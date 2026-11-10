import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:slice_app/adapters/fake/fakes.dart';
import 'package:slice_app/adapters/real/strip_camera.dart';
import 'package:slice_app/core/adapters.dart';
import 'package:slice_app/core/engine/native_strip_engine.dart';
import 'package:slice_app/core/strip.dart';
import 'package:slice_app/core/thermometer.dart';

import '../support/harness.dart';

void main() {
  test('camera path: a PNG of a strip decodes to the same gray bytes the engine got from the PGM', () {
    final pgm = decodePgm(File(strip(1)).readAsBytesSync())!;
    final png = img.encodePng(img.Image.fromBytes(width: pgm.width, height: pgm.height, bytes: pgm.pixels.buffer,
        bytesOffset: pgm.pixels.offsetInBytes, numChannels: 1));
    final gray = encodedImageToGray(Uint8List.fromList(png))!;
    expect([gray.width, gray.height], [pgm.width, pgm.height]);
    expect(gray.pixels, pgm.pixels);
    const engine = NativeStripEngine();
    expect(engine.read(gray).ratio, engine.read(pgm).ratio);
  });

  test('camera path: colour photos are reduced to luminance; junk bytes give null', () {
    final rgb = img.Image(width: 2, height: 1)
      ..setPixelRgb(0, 0, 255, 255, 255)
      ..setPixelRgb(1, 0, 0, 0, 0);
    expect(encodedImageToGray(Uint8List.fromList(img.encodePng(rgb)))!.pixels, [255, 0]);
    expect(encodedImageToGray(Uint8List.fromList([1, 2, 3])), isNull);
  });

  test('scripted thermometer replays a kit session fixture as BLE events', () async {
    final events = await ScriptedThermometer.fromFile('$kitDir/scenarios/fixtures/ble/session-001.json').session().toList();
    expect(events.first, isA<BleConnected>());
    expect((events.first as BleConnected).deviceName, isNotEmpty);
    expect(events.last, isA<BleDisconnected>());
    expect(events.whereType<BleNotification>().last.characteristic, kTemperatureMeasurementChar);
  });

  test('fake store plays its script once and records finishes without duplicates', () async {
    final store = FakeStore()
      ..purchaseScript = [
        {'event': 'pending'},
        {'event': 'purchased', 'txId': 't', 'receipt': 'r'}
      ];
    final events = await store.purchase('p').toList();
    expect(events[0], isA<StorePending>());
    expect((events[1] as StorePurchased).receipt, 'r');
    expect(await store.purchase('p').toList(), isEmpty);
    await store.finish('t');
    await store.finish('t');
    expect(store.finished, ['t']);
  });
}
