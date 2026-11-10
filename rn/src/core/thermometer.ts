// Bluetooth Health Thermometer (service 0x1809) decoding. Pure functions: the adapter only delivers bytes.
import type { ThermometerEvent } from './ports';
import { roundTo } from './numbers';
import { isoFromFields } from './time';

export const HEALTH_THERMOMETER_SERVICE = '1809';
/** Temperature Measurement: the final reading. */
export const FINAL_MEASUREMENT_CHAR = '2A1C';
/** Intermediate Temperature: readings while the thermometer is still settling. Always ignored. */
export const INTERMEDIATE_CHAR = '2A1E';

const FLAG_FAHRENHEIT = 0x01;
const FLAG_TIMESTAMP = 0x02;
const FLAG_TEMPERATURE_TYPE = 0x04;
const NAN_MANTISSA = 0x7fffff;

export type TemperatureReading = {
  /** Degrees Celsius, rounded to 2 decimals. */
  celsius: number;
  /** The device's own timestamp (treated as UTC), or null when the frame has none or it is not a real date. */
  deviceTime: string | null;
};

/** Decodes one Temperature Measurement frame. Returns null for NaN or a frame shorter than its flags declare. */
export function parseTemperatureMeasurement(bytes: Uint8Array): TemperatureReading | null {
  if (bytes.length < 1) return null;
  const flags = bytes[0];
  const hasTimestamp = (flags & FLAG_TIMESTAMP) !== 0;
  const hasType = (flags & FLAG_TEMPERATURE_TYPE) !== 0;
  const needed = 1 + 4 + (hasTimestamp ? 7 : 0) + (hasType ? 1 : 0);
  if (bytes.length < needed) return null;

  // IEEE-11073 32-bit FLOAT: 24-bit signed mantissa (little-endian), then a signed 8-bit exponent.
  const rawMantissa = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16);
  if (rawMantissa === NAN_MANTISSA) return null;
  const mantissa = rawMantissa & 0x800000 ? rawMantissa - 0x1000000 : rawMantissa;
  const exponent = bytes[4] & 0x80 ? bytes[4] - 0x100 : bytes[4];
  // Dividing by a power of ten (instead of multiplying by 0.01) keeps 3668e-2 exactly 36.68.
  const value = exponent < 0 ? mantissa / 10 ** -exponent : mantissa * 10 ** exponent;
  const celsius = flags & FLAG_FAHRENHEIT ? ((value - 32) * 5) / 9 : value;

  let deviceTime: string | null = null;
  if (hasTimestamp) {
    const year = bytes[5] | (bytes[6] << 8);
    deviceTime = isoFromFields(year, bytes[7], bytes[8], bytes[9], bytes[10], bytes[11]);
  }
  return { celsius: roundTo(celsius, 2), deviceTime };
}

export type SessionOutcome =
  | { kind: 'reading'; reading: TemperatureReading; deviceName: string }
  | { kind: 'invalid' }
  | { kind: 'no_final_reading' };

/**
 * Follows one thermometer session. The first final measurement (2A1C) received while connected decides
 * the session; intermediate readings (2A1E) and anything after a disconnect are ignored.
 */
export class ThermometerSessionReader {
  private deviceName = '';
  private connected = false;
  private result: SessionOutcome | null = null;

  /** Feeds one event. Returns false once the session is decided (the adapter may disconnect). */
  feed(event: ThermometerEvent): boolean {
    if (this.result) return false;
    if (event.event === 'connect') {
      this.connected = true;
      this.deviceName = event.deviceName;
    } else if (event.event === 'disconnect') {
      this.connected = false;
      this.result = { kind: 'no_final_reading' };
    } else if (this.connected && event.char.toUpperCase() === FINAL_MEASUREMENT_CHAR) {
      const reading = parseTemperatureMeasurement(event.bytes);
      this.result = reading ? { kind: 'reading', reading, deviceName: this.deviceName } : { kind: 'invalid' };
    }
    return this.result === null;
  }

  outcome(): SessionOutcome {
    return this.result ?? { kind: 'no_final_reading' };
  }
}
