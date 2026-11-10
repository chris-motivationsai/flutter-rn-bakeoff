import type { ObservationBody, Source } from './contracts';

/** Error codes a step / user action can end with (SPEC sections 3 to 5). */
export type ErrorCode =
  | 'unknown_type'
  | 'source_not_allowed'
  | 'invalid_value'
  | 'strip_no_control_line'
  | 'strip_too_dark'
  | 'strip_too_bright'
  | 'strip_bad_input'
  | 'thermo_invalid_reading'
  | 'thermo_no_final_reading'
  | 'not_found'
  | 'read_only'
  | 'network'
  | 'cancelled'
  | 'store_error'
  | 'not_available'
  | 'invalid_receipt'
  | 'receipt_user_mismatch';

export type Result = { ok: true } | { ok: false; error: ErrorCode };
export const OK: Result = { ok: true };
export const fail = (error: ErrorCode): Result => ({ ok: false, error });

export type ObservationValue = Record<string, unknown>;

/** An observation as stored on the device. */
export type StoredObservation = ObservationBody & {
  id: string;
  /** Last server revision this device knows for the observation; 0 = the server has never confirmed it. */
  baseRevision: number;
  /** True while a local delete is waiting to be pushed. */
  deleted: boolean;
};

export type PendingMutation = {
  observationId: string;
  mutationId: string;
  op: 'upsert' | 'delete';
  /** Order in which observations became pending (oldest first). */
  seq: number;
  /** True once the mutation has been put on the wire at least once (the server may have applied it). */
  attempted: boolean;
};

export type Target = { type: string; observedAt: string };

export type StripDisplay = { level: string | null; ratio: number | null; locked: boolean };

export type SnapshotObservation = {
  type: string;
  observedAt: string;
  source: Source;
  sync: 'pending' | 'synced';
  display: ObservationValue | StripDisplay;
};

export type PurchaseState = 'idle' | 'pending' | 'verifying';

/** What the Today screen shows. The runner adds `storeFinished` from the fake store. */
export type Snapshot = {
  pack: string;
  observations: SnapshotObservation[];
  pendingMutations: number;
  conflicts: Target[];
  entitlements: string[];
  purchaseState: PurchaseState;
  lastPurchaseError: string | null;
};
