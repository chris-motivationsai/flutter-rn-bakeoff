/// Bluetooth Health Thermometer (service 0x1809) protocol: frame parsing and the session
/// rule "only the final measurement counts". Pure Dart; the radio sits behind
/// [ThermometerTransport] (see adapters.dart).
library;

import 'dart:typed_data';

import 'contracts.dart';
import 'model.dart';

/// 16-bit UUIDs, upper-case hex, as the fixtures and the real adapter both report them.
const String kHealthThermometerService = '1809';
const String kTemperatureMeasurementChar = '2A1C'; // final reading (indicate)
const String kIntermediateTemperatureChar = '2A1E'; // live reading (notify) - ignored

sealed class BleEvent {
  const BleEvent();
}

class BleConnected extends BleEvent {
  const BleConnected(this.deviceName);
  final String deviceName;
}

class BleNotification extends BleEvent {
  const BleNotification(this.characteristic, this.bytes);

  /// 16-bit characteristic UUID in upper-case hex, e.g. `2A1C`.
  final String characteristic;
  final Uint8List bytes;
}

class BleDisconnected extends BleEvent {
  const BleDisconnected();
}

class ThermoFrame {
  ThermoFrame(this.value, this.fahrenheit, this.timestamp, this.temperatureType);

  /// Temperature in the unit the device sent.
  final double value;
  final bool fahrenheit;

  /// Device timestamp (canonical UTC string) when the frame carries one.
  final String? timestamp;
  final int? temperatureType;

  double get celsius => fahrenheit ? (value - 32) * 5 / 9 : value;
}

/// Parses a Temperature Measurement frame. Returns null for an invalid one: too short for
/// the fields its flags declare, a NaN mantissa, or an impossible timestamp.
ThermoFrame? parseTemperatureMeasurement(Uint8List b) {
  if (b.isEmpty) return null;
  final flags = b[0];
  final fahrenheit = flags & 0x01 != 0;
  final hasTimestamp = flags & 0x02 != 0;
  final hasType = flags & 0x04 != 0;
  final need = 1 + 4 + (hasTimestamp ? 7 : 0) + (hasType ? 1 : 0);
  if (b.length < need) return null;

  // IEEE-11073 32-bit FLOAT: 24-bit signed mantissa (little-endian), signed 8-bit exponent.
  final raw = b[1] | (b[2] << 8) | (b[3] << 16);
  if (raw == 0x7FFFFF) return null; // NaN
  final mantissa = raw >= 0x800000 ? raw - 0x1000000 : raw;
  final exponent = b[4] >= 0x80 ? b[4] - 0x100 : b[4];
  final value = _scale(mantissa, exponent);
  if (!value.isFinite) return null;

  var at = 5;
  String? timestamp;
  if (hasTimestamp) {
    final year = b[at] | (b[at + 1] << 8);
    final t = DateTime.utc(year, b[at + 2], b[at + 3], b[at + 4], b[at + 5], b[at + 6]);
    // DateTime.utc normalises overflow (month 13 -> January); reject anything it had to fix.
    if (t.year != year || t.month != b[at + 2] || t.day != b[at + 3] || t.hour != b[at + 4] || t.minute != b[at + 5] || t.second != b[at + 6]) {
      return null;
    }
    timestamp = isoSeconds(t);
    if (!isIsoSeconds(timestamp)) return null;
    at += 7;
  }
  final type = hasType ? b[at] : null;
  return ThermoFrame(value, fahrenheit, timestamp, type);
}

/// mantissa x 10^exponent without the drift of repeated float multiplication for the
/// common negative exponents (3668 x 10^-2 is exactly 36.68's nearest double).
double _scale(int mantissa, int exponent) {
  if (exponent >= 0) {
    var v = mantissa.toDouble();
    for (var i = 0; i < exponent; i++) {
      v *= 10;
    }
    return v;
  }
  if (exponent >= -22) {
    var d = 1.0;
    for (var i = 0; i < -exponent; i++) {
      d *= 10; // exact up to 10^22
    }
    return mantissa / d;
  }
  return mantissa == 0 ? 0 : mantissa / double.parse('1e${-exponent}');
}

/// Outcome of listening to one thermometer session.
class ThermoSessionResult {
  ThermoSessionResult.reading(ThermoFrame this.frame, String this.deviceName) : error = null;
  ThermoSessionResult.failed(String this.error)
      : frame = null,
        deviceName = null;
  final ThermoFrame? frame;
  final String? deviceName;
  final String? error;
}

/// Consumes a session's events. Intermediate readings (2A1E) are ignored; the first final
/// measurement (2A1C) decides the outcome; a disconnect before one is `thermo_no_final_reading`.
Future<ThermoSessionResult> readThermometerSession(Stream<BleEvent> events) async {
  var deviceName = '';
  await for (final e in events) {
    switch (e) {
      case BleConnected(deviceName: final n):
        deviceName = n;
      case BleNotification(characteristic: final c, bytes: final bytes):
        if (c.toUpperCase() != kTemperatureMeasurementChar) continue;
        final frame = parseTemperatureMeasurement(bytes);
        if (frame == null) return ThermoSessionResult.failed(Err.thermoInvalidReading);
        return ThermoSessionResult.reading(frame, deviceName);
      case BleDisconnected():
        return ThermoSessionResult.failed(Err.thermoNoFinalReading);
    }
  }
  return ThermoSessionResult.failed(Err.thermoNoFinalReading);
}

Uint8List hexToBytes(String hex) {
  final clean = hex.replaceAll(RegExp(r'\s'), '');
  if (clean.length.isOdd) throw FormatException('odd-length hex', hex);
  final out = Uint8List(clean.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    out[i] = int.parse(clean.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return out;
}
