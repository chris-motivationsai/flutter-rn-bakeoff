// Bakeoff test server. One user, in-memory, reset per scenario. Usage: node server/server.ts [port]
// Prints "LISTENING <port>" when ready. App endpoints need "Authorization: Bearer test-token".
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import * as c from '../contracts/schemas.ts';
import { readReceipt } from './receipt.ts';

type Obs = c.Observation;
let st = fresh('u-0');
function fresh(user: string) {
  return {
    user, mode: 'ok' as 'ok' | 'down' | 'http503', applyThenDrop: 0, counter: 0,
    obs: new Map<string, Obs>(), seen: new Map<string, any>(),
    events: 0, violations: [] as string[], oversize: 0, pushRequests: 0, rejected: [] as string[],
  };
}

function pushOne(m: any) {
  if (st.seen.has(m.mutationId)) {
    const prev = st.seen.get(m.mutationId);
    return prev.status === 'applied' ? { ...prev, status: 'duplicate' } : prev;
  }
  const cur = st.obs.get(m.id);
  let res: any;
  const reject = (reason: string) => { st.rejected.push(reason); return { mutationId: m.mutationId, status: 'rejected', reason }; };
  if (m.op === 'upsert') {
    const err = m.observation ? c.validateObservationBody(m.observation) : 'missing_observation';
    if (err) res = reject(err);
    else if (!cur) res = m.baseRevision !== 0 ? reject('unknown_id')
      : (st.obs.set(m.id, { ...m.observation, id: m.id, revision: ++st.counter, deleted: false }), { mutationId: m.mutationId, status: 'applied', revision: st.counter });
    else if (cur.revision !== m.baseRevision) res = { mutationId: m.mutationId, status: 'conflict', server: cur };
    else { st.obs.set(m.id, { ...m.observation, id: m.id, revision: ++st.counter, deleted: false }); res = { mutationId: m.mutationId, status: 'applied', revision: st.counter }; }
  } else {
    if (!cur) res = reject('unknown_id');
    else if (cur.revision !== m.baseRevision) res = { mutationId: m.mutationId, status: 'conflict', server: cur };
    else { st.obs.set(m.id, { ...cur, revision: ++st.counter, deleted: true }); res = { mutationId: m.mutationId, status: 'applied', revision: st.counter }; }
  }
  st.seen.set(m.mutationId, res);
  return res;
}

function remote(r: any) {
  const cur = [...st.obs.values()].find(o => o.type === r.type && o.observedAt === r.observedAt);
  if (r.op === 'delete') { if (cur) st.obs.set(cur.id, { ...cur, revision: ++st.counter, deleted: true }); return; }
  const body = { type: r.type, value: r.value, observedAt: r.observedAt, source: r.source ?? 'manual' };
  const id = cur?.id ?? randomUUID();
  st.obs.set(id, { ...body, id, revision: ++st.counter, deleted: false } as Obs);
}

const send = (res: ServerResponse, code: number, body: unknown) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) }); res.end(s);
};
const readBody = (req: IncomingMessage) => new Promise<any>((ok) => {
  let d = ''; req.on('data', x => d += x); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { ok(undefined); } });
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const body = req.method === 'POST' ? await readBody(req) : {};
  // ---- control plane: always reachable ----
  if (url.pathname === '/__control/state') {
    return send(res, 200, { observations: [...st.obs.values()], events: st.events, violations: st.violations, oversize: st.oversize, pushRequests: st.pushRequests, rejected: st.rejected });
  }
  if (url.pathname === '/__control') {
    if (body?.reset) st = fresh(body.reset.user);
    if (body?.mode) st.mode = body.mode;
    if (typeof body?.applyThenDrop === 'number') st.applyThenDrop = body.applyThenDrop;
    if (body?.remote) remote(body.remote);
    return send(res, 200, { ok: true });
  }
  // ---- faults ----
  if (st.mode === 'down') return void req.socket.destroy();
  if (st.mode === 'http503') return send(res, 503, { error: 'unavailable' });
  if (req.headers.authorization !== 'Bearer test-token') return send(res, 401, { error: 'unauthorized' });
  if (body === undefined) return send(res, 400, { error: 'bad_json' });

  if (req.method === 'POST' && url.pathname === '/v1/sync/push') {
    st.pushRequests++;
    const parsed = c.PushRequest.safeParse(body);
    if (!parsed.success) return send(res, 400, { error: 'bad_request', detail: parsed.error.issues.slice(0, 3) });
    if (parsed.data.mutations.length > c.MAX_MUTATIONS_PER_PUSH) { st.oversize++; return send(res, 413, { error: 'too_many_mutations' }); }
    const results = parsed.data.mutations.map(pushOne);
    if (st.applyThenDrop > 0) { st.applyThenDrop--; return void req.socket.destroy(); }
    return send(res, 200, { results });
  }
  if (req.method === 'GET' && url.pathname === '/v1/sync/pull') {
    const since = Number(url.searchParams.get('since') ?? 0);
    const changes = [...st.obs.values()].filter(o => o.revision > since).sort((a, b) => a.revision - b.revision);
    return send(res, 200, { changes, cursor: st.counter });
  }
  if (req.method === 'POST' && url.pathname === '/v1/entitlements/verify') {
    if (!c.VerifyRequest.safeParse(body).success) return send(res, 400, { error: 'bad_request' });
    const r = readReceipt(body.receipt);
    if (!r) return send(res, 422, { error: 'invalid_receipt' });
    if (r.userId !== st.user) return send(res, 422, { error: 'receipt_user_mismatch' });
    return send(res, 200, { entitlements: [{ name: r.entitlement, expiresAt: r.expiresAt }] });
  }
  if (req.method === 'POST' && url.pathname === '/v1/events') {
    if (!c.AnalyticsEvent.safeParse(body).success) { st.violations.push(JSON.stringify(body).slice(0, 200)); return send(res, 422, { error: 'event_not_allowed' }); }
    st.events++;
    return send(res, 202, { ok: true });
  }
  send(res, 404, { error: 'not_found' });
});
server.listen(Number(process.argv[2] ?? 0), '127.0.0.1', () => console.log('LISTENING', (server.address() as any).port));
