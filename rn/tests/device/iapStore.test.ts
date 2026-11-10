// The real store adapter, with react-native-iap's functions replaced by scripted ones.
import { IapStore, eventForError, eventForPurchase } from '../../src/adapters/real/iapStore';
import type { StoreEvent } from '../../src/core/ports';

type AnyFn = (...args: any[]) => any;
const mockLib = {
  onPurchase: null as AnyFn | null,
  onError: null as AnyFn | null,
  requests: [] as unknown[],
  finished: [] as unknown[],
  available: [] as unknown[],
  removed: 0,
  onRequest: (() => undefined) as () => void,
};

jest.mock('react-native-iap', () => ({
  ErrorCode: { UserCancelled: 'user-cancelled', Pending: 'pending', DeferredPayment: 'deferred-payment', NetworkError: 'network-error' },
  initConnection: async () => true,
  endConnection: async () => true,
  purchaseUpdatedListener: (listener: AnyFn) => { mockLib.onPurchase = listener; return { remove: () => void mockLib.removed++ }; },
  purchaseErrorListener: (listener: AnyFn) => { mockLib.onError = listener; return { remove: () => void mockLib.removed++ }; },
  requestPurchase: async (request: unknown) => { mockLib.requests.push(request); mockLib.onRequest(); return null; },
  getAvailablePurchases: async () => mockLib.available,
  finishTransaction: async (args: unknown) => { mockLib.finished.push(args); },
}));

const purchase = (id: string, purchaseState: string, purchaseToken: string | null = `token-${id}`) => ({ id, productId: 'premium_monthly', purchaseState, purchaseToken });

beforeEach(() => {
  Object.assign(mockLib, { onPurchase: null, onError: null, requests: [], finished: [], available: [], removed: 0, onRequest: () => undefined });
});

async function run(onRequest: () => void) {
  const events: StoreEvent[] = [];
  mockLib.onRequest = onRequest;
  const store = new IapStore();
  await store.purchase('premium_monthly', async (event) => void events.push(event));
  return { events, store };
}

test('maps library purchases and errors to store events', () => {
  expect(eventForPurchase(purchase('t1', 'purchased') as never)).toEqual({ event: 'purchased', txId: 't1', receipt: 'token-t1' });
  expect(eventForPurchase(purchase('t1', 'pending') as never)).toEqual({ event: 'pending' });
  expect(eventForPurchase(purchase('t1', 'purchased', null) as never).event).toBe('error');
  expect(eventForPurchase(purchase('t1', 'unknown') as never).event).toBe('error');
  expect(eventForError({ code: 'user-cancelled' } as never)).toEqual({ event: 'cancelled' });
  expect(eventForError({ code: 'deferred-payment' } as never)).toEqual({ event: 'pending' });
  expect(eventForError({ code: 'network-error' } as never)).toEqual({ event: 'error', code: 'network-error' });
});

test('a completed purchase is reported with its token and can be finished', async () => {
  const { events, store } = await run(() => mockLib.onPurchase!(purchase('tx-1', 'purchased')));
  expect(mockLib.requests).toEqual([{ type: 'subs', request: { apple: { sku: 'premium_monthly' }, google: { skus: ['premium_monthly'] } } }]);
  expect(events).toEqual([{ event: 'purchased', txId: 'tx-1', receipt: 'token-tx-1' }]);
  expect(mockLib.removed).toBe(2); // listeners are removed when the flow ends
  expect(mockLib.finished).toEqual([]); // never finished before the core says so
  await store.finish('tx-1');
  expect(mockLib.finished).toEqual([{ purchase: purchase('tx-1', 'purchased'), isConsumable: false }]);
});

test('user cancel and store errors end the flow', async () => {
  expect((await run(() => mockLib.onError!({ code: 'user-cancelled' }))).events).toEqual([{ event: 'cancelled' }]);
  expect((await run(() => mockLib.onError!({ code: 'network-error' }))).events).toEqual([{ event: 'error', code: 'network-error' }]);
  expect((await run(() => mockLib.onPurchase!(purchase('tx-2', 'pending')))).events).toEqual([{ event: 'pending' }]);
});

test('restore lists the store purchases that carry a token', async () => {
  mockLib.available = [purchase('tx-a', 'purchased'), purchase('tx-b', 'purchased', null)];
  expect(await new IapStore().restore()).toEqual([{ txId: 'tx-a', receipt: 'token-tx-a' }]);
});

test('finish after an app restart looks the transaction up in the store again', async () => {
  mockLib.available = [purchase('tx-old', 'purchased')];
  const store = new IapStore();
  await store.finish('tx-old');
  await store.finish('tx-gone'); // unknown to the store: nothing to finish, no throw
  expect(mockLib.finished).toEqual([{ purchase: purchase('tx-old', 'purchased'), isConsumable: false }]);
});
