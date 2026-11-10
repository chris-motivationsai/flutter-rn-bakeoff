// HTTP over fetch. This same class runs on a phone and in the headless runs (Node has fetch too).
import type { Http, HttpRequest, HttpResponse } from '../core/ports';

export class FetchHttp implements Http {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 15000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.baseUrl + request.path, {
        method: request.method,
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      return { kind: 'response', status: response.status, json };
    } catch {
      return { kind: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }
}
