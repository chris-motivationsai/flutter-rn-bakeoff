// Per-file setup shared by the core tests: one kit server per file, a fresh user and app per test.
import { createHarness, type Harness } from './harness';
import { TestServer } from './server';

export const USER = 'u-test';

export function appSuite(packId: 'polly' | 'premom' = 'premom') {
  const server = new TestServer();
  const ctx = { server, h: undefined as unknown as Harness };
  beforeAll(() => server.start());
  afterAll(() => server.stop());
  beforeEach(async () => {
    await server.reset(USER);
    ctx.h = createHarness(server.url, packId);
  });
  afterEach(() => ctx.h.dispose());
  return ctx;
}

export const OK = { ok: true };
export const err = (error: string) => ({ ok: false, error });
