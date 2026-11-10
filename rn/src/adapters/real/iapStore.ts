// The app store over react-native-iap. Translates the library's listeners into the core's StoreEvent
// sequence. The receipt handed to the server is the unified purchase token (iOS JWS / Android purchaseToken).
import {
  ErrorCode, endConnection, finishTransaction, getAvailablePurchases, initConnection,
  purchaseErrorListener, purchaseUpdatedListener, requestPurchase,
  type Purchase, type PurchaseError,
} from 'react-native-iap';
import type { Store, StoreEvent, StoreTransaction } from '../../core/ports';

/** Maps one library purchase update to what the core should hear. Exported for tests. */
export function eventForPurchase(purchase: Pick<Purchase, 'id' | 'purchaseState' | 'purchaseToken'>): StoreEvent {
  if (purchase.purchaseState === 'pending') return { event: 'pending' };
  if (purchase.purchaseState === 'purchased' && purchase.purchaseToken) {
    return { event: 'purchased', txId: purchase.id, receipt: purchase.purchaseToken };
  }
  return { event: 'error', code: 'unknown_purchase_state' };
}

/** Maps one library error to what the core should hear. Exported for tests. */
export function eventForError(error: Pick<PurchaseError, 'code'>): StoreEvent {
  if (error.code === ErrorCode.UserCancelled) return { event: 'cancelled' };
  if (error.code === ErrorCode.Pending || error.code === ErrorCode.DeferredPayment) return { event: 'pending' };
  return { event: 'error', code: String(error.code) };
}

export class IapStore implements Store {
  private connected = false;
  private readonly purchases = new Map<string, Purchase>();

  private async connect(): Promise<void> {
    if (!this.connected) this.connected = await initConnection();
  }

  async purchase(productId: string, listener: (event: StoreEvent) => Promise<void>): Promise<void> {
    await this.connect();
    await new Promise<void>((resolve) => {
      let chain = Promise.resolve();
      const deliver = (event: StoreEvent, purchase?: Purchase) => {
        if (purchase) this.purchases.set(purchase.id, purchase);
        // A "pending" purchase (Ask to Buy, slow payment) may complete days later; the flow is over for now.
        chain = chain.then(() => listener(event)).then(() => {
          updates.remove();
          errors.remove();
          resolve();
        });
      };
      const updates = purchaseUpdatedListener((purchase) => deliver(eventForPurchase(purchase), purchase));
      const errors = purchaseErrorListener((error) => deliver(eventForError(error)));
      requestPurchase({
        type: 'subs',
        request: { apple: { sku: productId }, google: { skus: [productId] } },
      }).catch((error: PurchaseError) => deliver(eventForError(error)));
    });
  }

  async restore(): Promise<StoreTransaction[]> {
    await this.connect();
    const available = await getAvailablePurchases();
    const transactions: StoreTransaction[] = [];
    for (const purchase of available) {
      if (!purchase.purchaseToken) continue;
      this.purchases.set(purchase.id, purchase);
      transactions.push({ txId: purchase.id, receipt: purchase.purchaseToken });
    }
    return transactions;
  }

  async finish(txId: string): Promise<void> {
    await this.connect();
    let purchase = this.purchases.get(txId);
    if (!purchase) {
      // After an app restart the in-memory map is empty: ask the store for the transaction again.
      purchase = (await getAvailablePurchases()).find((candidate) => candidate.id === txId);
    }
    if (!purchase) return;
    await finishTransaction({ purchase, isConsumable: false });
    this.purchases.delete(txId);
  }

  async dispose(): Promise<void> {
    if (this.connected) await endConnection();
    this.connected = false;
  }
}
