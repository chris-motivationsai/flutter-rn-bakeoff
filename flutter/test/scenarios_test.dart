// Replays the kit's public scenarios through ScenarioRunner (the class behind
// run-scenario.sh) against the kit's real test server, and checks what the judge checks.
// This is the only place `expect` is read: the runner itself never sees it.
// Needs `node` on PATH; skipped (loudly) if the kit or node is missing.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:slice_app/core/scenario.dart';

import 'support/harness.dart';

String? diff(Object? exp, Object? act, [String path = '']) {
  if (exp is num && act is num) return (exp - act).abs() < 1e-9 ? null : '$path: expected $exp, got $act';
  if (exp is Map) {
    if (act is! Map) return '$path: expected a map, got $act';
    for (final k in {...exp.keys, ...act.keys}) {
      final d = diff(exp[k], act[k], '$path.$k');
      if (d != null) return d;
    }
    return null;
  }
  if (exp is List) {
    if (act is! List) return '$path: expected a list, got $act';
    if (exp.length != act.length) return '$path: expected ${exp.length} items, got ${act.length}';
    for (var i = 0; i < exp.length; i++) {
      final d = diff(exp[i], act[i], '$path[$i]');
      if (d != null) return d;
    }
    return null;
  }
  return exp == act ? null : '$path: expected ${jsonEncode(exp)}, got ${jsonEncode(act)}';
}

void main() {
  final scenarioDir = Directory('$kitDir/scenarios');
  final files = scenarioDir.existsSync()
      ? (scenarioDir.listSync().whereType<File>().where((f) => RegExp(r'S\d+\.json$').hasMatch(f.path)).toList()
        ..sort((a, b) => a.path.compareTo(b.path)))
      : <File>[];
  final haveNode = Process.runSync('which', ['node']).exitCode == 0;

  Process? server;
  late Uri url;
  final client = http.Client();

  setUpAll(() async {
    if (!haveNode || files.isEmpty) return;
    server = await Process.start('node', ['$kitDir/server/server.ts']);
    final line = await server!.stdout.transform(utf8.decoder).firstWhere((l) => l.contains('LISTENING'));
    url = Uri.parse('http://127.0.0.1:${RegExp(r'LISTENING (\d+)').firstMatch(line)!.group(1)}');
  });
  tearDownAll(() {
    server?.kill();
    client.close();
  });

  test('public scenarios are present', () {
    expect(haveNode, isTrue, reason: 'node is needed to run the kit server');
    expect(files, isNotEmpty);
  });

  for (final file in files) {
    final sc = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    test('${sc['id']} ${sc['title']}', () async {
      await client.post(url.replace(path: '/__control'), body: jsonEncode({'reset': {'user': sc['user']}}));
      final work = Directory.systemTemp.createTempSync('slice-scn-');
      addTearDown(() => work.deleteSync(recursive: true));
      final runner = ScenarioRunner(
          pack: loadPack(sc['pack'] as String), serverUrl: url, workDir: work.path, fixtureRoot: file.parent.path);
      final out = jsonDecode(jsonEncode(await runner.run(sc['steps'] as List))) as Map<String, dynamic>;
      runner.close();

      final e = sc['expect'] as Map<String, dynamic>;
      final steps = sc['steps'] as List;
      for (var i = 0; i < (e['steps'] as List).length; i++) {
        expect(diff(e['steps'][i], out['steps'][i], 'step[$i] ${steps[i]['do']}'), isNull);
      }
      for (final name in (e['snapshots'] as Map).keys) {
        expect(diff(e['snapshots'][name], out['snapshots'][name], 'snapshot.$name'), isNull);
      }
      final state = jsonDecode((await client.get(url.replace(path: '/__control/state'))).body) as Map<String, dynamic>;
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
      expect(diff(e['server']['observations'], live, 'server.observations'), isNull);
      expect(diff(e['server']['deleted'], deleted, 'server.deleted'), isNull);
      expect(state['events'], e['server']['events'], reason: 'analytics events');
      expect(state['violations'], isEmpty, reason: 'analytics gate');
      expect(state['oversize'], 0, reason: 'oversize pushes');
      expect(state['rejected'], isEmpty, reason: 'rejected mutations');
    });
  }
}
