// Typed access to the server. Request and response shapes come from the kit contracts.
import {
  PullResponse, PushResponse, VerifyError, VerifyResponse,
  type AnalyticsEvent, type Entitlement, type Mutation, type MutationResult, type ServerObservation,
} from './contracts';
import type { Http } from './ports';

/** `network` = transport failure, an unexpected status, or an answer that does not match the contract. */
export type Network = { kind: 'network' };
const NETWORK: Network = { kind: 'network' };

export class Api {
  constructor(private readonly http: Http) {}

  /**
   * `answered: true` on a failure means the server replied with an error status, so it did not apply the
   * push. Without an answer we cannot know: it may have applied everything and lost the connection.
   */
  async push(deviceId: string, mutations: Mutation[]): Promise<{ kind: 'ok'; results: MutationResult[] } | (Network & { answered: boolean })> {
    const res = await this.http.send({ method: 'POST', path: '/v1/sync/push', body: { deviceId, mutations } });
    if (res.kind !== 'response') return { ...NETWORK, answered: false };
    if (res.status < 200 || res.status > 299) return { ...NETWORK, answered: true };
    const parsed = PushResponse.safeParse(res.json);
    return parsed.success ? { kind: 'ok', results: parsed.data.results } : { ...NETWORK, answered: false };
  }

  async pull(since: number): Promise<{ kind: 'ok'; changes: ServerObservation[]; cursor: number } | Network> {
    const res = await this.http.send({ method: 'GET', path: `/v1/sync/pull?since=${since}` });
    if (res.kind !== 'response' || res.status < 200 || res.status > 299) return NETWORK;
    const parsed = PullResponse.safeParse(res.json);
    return parsed.success ? { kind: 'ok', ...parsed.data } : NETWORK;
  }

  /** 200 = verified, 422 = refused for good, anything else = we do not know yet. */
  async verifyReceipt(receipt: string): Promise<{ kind: 'verified'; entitlements: Entitlement[] } | { kind: 'refused'; error: 'invalid_receipt' | 'receipt_user_mismatch' } | Network> {
    const res = await this.http.send({ method: 'POST', path: '/v1/entitlements/verify', body: { receipt } });
    if (res.kind !== 'response') return NETWORK;
    if (res.status === 200) {
      const parsed = VerifyResponse.safeParse(res.json);
      return parsed.success ? { kind: 'verified', entitlements: parsed.data.entitlements } : NETWORK;
    }
    if (res.status === 422) {
      const parsed = VerifyError.safeParse(res.json);
      return parsed.success ? { kind: 'refused', error: parsed.data.error } : NETWORK;
    }
    return NETWORK;
  }

  /** One attempt; the caller does not care whether it arrived. */
  async sendEvent(event: AnalyticsEvent): Promise<void> {
    await this.http.send({ method: 'POST', path: '/v1/events', body: event });
  }
}
