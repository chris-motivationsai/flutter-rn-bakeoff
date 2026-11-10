/// Contract helpers. The schemas and constants themselves are generated from kit/contracts
/// (see generated/contracts.g.dart); this file only holds a generic JSON Schema checker
/// and small formatting helpers. No contract shape is written out by hand here.
library;

import 'generated/contracts.g.dart';

export 'generated/contracts.g.dart';

final RegExp _isoSeconds = RegExp(kIsoSecondsPattern);

bool isIsoSeconds(Object? s) => s is String && _isoSeconds.hasMatch(s);

/// Formats a UTC instant in the contract's canonical form (second precision, no millis).
String isoSeconds(DateTime t) {
  final u = t.toUtc();
  String p(int n, [int w = 2]) => n.toString().padLeft(w, '0');
  return '${p(u.year, 4)}-${p(u.month)}-${p(u.day)}T${p(u.hour)}:${p(u.minute)}:${p(u.second)}Z';
}

DateTime parseIso(String s) => DateTime.parse(s).toUtc();

/// Rounds half away from zero to [places] decimals.
double roundTo(num v, int places) {
  var scale = 1.0;
  for (var i = 0; i < places; i++) {
    scale *= 10;
  }
  return (v * scale).round() / scale;
}

/// Rounds a value field the way the contract demands for [type], if it demands anything.
num roundForContract(String type, String field, num v) {
  final places = kValueDecimals[type]?[field];
  return places == null ? v : roundTo(v, places);
}

/// Returns null when [value] satisfies the named wire schema, else a short reason.
String? validateAgainst(String schemaName, Object? value) {
  final schema = kSchemas[schemaName];
  if (schema == null) return 'no schema named $schemaName';
  return validateSchema(schema, value);
}

/// Minimal JSON Schema (2020-12 subset) checker covering what kit/contracts emits:
/// type, properties, required, additionalProperties, enum, const, pattern, minimum,
/// maximum, minLength, minItems, items. Returns null when valid.
String? validateSchema(Object? schema, Object? value, [String path = r'$']) {
  if (schema is! Map) return null;
  final type = schema['type'];
  if (type != null) {
    final ok = switch (type) {
      'object' => value is Map,
      'array' => value is List,
      'string' => value is String,
      'number' => value is num && value.isFinite,
      'integer' => value is int || (value is double && value.isFinite && value == value.truncateToDouble()),
      'boolean' => value is bool,
      'null' => value == null,
      _ => true,
    };
    if (!ok) return '$path: expected $type';
  }
  if (schema.containsKey('const') && schema['const'] != value) return '$path: expected const ${schema['const']}';
  final en = schema['enum'];
  if (en is List && !en.contains(value)) return '$path: not one of $en';
  if (value is String) {
    final pattern = schema['pattern'];
    if (pattern is String && !RegExp(pattern).hasMatch(value)) return '$path: does not match pattern';
    final minLength = schema['minLength'];
    if (minLength is num && value.length < minLength) return '$path: shorter than $minLength';
  }
  if (value is num) {
    final min = schema['minimum'];
    final max = schema['maximum'];
    if (min is num && value < min) return '$path: below $min';
    if (max is num && value > max) return '$path: above $max';
  }
  if (value is List) {
    final minItems = schema['minItems'];
    if (minItems is num && value.length < minItems) return '$path: fewer than $minItems items';
    final items = schema['items'];
    if (items is Map) {
      for (var i = 0; i < value.length; i++) {
        final e = validateSchema(items, value[i], '$path[$i]');
        if (e != null) return e;
      }
    }
  }
  if (value is Map) {
    final props = (schema['properties'] as Map?) ?? const {};
    for (final r in (schema['required'] as List?) ?? const []) {
      if (!value.containsKey(r)) return '$path: missing $r';
    }
    final additional = schema['additionalProperties'];
    for (final k in value.keys) {
      if (props.containsKey(k)) {
        final e = validateSchema(props[k], value[k], '$path.$k');
        if (e != null) return e;
      } else if (additional == false) {
        return '$path: unexpected field $k';
      } else if (additional is Map) {
        final e = validateSchema(additional, value[k], '$path.$k');
        if (e != null) return e;
      }
    }
  }
  return null;
}
