// The app core. Screens and the scenario runner both drive this one class; it owns every rule in SPEC.md
// and reaches the device only through the ports.
import { Api } from './api';
import type { ObservationBody, Source } from './contracts';
import { checkValue, contractAccepts, displayFor, entryFor, LH_DECIMALS } from './observations';
import { roundTo } from './numbers';
import { findEntry, type Pack } from './pack';
import type { Clock, Http, IdSource, SqlDriver, Store, StripCamera, StripEngine, Thermometer } from './ports';
import { Purchases } from './purchases';
import { Storage } from './storage';
import { pullChanges, pushPending } from './sync';
import { ThermometerSessionReader } from './thermometer';
import { OK, fail, type ErrorCode, type ObservationValue, type Result, type Snapshot, type StoredObservation, type Target } from './types';

export type AppDeps = {
  pack: Pack;
  db: SqlDriver;
  http: Http;
  clock: Clock;
  ids: IdSource;
  stripEngine: StripEngine;
  camera: StripCamera;
  thermometer: Thermometer;
  store: Store;
};

/** Engine status codes from strip_engine.h, mapped to step errors. Status 0 is success. */
const STRIP_ERRORS: Record<number, ErrorCode> = {
  1: 'strip_no_control_line',
  2: 'strip_too_dark',
  3: 'strip_too_bright',
};

export class AppCore {
  readonly pack: Pack;
  private readonly storage: Storage;
  private readonly api: Api;
  private readonly purchases: Purchases;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: AppDeps) {
    this.pack = deps.pack;
    this.storage = new Storage(deps.db);
    this.api = new Api(deps.http);
    this.purchases = new Purchases(deps.pack, this.storage, this.api, deps.store);
  }

  /** Disposes this instance. A new AppCore on the same database continues where this one stopped. */
  close(): void {
    this.listeners.clear();
    this.storage.close();
  }

  /** Screens subscribe to re-read `snapshot()` after every action. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- logging ----

  logManual(type: string, value: unknown): Promise<Result> {
    return this.exclusive(async () => {
      const entry = entryFor(this.pack, type, 'manual');
      if (!entry.ok) return fail(entry.error);
      const checked = checkValue(entry.value, value);
      if (!checked.ok) return fail(checked.error);
      return this.create({ type, value: checked.value, observedAt: this.deps.clock.now(), source: 'manual' });
    });
  }

  /** Takes a strip image from the camera port and runs it through the C++ engine. A failed read creates nothing. */
  scanStrip(type: string): Promise<Result> {
    return this.exclusive(async () => {
      const entry = entryFor(this.pack, type, 'strip_reader');
      if (!entry.ok) return fail(entry.error);
      const image = await this.deps.camera.capture();
      const read = this.deps.stripEngine.read(image.gray, image.width, image.height);
      if (read.status !== 0) return fail(STRIP_ERRORS[read.status] ?? 'strip_bad_input');
      return this.create({
        type,
        value: { ratio: roundTo(read.ratio, LH_DECIMALS) },
        observedAt: this.deps.clock.now(),
        source: 'strip_reader',
        reader: { engineVersion: this.deps.stripEngine.version() },
      });
    });
  }

  /** Runs one Bluetooth thermometer session and logs its final reading. A failed session creates nothing. */
  readThermometer(type: string): Promise<Result> {
    return this.exclusive(async () => {
      const entry = entryFor(this.pack, type, 'thermometer');
      if (!entry.ok) return fail(entry.error);
      const session = new ThermometerSessionReader();
      await this.deps.thermometer.runSession((event) => session.feed(event));
      const outcome = session.outcome();
      if (outcome.kind === 'no_final_reading') return fail('thermo_no_final_reading');
      if (outcome.kind === 'invalid') return fail('thermo_invalid_reading');
      const { celsius, deviceTime } = outcome.reading;
      if (entry.value.kind !== 'number' || celsius < entry.value.min || celsius > entry.value.max) return fail('thermo_invalid_reading');
      return this.create({
        type,
        value: { [entry.value.field]: celsius },
        observedAt: deviceTime ?? this.deps.clock.now(),
        source: 'thermometer',
        reader: { deviceModel: outcome.deviceName },
      });
    });
  }

  private async create(body: ObservationBody): Promise<Result> {
    if (!contractAccepts(body)) return fail('invalid_value');
    const id = this.deps.ids.uuid();
    this.storage.transaction(() => {
      this.storage.putObservation({ ...body, id, baseRevision: 0 });
      this.storage.replacePending(id, this.deps.ids.uuid(), 'upsert');
    });
    // Analytics gate (SPEC section 6): type, source and pack only. Never the value. One attempt, failures dropped.
    await this.api.sendEvent({ name: 'observation_logged', props: { type: body.type, source: body.source, pack: this.pack.packId } });
    return OK;
  }

  // ---- edit and delete ----

  edit(target: Target, value: unknown): Promise<Result> {
    return this.exclusive(async () => {
      const obs = this.find(target);
      if (!obs) return fail('not_found');
      if (obs.source !== 'manual') return fail('read_only'); // reader results are never edited
      const entry = findEntry(this.pack, obs.type);
      const checked = entry ? checkValue(entry, value) : ({ ok: false, error: 'invalid_value' } as const);
      if (!checked.ok) return fail(checked.error);
      this.storage.transaction(() => {
        this.storage.putObservation({ ...obs, value: checked.value });
        this.storage.replacePending(obs.id, this.deps.ids.uuid(), 'upsert');
      });
      return OK;
    });
  }

  delete(target: Target): Promise<Result> {
    return this.exclusive(async () => {
      const obs = this.find(target);
      if (!obs) return fail('not_found');
      this.storage.transaction(() => {
        const pending = this.storage.getPending(obs.id);
        const unconfirmedCreate = obs.baseRevision === 0 && pending !== null;
        if (unconfirmedCreate && !pending.attempted) {
          // Created and deleted before it was ever sent: nothing to send.
          this.storage.removePending(obs.id);
          this.storage.removeObservation(obs.id);
        } else if (unconfirmedCreate) {
          // The create went out but was never answered, so the server may or may not have it. Hide the
          // observation and keep retrying the same create; sync sends the delete once the create is confirmed.
          this.storage.putObservation({ ...obs, deleted: true });
        } else {
          this.storage.putObservation({ ...obs, deleted: true });
          this.storage.replacePending(obs.id, this.deps.ids.uuid(), 'delete');
        }
      });
      return OK;
    });
  }

  /** Observations this app can show: a type from the pack, not locally deleted. Sorted by time, then type. */
  private visible(): StoredObservation[] {
    return this.storage.allObservations().filter((obs) => !obs.deleted && findEntry(this.pack, obs.type) !== undefined);
  }

  private find(target: Target): StoredObservation | undefined {
    return this.visible().find((obs) => obs.type === target.type && obs.observedAt === target.observedAt);
  }

  // ---- sync ----

  sync(): Promise<Result> {
    return this.exclusive(async () => {
      await this.purchases.retryHeldReceipts();
      const deviceId = this.storage.deviceId(() => this.deps.ids.uuid());
      if ((await pushPending(this.storage, this.api, this.deps.ids, deviceId)) === 'network') return fail('network');
      if ((await pullChanges(this.storage, this.api)) === 'network') return fail('network');
      return OK;
    });
  }

  // ---- purchases ----

  purchase(productId: string): Promise<Result> {
    return this.exclusive(() => this.purchases.purchase(productId));
  }

  restore(): Promise<Result> {
    return this.exclusive(() => this.purchases.restore());
  }

  // ---- what the Today screen shows ----

  snapshot(): Snapshot {
    const now = this.deps.clock.now();
    const entitlements = this.purchases.activeEntitlements(now);
    return {
      pack: this.pack.packId,
      observations: this.visible().map((obs) => ({
        type: obs.type,
        observedAt: obs.observedAt,
        source: obs.source as Source,
        sync: this.storage.getPending(obs.id) ? 'pending' : 'synced',
        display: displayFor(this.pack, obs.type, obs.value as ObservationValue, entitlements),
      })),
      pendingMutations: this.storage.countPending(),
      conflicts: this.storage.allConflicts(),
      entitlements,
      purchaseState: this.purchases.state(),
      lastPurchaseError: this.purchases.lastPurchaseError(),
    };
  }

  /** Runs one action at a time, in call order, and tells subscribers when it is done. */
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const run = this.queue.then(action);
    this.queue = run.catch(() => undefined);
    return run.finally(() => this.listeners.forEach((listener) => listener()));
  }
}
