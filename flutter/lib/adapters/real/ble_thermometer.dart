/// Real Bluetooth adapter: package:flutter_blue_plus. Finds a Health Thermometer (0x1809),
/// subscribes to its two temperature characteristics and forwards what arrives as
/// [BleEvent]s. All protocol decisions (which characteristic counts, frame parsing) stay in
/// lib/core/thermometer.dart, shared with the fake.
///
/// NOT exercised on this machine: needs a phone and a thermometer. Statically checked only.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_blue_plus/flutter_blue_plus.dart';

import '../../core/adapters.dart';
import '../../core/thermometer.dart';

class FlutterBluePlusThermometer implements ThermometerTransport {
  FlutterBluePlusThermometer({
    required this.license,
    this.scanTimeout = const Duration(seconds: 20),
    this.sessionTimeout = const Duration(minutes: 3),
  });

  /// flutter_blue_plus 2.x asks every caller to state its licence tier on connect.
  final License license;
  final Duration scanTimeout;
  final Duration sessionTimeout;

  static String _short(Guid g) => g.str.toUpperCase();

  @override
  Stream<BleEvent> session() {
    final out = StreamController<BleEvent>();
    final subs = <StreamSubscription<Object?>>[];
    BluetoothDevice? device;
    var finished = false;

    Future<void> finish({bool disconnected = false}) async {
      if (finished) return;
      finished = true;
      for (final s in subs) {
        await s.cancel();
      }
      if (disconnected && !out.isClosed) out.add(const BleDisconnected());
      try {
        await FlutterBluePlus.stopScan();
        await device?.disconnect();
      } catch (_) {}
      if (!out.isClosed) await out.close();
    }

    Future<void> run() async {
      try {
        // 1. find a thermometer
        final found = Completer<ScanResult>();
        subs.add(FlutterBluePlus.onScanResults.listen((results) {
          if (results.isNotEmpty && !found.isCompleted) found.complete(results.first);
        }));
        await FlutterBluePlus.startScan(withServices: [Guid(kHealthThermometerService)], timeout: scanTimeout);
        final hit = await found.future.timeout(scanTimeout);
        await FlutterBluePlus.stopScan();
        final d = device = hit.device;

        // 2. connect
        await d.connect(license: license);
        final name = d.platformName.isNotEmpty ? d.platformName : hit.advertisementData.advName;
        out.add(BleConnected(name));
        subs.add(d.connectionState.skip(1).listen((s) {
          if (s == BluetoothConnectionState.disconnected) finish(disconnected: true);
        }));

        // 3. subscribe to final (2A1C, indicate) and intermediate (2A1E, notify) readings
        final services = await d.discoverServices();
        for (final service in services.where((s) => _short(s.uuid) == kHealthThermometerService)) {
          for (final c in service.characteristics) {
            final id = _short(c.uuid);
            if (id != kTemperatureMeasurementChar && id != kIntermediateTemperatureChar) continue;
            subs.add(c.onValueReceived.listen((bytes) {
              if (!out.isClosed) out.add(BleNotification(id, Uint8List.fromList(bytes)));
            }));
            await c.setNotifyValue(true);
          }
        }
        // 4. give up eventually if the device never says goodbye
        subs.add(Stream<void>.fromFuture(Future<void>.delayed(sessionTimeout)).listen((_) => finish(disconnected: true)));
      } catch (_) {
        // Could not scan / connect / subscribe: the session ends without a final reading.
        await finish(disconnected: true);
      }
    }

    out.onListen = run;
    out.onCancel = finish; // the core stops listening once it has its final reading
    return out.stream;
  }
}
