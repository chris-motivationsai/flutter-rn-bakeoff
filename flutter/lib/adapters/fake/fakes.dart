/// Scripted stand-ins for the device adapters. Pure Dart: used by the scenario runner,
/// the unit tests and the widget tests.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import '../../core/adapters.dart';
import '../../core/strip.dart';
import '../../core/thermometer.dart';

/// A clock that says whatever it was last told.
class ManualClock implements Clock {
  ManualClock([this.time = '2026-01-01T00:00:00Z']);
  String time;
  @override
  String now() => time;
}

/// "Camera" that hands back a PGM file (or raw image) chosen beforehand.
class FakeStripSource implements StripImageSource {
  FakeStripSource([this.next]);
  GrayImage? next;

  void loadPgmFile(String path) => next = decodePgm(File(path).readAsBytesSync());

  @override
  Future<GrayImage?> capture() async => next;
}

/// "Radio" that replays a session script: `{device: {name}, events: [{event, char?, hex?}]}`.
class ScriptedThermometer implements ThermometerTransport {
  ScriptedThermometer(this.script);
  factory ScriptedThermometer.fromFile(String path) =>
      ScriptedThermometer((jsonDecode(File(path).readAsStringSync()) as Map).cast<String, Object?>());

  final Map<String, Object?> script;

  @override
  Stream<BleEvent> session() async* {
    final name = ((script['device'] as Map?)?['name'] as String?) ?? '';
    for (final e in (script['events'] as List).cast<Map>()) {
      switch (e['event']) {
        case 'connect':
          yield BleConnected(name);
        case 'notify':
          yield BleNotification((e['char'] as String).toUpperCase(), _hex(e['hex'] as String));
        case 'disconnect':
          yield const BleDisconnected();
          return;
      }
    }
  }

  static Uint8List _hex(String h) => hexToBytes(h);
}

/// Store that plays back scripted events and remembers which transactions were finished.
/// It outlives app restarts, like the real store does.
class FakeStore implements StoreAdapter {
  /// Events the next purchase() will emit: `{event: pending|cancelled|error|purchased, txId?, receipt?, code?}`.
  List<Map<String, Object?>> purchaseScript = [];

  /// Purchases the next restore() will return: `{txId, receipt}`.
  List<Map<String, Object?>> restoreScript = [];

  final List<String> finished = [];
  int purchaseCalls = 0;
  int restoreCalls = 0;

  @override
  Stream<StoreEvent> purchase(String productId) async* {
    purchaseCalls++;
    final script = purchaseScript;
    purchaseScript = [];
    for (final e in script) {
      switch (e['event']) {
        case 'pending':
          yield const StorePending();
        case 'cancelled':
          yield const StoreCancelled();
        case 'error':
          yield StoreFailed(e['code'] as String?);
        case 'purchased':
          yield StorePurchased(e['txId'] as String, e['receipt'] as String);
      }
    }
  }

  @override
  Future<List<StorePurchased>> restore() async {
    restoreCalls++;
    final script = restoreScript;
    restoreScript = [];
    return [for (final e in script) StorePurchased(e['txId'] as String, e['receipt'] as String)];
  }

  @override
  Future<void> finish(String txId) async {
    if (!finished.contains(txId)) finished.add(txId);
  }
}
