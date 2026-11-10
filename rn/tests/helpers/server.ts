// Starts the kit's real test server for a test file. Tests talk to it over HTTP exactly as the app does.
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

/** Plain node:http JSON call. Used instead of fetch because the React Native test environment replaces fetch. */
export function nodeRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(url, { method, headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, (response) => {
      let text = '';
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => {
        let json: unknown;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: response.statusCode ?? 0, json });
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const KIT = path.resolve(PROJECT_ROOT, '..', 'kit');

export type ServerState = {
  observations: { id: string; type: string; value: Record<string, unknown>; observedAt: string; source: string; reader?: Record<string, string>; revision: number; deleted: boolean }[];
  events: number;
  violations: string[];
  oversize: number;
  pushRequests: number;
  rejected: string[];
};

export class TestServer {
  private child: ChildProcess | null = null;
  url = '';

  async start(): Promise<void> {
    const child = spawn('node', [path.join(KIT, 'server', 'server.ts')], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((resolve, reject) => {
      child.stdout!.on('data', (data) => {
        const match = /LISTENING (\d+)/.exec(String(data));
        if (match) resolve(Number(match[1]));
      });
      child.on('exit', () => reject(new Error('test server exited')));
    });
    this.url = `http://127.0.0.1:${port}`;
  }

  stop(): void {
    this.child?.kill();
  }

  async control(body: unknown): Promise<void> {
    await nodeRequest(`${this.url}/__control`, 'POST', body);
  }

  reset(user = 'u-test'): Promise<void> {
    return this.control({ reset: { user } });
  }

  async state(): Promise<ServerState> {
    return (await nodeRequest(`${this.url}/__control/state`, 'GET')).json as ServerState;
  }

  /** Live (not deleted) observations on the server, sorted like the judge sorts them. */
  async live(): Promise<ServerState['observations']> {
    const state = await this.state();
    return state.observations.filter((o) => !o.deleted).sort((a, b) => `${a.type}|${a.observedAt}`.localeCompare(`${b.type}|${b.observedAt}`));
  }
}
