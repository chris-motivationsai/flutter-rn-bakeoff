/// Plays a scenario's steps through [AppCore] with the fake device adapters. Used by
/// bin/run_scenario.dart. It reads `pack`, `steps` and nothing else: never `expect`.
library;

import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import '../adapters/fake/fakes.dart';
import 'api.dart';
import 'app_core.dart';
import 'engine/native_strip_engine.dart';
import 'model.dart';
import 'pack.dart';
import 'storage.dart';
import 'strip.dart';

class ScenarioRunner {
  ScenarioRunner({
    required this.pack,
    required this.serverUrl,
    required this.workDir,
    required this.fixtureRoot,
    http.Client? httpClient,
    StripEngine? engine,
  })  : _http = httpClient ?? http.Client(),
        _engine = engine ?? const NativeStripEngine();

  final StagePack pack;
  final Uri serverUrl;
  final String workDir;

  /// Folder that fixture paths in steps are relative to (the scenario file's folder).
  final String fixtureRoot;
  final http.Client _http;
  final StripEngine _engine;

  final ManualClock clock = ManualClock();
  final FakeStore fakeStore = FakeStore(); // outlives restarts
  AppCore? _core;

  AppCore get core => _core ??= _open();

  AppCore _open() => AppCore(
        pack: pack,
        store: LocalStore.open(p.join(workDir, 'slice.db')),
        api: ApiClient(_http, serverUrl),
        clock: clock,
        engine: _engine,
        billing: fakeStore,
      );

  /// Runs all steps; returns the `out.json` document.
  Future<Map<String, Object?>> run(List<Object?> steps) async {
    final results = <Map<String, Object?>>[];
    final snapshots = <String, Object?>{};
    for (final raw in steps) {
      final step = (raw as Map).cast<String, Object?>();
      Outcome outcome;
      try {
        outcome = await runStep(step, snapshots);
      } catch (e, st) {
        stderr.writeln('step ${step['do']} at ${step['at']} threw: $e\n$st');
        outcome = const Outcome.fail('internal_error');
      }
      results.add(outcome.toJson());
    }
    return {'steps': results, 'snapshots': snapshots};
  }

  Future<Outcome> runStep(Map<String, Object?> step, Map<String, Object?> snapshots) async {
    clock.time = step['at'] as String;
    switch (step['do']) {
      case 'log_manual':
        return core.logManual(step['type'] as String, step['value']);
      case 'scan_strip':
        final file = File(p.join(fixtureRoot, step['image'] as String));
        final image = file.existsSync() ? decodePgm(file.readAsBytesSync()) : null;
        return core.scanStrip(step['type'] as String, image);
      case 'thermometer_session':
        return core.thermometerSession(
            step['type'] as String, ScriptedThermometer.fromFile(p.join(fixtureRoot, step['script'] as String)));
      case 'edit':
        return core.edit(_target(step['target']), step['value']);
      case 'delete':
        return core.delete(_target(step['target']));
      case 'sync':
        return core.sync();
      case 'restart':
        _core?.dispose();
        _core = _open();
        return const Outcome.ok();
      case 'purchase':
        fakeStore.purchaseScript = [for (final e in step['store'] as List) (e as Map).cast<String, Object?>()];
        return core.purchase(step['productId'] as String);
      case 'restore':
        fakeStore.restoreScript = [for (final e in step['store'] as List) (e as Map).cast<String, Object?>()];
        return core.restore();
      case 'server_control':
        // Forwarded verbatim; never interpreted here.
        try {
          await _http.post(serverUrl.replace(path: '/__control'),
              headers: {'content-type': 'application/json'}, body: jsonEncode(step['body']));
        } catch (e) {
          stderr.writeln('server_control failed: $e');
        }
        return const Outcome.ok();
      case 'snapshot':
        snapshots[step['name'] as String] = core.snapshot(storeFinished: fakeStore.finished).toJson();
        return const Outcome.ok();
      default:
        return const Outcome.fail('unknown_step');
    }
  }

  TargetKey _target(Object? t) => TargetKey((t as Map)['type'] as String, t['observedAt'] as String);

  void close() {
    _core?.dispose();
    _core = null;
    _http.close();
  }
}
