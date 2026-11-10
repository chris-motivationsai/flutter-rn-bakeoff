// Words shown to the user. Kept apart from the screens so tests and screens agree on them.
import type { ErrorCode, ObservationValue, SnapshotObservation, StripDisplay } from '../core/types';

const ERROR_TEXT: Record<ErrorCode, string> = {
  unknown_type: 'This app does not track that.',
  source_not_allowed: 'That cannot be entered this way.',
  invalid_value: 'That value is not valid.',
  strip_no_control_line: 'No control line found. Try another strip.',
  strip_too_dark: 'The photo is too dark.',
  strip_too_bright: 'The photo is too bright.',
  strip_bad_input: 'The photo could not be read.',
  thermo_invalid_reading: 'The thermometer sent an invalid reading.',
  thermo_no_final_reading: 'The thermometer disconnected before a final reading.',
  not_found: 'That entry no longer exists.',
  read_only: 'Device readings cannot be edited.',
  network: 'Could not reach the server. Your entries are saved and will sync later.',
  cancelled: 'Purchase cancelled.',
  store_error: 'The store reported an error.',
  not_available: 'That product is not available.',
  invalid_receipt: 'The purchase could not be verified.',
  receipt_user_mismatch: 'That purchase belongs to another account.',
};

export function errorText(code: string): string {
  return ERROR_TEXT[code as ErrorCode] ?? code;
}

const isStripDisplay = (display: ObservationValue | StripDisplay): display is StripDisplay => 'locked' in display && 'level' in display;

/** One line for an observation's value: "36.61", "medium", "high · 0.689", "high · number locked". */
export function displayText(observation: SnapshotObservation): string {
  const display = observation.display;
  if (!isStripDisplay(display)) return Object.values(display).map(String).join(' ');
  const level = display.level ?? 'unknown';
  if (display.locked) return `${level} · number locked`;
  return display.ratio === null ? level : `${level} · ${display.ratio}`;
}

/** "2026-11-03T06:45:00Z" -> "2026-11-03 06:45" */
export function timeText(observedAt: string): string {
  return observedAt.replace('T', ' ').slice(0, 16);
}
