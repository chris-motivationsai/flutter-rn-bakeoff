import 'package:flutter/foundation.dart';

import '../core/adapters.dart';
import '../core/app_core.dart';
import '../core/model.dart';
import '../core/pack.dart';

/// Glue between the screens and [AppCore]: runs an action, then republishes the snapshot.
/// It holds no rules of its own.
class AppController extends ChangeNotifier {
  AppController({
    required this.core,
    required this.stripSource,
    required this.thermometer,
    List<String> Function()? storeFinished,
  }) : _storeFinished = storeFinished ?? (() => const []) {
    snapshot = _read();
  }

  final AppCore core;
  final StripImageSource stripSource;

  /// A fresh transport per session.
  final ThermometerTransport Function() thermometer;
  final List<String> Function() _storeFinished;

  late Snapshot snapshot;
  bool busy = false;

  StagePack get pack => core.pack;

  Snapshot _read() => core.snapshot(storeFinished: _storeFinished());

  void refresh() {
    snapshot = _read();
    notifyListeners();
  }

  Future<Outcome> _run(Future<Outcome> Function() action) async {
    busy = true;
    notifyListeners();
    try {
      return await action();
    } finally {
      busy = false;
      refresh();
    }
  }

  Future<Outcome> logManual(String type, Object? value) => _run(() => core.logManual(type, value));
  Future<Outcome> edit(TargetKey target, Object? value) => _run(() => core.edit(target, value));
  Future<Outcome> delete(TargetKey target) => _run(() => core.delete(target));
  Future<Outcome> sync() => _run(core.sync);
  Future<Outcome> purchase(String productId) => _run(() => core.purchase(productId));
  Future<Outcome> restore() => _run(core.restore);
  Future<Outcome> scanStrip(String type) => _run(() async => core.scanStrip(type, await stripSource.capture()));
  Future<Outcome> readThermometer(String type) => _run(() => core.thermometerSession(type, thermometer()));
}

/// Plain-language text for an error code. The code itself is always shown too.
String describeError(String code) => switch (code) {
      Err.unknownType => 'This app does not track that.',
      Err.sourceNotAllowed => 'That cannot be logged this way.',
      Err.invalidValue => 'That value is not valid.',
      Err.stripNoControlLine => 'No control line found. The test did not run properly; use a new strip.',
      Err.stripTooDark => 'The photo is too dark. Try again with more light.',
      Err.stripTooBright => 'The photo is too bright. Try again away from glare.',
      Err.stripBadInput => 'That picture could not be read.',
      Err.thermoInvalidReading => 'The thermometer sent a reading that is not valid.',
      Err.thermoNoFinalReading => 'The thermometer disconnected before a final reading.',
      Err.notFound => 'That entry no longer exists.',
      Err.readOnly => 'Results from a reader cannot be edited.',
      Err.network => 'Could not reach the server. Your changes are saved and will sync later.',
      Err.notAvailable => 'That is not for sale in this app.',
      Err.cancelled => 'Purchase cancelled.',
      Err.storeError => 'The store reported a problem.',
      'invalid_receipt' => 'The purchase could not be verified.',
      'receipt_user_mismatch' => 'That purchase belongs to another account.',
      _ => 'Something went wrong.',
    };
