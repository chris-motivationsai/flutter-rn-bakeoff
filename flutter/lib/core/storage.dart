/// Durable on-device storage (SQLite through package:sqlite3, the same library and SQL on a
/// phone and on this Mac). Everything SPEC section 4 calls durable lives here: observations,
/// pending mutations, the pull cursor, conflicts, entitlements and unverified receipts.
library;

import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

import 'model.dart';

class LocalStore {
  LocalStore._(this._db);

  /// Opens (and if needed creates) the database file at [path].
  factory LocalStore.open(String path) => LocalStore._(sqlite3.open(path)).._migrate();

  /// A throwaway database for tests.
  factory LocalStore.inMemory() => LocalStore._(sqlite3.openInMemory()).._migrate();

  final Database _db;
  bool _closed = false;

  static const schemaVersion = 1;

  void _migrate() {
    final v = _db.userVersion;
    if (v < 1) {
      _db.execute('''
        CREATE TABLE observations(
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          value TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          source TEXT NOT NULL,
          reader TEXT,
          base_revision INTEGER NOT NULL DEFAULT 0,
          pending_op TEXT,
          pending_mutation_id TEXT,
          pending_seq INTEGER
        );
        CREATE INDEX observations_key ON observations(type, observed_at);
        CREATE TABLE conflicts(seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, observed_at TEXT NOT NULL);
        CREATE TABLE entitlements(name TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
        CREATE TABLE receipts(seq INTEGER PRIMARY KEY AUTOINCREMENT, tx_id TEXT NOT NULL UNIQUE, receipt TEXT NOT NULL);
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      ''');
      _db.userVersion = schemaVersion;
    }
  }

  void close() {
    if (_closed) return;
    _closed = true;
    _db.close();
  }

  /// Runs [body] atomically.
  T transaction<T>(T Function() body) {
    _db.execute('BEGIN IMMEDIATE');
    try {
      final r = body();
      _db.execute('COMMIT');
      return r;
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  // ---- meta ----
  String? _meta(String key) {
    final rows = _db.select('SELECT value FROM meta WHERE key = ?', [key]);
    return rows.isEmpty ? null : rows.first['value'] as String;
  }

  void _setMeta(String key, String value) =>
      _db.execute('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);

  int get cursor => int.parse(_meta('cursor') ?? '0');
  set cursor(int v) => _setMeta('cursor', '$v');

  String? get deviceId => _meta('device_id');
  set deviceId(String? v) => _setMeta('device_id', v!);

  /// Next position in the push queue. Monotonic for the life of the database.
  int nextSeq() {
    final n = int.parse(_meta('pending_seq') ?? '0') + 1;
    _setMeta('pending_seq', '$n');
    return n;
  }

  // ---- observations ----
  static Obs _obs(Row r) => Obs(
        id: r['id'] as String,
        type: r['type'] as String,
        value: (jsonDecode(r['value'] as String) as Map).cast<String, Object?>(),
        observedAt: r['observed_at'] as String,
        source: r['source'] as String,
        reader: r['reader'] == null ? null : (jsonDecode(r['reader'] as String) as Map).cast<String, Object?>(),
        baseRevision: r['base_revision'] as int,
        pending: r['pending_mutation_id'] == null
            ? null
            : PendingMutation(r['pending_mutation_id'] as String, r['pending_op'] as String, r['pending_seq'] as int),
      );

  /// Inserts or fully replaces an observation row, including its pending mutation.
  void put(Obs o) {
    _db.execute(
      '''INSERT INTO observations(id, type, value, observed_at, source, reader, base_revision, pending_op, pending_mutation_id, pending_seq)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET type = excluded.type, value = excluded.value, observed_at = excluded.observed_at,
           source = excluded.source, reader = excluded.reader, base_revision = excluded.base_revision,
           pending_op = excluded.pending_op, pending_mutation_id = excluded.pending_mutation_id, pending_seq = excluded.pending_seq''',
      [
        o.id,
        o.type,
        jsonEncode(o.value),
        o.observedAt,
        o.source,
        o.reader == null ? null : jsonEncode(o.reader),
        o.baseRevision,
        o.pending?.op,
        o.pending?.mutationId,
        o.pending?.seq,
      ],
    );
  }

  Obs? byId(String id) {
    final rows = _db.select('SELECT * FROM observations WHERE id = ?', [id]);
    return rows.isEmpty ? null : _obs(rows.first);
  }

  void remove(String id) => _db.execute('DELETE FROM observations WHERE id = ?', [id]);

  /// Every stored observation, including locally deleted ones and types this pack lacks.
  List<Obs> all() => [for (final r in _db.select('SELECT * FROM observations ORDER BY observed_at, type, rowid')) _obs(r)];

  /// Observations matching a `{type, observedAt}` target that are not locally deleted.
  List<Obs> byKey(String type, String observedAt) => [
        for (final r in _db.select(
            "SELECT * FROM observations WHERE type = ? AND observed_at = ? AND (pending_op IS NULL OR pending_op <> 'delete') ORDER BY rowid",
            [type, observedAt]))
          _obs(r)
      ];

  /// Observations with a pending mutation, oldest first.
  List<Obs> pending() => [
        for (final r in _db.select('SELECT * FROM observations WHERE pending_mutation_id IS NOT NULL ORDER BY pending_seq, rowid'))
          _obs(r)
      ];

  int pendingCount() =>
      _db.select('SELECT COUNT(*) AS n FROM observations WHERE pending_mutation_id IS NOT NULL').first['n'] as int;

  // ---- conflicts ----
  void addConflict(String type, String observedAt) =>
      _db.execute('INSERT INTO conflicts(type, observed_at) VALUES(?, ?)', [type, observedAt]);

  List<TargetKey> conflicts() => [
        for (final r in _db.select('SELECT type, observed_at FROM conflicts ORDER BY seq'))
          TargetKey(r['type'] as String, r['observed_at'] as String)
      ];

  // ---- entitlements ----
  void putEntitlement(Entitlement e) => _db.execute(
      'INSERT INTO entitlements(name, expires_at) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at',
      [e.name, e.expiresAt]);

  List<Entitlement> entitlements() => [
        for (final r in _db.select('SELECT name, expires_at FROM entitlements ORDER BY name'))
          Entitlement(r['name'] as String, r['expires_at'] as String)
      ];

  // ---- receipts waiting for the server ----
  void holdReceipt(HeldReceipt r) => _db.execute(
      'INSERT INTO receipts(tx_id, receipt) VALUES(?, ?) ON CONFLICT(tx_id) DO UPDATE SET receipt = excluded.receipt',
      [r.txId, r.receipt]);

  void dropReceipt(String txId) => _db.execute('DELETE FROM receipts WHERE tx_id = ?', [txId]);

  List<HeldReceipt> heldReceipts() => [
        for (final r in _db.select('SELECT tx_id, receipt FROM receipts ORDER BY seq'))
          HeldReceipt(r['tx_id'] as String, r['receipt'] as String)
      ];
}
