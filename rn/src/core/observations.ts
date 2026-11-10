// The rules for turning input into an observation value, and a stored observation into what is displayed.
import { validateObservationBody, type ObservationBody, type Source } from './contracts';
import { roundTo } from './numbers';
import { findEntry, levelFor, valueField, type CatalogEntry, type Pack } from './pack';
import type { ErrorCode, ObservationValue, StripDisplay } from './types';

export const BBT_DECIMALS = 2;
export const LH_DECIMALS = 3;

type Checked<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };

/** Catalog checks shared by every way of logging: the type must be in the pack and allow this source. */
export function entryFor(pack: Pack, type: string, source: Source): Checked<CatalogEntry> {
  const entry = findEntry(pack, type);
  if (!entry) return { ok: false, error: 'unknown_type' };
  if (!entry.sources.includes(source)) return { ok: false, error: 'source_not_allowed' };
  return { ok: true, value: entry };
}

/** Number values are rounded to the precision the contract demands (lh: 3 decimals, everything else: 2). */
export function decimalsFor(entry: CatalogEntry): number {
  return entry.kind === 'strip' ? LH_DECIMALS : BBT_DECIMALS;
}

/**
 * Checks a value against the catalog entry and returns it in stored form (numbers rounded).
 * The value must be an object with exactly the entry's field.
 */
export function checkValue(entry: CatalogEntry, input: unknown): Checked<ObservationValue> {
  const invalid: Checked<ObservationValue> = { ok: false, error: 'invalid_value' };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid;
  const field = valueField(entry);
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== field) return invalid;
  const raw = (input as Record<string, unknown>)[field];

  if (entry.kind === 'enum') {
    if (typeof raw !== 'string' || !entry.values.includes(raw)) return invalid;
    return { ok: true, value: { [field]: raw } };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return invalid;
  const rounded = roundTo(raw, decimalsFor(entry));
  if (entry.kind === 'number' && (rounded < entry.min || rounded > entry.max)) return invalid;
  if (entry.kind === 'strip' && rounded < 0) return invalid;
  return { ok: true, value: { [field]: rounded } };
}

/** Last line of defence: the kit's own validator must accept whatever we are about to store and push. */
export function contractAccepts(body: ObservationBody): boolean {
  return validateObservationBody(body) === null;
}

/** What the Today screen shows for one observation. */
export function displayFor(pack: Pack, type: string, value: ObservationValue, activeEntitlements: readonly string[]): ObservationValue | StripDisplay {
  const entry = findEntry(pack, type);
  if (!entry || entry.kind !== 'strip') return value;
  const ratio = typeof value.ratio === 'number' ? value.ratio : 0;
  const level = levelFor(entry, ratio);
  if (entry.numeric === null) return { level, ratio: null, locked: false };
  const unlocked = activeEntitlements.includes(entry.numeric.requiresEntitlement);
  return unlocked ? { level, ratio, locked: false } : { level, ratio: null, locked: true };
}
