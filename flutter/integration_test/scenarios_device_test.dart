// Replays the kit's public scenarios inside the app on a device, then judges them the way
// kit/judge/judge.ts does. Run with:
//   flutter test integration_test/scenarios_device_test.dart -d <device> \
//     --dart-define=PACK=premom \
//     --dart-define=SCENARIO_URL=http://10.0.2.2:<port> --dart-define=API_URL=http://10.0.2.2:<port>
// SCENARIO_URL serves kit/scenarios (S01.json ... and fixtures/); API_URL is the kit test server.
//
// On the device: ScenarioRunner (lib/core/scenario.dart, the class behind run-scenario.sh),
// SQLite files under the app's support directory, package:http over dart:io on Android,
// the C++ engine over FFI. Bluetooth and the store are the runner's own fakes.
// The runner is given only `pack` and `steps`; `expect` is read here, after the run.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:slice_app/core/pack.dart';
import 'package:slice_app/core/scenario.dart';

const _scenarioUrl = String.fromEnvironment('SCENARIO_URL');
const _apiUrl = String.fromEnvironment('API_URL');
const _count = int.fromEnvironment('SCENARIOS', defaultValue: 27);

const _missing = Object();

/// Port of `diff` in kit/judge/judge.ts.
String? diff(Object? exp, Object? act, [String path = '']) {
  String j(Object? v) => identical(v, _missing) ? 'undefined' : jsonEncode(v);
  if (exp is num && act is num) return (exp - act).abs() < 1e-9 ? null : '$path: expected $exp, got $act';
  if (exp is! Map && exp is! List) return exp == act ? null : '$path: expected ${j(exp)}, got ${j(act)}';
  if (act is! Map && act is! List) return '$path: expected ${j(exp)}, got ${j(act)}';
  if (exp is List) {
    if (act is! List) return '$path: expected an array';
    if (exp.length != act.length) return '$path: expected ${exp.length} items, got ${act.length}';
    for (var i = 0; i < exp.length; i++) {
      final d = diff(exp[i], act[i], '$path[$i]');
      if (d != null) return d;
    }
    return null;
  }
  final e = exp as Map;
  if (act is! Map) return '$path: expected an object, got an array';
  for (final k in {...e.keys, ...act.keys}) {
    final d = diff(e.containsKey(k) ? e[k] : _missing, act.containsKey(k) ? act[k] : _missing, '$path.$k');
    if (d != null) return d;
  }
  return null;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final api = Uri.parse(_apiUrl);
  final control = http.Client(); // the judge's own connection, separate from the app's
  late Directory support;
  late Directory fixtureRoot;
  final summary = <String>[];

  Future<Map<String, dynamic>> serverState() async =>
      jsonDecode(await control.read(api.replace(path: '/__control/state'))) as Map<String, dynamic>;
  Future<void> reset(Object? user) => control.post(api.replace(path: '/__control'),
      body: jsonEncode({
        'reset': {'user': user}
      }));

  Future<Map<String, dynamic>> loadScenario(String id) async {
    final sc = jsonDecode(await control.read(Uri.parse('$_scenarioUrl/$id.json'))) as Map<String, dynamic>;
    // Copy the fixtures the steps name onto the device, at the same relative paths.
    for (final step in (sc['steps'] as List).cast<Map>()) {
      for (final key in const ['image', 'script']) {
        final rel = step[key];
        if (rel is! String) continue;
        final f = File(p.join(fixtureRoot.path, rel));
        if (f.existsSync()) continue;
        final res = await control.get(Uri.parse('$_scenarioUrl/$rel'));
        if (res.statusCode != 200) continue; // a fixture that is absent on the host stays absent here
        f.parent.createSync(recursive: true);
        f.writeAsBytesSync(res.bodyBytes);
      }
    }
    return sc;
  }

  Future<StagePack> pack(Object? id) async => StagePack.parse(await rootBundle.loadString('assets/packs/$id.json'));

  Directory freshWork(String name) {
    final d = Directory(p.join(support.path, 'scenarios', name));
    if (d.existsSync()) d.deleteSync(recursive: true);
    d.createSync(recursive: true);
    return d;
  }

  setUpAll(() async {
    support = await getApplicationSupportDirectory();
    fixtureRoot = Directory(p.join(support.path, 'scenario-fixtures'))..createSync(recursive: true);
    // ignore: avoid_print
    print('ODS device os=${Platform.operatingSystemVersion} support=${support.path}');
  });
  tearDownAll(() {
    // ignore: avoid_print
    print('ODS SUMMARY ${summary.where((s) => s.startsWith('PASS')).length}/${summary.length} passed');
    control.close();
  });

  for (var n = 1; n <= _count; n++) {
    final id = 'S${n.toString().padLeft(2, '0')}';
    test(id, () async {
      final sc = await loadScenario(id);
      await reset(sc['user']);
      final work = freshWork(id);
      final runner = ScenarioRunner(
          pack: await pack(sc['pack']), serverUrl: api, workDir: work.path, fixtureRoot: fixtureRoot.path);
      final sw = Stopwatch()..start();
      final out = jsonDecode(jsonEncode(await runner.run(sc['steps'] as List))) as Map<String, dynamic>;
      runner.close();
      final ms = sw.elapsedMilliseconds;
      final dbBytes = File(p.join(work.path, 'slice.db')).existsSync() ? File(p.join(work.path, 'slice.db')).lengthSync() : -1;

      final fails = <String>[];
      var checks = 0;
      void check(String? d) {
        checks++;
        if (d != null) fails.add(d);
      }

      final e = sc['expect'] as Map<String, dynamic>;
      final steps = sc['steps'] as List;
      final outSteps = out['steps'] as List;
      for (var i = 0; i < (e['steps'] as List).length; i++) {
        check(diff(e['steps'][i], i < outSteps.length ? outSteps[i] : _missing, 'step[$i] ${steps[i]['do']}'));
      }
      final outSnaps = out['snapshots'] as Map;
      for (final name in (e['snapshots'] as Map).keys) {
        check(diff(e['snapshots'][name], outSnaps.containsKey(name) ? outSnaps[name] : _missing, 'snapshot.$name'));
      }
      final state = await serverState();
      String key(dynamic o) => '${o['type']}|${o['observedAt']}';
      final all = (state['observations'] as List).cast<Map>();
      final live = [
        for (final o in all.where((o) => o['deleted'] != true))
          {
            'type': o['type'],
            'observedAt': o['observedAt'],
            'value': o['value'],
            'source': o['source'],
            if (o['reader'] is Map && (o['reader'] as Map).isNotEmpty) 'reader': o['reader'],
          }
      ]..sort((a, b) => key(a).compareTo(key(b)));
      final deleted = [
        for (final o in all.where((o) => o['deleted'] == true)) {'type': o['type'], 'observedAt': o['observedAt']}
      ]..sort((a, b) => key(a).compareTo(key(b)));
      check(diff(e['server']['observations'], live, 'server.observations'));
      check(diff(e['server']['deleted'], deleted, 'server.deleted'));
      check(diff(e['server']['events'], state['events'], 'server.analyticsEvents'));
      final violations = state['violations'] as List;
      check(violations.isEmpty ? null : 'analytics gate violated ${violations.length}x, e.g. ${violations.first}');
      check(state['oversize'] == 0 ? null : 'sent ${state['oversize']} push request(s) with more than 20 mutations');
      final rejected = state['rejected'] as List;
      check(rejected.isEmpty ? null : 'server rejected ${rejected.length} mutation(s): ${rejected.toSet().join(', ')}');

      final verdict = fails.isEmpty ? 'PASS' : 'FAIL';
      summary.add('$verdict $id');
      // ignore: avoid_print
      print('ODS $verdict $id pack=${sc['pack']} steps=${steps.length} checks=${checks - fails.length}/$checks '
          'ms=$ms dbBytes=$dbBytes pushRequests=${state['pushRequests']} serverObs=${all.length} events=${state['events']}');
      for (final f in fails.take(8)) {
        final s = f.length > 600 ? '${f.substring(0, 600)}...' : f;
        // ignore: avoid_print
        print('ODS   - $id $s');
      }
      expect(fails, isEmpty);
    }, timeout: const Timeout(Duration(minutes: 5)));
  }

  // Second pass over the scenarios that use applyThenDrop, one step at a time through the same
  // ScenarioRunner.runStep, reading the server's pushRequests counter before and after each sync.
  for (final id in const ['S09', 'S10', 'S24', 'S25', 'S26', 'S27']) {
    test('push count per sync, $id', () async {
      final sc = await loadScenario(id);
      await reset(sc['user']);
      final work = freshWork('$id-probe');
      final runner = ScenarioRunner(
          pack: await pack(sc['pack']), serverUrl: api, workDir: work.path, fixtureRoot: fixtureRoot.path);
      final snapshots = <String, Object?>{};
      final steps = (sc['steps'] as List).cast<Map>();
      var armed = 0; // applyThenDrop value most recently sent
      for (var i = 0; i < steps.length; i++) {
        final step = steps[i].cast<String, Object?>();
        if (step['do'] == 'server_control' && (step['body'] as Map)['applyThenDrop'] is num) {
          armed = ((step['body'] as Map)['applyThenDrop'] as num).toInt();
        }
        if (step['do'] != 'sync') {
          await runner.runStep(step, snapshots);
          continue;
        }
        final pending = runner.core.snapshot().pendingMutations;
        final before = (await serverState())['pushRequests'] as int;
        final outcome = (await runner.runStep(step, snapshots)).toJson();
        final after = (await serverState())['pushRequests'] as int;
        if (outcome['ok'] != true || armed > 0) {
          // ignore: avoid_print
          print('ODS PUSHCOUNT $id step[$i] sync armedDrop=$armed pendingBefore=$pending '
              'result=${jsonEncode(outcome)} pushRequests=${after - before} (counter $before->$after) '
              'pendingAfter=${runner.core.snapshot().pendingMutations}');
          armed = 0;
        }
      }
      runner.close();
    }, timeout: const Timeout(Duration(minutes: 5)));
  }
}
