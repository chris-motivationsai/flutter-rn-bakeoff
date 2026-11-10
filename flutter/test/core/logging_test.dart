import 'package:flutter_test/flutter_test.dart';
import 'package:slice_app/core/contracts.dart';
import 'package:slice_app/core/model.dart';
import 'package:slice_app/core/pack.dart';

import '../support/harness.dart';

void main() {
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

  group('manual log', () {
    test('creates a pending manual observation at the injected time, with no reader', () async {
      final r = await premom.logAt('2026-11-03T06:40:00Z', 'bbt', {'celsius': 36.1});
      expect(r.ok, isTrue);
      final s = premom.snapJson;
      expect(s['observations'], [
        {'type': 'bbt', 'observedAt': '2026-11-03T06:40:00Z', 'source': 'manual', 'sync': 'pending', 'display': {'celsius': 36.1}}
      ]);
      expect(s['pendingMutations'], 1);
      expect(premom.snap.observations.single.obs.reader, isNull);
    });

    test('check order: unknown_type, then source_not_allowed, then invalid_value', () async {
      // mucus is not in Polly at all, so even a bad value reports unknown_type
      expect((await polly.logAt('2026-11-03T08:00:00Z', 'mucus', {'code': 'nonsense'})).error, Err.unknownType);
      // lh exists but cannot be typed in, even with a plausible value
      expect((await premom.logAt('2026-11-03T08:00:00Z', 'lh', {'ratio': 0.5})).error, Err.sourceNotAllowed);
      expect((await premom.logAt('2026-11-03T08:00:00Z', 'lh', {'nope': true})).error, Err.sourceNotAllowed);
      expect((await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'torrential'})).error, Err.invalidValue);
      expect(premom.snap.observations, isEmpty);
      expect(polly.snap.observations, isEmpty);
      expect(premom.server.events, isEmpty);
    });

    test('the same type can be valid in one pack and unknown in the other', () async {
      expect((await premom.logAt('2026-11-03T08:00:00Z', 'mucus', {'code': 'eggwhite'})).ok, isTrue);
      expect((await polly.logAt('2026-11-03T08:00:00Z', 'mucus', {'code': 'eggwhite'})).error, Err.unknownType);
    });

    test('number range comes from the pack: limits are inclusive', () async {
      expect((await premom.logAt('2026-11-03T06:00:00Z', 'bbt', {'celsius': 33.99})).error, Err.invalidValue);
      expect((await premom.logAt('2026-11-03T06:01:00Z', 'bbt', {'celsius': 42.01})).error, Err.invalidValue);
      expect((await premom.logAt('2026-11-03T06:02:00Z', 'bbt', {'celsius': 34})).ok, isTrue);
      expect((await premom.logAt('2026-11-03T06:03:00Z', 'bbt', {'celsius': 42.0})).ok, isTrue);
      expect(premom.snap.observations.length, 2);
    });

    test('malformed values are invalid_value', () async {
      for (final bad in <Object?>[
        {'celsius': '36.5'},
        {'celsius': null},
        {'fahrenheit': 98.0},
        {'celsius': 36.5, 'extra': 1},
        <String, Object?>{},
        'hot',
        null,
        {'celsius': double.nan},
      ]) {
        expect((await premom.logAt('2026-11-03T06:00:00Z', 'bbt', bad is Map ? bad.cast<String, Object?>() : {'celsius': bad})).error,
            Err.invalidValue,
            reason: '$bad');
      }
      expect((await premom.logAt('2026-11-03T06:00:00Z', 'flow', {'code': 3})).error, Err.invalidValue);
      expect((await premom.logAt('2026-11-03T06:00:00Z', 'flow', {'celsius': 36.5})).error, Err.invalidValue);
      expect(premom.snap.observations, isEmpty);
    });

    test('bbt is stored rounded to 2 decimals', () async {
      await premom.logAt('2026-11-03T06:00:00Z', 'bbt', {'celsius': 36.456});
      expect(premom.snap.observations.single.obs.value, {'celsius': 36.46});
    });

    test('every enum value the pack lists is accepted', () async {
      var minute = 10;
      for (final e in premom.pack.catalog.where((e) => e.kind == 'enum')) {
        for (final v in e.values!) {
          expect((await premom.logAt('2026-11-03T08:${minute++}:00Z', e.type, {'code': v})).ok, isTrue, reason: '${e.type}/$v');
        }
      }
    });
  });

  group('analytics gate', () {
    test('one event per created observation with exactly name + {type, source, pack}', () async {
      await premom.logAt('2026-11-03T06:40:00Z', 'bbt', {'celsius': 36.1});
      await premom.scanAt('2026-11-03T14:00:00Z', 1);
      await premom.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', '00540e00fe'), disconnect()]);
      await polly.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      expect(premom.server.events, [
        {'name': 'observation_logged', 'props': {'type': 'bbt', 'source': 'manual', 'pack': 'premom'}},
        {'name': 'observation_logged', 'props': {'type': 'lh', 'source': 'strip_reader', 'pack': 'premom'}},
        {'name': 'observation_logged', 'props': {'type': 'bbt', 'source': 'thermometer', 'pack': 'premom'}},
      ]);
      expect(polly.server.events, [
        {'name': 'observation_logged', 'props': {'type': 'flow', 'source': 'manual', 'pack': 'polly'}},
      ]);
      expect(premom.server.eventViolations, isEmpty);
    });

    test('edits, deletes, syncs and failed logs send no event', () async {
      await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      await premom.core.edit(const TargetKey('flow', '2026-11-03T08:00:00Z'), {'code': 'heavy'});
      await premom.core.sync();
      await premom.core.delete(const TargetKey('flow', '2026-11-03T08:00:00Z'));
      await premom.logAt('2026-11-03T09:00:00Z', 'flow', {'code': 'bad'});
      expect(premom.server.events.length, 1);
    });

    test('offline: the event is dropped, the log still succeeds, nothing is sent later', () async {
      premom.server.mode = 'down';
      expect((await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'})).ok, isTrue);
      premom.server.mode = 'http503';
      expect((await premom.logAt('2026-11-03T09:00:00Z', 'flow', {'code': 'light'})).ok, isTrue);
      premom.server.mode = 'ok';
      await premom.core.sync();
      expect(premom.server.events, isEmpty);
      expect(premom.server.requests.where((r) => r.endsWith('/v1/events')).length, 2); // one attempt each
      expect(premom.server.live.length, 2);
    });
  });

  group('edit and delete', () {
    const flow = TargetKey('flow', '2026-11-03T08:00:00Z');

    test('edit changes a manual observation and keeps its time and source', () async {
      await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      premom.clock.time = '2026-11-03T20:00:00Z';
      expect((await premom.core.edit(flow, {'code': 'heavy'})).ok, isTrue);
      final o = premom.snap.observations.single;
      expect(o.obs.value, {'code': 'heavy'});
      expect(o.obs.observedAt, '2026-11-03T08:00:00Z');
      expect(o.obs.source, 'manual');
    });

    test('edit errors: not_found, read_only before invalid_value, invalid_value', () async {
      await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      await premom.scanAt('2026-11-03T14:00:00Z', 1);
      await premom.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', '00540e00fe'), disconnect()]);
      expect((await premom.core.edit(const TargetKey('flow', '2026-11-03T08:00:01Z'), {'code': 'heavy'})).error, Err.notFound);
      expect((await premom.core.edit(const TargetKey('mucus', '2026-11-03T08:00:00Z'), {'code': 'dry'})).error, Err.notFound);
      expect((await premom.core.edit(const TargetKey('lh', '2026-11-03T14:00:00Z'), {'ratio': 1.5})).error, Err.readOnly);
      expect((await premom.core.edit(const TargetKey('lh', '2026-11-03T14:00:00Z'), {'ratio': 'bad'})).error, Err.readOnly);
      expect((await premom.core.edit(const TargetKey('bbt', '2026-11-03T06:30:00Z'), {'celsius': 36})).error, Err.readOnly);
      expect((await premom.core.edit(flow, {'code': 'nope'})).error, Err.invalidValue);
      expect((await premom.core.edit(flow, {'celsius': 36.5})).error, Err.invalidValue);
      expect(premom.snap.observations.firstWhere((o) => o.obs.type == 'flow').obs.value, {'code': 'light'});
    });

    test('delete works for any source; a second delete is not_found', () async {
      await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      await premom.scanAt('2026-11-03T14:00:00Z', 1);
      await premom.thermoAt('2026-11-03T06:30:00Z', [connect(), notify('2A1C', '00540e00fe'), disconnect()]);
      expect((await premom.core.delete(const TargetKey('lh', '2026-11-03T14:00:00Z'))).ok, isTrue);
      expect((await premom.core.delete(const TargetKey('bbt', '2026-11-03T06:30:00Z'))).ok, isTrue);
      expect((await premom.core.delete(flow)).ok, isTrue);
      expect((await premom.core.delete(flow)).error, Err.notFound);
      expect(premom.snap.observations, isEmpty);
    });

    test('a deleted observation cannot be edited', () async {
      await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      await premom.core.sync();
      await premom.core.delete(flow);
      expect((await premom.core.edit(flow, {'code': 'heavy'})).error, Err.notFound);
    });
  });

  group('snapshot', () {
    test('observations are sorted by observedAt, then type', () async {
      await premom.logAt('2026-11-03T20:00:00Z', 'mucus', {'code': 'dry'});
      await premom.logAt('2026-11-03T08:00:00Z', 'mucus', {'code': 'dry'});
      await premom.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      await premom.logAt('2026-11-03T08:00:00Z', 'bbt', {'celsius': 36.5});
      expect(premom.snap.observations.map((o) => '${o.obs.observedAt.substring(11, 13)} ${o.obs.type}'),
          ['08 bbt', '08 flow', '08 mucus', '20 mucus']);
    });

    test('names the pack', () {
      expect(premom.snapJson['pack'], 'premom');
      expect(polly.snapJson['pack'], 'polly');
    });
  });

  group('pack', () {
    test('level is the highest minRatio at or below the ratio, whatever order the pack lists them in', () {
      final pack = StagePack.fromJson({
        'packId': 'x',
        'appName': 'X',
        'catalog': [
          {
            'type': 'lh',
            'kind': 'strip',
            'sources': ['strip_reader'],
            'levels': [
              {'level': 'c', 'minRatio': 1.0},
              {'level': 'a', 'minRatio': 0.2},
              {'level': 'b', 'minRatio': 0.5},
            ],
            'numeric': null,
          }
        ],
        'products': <Object>[],
      });
      final e = pack.entry('lh')!;
      expect(e.levelFor(0.1), isNull);
      expect(e.levelFor(0.2), 'a');
      expect(e.levelFor(0.499), 'a');
      expect(e.levelFor(0.5), 'b');
      expect(e.levelFor(0.999), 'b');
      expect(e.levelFor(1.0), 'c');
      expect(e.levelFor(4), 'c');
      expect(e.field, 'ratio'); // from the contract, the pack does not name it
      expect(e.hasNumeric, isFalse);
    });

    test('app name, catalog and products differ by pack, from the pack files', () {
      expect(premom.pack.appName, 'Premom');
      expect(polly.pack.appName, 'Polly');
      expect(polly.pack.has('mucus'), isFalse);
      expect(premom.pack.has('mucus'), isTrue);
      expect(polly.pack.products, isEmpty);
      expect(premom.pack.product('premium_monthly')!.entitlement, 'premium');
      expect(premom.pack.entry('lh')!.numericEntitlement, 'premium');
      expect(polly.pack.entry('lh')!.hasNumeric, isFalse);
    });
  });

  group('contracts', () {
    test('isoSeconds drops milliseconds and converts to UTC', () {
      expect(isoSeconds(DateTime.utc(2026, 11, 3, 6, 45, 0, 999)), '2026-11-03T06:45:00Z');
      expect(isIsoSeconds('2026-11-03T06:45:00Z'), isTrue);
      expect(isIsoSeconds('2026-11-03T06:45:00.000Z'), isFalse);
      expect(isIsoSeconds('2026-11-03 06:45:00'), isFalse);
    });
    test('roundTo', () {
      expect(roundTo(36.456, 2), 36.46);
      expect(roundTo(36.454, 2), 36.45);
      expect(roundTo(0.68888, 3), 0.689);
      expect(roundTo(1, 3), 1.0);
    });
    test('schema checker enforces required, extra fields, enums, patterns and bounds', () {
      Map<String, Object?> event([Map<String, Object?> extra = const {}]) => {
            'name': 'observation_logged',
            'props': {'type': 'bbt', 'source': 'manual', 'pack': 'premom', ...extra},
          };
      expect(validateAgainst('AnalyticsEvent', event()), isNull);
      expect(validateAgainst('AnalyticsEvent', event({'value': 36.5})), isNotNull);
      expect(validateAgainst('AnalyticsEvent', {...event(), 'observedAt': 'x'}), isNotNull);
      expect(validateAgainst('AnalyticsEvent', {'name': 'other', 'props': event()['props']}), isNotNull);
      expect(validateAgainst('AnalyticsEvent', {'name': 'observation_logged'}), isNotNull);
      expect(validateAgainst('Entitlement', {'name': 'premium', 'expiresAt': '2026-12-01T00:00:00Z'}), isNull);
      expect(validateAgainst('Entitlement', {'name': 'premium', 'expiresAt': '2026-12-01'}), isNotNull);
      expect(validateSchema(kValueSchemas['bbt'], {'celsius': 43}), isNotNull);
      expect(validateSchema(kValueSchemas['flow'], {'code': 'heavy'}), isNull);
      expect(validateAgainst('PushRequest', {'deviceId': 'd', 'mutations': <Object>[]}), isNotNull);
    });
  });
}
