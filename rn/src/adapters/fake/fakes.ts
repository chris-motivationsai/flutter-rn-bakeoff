// Scripted stand-ins for the device: the scenario runner and the tests load them with what the
// "device" should do next, then drive the real core.
import { hexToBytes } from '../../core/numbers';
import type { Clock, GrayImage, IdSource, Store, StoreEvent, StoreTransaction, StripCamera, Thermometer, ThermometerEvent } from '../../core/ports';

/** A clock that only moves when told to. */
export class FakeClock implements Clock {
  constructor(public at = '2026-01-01T00:00:00Z') {}
  now(): string {
    return this.at;
  }
}

/** Real random UUIDs in Node; `crypto.randomUUID` exists there as a global. */
export const nodeIds: IdSource = { uuid: () => globalThis.crypto.randomUUID() };

/** A camera whose next picture is whatever the test put in front of it. */
export class FakeCamera implements StripCamera {
  next: GrayImage | null = null;
  async capture(): Promise<GrayImage> {
    if (!this.next) throw new Error('FakeCamera has no image loaded');
    const image = this.next;
    this.next = null;
    return image;
  }
}

/** The shape of a kit Bluetooth fixture (scenarios/fixtures/ble/*.json). */
export type BleScript = {
  device: { name: string; service?: string };
  events: ({ event: 'connect' } | { event: 'notify'; char: string; hex: string } | { event: 'disconnect' })[];
};

/** Plays a scripted Bluetooth session, event by event, until the script ends or the listener has enough. */
export class FakeThermometer implements Thermometer {
  script: BleScript | null = null;
  sessions = 0;

  async runSession(listener: (event: ThermometerEvent) => boolean): Promise<void> {
    if (!this.script) throw new Error('FakeThermometer has no script loaded');
    const script = this.script;
    this.script = null;
    this.sessions++;
    for (const step of script.events) {
      const event: ThermometerEvent =
        step.event === 'connect' ? { event: 'connect', deviceName: script.device.name }
        : step.event === 'notify' ? { event: 'notify', char: step.char, bytes: hexToBytes(step.hex) }
        : { event: 'disconnect' };
      if (!listener(event)) return;
    }
  }
}

/** Plays a scripted store. `finished` outlives app restarts, like the real store's own records. */
export class FakeStore implements Store {
  purchaseScript: StoreEvent[] = [];
  restoreScript: StoreTransaction[] = [];
  readonly finished: string[] = [];
  purchaseCalls = 0;

  async purchase(_productId: string, listener: (event: StoreEvent) => Promise<void>): Promise<void> {
    this.purchaseCalls++;
    const script = this.purchaseScript;
    this.purchaseScript = [];
    for (const event of script) await listener(event);
  }

  async restore(): Promise<StoreTransaction[]> {
    const script = this.restoreScript;
    this.restoreScript = [];
    return script;
  }

  async finish(txId: string): Promise<void> {
    if (!this.finished.includes(txId)) this.finished.push(txId);
  }
}
