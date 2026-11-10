// Scenario runner (SPEC section 8):
//   dart run bin/run_scenario.dart <scenario.json> <serverUrl> <out.json> <workDir>
// Drives the same AppCore the screens use. Reads the scenario's pack and steps; never `expect`.
import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:slice_app/core/pack.dart';
import 'package:slice_app/core/scenario.dart';

Future<void> main(List<String> args) async {
  if (args.length != 4) {
    stderr.writeln('usage: run_scenario <scenario.json> <serverUrl> <out.json> <workDir>');
    exit(2);
  }
  final scenarioFile = File(args[0]).absolute;
  final scenario = jsonDecode(scenarioFile.readAsStringSync()) as Map<String, dynamic>;
  final packId = scenario['pack'] as String;
  final steps = scenario['steps'] as List; // `expect` is deliberately never touched

  // Packs: the kit is the source of truth; the bundled copy (kept identical by check.sh) is the fallback.
  final root = Platform.environment['SLICE_APP_ROOT'] ?? Directory.current.path;
  final candidates = [
    if (Platform.environment['BAKEOFF_KIT_DIR'] != null) p.join(Platform.environment['BAKEOFF_KIT_DIR']!, 'packs', '$packId.json'),
    p.join(root, '..', 'kit', 'packs', '$packId.json'),
    p.join(root, 'assets', 'packs', '$packId.json'),
  ];
  final packFile = candidates.map(File.new).firstWhere((f) => f.existsSync(),
      orElse: () => throw StateError('pack "$packId" not found in ${candidates.join(', ')}'));
  final pack = StagePack.parse(packFile.readAsStringSync());

  Directory(args[3]).createSync(recursive: true);
  final runner = ScenarioRunner(
    pack: pack,
    serverUrl: Uri.parse(args[1]),
    workDir: args[3],
    fixtureRoot: scenarioFile.parent.path,
  );
  final out = await runner.run(steps);
  runner.close();
  File(args[2]).writeAsStringSync(jsonEncode(out));
  exit(0);
}
