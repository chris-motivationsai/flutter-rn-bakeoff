/// A stage pack: the data that turns the one codebase into Polly or Premom.
/// Parsed from kit/packs/*.json at run time (bundled copies live in assets/packs/).
library;

import 'dart:convert';

import 'contracts.dart';

class StripLevel {
  StripLevel(this.level, this.minRatio);
  final String level;
  final num minRatio;
}

class CatalogEntry {
  CatalogEntry._(this.type, this.kind, this.sources, this._field, this.min, this.max, this.values, this.levels,
      this.hasNumeric, this.numericEntitlement);

  factory CatalogEntry.fromJson(Map<String, dynamic> j) {
    final numeric = j['numeric'];
    return CatalogEntry._(
      j['type'] as String,
      j['kind'] as String,
      (j['sources'] as List? ?? const []).cast<String>(),
      j['field'] as String?,
      j['min'] as num?,
      j['max'] as num?,
      (j['values'] as List?)?.cast<String>(),
      [for (final l in (j['levels'] as List? ?? const [])) StripLevel(l['level'] as String, l['minRatio'] as num)],
      numeric is Map,
      numeric is Map ? numeric['requiresEntitlement'] as String? : null,
    );
  }

  final String type;

  /// `number` | `enum` | `strip`.
  final String kind;
  final List<String> sources;
  final String? _field;
  final num? min;
  final num? max;
  final List<String>? values;
  final List<StripLevel> levels;

  /// False when the pack says `numeric: null`: the ratio is never shown.
  final bool hasNumeric;

  /// Entitlement that unlocks the numeric result (null: no entitlement needed).
  final String? numericEntitlement;

  /// Name of the single field in this type's value object. The pack names it for number
  /// entries; otherwise it comes from the contract's value schema for the type.
  String get field {
    if (_field != null) return _field;
    final props = (kValueSchemas[type] as Map?)?['properties'];
    if (props is Map && props.length == 1) return props.keys.first as String;
    throw StateError('pack entry "$type" has no value field and the contract does not define one');
  }

  /// The level with the highest minRatio that is <= [ratio]; null if none qualifies.
  String? levelFor(num ratio) {
    StripLevel? best;
    for (final l in levels) {
      if (l.minRatio <= ratio && (best == null || l.minRatio > best.minRatio)) best = l;
    }
    return best?.level;
  }
}

class Product {
  Product(this.productId, this.entitlement);
  final String productId;
  final String entitlement;
}

class StagePack {
  StagePack(this.packId, this.appName, this.catalog, this.products);

  factory StagePack.fromJson(Map<String, dynamic> j) => StagePack(
        j['packId'] as String,
        j['appName'] as String,
        [for (final e in j['catalog'] as List) CatalogEntry.fromJson((e as Map).cast<String, dynamic>())],
        [for (final p in (j['products'] as List? ?? const [])) Product(p['productId'] as String, p['entitlement'] as String)],
      );

  factory StagePack.parse(String json) => StagePack.fromJson(jsonDecode(json) as Map<String, dynamic>);

  final String packId;
  final String appName;
  final List<CatalogEntry> catalog;
  final List<Product> products;

  CatalogEntry? entry(String type) {
    for (final e in catalog) {
      if (e.type == type) return e;
    }
    return null;
  }

  Product? product(String productId) {
    for (final p in products) {
      if (p.productId == productId) return p;
    }
    return null;
  }

  bool has(String type) => entry(type) != null;
}
