library;

/// Error codes a step can end with (SPEC sections 3-5).
abstract final class Err {
  static const unknownType = 'unknown_type';
  static const sourceNotAllowed = 'source_not_allowed';
  static const invalidValue = 'invalid_value';
  static const stripNoControlLine = 'strip_no_control_line';
  static const stripTooDark = 'strip_too_dark';
  static const stripTooBright = 'strip_too_bright';
  static const stripBadInput = 'strip_bad_input'; // engine status 4 / unreadable image (not in SPEC)
  static const thermoInvalidReading = 'thermo_invalid_reading';
  static const thermoNoFinalReading = 'thermo_no_final_reading';
  static const notFound = 'not_found';
  static const readOnly = 'read_only';
  static const network = 'network';
  static const notAvailable = 'not_available';
  static const cancelled = 'cancelled';
  static const storeError = 'store_error';
}

abstract final class Src {
  static const manual = 'manual';
  static const stripReader = 'strip_reader';
  static const thermometer = 'thermometer';
}

/// Result of one user action. `error == null` means ok.
class Outcome {
  const Outcome.ok([this.observation]) : error = null;
  const Outcome.fail(String this.error) : observation = null;
  final String? error;

  /// The observation the action created or changed, when there is one.
  final Obs? observation;
  bool get ok => error == null;
  Map<String, Object?> toJson() => ok ? {'ok': true} : {'ok': false, 'error': error};
}

class PendingMutation {
  PendingMutation(this.mutationId, this.op, this.seq);
  final String mutationId;

  /// `upsert` | `delete`.
  final String op;

  /// Order in which observations became pending (push order).
  final int seq;
}

/// An observation as stored on the device.
class Obs {
  Obs({
    required this.id,
    required this.type,
    required this.value,
    required this.observedAt,
    required this.source,
    this.reader,
    this.baseRevision = 0,
    this.pending,
  });
  final String id;
  final String type;
  final Map<String, Object?> value;
  final String observedAt;
  final String source;
  final Map<String, Object?>? reader;

  /// Last revision the server confirmed for this observation; 0 = never confirmed.
  final int baseRevision;
  final PendingMutation? pending;

  bool get locallyDeleted => pending?.op == 'delete';

  /// The body sent to the server (contract `ObservationBody`).
  Map<String, Object?> body() => {
        'type': type,
        'value': value,
        'observedAt': observedAt,
        'source': source,
        if (reader != null && reader!.isNotEmpty) 'reader': reader,
      };
}

class TargetKey {
  const TargetKey(this.type, this.observedAt);
  final String type;
  final String observedAt;
  Map<String, Object?> toJson() => {'type': type, 'observedAt': observedAt};
}

class Entitlement {
  const Entitlement(this.name, this.expiresAt);
  final String name;
  final String expiresAt;
}

class HeldReceipt {
  const HeldReceipt(this.txId, this.receipt);
  final String txId;
  final String receipt;
}

/// One row of the Today screen.
class ObservationView {
  ObservationView({required this.obs, required this.synced, required this.display});
  final Obs obs;
  final bool synced;

  /// For strip entries `{level, ratio, locked}`; for everything else the stored value object.
  final Map<String, Object?> display;
  Map<String, Object?> toJson() => {
        'type': obs.type,
        'observedAt': obs.observedAt,
        'source': obs.source,
        'sync': synced ? 'synced' : 'pending',
        'display': display,
      };
}

/// What the Today screen shows (SPEC section 8).
class Snapshot {
  Snapshot({
    required this.pack,
    required this.observations,
    required this.pendingMutations,
    required this.conflicts,
    required this.entitlements,
    required this.purchaseState,
    required this.lastPurchaseError,
    required this.storeFinished,
  });
  final String pack;
  final List<ObservationView> observations;
  final int pendingMutations;
  final List<TargetKey> conflicts;
  final List<String> entitlements;
  final String purchaseState;
  final String? lastPurchaseError;
  final List<String> storeFinished;
  Map<String, Object?> toJson() => {
        'pack': pack,
        'observations': [for (final o in observations) o.toJson()],
        'pendingMutations': pendingMutations,
        'conflicts': [for (final c in conflicts) c.toJson()],
        'entitlements': entitlements,
        'purchaseState': purchaseState,
        'lastPurchaseError': lastPurchaseError,
        'storeFinished': storeFinished,
      };
}
