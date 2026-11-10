import { createHarness } from '../helpers/harness';
import { OK, err, appSuite } from '../helpers/suite';

const ctx = appSuite('premom');
const T1 = '2026-11-03T06:40:00Z';
const T2 = '2026-11-03T08:00:00Z';

describe('manual log', () => {
  test('stores the value with the step time, source manual and no reader', async () => {
    const { h, server } = ctx;
    expect(await h.log(T1, 'bbt', { celsius: 36.1 })).toEqual(OK);
    expect(h.app.snapshot().observations).toEqual([
      { type: 'bbt', observedAt: T1, source: 'manual', sync: 'pending', display: { celsius: 36.1 } },
    ]);
    await h.app.sync();
    const [stored] = await server.live();
    expect(stored).toMatchObject({ type: 'bbt', observedAt: T1, source: 'manual', value: { celsius: 36.1 } });
    expect(stored.reader).toBeUndefined();
  });

  test('unknown type is checked first, then the source, then the value', async () => {
    const polly = createHarness(ctx.server.url, 'polly');
    try {
      // mucus is not in Polly's catalog, even with a perfectly good value
      expect(await polly.log(T1, 'mucus', { code: 'sticky' })).toEqual(err('unknown_type'));
      expect(await polly.log(T1, 'mucus', { code: 'nonsense' })).toEqual(err('unknown_type'));
      // lh exists but cannot be typed in, whatever the value
      expect(await polly.log(T1, 'lh', { ratio: 0.9 })).toEqual(err('source_not_allowed'));
      expect(await polly.log(T1, 'lh', { ratio: 'x' })).toEqual(err('source_not_allowed'));
      expect(await polly.log(T1, 'flow', { code: 'eggwhite' })).toEqual(err('invalid_value'));
      expect(polly.app.snapshot().observations).toEqual([]);
      expect(polly.app.snapshot().pendingMutations).toBe(0);
    } finally {
      polly.dispose();
    }
  });

  test('number range comes from the pack and includes both ends', async () => {
    const { h } = ctx;
    expect(await h.log('2026-11-03T06:00:00Z', 'bbt', { celsius: 34 })).toEqual(OK);
    expect(await h.log('2026-11-03T06:01:00Z', 'bbt', { celsius: 42 })).toEqual(OK);
    expect(await h.log('2026-11-03T06:02:00Z', 'bbt', { celsius: 33.99 })).toEqual(err('invalid_value'));
    expect(await h.log('2026-11-03T06:03:00Z', 'bbt', { celsius: 42.01 })).toEqual(err('invalid_value'));
    expect(await h.log('2026-11-03T06:04:00Z', 'bbt', { celsius: 50 })).toEqual(err('invalid_value'));
    expect(h.app.snapshot().observations.map((o) => o.display)).toEqual([{ celsius: 34 }, { celsius: 42 }]);
  });

  test('malformed values are invalid', async () => {
    const { h } = ctx;
    for (const value of [{ celsius: '36.5' }, { celsius: Number.NaN }, { fahrenheit: 98 }, { celsius: 36.5, note: 'x' }, {}, null, 36.5, 'medium']) {
      expect(await h.log(T1, 'bbt', value)).toEqual(err('invalid_value'));
    }
    for (const value of [{ code: 'purple' }, { code: 3 }, { celsius: 36.5 }, { code: 'light', extra: 1 }]) {
      expect(await h.log(T1, 'flow', value)).toEqual(err('invalid_value'));
    }
    expect(h.app.snapshot().observations).toEqual([]);
  });

  test('every enum value the pack lists is accepted', async () => {
    const { h } = ctx;
    const values = ['dry', 'sticky', 'creamy', 'watery', 'eggwhite'];
    for (const [i, code] of values.entries()) expect(await h.log(`2026-11-03T10:0${i}:00Z`, 'mucus', { code })).toEqual(OK);
    expect(h.app.snapshot().observations.map((o) => o.display)).toEqual(values.map((code) => ({ code })));
  });

  test('bbt is rounded to 2 decimals before it is stored and pushed', async () => {
    const { h, server } = ctx;
    expect(await h.log(T1, 'bbt', { celsius: 36.456 })).toEqual(OK);
    expect(await h.log(T2, 'bbt', { celsius: 36.123 })).toEqual(OK);
    expect(h.app.snapshot().observations.map((o) => o.display)).toEqual([{ celsius: 36.46 }, { celsius: 36.12 }]);
    expect(await h.app.sync()).toEqual(OK);
    expect((await server.live()).map((o) => o.value)).toEqual([{ celsius: 36.46 }, { celsius: 36.12 }]);
    expect((await server.state()).rejected).toEqual([]);
  });
});

describe('snapshot list', () => {
  test('is sorted by time, then by type', async () => {
    const { h } = ctx;
    await h.log(T2, 'mucus', { code: 'dry' });
    await h.log(T2, 'flow', { code: 'light' });
    await h.log(T2, 'bbt', { celsius: 36.5 });
    await h.log(T1, 'mucus', { code: 'creamy' });
    expect(h.app.snapshot().observations.map((o) => `${o.observedAt} ${o.type}`)).toEqual([
      `${T1} mucus`, `${T2} bbt`, `${T2} flow`, `${T2} mucus`,
    ]);
    expect(h.app.snapshot().pack).toBe('premom');
  });

  test('everything survives a restart', async () => {
    const { h } = ctx;
    await h.log(T1, 'bbt', { celsius: 36.5 });
    await h.log(T2, 'flow', { code: 'heavy' });
    const before = h.app.snapshot();
    h.restart();
    expect(h.app.snapshot()).toEqual(before);
    expect(before.pendingMutations).toBe(2);
  });
});

describe('edit', () => {
  test('changes the value, keeps time and source, and marks it pending again', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'heavy' });
    await h.app.sync();
    expect(h.app.snapshot().observations[0].sync).toBe('synced');
    h.at('2026-11-03T20:00:00Z');
    expect(await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'spotting' })).toEqual(OK);
    expect(h.app.snapshot().observations).toEqual([
      { type: 'flow', observedAt: T1, source: 'manual', sync: 'pending', display: { code: 'spotting' } },
    ]);
    expect(h.app.snapshot().pendingMutations).toBe(1);
    await h.app.sync();
    expect(await server.live()).toMatchObject([{ type: 'flow', observedAt: T1, value: { code: 'spotting' }, source: 'manual' }]);
    expect((await server.state()).observations).toHaveLength(1);
  });

  test('missing target is not_found; a bad value is invalid_value and changes nothing', async () => {
    const { h } = ctx;
    await h.log(T1, 'mucus', { code: 'eggwhite' });
    expect(await h.app.edit({ type: 'mucus', observedAt: T2 }, { code: 'dry' })).toEqual(err('not_found'));
    expect(await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'light' })).toEqual(err('not_found'));
    expect(await h.app.edit({ type: 'mucus', observedAt: T1 }, { code: 'purple' })).toEqual(err('invalid_value'));
    expect(h.app.snapshot().observations[0].display).toEqual({ code: 'eggwhite' });
  });

  test('an edited number is range-checked and rounded like a new one', async () => {
    const { h } = ctx;
    await h.log(T1, 'bbt', { celsius: 36.5 });
    expect(await h.app.edit({ type: 'bbt', observedAt: T1 }, { celsius: 43 })).toEqual(err('invalid_value'));
    expect(await h.app.edit({ type: 'bbt', observedAt: T1 }, { celsius: 36.777 })).toEqual(OK);
    expect(h.app.snapshot().observations[0].display).toEqual({ celsius: 36.78 });
  });
});

describe('delete', () => {
  test('removes a synced observation locally at once and on the server after sync', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'heavy' });
    await h.log(T2, 'mucus', { code: 'dry' });
    await h.app.sync();
    expect(await h.app.delete({ type: 'mucus', observedAt: T2 })).toEqual(OK);
    const snapshot = h.app.snapshot();
    expect(snapshot.observations.map((o) => o.type)).toEqual(['flow']);
    expect(snapshot.pendingMutations).toBe(1); // the delete counts as pending
    expect(await h.app.delete({ type: 'mucus', observedAt: T2 })).toEqual(err('not_found'));
    h.restart(); // the pending delete is durable
    expect(h.app.snapshot().observations.map((o) => o.type)).toEqual(['flow']);
    expect(h.app.snapshot().pendingMutations).toBe(1);
    expect(await h.app.sync()).toEqual(OK);
    expect((await server.live()).map((o) => o.type)).toEqual(['flow']);
    expect((await server.state()).observations.filter((o) => o.deleted).map((o) => o.type)).toEqual(['mucus']);
    expect(h.app.snapshot().pendingMutations).toBe(0);
  });

  test('missing target is not_found', async () => {
    expect(await ctx.h.app.delete({ type: 'flow', observedAt: T1 })).toEqual(err('not_found'));
  });
});

describe('analytics gate', () => {
  test('one event per created observation with exactly type, source and pack', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'bbt', { celsius: 36.61 });
    await h.log(T2, 'flow', { code: 'medium' });
    const events = h.http.to('/v1/events').map((call) => call.request.body);
    expect(events).toEqual([
      { name: 'observation_logged', props: { type: 'bbt', source: 'manual', pack: 'premom' } },
      { name: 'observation_logged', props: { type: 'flow', source: 'manual', pack: 'premom' } },
    ]);
    const state = await server.state();
    expect(state.events).toBe(2);
    expect(state.violations).toEqual([]);
  });

  test('no event for a rejected log, an edit, a delete or a sync', async () => {
    const { h, server } = ctx;
    await h.log(T1, 'flow', { code: 'medium' });
    await h.log(T2, 'bbt', { celsius: 99 });
    await h.app.edit({ type: 'flow', observedAt: T1 }, { code: 'light' });
    await h.app.sync();
    await h.app.delete({ type: 'flow', observedAt: T1 });
    await h.app.sync();
    expect(h.http.to('/v1/events')).toHaveLength(1);
    expect((await server.state()).events).toBe(1);
  });

  test('an event that cannot be sent is dropped: the log still succeeds and it is never resent', async () => {
    const { h, server } = ctx;
    await server.control({ mode: 'down' });
    expect(await h.log(T1, 'flow', { code: 'medium' })).toEqual(OK);
    expect(h.http.to('/v1/events')).toHaveLength(1); // one attempt only
    await server.control({ mode: 'ok' });
    await h.log(T2, 'mucus', { code: 'dry' });
    expect(await h.app.sync()).toEqual(OK);
    expect((await server.state()).events).toBe(1);
    expect(await server.live()).toHaveLength(2);
  });
});
