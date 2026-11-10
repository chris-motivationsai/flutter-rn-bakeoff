import 'package:flutter_test/flutter_test.dart';
import 'package:slice_app/core/contracts.dart';
import 'package:slice_app/core/model.dart';

import '../support/harness.dart';

String at(int minute, {int hour = 8, int day = 3}) =>
    '2026-11-${day.toString().padLeft(2, '0')}T${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}:00Z';

void main() {
  late Harness h;
  setUp(() => h = Harness('premom'));
  tearDown(() => h.dispose());

  const flow = TargetKey('flow', '2026-11-03T08:00:00Z');
  Future<void> logFlow([String code = 'light']) => h.logAt(at(0), 'flow', {'code': code});

  group('push', () {
    test('sends a contract-shaped upsert with baseRevision 0 and marks it synced', () async {
      await logFlow();
      expect((await h.core.sync()).ok, isTrue);
      final m = h.server.pushes.single.single;
      expect(m['op'], 'upsert');
      expect(m['baseRevision'], 0);
      expect(m['observation'], {'type': 'flow', 'value': {'code': 'light'}, 'observedAt': at(0), 'source': 'manual'});
      expect(validateAgainst('Mutation', m), isNull);
      expect(h.snap.pendingMutations, 0);
      expect(h.snap.observations.single.synced, isTrue);
      expect(h.server.rejected, isEmpty);
    });

    test('nothing pending: no push request at all, but the pull still happens', () async {
      expect((await h.core.sync()).ok, isTrue);
      expect(h.server.pushes, isEmpty);
      expect(h.server.requests, ['GET /v1/sync/pull']);
    });

    test('a backlog goes out oldest first in requests of at most 20', () async {
      for (var i = 0; i < 45; i++) {
        await h.logAt(at(i), 'flow', {'code': 'light'});
      }
      expect((await h.core.sync()).ok, isTrue);
      expect(h.server.pushes.map((p) => p.length), [20, 20, 5]);
      final sentTimes = [for (final p in h.server.pushes) for (final m in p) (m['observation'] as Map)['observedAt']];
      expect(sentTimes, [for (var i = 0; i < 45; i++) at(i)]);
      expect(h.snap.pendingMutations, 0);
      expect(h.server.live.length, 45);
    });

    test('exactly 20 pending is one request; 21 is two', () async {
      for (var i = 0; i < 20; i++) {
        await h.logAt(at(i), 'flow', {'code': 'light'});
      }
      await h.core.sync();
      expect(h.server.pushes.map((p) => p.length), [20]);
      for (var i = 20; i < 41; i++) {
        await h.logAt(at(i), 'flow', {'code': 'light'});
      }
      await h.core.sync();
      expect(h.server.pushes.map((p) => p.length), [20, 20, 1]);
    });

    test('push order follows when each observation became pending, not its observedAt', () async {
      await h.logAt(at(30), 'flow', {'code': 'light'});
      await h.logAt(at(10), 'mucus', {'code': 'dry'});
      await h.logAt(at(20), 'bbt', {'celsius': 36.5});
      // editing the first does not move it to the back of the queue
      await h.core.edit(TargetKey('flow', at(30)), {'code': 'heavy'});
      await h.core.sync();
      expect(h.server.pushes.single.map((m) => (m['observation'] as Map)['type']), ['flow', 'mucus', 'bbt']);
    });

    test('server down or 503: sync reports network and everything stays pending', () async {
      await logFlow();
      for (final mode in ['down', 'http503']) {
        h.server.mode = mode;
        expect((await h.core.sync()).error, Err.network, reason: mode);
        expect(h.snap.pendingMutations, 1);
        expect(h.snap.observations.single.synced, isFalse);
      }
      h.server.mode = 'ok';
      expect((await h.core.sync()).ok, isTrue);
      expect(h.snap.pendingMutations, 0);
    });

    test('a retry reuses the same mutationId, also across a restart', () async {
      await logFlow();
      h.server.mode = 'http503';
      await h.core.sync();
      h.server.mode = 'ok';
      h.server.applyThenDrop = 1;
      expect((await h.core.sync()).error, Err.network);
      h.restart();
      expect((await h.core.sync()).ok, isTrue);
      expect(h.server.pushes.length, 2);
      expect(h.server.pushes[1].single['mutationId'], h.server.pushes[0].single['mutationId']);
      expect(h.server.pushes[1].single['id'], h.server.pushes[0].single['id']);
    });

    test('applied but never answered: the retry is a duplicate, not a second copy or a conflict', () async {
      await logFlow();
      h.server.applyThenDrop = 1;
      expect((await h.core.sync()).error, Err.network);
      expect(h.snap.pendingMutations, 1);
      expect(h.server.live.length, 1);
      expect((await h.core.sync()).ok, isTrue);
      expect(h.server.live.length, 1);
      expect(h.snap.pendingMutations, 0);
      expect(h.snap.conflicts, isEmpty);
      expect(h.snap.observations.single.synced, isTrue);
      // the revision from the duplicate answer is remembered: a later edit is not a conflict
      await h.core.edit(flow, {'code': 'heavy'});
      await h.core.sync();
      expect(h.snap.conflicts, isEmpty);
      expect(h.server.live.single['value'], {'code': 'heavy'});
    });

    test('a failure part-way keeps what was confirmed and leaves the rest pending', () async {
      for (var i = 0; i < 25; i++) {
        await h.logAt(at(i), 'flow', {'code': 'light'});
      }
      await h.core.sync();
      expect(h.snap.pendingMutations, 0);
      var calls = 0;
      for (var i = 25; i < 50; i++) {
        await h.logAt(at(i), 'flow', {'code': 'light'});
      }
      h.server.onPush = () {
        calls++;
        if (calls == 2) h.server.mode = 'down';
      };
      expect((await h.core.sync()).error, Err.network);
      expect(h.snap.pendingMutations, 5);
      expect(h.snap.observations.where((o) => !o.synced).map((o) => o.obs.observedAt), [for (var i = 45; i < 50; i++) at(i)]);
      h.server.onPush = null;
      h.server.mode = 'ok';
      expect((await h.core.sync()).ok, isTrue);
      expect(h.server.live.length, 50);
    });

    test('edit after sync sends the confirmed revision as baseRevision', () async {
      await logFlow();
      await h.core.sync();
      await h.core.edit(flow, {'code': 'heavy'});
      expect(h.snap.observations.single.synced, isFalse);
      await h.core.sync();
      expect(h.server.pushes[1].single['baseRevision'], 1);
      expect(h.server.pushes[1].single['id'], h.server.pushes[0].single['id']);
      expect(h.server.pushes[1].single['mutationId'], isNot(h.server.pushes[0].single['mutationId']));
      expect(h.server.rejected, isEmpty);
      expect(h.snap.conflicts, isEmpty);
    });

    test('delete after sync sends a delete without a body and removes the row once confirmed', () async {
      await logFlow();
      await h.core.sync();
      await h.core.delete(flow);
      expect(h.snap.observations, isEmpty); // hidden straight away
      expect(h.snap.pendingMutations, 1); // deletes count
      await h.core.sync();
      final m = h.server.pushes[1].single;
      expect(m['op'], 'delete');
      expect(m['baseRevision'], 1);
      expect(m.containsKey('observation'), isFalse);
      expect(h.server.live, isEmpty);
      expect(h.snap.pendingMutations, 0);
      expect(h.core.store.all(), isEmpty);
    });

    test('the device id is stable across pushes and restarts', () async {
      await logFlow();
      await h.core.sync();
      h.restart();
      await h.logAt(at(5), 'flow', {'code': 'light'});
      await h.core.sync();
      expect(h.server.pushDeviceIds.toSet().length, 1);
      expect(h.server.pushDeviceIds.first, isNotEmpty);
    });
  });

  group('one pending change per observation', () {
    test('edits before a sync coalesce into one upsert carrying the last value', () async {
      await logFlow();
      await h.core.edit(flow, {'code': 'medium'});
      await h.core.edit(flow, {'code': 'heavy'});
      expect(h.snap.pendingMutations, 1);
      await h.core.sync();
      expect(h.server.pushes.single.length, 1);
      expect((h.server.pushes.single.single['observation'] as Map)['value'], {'code': 'heavy'});
      expect(h.server.counter, 1);
    });

    test('each replacing change gets a fresh mutationId', () async {
      await logFlow();
      h.server.mode = 'down';
      await h.core.sync();
      final before = h.core.store.pending().single.pending!.mutationId;
      await h.core.edit(flow, {'code': 'heavy'});
      expect(h.core.store.pending().single.pending!.mutationId, isNot(before));
    });

    test('create then delete before any sync sends nothing', () async {
      await logFlow();
      expect(h.snap.pendingMutations, 1);
      await h.core.delete(flow);
      expect(h.snap.pendingMutations, 0);
      expect(h.snap.observations, isEmpty);
      await h.core.sync();
      expect(h.server.pushes, isEmpty);
      expect(h.server.obs, isEmpty);
    });

    test('edit then delete of a synced observation is a single delete', () async {
      await logFlow();
      await h.core.sync();
      await h.core.edit(flow, {'code': 'heavy'});
      await h.core.delete(flow);
      expect(h.snap.pendingMutations, 1);
      await h.core.sync();
      expect(h.server.pushes[1].map((m) => m['op']), ['delete']);
      expect(h.server.live, isEmpty);
      expect(h.server.rejected, isEmpty);
    });
  });

  group('conflicts', () {
    test('remote edit first: the server copy wins and the loss is recorded', () async {
      await logFlow();
      await h.core.sync();
      h.server.remoteUpsert('flow', at(0), {'code': 'spotting'});
      await h.core.edit(flow, {'code': 'heavy'});
      expect((await h.core.sync()).ok, isTrue);
      final o = h.snap.observations.single;
      expect(o.obs.value, {'code': 'spotting'});
      expect(o.synced, isTrue);
      expect(h.snap.pendingMutations, 0);
      expect(h.snapJson['conflicts'], [
        {'type': 'flow', 'observedAt': at(0)}
      ]);
      expect(h.server.live.single['value'], {'code': 'spotting'});
      // the adopted copy carries the server revision: the next edit goes through cleanly
      await h.core.edit(flow, {'code': 'medium'});
      await h.core.sync();
      expect(h.server.live.single['value'], {'code': 'medium'});
      expect(h.snap.conflicts.length, 1);
    });

    test('local edit loses to a remote delete: the observation disappears', () async {
      await logFlow();
      await h.core.sync();
      h.server.remoteDelete('flow', at(0));
      await h.core.edit(flow, {'code': 'heavy'});
      await h.core.sync();
      expect(h.snap.observations, isEmpty);
      expect(h.core.store.all(), isEmpty);
      expect(h.snap.conflicts.single.type, 'flow');
      expect(h.server.live, isEmpty);
    });

    test('local delete loses to a remote edit: the observation comes back', () async {
      await logFlow();
      await h.core.sync();
      h.server.remoteUpsert('flow', at(0), {'code': 'spotting'});
      await h.core.delete(flow);
      await h.core.sync();
      expect(h.snap.observations.single.obs.value, {'code': 'spotting'});
      expect(h.snap.observations.single.synced, isTrue);
      expect(h.snap.conflicts.single.observedAt, at(0));
      expect(h.snap.pendingMutations, 0);
    });

    test('conflicts are listed in the order they happened and survive a restart', () async {
      await h.logAt(at(0), 'flow', {'code': 'light'});
      await h.logAt(at(1), 'mucus', {'code': 'dry'});
      await h.core.sync();
      h.server.remoteUpsert('mucus', at(1), {'code': 'sticky'});
      await h.core.edit(TargetKey('mucus', at(1)), {'code': 'watery'});
      await h.core.sync();
      h.server.remoteUpsert('flow', at(0), {'code': 'spotting'});
      await h.core.edit(flow, {'code': 'heavy'});
      await h.core.sync();
      h.restart();
      expect(h.snap.conflicts.map((c) => c.type), ['mucus', 'flow']);
    });
  });

  group('push answered, then the pull fails', () {
    test('confirmed pushes stay confirmed and their revision is kept', () async {
      await logFlow();
      h.server.failPulls = 1;
      expect((await h.core.sync()).error, Err.network);
      expect(h.snap.pendingMutations, 0);
      expect(h.snap.observations.single.synced, isTrue);
      expect(h.core.store.all().single.baseRevision, 1);
      // so the next edit is a clean update, not a conflict
      await h.core.edit(flow, {'code': 'heavy'});
      expect((await h.core.sync()).ok, isTrue);
      expect(h.server.pushes[1].single['baseRevision'], 1);
      expect(h.snap.conflicts, isEmpty);
      expect(h.server.live.single['value'], {'code': 'heavy'});
    });

    test('a conflict is resolved to the server copy by the push answer alone', () async {
      await logFlow();
      await h.core.sync();
      h.server.remoteUpsert('flow', at(0), {'code': 'spotting'});
      await h.core.edit(flow, {'code': 'heavy'});
      h.server.failPulls = 1;
      expect((await h.core.sync()).error, Err.network);
      expect(h.snap.observations.single.obs.value, {'code': 'spotting'});
      expect(h.snap.observations.single.synced, isTrue);
      expect(h.core.store.all().single.baseRevision, 2);
      expect(h.snap.conflicts.length, 1);
    });

    test('a remote change to an observation edited locally waits for the push to decide', () async {
      // The pull is the only request that succeeds here: the local edit must survive it.
      await logFlow();
      await h.core.sync();
      await h.core.edit(flow, {'code': 'heavy'});
      h.server.remoteUpsert('flow', at(0), {'code': 'spotting'});
      final page = await h.core.api.pull(h.core.store.cursor);
      expect(page.changes.single['value'], {'code': 'spotting'});
      h.core.applyPull(page);
      expect(h.snap.observations.single.obs.value, {'code': 'heavy'});
      expect(h.snap.pendingMutations, 1);
    });
  });

  group('pull', () {
    test('remote creations, edits and deletions arrive', () async {
      await logFlow();
      await h.core.sync();
      h.server.remoteUpsert('mucus', at(5), {'code': 'creamy'});
      h.server.remoteUpsert('flow', at(0), {'code': 'heavy'});
      await h.core.sync();
      expect(h.snap.observations.map((o) => o.obs.value), [
        {'code': 'heavy'},
        {'code': 'creamy'}
      ]);
      expect(h.snap.observations.every((o) => o.synced), isTrue);
      h.server.remoteDelete('mucus', at(5));
      await h.core.sync();
      expect(h.snap.observations.map((o) => o.obs.type), ['flow']);
      expect(h.snap.conflicts, isEmpty);
    });

    test('the cursor is stored, sent on the next pull and survives a restart', () async {
      h.server.remoteUpsert('flow', at(0), {'code': 'light'});
      h.server.remoteUpsert('flow', at(1), {'code': 'light'});
      await h.core.sync();
      h.restart();
      await h.core.sync();
      expect(h.server.pullSince, [0, 2]);
    });

    test('a failed pull reports network and does not move the cursor', () async {
      h.server.remoteUpsert('flow', at(0), {'code': 'light'});
      h.server.mode = 'http503';
      expect((await h.core.sync()).error, Err.network);
      h.server.mode = 'ok';
      await h.core.sync();
      expect(h.server.pullSince, [0]);
      expect(h.snap.observations.length, 1);
    });

    test('a pulled change does not overwrite an observation with a pending local change', () async {
      await logFlow();
      await h.core.sync();
      await h.core.edit(flow, {'code': 'heavy'});
      // pull only (push fails first would abort), so simulate: remote edit lands, then sync resolves by push conflict
      h.server.remoteUpsert('flow', at(0), {'code': 'spotting'});
      await h.core.sync();
      expect(h.snap.conflicts.length, 1); // resolved by the push rule, exactly once
      expect(h.snap.observations.single.obs.value, {'code': 'spotting'});
    });

    test('types this pack lacks are kept in storage, hidden, and untouchable', () async {
      final polly = Harness('polly');
      addTearDown(polly.dispose);
      polly.server.remoteUpsert('mucus', at(0), {'code': 'creamy'});
      polly.server.remoteUpsert('flow', at(1), {'code': 'light'});
      await polly.core.sync();
      expect(polly.snap.observations.map((o) => o.obs.type), ['flow']);
      expect(polly.core.store.all().map((o) => o.type).toSet(), {'flow', 'mucus'});
      expect((await polly.core.edit(TargetKey('mucus', at(0)), {'code': 'dry'})).error, Err.notFound);
      expect((await polly.core.delete(TargetKey('mucus', at(0)))).error, Err.notFound);
      polly.restart();
      expect(polly.core.store.all().length, 2);
      expect(polly.snap.pendingMutations, 0);
      await polly.core.sync();
      expect(polly.server.pushes, isEmpty);
      expect(polly.server.find('mucus', at(0))!['deleted'], isFalse);
    });

    test('pulled reader observations stay read-only', () async {
      h.server.remoteUpsert('bbt', at(0), {'celsius': 36.5}, source: 'thermometer');
      await h.core.sync();
      expect((await h.core.edit(TargetKey('bbt', at(0)), {'celsius': 36.6})).error, Err.readOnly);
    });
  });

  group('durability across restart', () {
    test('observations, pending changes and sync state survive', () async {
      h.server.mode = 'down';
      await logFlow();
      await h.scanAt(at(10), 1);
      await h.thermoAt(at(20), [connect(), notify('2A1C', '00540e00fe'), disconnect()]);
      final before = h.snapJson;
      h.restart();
      expect(h.snapJson, before);
      expect(h.snap.pendingMutations, 3);
      h.server.mode = 'ok';
      expect((await h.core.sync()).ok, isTrue);
      expect(h.server.live.length, 3);
      expect(h.server.rejected, isEmpty);
      expect(h.server.find('lh', at(10))!['reader'], {'engineVersion': 'bakeoff-1.0.0'});
      expect(h.server.find('bbt', at(20))!['reader'], {'deviceModel': 'Test-Thermo'});
      expect(h.server.find('flow', at(0))!.containsKey('reader'), isFalse);
      h.restart();
      expect(h.snap.pendingMutations, 0);
      expect(h.snap.observations.every((o) => o.synced), isTrue);
    });

    test('a pending delete survives a restart', () async {
      await logFlow();
      await h.core.sync();
      await h.core.delete(flow);
      h.restart();
      expect(h.snap.observations, isEmpty);
      expect(h.snap.pendingMutations, 1);
      await h.core.sync();
      expect(h.server.live, isEmpty);
    });
  });
}
