import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:slice_app/core/engine/native_strip_engine.dart';
import 'package:slice_app/core/model.dart';
import 'package:slice_app/core/strip.dart';

import '../support/harness.dart';

void main() {
  const engine = NativeStripEngine();

  group('C++ engine over FFI', () {
    test('reports the kit engine version', () {
      expect(engine.version, 'bakeoff-1.0.0');
    });

    test('agrees with the kit CLI (same C++ source) on status and ratio for public fixtures', () {
      final cli = File('$kitDir/engine/build/strip_cli');
      if (!cli.existsSync()) {
        markTestSkipped('kit strip_cli not built');
        return;
      }
      for (var n = 1; n <= 106; n += 3) {
        final out = (Process.runSync(cli.path, [strip(n)]).stdout as String).trim().split(' ');
        final r = engine.read(decodePgm(File(strip(n)).readAsBytesSync())!);
        expect(r.status, int.parse(out[0]), reason: 'status of strip $n');
        if (r.status == 0) expect(r.ratio, double.parse(out[1]), reason: 'ratio of strip $n');
      }
    });

    test('equal lines read as ratio 1, a half-strength test line as 0.5', () {
      expect(engine.read(synth()).status, 0);
      expect(engine.read(synth()).ratio, closeTo(1.0, 1e-9));
      expect(engine.read(synth(control: 80, test: 40)).ratio, closeTo(0.5, 1e-9));
    });

    test('failure statuses', () {
      expect(engine.read(synth(control: 0)).status, 1); // no control line
      expect(engine.read(synth(background: 30, control: 10, test: 10)).status, 2); // too dark
      expect(engine.read(synth(background: 252, control: 0, test: 0)).status, 3); // too bright
      expect(engine.read(GrayImage(10, 5, Uint8List(50))).status, 4); // too small
    });
  });

  group('PGM decoding', () {
    test('reads header and pixels', () {
      final img = decodePgm(Uint8List.fromList([...'P5\n3 2\n255\n'.codeUnits, 1, 2, 3, 4, 5, 6]))!;
      expect([img.width, img.height], [3, 2]);
      expect(img.pixels, [1, 2, 3, 4, 5, 6]);
    });
    test('pixel data may start with bytes that look like whitespace', () {
      final img = decodePgm(Uint8List.fromList([...'P5\n2 1\n255\n'.codeUnits, 10, 32]))!;
      expect(img.pixels, [10, 32]);
    });
    test('rejects other formats and truncated data', () {
      expect(decodePgm(Uint8List.fromList('P2\n1 1\n255\n0'.codeUnits)), isNull);
      expect(decodePgm(Uint8List.fromList([...'P5\n3 2\n255\n'.codeUnits, 1, 2])), isNull);
      expect(decodePgm(Uint8List(0)), isNull);
    });
  });

  group('scan_strip', () {
    late Harness premom;
    late Harness polly;
    setUp(() {
      premom = Harness('premom');
      polly = Harness('polly');
    });
    tearDown(() {
      premom.dispose();
      polly.dispose();
    });

    Future<Outcome> scan(Harness h, GrayImage? image, {String at = '2026-11-03T14:00:00Z', String type = 'lh'}) {
      h.clock.time = at;
      return h.core.scanStrip(type, image);
    }

    test('a good read becomes an lh observation: ratio to 3 decimals, engine version as reader', () async {
      final r = await scan(premom, synth(control: 90, test: 62)); // 0.68888...
      expect(r.ok, isTrue);
      final o = premom.snap.observations.single.obs;
      expect(o.type, 'lh');
      expect(o.source, 'strip_reader');
      expect(o.value, {'ratio': 0.689});
      expect(o.reader, {'engineVersion': 'bakeoff-1.0.0'});
      expect(o.observedAt, '2026-11-03T14:00:00Z');
    });

    test('failed reads return the specific error and create nothing', () async {
      expect((await scan(premom, synth(control: 0))).error, Err.stripNoControlLine);
      expect((await scan(premom, synth(background: 30, control: 10, test: 10))).error, Err.stripTooDark);
      expect((await scan(premom, synth(background: 252, control: 0, test: 0))).error, Err.stripTooBright);
      expect((await scan(premom, null)).error, Err.stripBadInput);
      expect(premom.snap.observations, isEmpty);
      expect(premom.snap.pendingMutations, 0);
      expect(premom.server.events, isEmpty);
    });

    test('Premom levels: low / high / peak at the pack thresholds, number locked without premium', () async {
      await scan(premom, synth(control: 100, test: 49), at: '2026-11-03T14:00:00Z'); // 0.49
      await scan(premom, synth(control: 100, test: 50), at: '2026-11-03T14:01:00Z'); // 0.50
      await scan(premom, synth(control: 100, test: 99), at: '2026-11-03T14:02:00Z'); // 0.99
      await scan(premom, synth(control: 100, test: 100), at: '2026-11-03T14:03:00Z'); // 1.00
      await scan(premom, synth(control: 100, test: 0), at: '2026-11-03T14:04:00Z'); // 0
      expect(premom.snap.observations.map((o) => o.display), [
        {'level': 'low', 'ratio': null, 'locked': true},
        {'level': 'high', 'ratio': null, 'locked': true},
        {'level': 'high', 'ratio': null, 'locked': true},
        {'level': 'peak', 'ratio': null, 'locked': true},
        {'level': 'low', 'ratio': null, 'locked': true},
      ]);
    });

    test('Polly levels: negative / positive at 0.8, never a number and never locked', () async {
      await scan(polly, synth(control: 100, test: 79), at: '2026-11-03T14:00:00Z');
      await scan(polly, synth(control: 100, test: 80), at: '2026-11-03T14:01:00Z');
      expect(polly.snap.observations.map((o) => o.display), [
        {'level': 'negative', 'ratio': null, 'locked': false},
        {'level': 'positive', 'ratio': null, 'locked': false},
      ]);
      // the ratio is still what gets stored and synced
      expect(polly.snap.observations.map((o) => o.obs.value), [
        {'ratio': 0.79},
        {'ratio': 0.8}
      ]);
    });

    test('the level is computed, not stored: nothing but the ratio goes to the server', () async {
      await scan(premom, synth(control: 100, test: 70));
      await premom.core.sync();
      final sent = premom.server.pushes.single.single['observation'] as Map;
      expect(sent['value'], {'ratio': 0.7});
      expect(sent.keys.toSet(), {'type', 'value', 'observedAt', 'source', 'reader'});
    });

    test('real fixture through the whole path', () async {
      final r = await premom.scanAt('2026-11-03T14:00:00Z', 1);
      expect(r.ok, isTrue);
      final ratio = premom.snap.observations.single.obs.value['ratio'] as double;
      expect((ratio * 1000).roundToDouble(), closeTo(ratio * 1000, 1e-9));
    });

    test('strip type must be in the pack and allow the strip reader', () async {
      expect((await scan(premom, synth(), type: 'bbt')).error, Err.sourceNotAllowed);
      expect((await scan(polly, synth(), type: 'mucus')).error, Err.unknownType);
    });
  });
}
