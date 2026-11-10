/// The slice's core: every rule in SPEC sections 3-6, on top of durable storage.
/// The screens (lib/ui) and the scenario runner (bin/run_scenario.dart) both drive this
/// one class; nothing in it knows about widgets, plugins or scenarios.
library;

import 'package:uuid/uuid.dart';

import 'adapters.dart';
import 'api.dart';
import 'contracts.dart';
import 'model.dart';
import 'pack.dart';
import 'storage.dart';
import 'strip.dart';
import 'thermometer.dart';

class AppCore {
  AppCore({
    required this.pack,
    required this.store,
    required this.api,
    required this.clock,
    required this.engine,
    required this.billing,
    String Function()? newId,
  }) : _newId = newId ?? const Uuid().v4 {
    store.deviceId ??= _newId();
  }

  final StagePack pack;
  final LocalStore store;
  final ApiClient api;
  final Clock clock;
  final StripEngine engine;
  final StoreAdapter billing;
  final String Function() _newId;

  // Not durable on purpose: after a restart `pending` reads as idle and the error is cleared.
  bool _purchasePending = false;
  String? _lastPurchaseError;

  /// Closes storage. The instance must not be used afterwards.
  void dispose() => store.close();

  // ------------------------------------------------------------------ logging

  /// Catalog gate shared by all three ways in: is the type in this pack, and may it arrive this way?
  ({CatalogEntry? entry, String? error}) _admit(String type, String source) {
    final entry = pack.entry(type);
    if (entry == null) return (entry: null, error: Err.unknownType);
    if (!entry.sources.contains(source)) return (entry: null, error: Err.sourceNotAllowed);
    return (entry: entry, error: null);
  }

  /// Checks a value object against the pack entry (and the contract's value schema for the
  /// type). Returns the normalised value to store, or null if it is not acceptable.
  Map<String, Object?>? _checkValue(CatalogEntry entry, Object? value) {
    if (value is! Map || value.length != 1 || !value.containsKey(entry.field)) return null;
    final v = value[entry.field];
    final Map<String, Object?> out;
    switch (entry.kind) {
      case 'enum':
        if (v is! String || !(entry.values ?? const []).contains(v)) return null;
        out = {entry.field: v};
      default: // number, and strip if a pack ever allowed typing a ratio in
        if (v is! num || !v.isFinite) return null;
        if (entry.min != null && v < entry.min!) return null;
        if (entry.max != null && v > entry.max!) return null;
        out = {entry.field: roundForContract(entry.type, entry.field, v)};
    }
    final schema = kValueSchemas[entry.type];
    if (schema != null && validateSchema(schema, out) != null) return null;
    return out;
  }

  Future<Outcome> logManual(String type, Object? value) async {
    final a = _admit(type, Src.manual);
    if (a.error != null) return Outcome.fail(a.error!);
    final checked = _checkValue(a.entry!, value);
    if (checked == null) return const Outcome.fail(Err.invalidValue);
    return _create(type: type, value: checked, observedAt: clock.now(), source: Src.manual);
  }

  /// Runs a strip image through the engine. A failed read creates nothing.
  Future<Outcome> scanStrip(String type, GrayImage? image) async {
    final a = _admit(type, Src.stripReader);
    if (a.error != null) return Outcome.fail(a.error!);
    if (image == null) return const Outcome.fail(Err.stripBadInput);
    final r = engine.read(image);
    switch (r.status) {
      case 0:
        break;
      case 1:
        return const Outcome.fail(Err.stripNoControlLine);
      case 2:
        return const Outcome.fail(Err.stripTooDark);
      case 3:
        return const Outcome.fail(Err.stripTooBright);
      default:
        return const Outcome.fail(Err.stripBadInput);
    }
    final field = a.entry!.field;
    return _create(
      type: type,
      value: {field: roundForContract(type, field, r.ratio)},
      observedAt: clock.now(),
      source: Src.stripReader,
      reader: {'engineVersion': engine.version},
    );
  }

  /// Listens to one thermometer session and logs its final reading.
  Future<Outcome> thermometerSession(String type, ThermometerTransport transport) async {
    final a = _admit(type, Src.thermometer);
    if (a.error != null) return Outcome.fail(a.error!);
    final entry = a.entry!;
    final now = clock.now(); // the step's time, taken before any waiting on the radio
    final session = await readThermometerSession(transport.session());
    if (session.error != null) return Outcome.fail(session.error!);
    final frame = session.frame!;
    final celsius = roundForContract(type, entry.field, frame.celsius);
    if (!celsius.isFinite || (entry.min != null && celsius < entry.min!) || (entry.max != null && celsius > entry.max!)) {
      return const Outcome.fail(Err.thermoInvalidReading);
    }
    return _create(
      type: type,
      value: {entry.field: celsius},
      observedAt: frame.timestamp ?? now,
      source: Src.thermometer,
      reader: {'deviceModel': session.deviceName},
    );
  }

  Future<Outcome> _create({
    required String type,
    required Map<String, Object?> value,
    required String observedAt,
    required String source,
    Map<String, Object?>? reader,
  }) async {
    final obs = store.transaction(() {
      final o = Obs(
        id: _newId(),
        type: type,
        value: value,
        observedAt: observedAt,
        source: source,
        reader: reader,
        pending: PendingMutation(_newId(), 'upsert', store.nextSeq()),
      );
      store.put(o);
      return o;
    });
    // Analytics gate: type, source and pack only. Never the value, the time or the reader.
    await api.observationLogged(type: type, source: source, pack: pack.packId);
    return Outcome.ok(obs);
  }

  // ------------------------------------------------------------ edit / delete

  Obs? _find(TargetKey target) {
    if (!pack.has(target.type)) return null; // other packs' types are never touched from here
    final hits = store.byKey(target.type, target.observedAt);
    return hits.isEmpty ? null : hits.first;
  }

  Future<Outcome> edit(TargetKey target, Object? value) async {
    final obs = _find(target);
    if (obs == null) return const Outcome.fail(Err.notFound);
    if (obs.source != Src.manual) return const Outcome.fail(Err.readOnly);
    final checked = _checkValue(pack.entry(obs.type)!, value);
    if (checked == null) return const Outcome.fail(Err.invalidValue);
    final updated = store.transaction(() {
      final o = Obs(
        id: obs.id,
        type: obs.type,
        value: checked,
        observedAt: obs.observedAt,
        source: obs.source,
        reader: obs.reader,
        baseRevision: obs.baseRevision,
        // One pending mutation per observation: a new change replaces the old one (new
        // mutationId) but keeps its place in the queue.
        pending: PendingMutation(_newId(), 'upsert', obs.pending?.seq ?? store.nextSeq()),
      );
      store.put(o);
      return o;
    });
    return Outcome.ok(updated);
  }

  Future<Outcome> delete(TargetKey target) async {
    final obs = _find(target);
    if (obs == null) return const Outcome.fail(Err.notFound);
    store.transaction(() {
      if (obs.baseRevision == 0) {
        // The server has never confirmed this observation: there is nothing to delete there.
        store.remove(obs.id);
      } else {
        store.put(Obs(
          id: obs.id,
          type: obs.type,
          value: obs.value,
          observedAt: obs.observedAt,
          source: obs.source,
          reader: obs.reader,
          baseRevision: obs.baseRevision,
          pending: PendingMutation(_newId(), 'delete', obs.pending?.seq ?? store.nextSeq()),
        ));
      }
    });
    return const Outcome.ok();
  }

  // --------------------------------------------------------------------- sync

  /// Receipts first, then push, then pull. `network` if push or pull could not complete.
  Future<Outcome> sync() async {
    await _verifyHeldReceipts();
    try {
      await _push();
      await _pull();
    } on NetworkFailure {
      return const Outcome.fail(Err.network);
    }
    return const Outcome.ok();
  }

  Map<String, Object?> _mutation(Obs o) => {
        'mutationId': o.pending!.mutationId,
        'op': o.pending!.op,
        'id': o.id,
        'baseRevision': o.baseRevision,
        if (o.pending!.op == 'upsert') 'observation': o.body(),
      };

  Future<void> _push() async {
    final queue = store.pending();
    for (var i = 0; i < queue.length; i += kMaxMutationsPerPush) {
      final end = i + kMaxMutationsPerPush < queue.length ? i + kMaxMutationsPerPush : queue.length;
      final batch = queue.sublist(i, end);
      final results = await api.push(store.deviceId!, [for (final o in batch) _mutation(o)]);
      // Each answered batch is committed before the next request, so a later failure
      // cannot undo what the server already confirmed.
      store.transaction(() {
        for (final r in results) {
          _applyPushResult(r);
        }
      });
    }
  }

  void _applyPushResult(MutationResult r) {
    Obs? local;
    for (final o in store.pending()) {
      if (o.pending!.mutationId == r.mutationId) local = o;
    }
    if (local == null) return; // not ours, or already superseded
    switch (r.status) {
      case 'applied':
      case 'duplicate':
        if (local.pending!.op == 'delete') {
          store.remove(local.id);
        } else {
          store.put(_plain(local, baseRevision: r.revision ?? local.baseRevision));
        }
      case 'conflict':
        // The server copy wins and the loss is recorded.
        final server = r.server;
        if (server == null || server['deleted'] == true) {
          store.remove(local.id);
        } else {
          store.put(_fromServer(server));
        }
        store.addConflict(local.type, local.observedAt);
      default:
        // `rejected` means this client broke the contract. Not covered by SPEC: the change
        // is dropped and recorded as a conflict so it cannot block the queue or pass as synced.
        if (local.baseRevision == 0 || local.pending!.op == 'delete') {
          store.remove(local.id);
        } else {
          store.put(_plain(local, baseRevision: local.baseRevision));
        }
        store.addConflict(local.type, local.observedAt);
    }
  }

  Obs _plain(Obs o, {required int baseRevision}) => Obs(
        id: o.id,
        type: o.type,
        value: o.value,
        observedAt: o.observedAt,
        source: o.source,
        reader: o.reader,
        baseRevision: baseRevision,
      );

  Obs _fromServer(Map<String, Object?> s) => Obs(
        id: s['id'] as String,
        type: s['type'] as String,
        value: (s['value'] as Map).cast<String, Object?>(),
        observedAt: s['observedAt'] as String,
        source: s['source'] as String,
        reader: (s['reader'] as Map?)?.cast<String, Object?>(),
        baseRevision: (s['revision'] as num).toInt(),
      );

  Future<void> _pull() async => applyPull(await api.pull(store.cursor));

  /// Applies one pull answer. Observations with a pending local change are left alone.
  void applyPull(PullResult page) {
    store.transaction(() {
      for (final change in page.changes) {
        final id = change['id'] as String;
        if (store.byId(id)?.pending != null) continue; // local change outstanding: push decides
        if (change['deleted'] == true) {
          store.remove(id);
        } else {
          store.put(_fromServer(change)); // kept even if this pack cannot show the type
        }
      }
      store.cursor = page.cursor;
    });
  }

  // ---------------------------------------------------------------- purchases

  Future<Outcome> purchase(String productId) async {
    _lastPurchaseError = null;
    _purchasePending = false;
    if (pack.product(productId) == null) {
      // The store is never called. Like every failure except a cancel, this is the last error.
      _lastPurchaseError = Err.notAvailable;
      return const Outcome.fail(Err.notAvailable);
    }
    var result = const Outcome.ok();
    await for (final event in billing.purchase(productId)) {
      switch (event) {
        case StorePending():
          _purchasePending = true;
        case StoreCancelled():
          _purchasePending = false;
          result = const Outcome.fail(Err.cancelled); // a choice, not an error
        case StoreFailed():
          _purchasePending = false;
          _lastPurchaseError = Err.storeError;
          result = const Outcome.fail(Err.storeError);
        case StorePurchased():
          _purchasePending = false;
          final refused = await _handleReceipt(HeldReceipt(event.txId, event.receipt));
          result = refused == null ? const Outcome.ok() : Outcome.fail(refused);
      }
    }
    return result;
  }

  Future<Outcome> restore() async {
    _lastPurchaseError = null;
    _purchasePending = false;
    for (final p in await billing.restore()) {
      await _handleReceipt(HeldReceipt(p.txId, p.receipt));
    }
    return const Outcome.ok();
  }

  /// A purchase the store delivered outside a purchase() call (for example one approved later).
  Future<void> handleStorePurchase(StorePurchased p) => _handleReceipt(HeldReceipt(p.txId, p.receipt));

  /// Stores the receipt durably, then asks the server. Returns the refusal code, if refused.
  Future<String?> _handleReceipt(HeldReceipt r) async {
    store.holdReceipt(r);
    return _verify(r);
  }

  Future<String?> _verify(HeldReceipt r) async {
    switch (await api.verify(r.receipt)) {
      case Verified(entitlements: final granted):
        store.transaction(() {
          for (final e in granted) {
            store.putEntitlement(e);
          }
          store.dropReceipt(r.txId);
        });
        await billing.finish(r.txId);
        return null;
      case Refused(code: final code):
        store.dropReceipt(r.txId);
        await billing.finish(r.txId);
        _lastPurchaseError = code;
        return code;
      case Unreachable():
        return null; // receipt stays held; nothing unlocks until the server says yes
    }
  }

  Future<void> _verifyHeldReceipts() async {
    for (final r in store.heldReceipts()) {
      await _verify(r);
    }
  }

  // ----------------------------------------------------------------- reading

  List<String> activeEntitlements() {
    final now = parseIso(clock.now());
    return [
      for (final e in store.entitlements())
        if (parseIso(e.expiresAt).isAfter(now)) e.name
    ]..sort();
  }

  String get purchaseState =>
      store.heldReceipts().isNotEmpty ? 'verifying' : (_purchasePending ? 'pending' : 'idle');

  String? get lastPurchaseError => _lastPurchaseError;

  /// How one observation is shown. Strip results get a level from the pack; the number is
  /// shown only if the pack allows it and any entitlement it names is active.
  Map<String, Object?> display(Obs o, {List<String>? entitlements}) {
    final entry = pack.entry(o.type);
    if (entry == null || entry.kind != 'strip') return o.value;
    final ratio = o.value[entry.field] as num;
    final level = entry.levelFor(ratio);
    if (!entry.hasNumeric) return {'level': level, 'ratio': null, 'locked': false};
    final needs = entry.numericEntitlement;
    final unlocked = needs == null || (entitlements ?? activeEntitlements()).contains(needs);
    return {'level': level, 'ratio': unlocked ? ratio : null, 'locked': !unlocked};
  }

  /// Everything the Today screen shows. [storeFinished] is supplied by whoever owns the store.
  Snapshot snapshot({List<String> storeFinished = const []}) {
    final active = activeEntitlements();
    return Snapshot(
      pack: pack.packId,
      observations: [
        for (final o in store.all())
          if (pack.has(o.type) && !o.locallyDeleted)
            ObservationView(obs: o, synced: o.pending == null, display: display(o, entitlements: active))
      ],
      pendingMutations: store.pendingCount(),
      conflicts: store.conflicts(),
      entitlements: active,
      purchaseState: purchaseState,
      lastPurchaseError: _lastPurchaseError,
      storeFinished: [...storeFinished]..sort(),
    );
  }
}
