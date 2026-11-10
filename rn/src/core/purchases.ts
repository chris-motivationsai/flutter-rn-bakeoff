// Purchases and entitlements. SPEC section 5. Nothing unlocks until the server has verified a receipt.
import type { Api } from './api';
import { findProduct, type Pack } from './pack';
import type { Store, StoreEvent, StoreTransaction } from './ports';
import type { Storage } from './storage';
import { OK, fail, type ErrorCode, type PurchaseState, type Result } from './types';

type ReceiptOutcome = 'verified' | 'held' | { refused: ErrorCode };

export class Purchases {
  /** Not durable on purpose: after a restart `pending` becomes `idle` and the last error is forgotten. */
  private storePending = false;
  private lastError: string | null = null;

  constructor(
    private readonly pack: Pack,
    private readonly storage: Storage,
    private readonly api: Api,
    private readonly store: Store,
  ) {}

  state(): PurchaseState {
    if (this.storage.heldReceipts().length > 0) return 'verifying';
    return this.storePending ? 'pending' : 'idle';
  }

  lastPurchaseError(): string | null {
    return this.lastError;
  }

  /** Names of the entitlements that have not expired at `now`, sorted. */
  activeEntitlements(now: string): string[] {
    return this.storage
      .allEntitlements()
      .filter((entitlement) => entitlement.expiresAt > now)
      .map((entitlement) => entitlement.name)
      .sort();
  }

  async purchase(productId: string): Promise<Result> {
    this.lastError = null;
    if (!findProduct(this.pack, productId)) {
      this.lastError = 'not_available';
      return fail('not_available');
    }
    this.storePending = false;
    let result: Result = OK;
    await this.store.purchase(productId, async (event: StoreEvent) => {
      result = await this.onStoreEvent(event);
    });
    return result;
  }

  private async onStoreEvent(event: StoreEvent): Promise<Result> {
    if (event.event === 'pending') {
      this.storePending = true;
      return OK;
    }
    this.storePending = false;
    if (event.event === 'cancelled') return fail('cancelled'); // the user changed their mind: not an error
    if (event.event === 'error') {
      this.lastError = 'store_error';
      return fail('store_error');
    }
    const outcome = await this.handleReceipt(event);
    return typeof outcome === 'object' ? fail(outcome.refused) : OK;
  }

  /** Each restored transaction is handled like a fresh purchase. The restore itself always succeeds. */
  async restore(): Promise<Result> {
    this.lastError = null;
    const transactions = await this.store.restore();
    for (const transaction of transactions) await this.handleReceipt(transaction);
    return OK;
  }

  /** Start of every sync: ask the server again about receipts it could not be reached for. */
  async retryHeldReceipts(): Promise<void> {
    for (const held of this.storage.heldReceipts()) await this.verify(held);
  }

  private async handleReceipt(transaction: StoreTransaction): Promise<ReceiptOutcome> {
    this.storage.holdReceipt(transaction.txId, transaction.receipt); // durable before we talk to anyone
    return this.verify(transaction);
  }

  private async verify(transaction: StoreTransaction): Promise<ReceiptOutcome> {
    const answer = await this.api.verifyReceipt(transaction.receipt);
    if (answer.kind === 'network') return 'held';
    if (answer.kind === 'verified') {
      this.storage.transaction(() => {
        for (const entitlement of answer.entitlements) this.storage.putEntitlement(entitlement);
        this.storage.releaseReceipt(transaction.txId);
      });
      await this.store.finish(transaction.txId);
      return 'verified';
    }
    this.storage.releaseReceipt(transaction.txId);
    await this.store.finish(transaction.txId);
    this.lastError = answer.error;
    return { refused: answer.error };
  }
}
