// Everything the core needs from the device sits behind these ports.
// Real implementations: src/adapters/real. Fakes for tests and the scenario runner: src/adapters/fake.

export type SqlValue = string | number | null;

/** Synchronous SQLite. expo-sqlite on a phone, node:sqlite in headless runs; the SQL is identical. */
export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): void;
  all<Row>(sql: string, params?: SqlValue[]): Row[];
  close(): void;
}

/** "Now" as a canonical UTC timestamp with second precision. The core never reads the system clock itself. */
export interface Clock {
  now(): string;
}

export interface IdSource {
  uuid(): string;
}

/** A pre-cropped grayscale strip image: width * height bytes, row-major, 0 = black. */
export type GrayImage = { width: number; height: number; gray: Uint8Array };

/** Where a strip photo comes from (camera on a phone, a PGM fixture in tests). */
export interface StripCamera {
  capture(): Promise<GrayImage>;
}

/** The C++ strip engine, reached through whatever binding the runtime has. */
export interface StripEngine {
  version(): string;
  read(gray: Uint8Array, width: number, height: number): { status: number; ratio: number };
}

export type ThermometerEvent =
  | { event: 'connect'; deviceName: string }
  | { event: 'notify'; char: string; bytes: Uint8Array }
  | { event: 'disconnect' };

/**
 * One Bluetooth thermometer session. The adapter connects to a Health Thermometer (service 0x1809) and
 * reports events in order. The listener returns false to say "I have what I need, disconnect".
 * The promise resolves when the session is over. `char` is the 16-bit characteristic id in upper case ("2A1C").
 */
export interface Thermometer {
  runSession(listener: (event: ThermometerEvent) => boolean): Promise<void>;
}

export type StoreEvent =
  | { event: 'pending' }
  | { event: 'cancelled' }
  | { event: 'error'; code?: string }
  | { event: 'purchased'; txId: string; receipt: string };

export type StoreTransaction = { txId: string; receipt: string };

/** The app store. `purchase` reports what the store does, in order, and resolves when it has nothing more to say. */
export interface Store {
  purchase(productId: string, listener: (event: StoreEvent) => Promise<void>): Promise<void>;
  restore(): Promise<StoreTransaction[]>;
  finish(txId: string): Promise<void>;
}

export type HttpRequest = { method: 'GET' | 'POST'; path: string; body?: unknown };
/** `unreachable` covers every transport failure; any HTTP answer comes back with its status and parsed JSON. */
export type HttpResponse = { kind: 'response'; status: number; json: unknown } | { kind: 'unreachable' };

export interface Http {
  send(request: HttpRequest): Promise<HttpResponse>;
}
