import { createHarness, receipt, stripImage, type Harness } from '../helpers/harness';
import { OK, USER, err, appSuite } from '../helpers/suite';

const ctx = appSuite('premom');
const PRODUCT = 'premium_monthly';
const T0 = '2026-11-03T14:00:00Z';
const EXPIRES = '2026-12-03T14:00:00Z';

const good = (txId: string, expiresAt = EXPIRES) => ({ txId, receipt: receipt({ txId, userId: USER, expiresAt }) });
const tampered = (txId: string) => ({ txId, receipt: good(txId).receipt.replace(/.$/, (c) => (c === '0' ? '1' : '0')) });
const someoneElses = (txId: string) => ({ txId, receipt: receipt({ txId, userId: 'u-someone-else', expiresAt: EXPIRES }) });

async function buy(h: Harness, script: Harness['store']['purchaseScript'], at = '2026-11-03T14:01:00Z') {
  h.clock.at = at;
  h.store.purchaseScript = script;
  return h.app.purchase(PRODUCT);
}
const lhDisplay = (h: Harness) => h.app.snapshot().observations.find((o) => o.type === 'lh')?.display;

beforeEach(async () => {
  await ctx.h.scan(T0, stripImage(100, 70));
});

describe('purchase', () => {
  test('nothing is unlocked before a purchase', () => {
    expect(ctx.h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'idle', lastPurchaseError: null });
    expect(lhDisplay(ctx.h)).toEqual({ level: 'high', ratio: null, locked: true });
  });

  test('verified by the server: entitlement saved, transaction finished, number unlocked', async () => {
    const { h } = ctx;
    expect(await buy(h, [{ event: 'purchased', ...good('tx-1') }])).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: ['premium'], purchaseState: 'idle', lastPurchaseError: null });
    expect(h.store.finished).toEqual(['tx-1']);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: 0.7, locked: false });
    expect(h.http.to('/v1/entitlements/verify').map((call) => call.request.body)).toEqual([{ receipt: good('tx-1').receipt }]);
    h.restart();
    expect(h.app.snapshot().entitlements).toEqual(['premium']);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: 0.7, locked: false });
  });

  test('pending then purchased ends idle and unlocked', async () => {
    const { h } = ctx;
    expect(await buy(h, [{ event: 'pending' }, { event: 'purchased', ...good('tx-1') }])).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: ['premium'], purchaseState: 'idle' });
  });

  test('pending with nothing following: ok, state pending, nothing unlocked; idle after a restart', async () => {
    const { h } = ctx;
    expect(await buy(h, [{ event: 'pending' }])).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'pending', lastPurchaseError: null });
    expect(h.store.finished).toEqual([]);
    h.restart();
    expect(h.app.snapshot().purchaseState).toBe('idle');
  });

  test('cancelled is a result, not an error', async () => {
    const { h } = ctx;
    expect(await buy(h, [{ event: 'cancelled' }])).toEqual(err('cancelled'));
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'idle', lastPurchaseError: null });
    expect(await buy(h, [{ event: 'pending' }, { event: 'cancelled' }])).toEqual(err('cancelled'));
    expect(h.app.snapshot().purchaseState).toBe('idle');
  });

  test('a store error is reported as store_error whatever the store code', async () => {
    const { h } = ctx;
    expect(await buy(h, [{ event: 'error', code: 'billing_unavailable' }])).toEqual(err('store_error'));
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'idle', lastPurchaseError: 'store_error' });
    expect(h.http.to('/v1/entitlements/verify')).toHaveLength(0);
  });

  test.each([
    ['a tampered receipt', tampered('tx-9'), 'invalid_receipt'],
    ['a receipt for another user', someoneElses('tx-9'), 'receipt_user_mismatch'],
  ])('%s is refused: discarded, finished, nothing granted', async (_name, transaction, code) => {
    const { h } = ctx;
    expect(await buy(h, [{ event: 'purchased', ...transaction }])).toEqual(err(code));
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'idle', lastPurchaseError: code });
    expect(h.store.finished).toEqual(['tx-9']);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: null, locked: true });
    // discarded for good: the next sync does not ask again
    h.http.clear();
    await h.app.sync();
    expect(h.http.to('/v1/entitlements/verify')).toHaveLength(0);
  });

  test('the last error is cleared when the next purchase or restore starts, and by a restart', async () => {
    const { h } = ctx;
    await buy(h, [{ event: 'error' }]);
    expect(h.app.snapshot().lastPurchaseError).toBe('store_error');
    await buy(h, [{ event: 'cancelled' }]);
    expect(h.app.snapshot().lastPurchaseError).toBeNull();
    await buy(h, [{ event: 'purchased', ...tampered('tx-2') }]);
    expect(h.app.snapshot().lastPurchaseError).toBe('invalid_receipt');
    h.store.restoreScript = [];
    expect(await h.app.restore()).toEqual(OK);
    expect(h.app.snapshot().lastPurchaseError).toBeNull();
    await buy(h, [{ event: 'error' }]);
    h.restart();
    expect(h.app.snapshot().lastPurchaseError).toBeNull();
  });

  test('a product the pack does not sell is not_available and the store is never called', async () => {
    const { h } = ctx;
    h.store.purchaseScript = [{ event: 'purchased', ...good('tx-1') }];
    expect(await h.app.purchase('lifetime_gold')).toEqual(err('not_available'));
    expect(h.store.purchaseCalls).toBe(0);
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], lastPurchaseError: 'not_available' });

    const polly = createHarness(ctx.server.url, 'polly');
    try {
      polly.store.purchaseScript = [{ event: 'purchased', ...good('tx-1') }];
      expect(await polly.app.purchase(PRODUCT)).toEqual(err('not_available'));
      expect(polly.store.purchaseCalls).toBe(0);
      expect(polly.store.finished).toEqual([]);
      expect(polly.app.snapshot().entitlements).toEqual([]);
    } finally {
      polly.dispose();
    }
  });
});

describe('server unreachable during a purchase', () => {
  test.each(['down', 'http503'])('server %s: the receipt is held, nothing unlocks, and the next sync verifies it', async (mode) => {
    const { h, server } = ctx;
    await server.control({ mode });
    expect(await buy(h, [{ event: 'purchased', ...good('tx-1') }])).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'verifying', lastPurchaseError: null });
    expect(h.store.finished).toEqual([]);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: null, locked: true });

    expect(await h.app.sync()).toEqual(err('network'));
    h.restart(); // the held receipt is durable; "verifying" survives
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'verifying' });
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: null, locked: true });

    await server.control({ mode: 'ok' });
    h.http.clear();
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: ['premium'], purchaseState: 'idle', lastPurchaseError: null });
    expect(h.store.finished).toEqual(['tx-1']);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: 0.7, locked: false });
    // sync order: receipts first, then push, then pull
    expect(h.http.calls.map((call) => call.request.path.split('?')[0])).toEqual(['/v1/entitlements/verify', '/v1/sync/push', '/v1/sync/pull']);
  });

  test('a held receipt the server later refuses sets the error, is finished, and the sync still succeeds', async () => {
    const { h, server } = ctx;
    await server.control({ mode: 'down' });
    expect(await buy(h, [{ event: 'purchased', ...tampered('tx-3') }])).toEqual(OK);
    expect(h.app.snapshot().purchaseState).toBe('verifying');
    await server.control({ mode: 'ok' });
    expect(await h.app.sync()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'idle', lastPurchaseError: 'invalid_receipt', pendingMutations: 0 });
    expect(h.store.finished).toEqual(['tx-3']);
  });
});

describe('restore', () => {
  test('each transaction is handled like a purchase; the step is ok even when one is refused', async () => {
    const { h } = ctx;
    h.store.restoreScript = [good('tx-a'), someoneElses('tx-b')];
    expect(await h.at('2026-11-03T14:01:00Z').app.restore()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: ['premium'], purchaseState: 'idle', lastPurchaseError: 'receipt_user_mismatch' });
    expect([...h.store.finished].sort()).toEqual(['tx-a', 'tx-b']);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: 0.7, locked: false });
  });

  test('restore while the server is unreachable holds the receipts', async () => {
    const { h, server } = ctx;
    await server.control({ mode: 'down' });
    h.store.restoreScript = [good('tx-a'), good('tx-b')];
    expect(await h.app.restore()).toEqual(OK);
    expect(h.app.snapshot()).toMatchObject({ entitlements: [], purchaseState: 'verifying', lastPurchaseError: null });
    await server.control({ mode: 'ok' });
    h.http.clear();
    await h.app.sync();
    expect(h.http.to('/v1/entitlements/verify')).toHaveLength(2);
    expect(h.app.snapshot()).toMatchObject({ entitlements: ['premium'], purchaseState: 'idle' });
    expect([...h.store.finished].sort()).toEqual(['tx-a', 'tx-b']);
  });
});

describe('entitlement expiry follows the injected clock', () => {
  test('active strictly before expiresAt, also offline and after a restart; locked again from expiresAt on', async () => {
    const { h, server } = ctx;
    await buy(h, [{ event: 'purchased', ...good('tx-1', '2026-11-27T14:01:00Z') }]);
    await server.control({ mode: 'down' });
    h.restart();
    h.at('2026-11-27T14:00:59Z');
    expect(h.app.snapshot().entitlements).toEqual(['premium']);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: 0.7, locked: false });
    h.at('2026-11-27T14:01:00Z');
    expect(h.app.snapshot().entitlements).toEqual([]);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: null, locked: true });
    h.at('2026-11-28T00:00:00Z');
    expect(h.app.snapshot().entitlements).toEqual([]);

    await server.control({ mode: 'ok' });
    expect(await buy(h, [{ event: 'purchased', ...good('tx-2', '2026-12-27T14:04:00Z') }], '2026-11-28T00:01:00Z')).toEqual(OK);
    expect(h.app.snapshot().entitlements).toEqual(['premium']);
    expect(lhDisplay(h)).toEqual({ level: 'high', ratio: 0.7, locked: false });
  });
});
