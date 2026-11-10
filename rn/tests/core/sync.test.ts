import path from 'node:path';
import { openNodeSqlite } from '../../src/adapters/fake/nodeSqlite';
import type { HttpRequest } from '../../src/core/ports';
import { createHarness, stripImage, type Harness } from '../helpers/harness';
import { OK, err, appSuite } from '../helpers/suite';

const ctx = appSuite('premom');
const T1 = '2026-11-03T08:00:00Z';
const T2 = '2026-11-03T20:00:00Z';

type WireMutation = { mutationId: string; op: string; id: string; baseRevision: number; observation?: { type: string; observedAt: string; value: Record<string, unknown> } };
const pushes = (h: Harness): WireMutation[][] => h.http.to('/v1/sync/push').map((call) => (call.request.body as { mutations: WireMutation[] }).mutations);
const pulls = (h: Harness): string[] => h.http.to('/v1/sync/pull').map((call) => call.request.path);
const isPush = (request: HttpRequest) => request.path === '/v1/sync/push';
const minute = (i: number) => `2026-11-03T10:${String(i).padStart(2, '0')}:00Z`;

describe('push', () => {
  test('pending observations are pushed and become synced', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'medium' });
    await h.log(T2, 'mucus', { code: 'eggwhite' });
    expect(h.app.snapshot().pendingMutations).toBe(2);
    expect(h.app.snapshot().observations.map((o) => o.sync)).toEqual(['pending', 'pending']);
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot().pendingMutations).toBe(0);
    expect(h.app.snapshot().observations.map((o) => o.sync)).toEqual(['synced', 'synced']);
    expect(pushes(h)).toHaveLength(1);
    expect(pushes(h)[0].map((m) => [m.op, m.baseRevision, m.observation?.type])).toEqual([['upsert', 0, 'flow'], ['upsert', 0, 'mucus']]);
    expect(await server.live()).toHaveLength(2);
  });

  test('nothing pending: no push request at all, but still a pull', async () => {
    const { h, server } = ctx;
    expect(await h.app.sync()).toEqual(OK);
    expect(pushes(h)).toHaveLength(0);
    expect(pulls(h)).toEqual(['/v1/sync/pull?since=0']);
    expect((await server.state()).pushRequests).toBe(0);
  });

  test('a backlog goes out oldest first in requests of at most 20', async () => {
    const { h, server } = ctx;
    for (let i = 0; i < 45; i++) await h.log(minute(i), 'flow', { code: 'light' });
    expect(await h.app.sync()).toEqual(OK);
    expect(pushes(h).map((chunk) => chunk.length)).toEqual([20, 20, 5]);
    expect(pushes(h).flat().map((m) => m.observation?.observedAt)).toEqual(Array.from({ length: 45 }, (_, i) => minute(i)));
    const state = await server.state();
    expect(state.oversize).toBe(0);
    expect(state.observations).toHaveLength(45);
    expect(h.app.snapshot().pendingMutations).toBe(0);
  });

  test('exactly 20 pending is one request; 21 is two', async () => {
    const { h } = ctx;
    for (let i = 0; i < 20; i++) await h.log(minute(i), 'flow', { code: 'light' });
    await h.app.sync();
    expect(pushes(h).map((chunk) => chunk.length)).toEqual([20]);
    h.http.clear();
    for (let i = 20; i < 41; i++) await h.log(minute(i), 'flow', { code: 'light' });
    await h.app.sync();
    expect(pushes(h).map((chunk) => chunk.length)).toEqual([20, 1]);
  });

  test('the order is by when an observation BECAME pending, not by its time or last edit', async () => {
    const { h } = ctx;
    await h.log(T2, 'mucus', { code: 'dry' }); // logged first, later timestamp
    await h.log(T1, 'flow', { code: 'light' });
    await h.app.edit({ type: 'mucus', observedAt: T2 }, { code: 'creamy' }); // editing does not move it back
    await h.app.sync();
    expect(pushes(h)[0].map((m) => m.observation?.type)).toEqual(['mucus', 'flow']);
  });
});

describe('one pending change per observation', () => {
  test('edits before the first push collapse into a single create with the last value', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'bbt', { celsius: 36.19 });
    await h.app.edit({ type: 'bbt', observedAt: T1 }, { celsius: 36.14 });
    await h.app.edit({ type: 'bbt', observedAt: T1 }, { celsius: 36.26 });
    expect(h.app.snapshot().pendingMutations).toBe(1);
    await h.app.sync();
    expect(pushes(h).flat()).toHaveLength(1);
    expect(pushes(h)[0][0]).toMatchObject({ op: 'upsert', baseRevision: 0, observation: { value: { celsius: 36.26 } } });
    expect((await server.live()).map((o) => o.value)).toEqual([{ celsius: 36.26 }]);
    expect((await server.state()).observations[0].revision).toBe(1);
  });

  test('created and deleted before it was ever sent: nothing is sent', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'mucus', { code: 'sticky' });
    expect(await h.app.delete({ type: 'mucus', observedAt: T1 })).toEqual(OK);
    expect(h.app.snapshot().pendingMutations).toBe(0);
    expect(h.app.snapshot().observations).toEqual([]);
    expect(await h.app.sync()).toEqual(OK);
    expect(pushes(h)).toHaveLength(0);
    const state = await server.state();
    expect(state.observations).toEqual([]);
    expect(state.rejected).toEqual([]);
  });

  test('edit then delete of a synced observation sends one delete against the known revision', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await h.app.sync();
    h.http.clear();
    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'heavy' });
    await h.app.delete({ type: 'flow', observedAt: T1 });
    expect(h.app.snapshot().pendingMutations).toBe(1);
    expect(await h.app.sync()).toEqual(OK);
    expect(pushes(h).flat().map((m) => [m.op, m.baseRevision])).toEqual([['delete', 1]]);
    expect(await server.live()).toEqual([]);
    expect(h.app.snapshot().conflicts).toEqual([]);
  });
});

describe('retries', () => {
  test('a mutationId is reused on every retry and replaced by a new local change', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await server.control({ mode: 'http503' });
    expect(await h.app.sync()).toEqual(err('network'));
    h.restart(); // the id is stored, not regenerated
    expect(await h.app.sync()).toEqual(err('network'));
    await server.control({ mode: 'ok' });
    expect(await h.app.sync()).toEqual(OK);
    const ids = pushes(h).flat().map((m) => m.mutationId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);

    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'heavy' });
    await h.app.sync();
    expect(pushes(h).flat()[3].mutationId).not.toBe(ids[0]);
  });

  test('a failed sync reports network and leaves everything pending', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    for (const mode of ['http503', 'down']) {
      await server.control({ mode });
      expect(await h.app.sync()).toEqual(err('network'));
      expect(h.app.snapshot().pendingMutations).toBe(1);
      expect(h.app.snapshot().observations[0].sync).toBe('pending');
    }
    expect(pulls(h)).toEqual([]); // a failed push ends the sync: no pull
  });

  test('the server applied the push but never answered: the retry neither duplicates nor conflicts', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'bbt', { celsius: 36.56 });
    await h.log(T2, 'flow', { code: 'heavy' });
    await server.control({ applyThenDrop: 1 });
    expect(await h.app.sync()).toEqual(err('network'));
    expect(h.app.snapshot().pendingMutations).toBe(2);
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ pendingMutations: 0, conflicts: [] });
    expect((await server.state()).observations).toHaveLength(2);

    // The revision from the "duplicate" answer was remembered: a later edit applies cleanly.
    await h.app.edit({ type: 'flow', observedAt: T2 }, { code: 'light' });
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot().conflicts).toEqual([]);
    expect((await server.live()).find((o) => o.type === 'flow')?.value).toEqual({ code: 'light' });
  });

  test('what was confirmed before a failure stays confirmed', async () => {
    const { h, server } = ctx;
    for (let i = 0; i < 25; i++) await h.log(minute(i), 'flow', { code: 'light' });
    let seen = 0;
    h.http.intercept = (request) => (isPush(request) && ++seen === 2 ? { kind: 'unreachable' } : null);
    expect(await h.app.sync()).toEqual(err('network'));
    const snapshot = h.app.snapshot();
    expect(snapshot.pendingMutations).toBe(5);
    expect(snapshot.observations.filter((o) => o.sync === 'synced')).toHaveLength(20);
    expect(snapshot.observations.slice(20).every((o) => o.sync === 'pending')).toBe(true);
    expect((await server.state()).observations).toHaveLength(20);
    h.http.intercept = null;
    expect(await h.app.sync()).toEqual(OK);
    expect((await server.state()).observations).toHaveLength(25);
  });

  test('a pull that fails also ends the sync with network, after the push was confirmed', async () => {
    const { h } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    h.http.intercept = (request) => (request.path.startsWith('/v1/sync/pull') ? { kind: 'response', status: 503, json: {} } : null);
    expect(await h.app.sync()).toEqual(err('network'));
    expect(h.app.snapshot().pendingMutations).toBe(0);
    // The revision from the push answer was remembered even though the pull never happened.
    h.http.intercept = null;
    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'heavy' });
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot().conflicts).toEqual([]);
    expect((await ctx.server.live()).map((o) => o.value)).toEqual([{ code: 'heavy' }]);
  });

  test('deleted after a refused push (503): it was never sent, so nothing is sent', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await server.control({ mode: 'http503' });
    expect(await h.app.sync()).toEqual(err('network'));
    await server.control({ mode: 'ok' });
    expect(await h.app.delete({ type: 'flow', observedAt: T1 })).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ observations: [], pendingMutations: 0 });
    expect(await h.app.sync()).toEqual(OK);
    expect((await server.state()).observations).toEqual([]);
  });

  test('deleted while its create is in doubt (applied, never answered): the server ends up without it, no conflict, no rejection', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await server.control({ applyThenDrop: 1 });
    expect(await h.app.sync()).toEqual(err('network'));
    expect(await h.app.delete({ type: 'flow', observedAt: T1 })).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ observations: [], pendingMutations: 1 });
    expect(await h.app.delete({ type: 'flow', observedAt: T1 })).toEqual(err('not_found'));
    h.restart();
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ observations: [], pendingMutations: 0, conflicts: [] });
    const state = await server.state();
    expect(state.observations.map((o) => o.deleted)).toEqual([true]);
    expect(state.rejected).toEqual([]);
  });
});

describe('conflicts: the server copy wins', () => {
  test('another device edited first: local value is replaced and the loss is recorded durably', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'heavy' });
    await h.log(T2, 'mucus', { code: 'dry' });
    await h.app.sync();
    await server.control({ remote: { op: 'upsert', type: 'flow', observedAt: T1, value: { code: 'spotting' }, source: 'manual' } });
    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'light' });
    expect(await h.app.sync()).toEqual(OK);
    const snapshot = h.app.snapshot();
    expect(snapshot.observations[0]).toEqual({ type: 'flow', observedAt: T1, source: 'manual', sync: 'synced', display: { code: 'spotting' } });
    expect(snapshot.pendingMutations).toBe(0);
    expect(snapshot.conflicts).toEqual([{ type: 'flow', observedAt: T1 }]);
    expect((await server.live()).find((o) => o.type === 'flow')?.value).toEqual({ code: 'spotting' });

    // The server revision was adopted: the next edit applies without another conflict.
    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'medium' });
    expect(await h.app.sync()).toEqual(OK);
    expect((await server.live()).find((o) => o.type === 'flow')?.value).toEqual({ code: 'medium' });

    // A second conflict is appended after the first, and the list survives a restart.
    await server.control({ remote: { op: 'upsert', type: 'mucus', observedAt: T2, value: { code: 'watery' }, source: 'manual' } });
    await h.app.edit({ type: 'mucus', observedAt: T2 }, { code: 'sticky' });
    await h.app.sync();
    h.restart();
    expect(h.app.snapshot().conflicts).toEqual([{ type: 'flow', observedAt: T1 }, { type: 'mucus', observedAt: T2 }]);
  });

  test('local edit against a remote delete: the observation disappears', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await h.app.sync();
    await server.control({ remote: { op: 'delete', type: 'flow', observedAt: T1 } });
    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'heavy' });
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ observations: [], pendingMutations: 0, conflicts: [{ type: 'flow', observedAt: T1 }] });
    expect(await server.live()).toEqual([]);
  });

  test('local delete against a remote edit: the observation comes back with the remote value', async () => {
    const { h, server } = ctx;
    await h.log(T2, 'mucus', { code: 'creamy' });
    await h.app.sync();
    await server.control({ remote: { op: 'upsert', type: 'mucus', observedAt: T2, value: { code: 'eggwhite' }, source: 'manual' } });
    await h.app.delete({ type: 'mucus', observedAt: T2 });
    expect(h.app.snapshot().observations).toEqual([]);
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({
      observations: [{ type: 'mucus', observedAt: T2, sync: 'synced', display: { code: 'eggwhite' } }],
      pendingMutations: 0,
      conflicts: [{ type: 'mucus', observedAt: T2 }],
    });
    expect(await server.live()).toHaveLength(1);
  });
});

describe('pull', () => {
  test('remote creates, edits and deletes arrive', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await h.app.sync();
    await server.control({ remote: { op: 'upsert', type: 'bbt', observedAt: '2026-11-04T06:30:00Z', value: { celsius: 36.51 }, source: 'manual' } });
    await server.control({ remote: { op: 'upsert', type: 'flow', observedAt: T1, value: { code: 'heavy' }, source: 'manual' } });
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot().observations).toEqual([
      { type: 'flow', observedAt: T1, source: 'manual', sync: 'synced', display: { code: 'heavy' } },
      { type: 'bbt', observedAt: '2026-11-04T06:30:00Z', source: 'manual', sync: 'synced', display: { celsius: 36.51 } },
    ]);
    await server.control({ remote: { op: 'delete', type: 'bbt', observedAt: '2026-11-04T06:30:00Z' } });
    await h.app.sync();
    expect(h.app.snapshot().observations.map((o) => o.type)).toEqual(['flow']);
    expect(h.app.snapshot().conflicts).toEqual([]);
  });

  test('the cursor is stored, sent on the next pull, and survives a restart', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await h.log(T2, 'mucus', { code: 'dry' });
    await h.app.sync();
    await h.app.sync();
    await server.control({ remote: { op: 'upsert', type: 'bbt', observedAt: T1, value: { celsius: 36.5 }, source: 'manual' } });
    h.restart();
    await h.app.sync();
    await h.app.sync();
    expect(pulls(h)).toEqual(['/v1/sync/pull?since=0', '/v1/sync/pull?since=2', '/v1/sync/pull?since=2', '/v1/sync/pull?since=3']);
  });

  test('a pulled change never overwrites an observation that still has a pending local change', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'light' });
    await h.app.sync();
    await server.control({ remote: { op: 'upsert', type: 'flow', observedAt: T1, value: { code: 'heavy' }, source: 'manual' } });
    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'medium' });
    // The push "succeeds" without an answer for our mutation, so it is still pending when the pull arrives.
    h.http.intercept = (request) => (isPush(request) ? { kind: 'response', status: 200, json: { results: [] } } : null);
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot().observations[0]).toMatchObject({ sync: 'pending', display: { code: 'medium' } });
    expect(h.app.snapshot().pendingMutations).toBe(1);
  });

  test('types this pack lacks are kept in storage but never shown, edited or deleted', async () => {
    const polly = createHarness(ctx.server.url, 'polly');
    try {
      const { server } = ctx;
      await server.control({ remote: { op: 'upsert', type: 'mucus', observedAt: T2, value: { code: 'creamy' }, source: 'manual' } });
      await server.control({ remote: { op: 'upsert', type: 'flow', observedAt: T1, value: { code: 'medium' }, source: 'manual' } });
      expect(await polly.app.sync()).toEqual(OK);
      expect(polly.app.snapshot().observations.map((o) => o.type)).toEqual(['flow']);
      expect(await polly.app.edit({ type: 'mucus', observedAt: T2 }, { code: 'dry' })).toEqual(err('not_found'));
      expect(await polly.app.delete({ type: 'mucus', observedAt: T2 })).toEqual(err('not_found'));
      expect(polly.app.snapshot().pendingMutations).toBe(0);
      polly.restart();
      expect(polly.app.snapshot().observations.map((o) => o.type)).toEqual(['flow']);
      const db = openNodeSqlite(path.join(polly.dir, 'app.db'));
      expect(db.all<{ type: string }>('SELECT type FROM observations ORDER BY type').map((row) => row.type)).toEqual(['flow', 'mucus']);
      db.close();
      expect(await polly.app.sync()).toEqual(OK);
      expect(await server.live()).toHaveLength(2); // and nothing was pushed about it
    } finally {
      polly.dispose();
    }
  });
});

describe('durability', () => {
  test('offline work survives restarts and syncs later, in full', async () => {
    const { h, server } = ctx;
    await server.control({ mode: 'down' });
    await h.log(T1, 'flow', { code: 'light' });
    await h.scan('2026-11-03T14:00:00Z', stripImage(100, 70));
    expect(await h.app.sync()).toEqual(err('network'));
    h.restart();
    expect(h.app.snapshot().pendingMutations).toBe(2);
    expect(h.app.snapshot().observations.map((o) => o.sync)).toEqual(['pending', 'pending']);
    await server.control({ mode: 'ok' });
    expect(await h.app.sync()).toEqual(OK);
    expect(await server.live()).toMatchObject([
      { type: 'flow', value: { code: 'light' } },
      { type: 'lh', value: { ratio: 0.7 }, source: 'strip_reader', reader: { engineVersion: 'bakeoff-1.0.0' } },
    ]);
    const state = await server.state();
    expect(state.rejected).toEqual([]);
    expect(state.events).toBe(0); // analytics from the offline period is not replayed
  });

  test('a strip result cannot be edited but can be deleted, also on the server', async () => {
    const { h, server } = ctx;
    await h.scan(T1, stripImage(100, 70));
    await h.app.sync();
    expect(await h.app.edit({ type: 'lh', observedAt: T1 }, { ratio: 1.5 })).toEqual(err('read_only'));
    expect(await h.app.delete({ type: 'lh', observedAt: T1 })).toEqual(OK);
    await h.app.sync();
    expect(await server.live()).toEqual([]);
  });
});
