import 'package:flutter_test/flutter_test.dart';
import 'package:slice_app/core/model.dart';
import 'package:slice_app/core/thermometer.dart';

import '../support/harness.dart';

void main() {
  group('Temperature Measurement frame', () {
    test('Celsius: 24-bit little-endian mantissa and signed exponent', () {
      final f = parseTemperatureMeasurement(hexToBytes('00540e00fe'))!; // 0x000e54 = 3668, exp -2
      expect(f.fahrenheit, isFalse);
      expect(f.value, 36.68);
      expect(f.celsius, 36.68);
      expect(f.timestamp, isNull);
    });

    test('uses all three mantissa bytes', () {
      final f = parseTemperatureMeasurement(hexToBytes('00a09105fc'))!; // 0x0591a0 = 364960, exp -4
      expect(f.value, closeTo(36.496, 1e-9));
    });

    test('negative mantissa is sign-extended', () {
      final f = parseTemperatureMeasurement(hexToBytes('00ffffff00'))!; // -1 x 10^0
      expect(f.value, -1);
    });

    test('positive and zero exponents', () {
      expect(parseTemperatureMeasurement(hexToBytes('0025000000'))!.value, 37);
      expect(parseTemperatureMeasurement(hexToBytes('0004000001'))!.value, 40);
    });

    test('flags bit 0 means Fahrenheit and converts to Celsius', () {
      final f = parseTemperatureMeasurement(hexToBytes('01d20300ff'))!; // 978 x 10^-1 = 97.8 F
      expect(f.fahrenheit, isTrue);
      expect(f.value, 97.8);
      expect(f.celsius, closeTo(36.5556, 1e-4));
    });

    test('flags bit 1: 7-byte timestamp is read as UTC', () {
      // 36.52 C, 2026-11-05 06:30:07
      final f = parseTemperatureMeasurement(hexToBytes('02440e00fe' 'ea07' '0b' '05' '06' '1e' '07'))!;
      expect(f.timestamp, '2026-11-05T06:30:07Z');
      expect(f.value, 36.52);
    });

    test('flags bit 2: a type byte follows, after the timestamp when both are present', () {
      final both = parseTemperatureMeasurement(hexToBytes('06440e00fe' 'ea070b05061e00' '02'))!;
      expect(both.timestamp, '2026-11-05T06:30:00Z');
      expect(both.temperatureType, 2);
      final typeOnly = parseTemperatureMeasurement(hexToBytes('05d20300ff02'))!;
      expect(typeOnly.timestamp, isNull);
      expect(typeOnly.temperatureType, 2);
      expect(typeOnly.fahrenheit, isTrue);
    });

    test('NaN mantissa 0x7FFFFF is invalid', () {
      expect(parseTemperatureMeasurement(hexToBytes('00ffff7f00')), isNull);
      expect(parseTemperatureMeasurement(hexToBytes('00ffff7ffe')), isNull);
    });

    test('too short for the fields its flags declare is invalid', () {
      expect(parseTemperatureMeasurement(hexToBytes('')), isNull);
      expect(parseTemperatureMeasurement(hexToBytes('00540e')), isNull); // no room for the float
      expect(parseTemperatureMeasurement(hexToBytes('02440e00fe' 'ea070b0506')), isNull); // timestamp cut short
      expect(parseTemperatureMeasurement(hexToBytes('04440e00fe')), isNull); // type byte missing
      expect(parseTemperatureMeasurement(hexToBytes('06440e00fe' 'ea070b05061e00')), isNull); // type missing after ts
    });

    test('an impossible device date is invalid', () {
      expect(parseTemperatureMeasurement(hexToBytes('02440e00fe' 'ea07' '0d' '05' '06' '1e' '00')), isNull); // month 13
    });
  });

  group('session', () {
    late Harness h;
    setUp(() => h = Harness('premom'));
    tearDown(() => h.dispose());

    test('logs the final reading, ignores intermediates, records the device name', () async {
      final r = await h.thermoAt('2026-11-03T06:30:00Z', [
        connect(),
        notify('2A1E', '00fa0d00fe'), // 35.78
        notify('2A1E', '00130e00fe'), // 36.03
        notify('2A1C', '00540e00fe'), // 36.68 final
        disconnect(),
      ], device: 'EasyHome-EBT-100');
      expect(r.ok, isTrue);
      final o = h.snap.observations.single;
      expect(o.obs.value, {'celsius': 36.68});
      expect(o.obs.source, 'thermometer');
      expect(o.obs.reader, {'deviceModel': 'EasyHome-EBT-100'});
      expect(o.obs.observedAt, '2026-11-03T06:30:00Z');
      expect(o.display, {'celsius': 36.68});
    });

    test('only intermediate readings: thermo_no_final_reading and nothing is created', () async {
      final r = await h.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1E', '00540e00fe'), disconnect()]);
      expect(r.error, Err.thermoNoFinalReading);
      expect(h.snap.observations, isEmpty);
      expect(h.snap.pendingMutations, 0);
      expect(h.server.events, isEmpty);
    });

    test('a script that just ends counts as no final reading', () async {
      final r = await h.thermoAt('2026-11-03T06:30:00Z', [connect()]);
      expect(r.error, Err.thermoNoFinalReading);
    });

    test('Fahrenheit is converted and rounded to 2 decimals', () async {
      await h.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', '01d20300ff'), disconnect()]);
      expect(h.snap.observations.single.obs.value, {'celsius': 36.56}); // 97.8 F
    });

    test('device timestamp wins over the step time', () async {
      await h.thermoAt('2026-11-05T09:00:00Z', [connect(), notify('2A1C', '02440e00fe' 'ea070b05061e00'), disconnect()]);
      expect(h.snap.observations.single.obs.observedAt, '2026-11-05T06:30:00Z');
    });

    test('NaN and truncated finals are thermo_invalid_reading and create nothing', () async {
      expect((await h.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', '00ffff7ffe'), disconnect()])).error,
          Err.thermoInvalidReading);
      expect((await h.thermoAt('2026-11-03T06:31:00Z', [connect(), notify('2A1C', '00540e'), disconnect()])).error,
          Err.thermoInvalidReading);
      expect(h.snap.observations, isEmpty);
    });

    test('readings outside the pack range are invalid; the limits themselves are fine', () async {
      Future<String?> send(String hex) async =>
          (await h.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', hex), disconnect()])).error;
      expect(await send('00470d00fe'), Err.thermoInvalidReading); // 33.99
      expect(await send('00691000fe'), Err.thermoInvalidReading); // 42.01
      expect(await send('01dc0500ff'), Err.thermoInvalidReading); // 150.0 F = 65.56 C
      expect(h.snap.observations, isEmpty);
      expect(await send('00480d00fe'), isNull); // 34.00
      expect(await send('00681000fe'), isNull); // 42.00
      expect(h.snap.observations.map((o) => o.obs.value['celsius']), [34.0, 42.0]);
    });

    test('a pack entry that does not allow the thermometer refuses the session', () async {
      expect((await h.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', '00540e00fe'), disconnect()], type: 'flow')).error,
          Err.sourceNotAllowed);
      expect((await h.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', '00540e00fe'), disconnect()], type: 'nope')).error,
          Err.unknownType);
    });
  });
}
