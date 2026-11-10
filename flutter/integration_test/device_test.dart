// On-device checks (Android emulator or phone). Run with:
//   flutter test integration_test/device_test.dart -d <device> \
//     --dart-define=PACK=premom --dart-define=FIXTURE_URL=http://10.0.2.2:<port> \
//     --dart-define=API_URL=http://10.0.2.2:<port>
// FIXTURE_URL serves the kit's strip fixtures plus expected.txt, one line per fixture:
// "<file> <status> <ratio>" as printed by the host's kit/engine/build/strip_cli.
// API_URL is the kit test server. Each group is skipped if its URL is not given.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:slice_app/adapters/fake/fakes.dart';
import 'package:slice_app/adapters/real/device_storage.dart';
import 'package:slice_app/core/api.dart';
import 'package:slice_app/core/app_core.dart';
import 'package:slice_app/core/engine/native_strip_engine.dart';
import 'package:slice_app/core/pack.dart';
import 'package:slice_app/core/strip.dart';

const _packId = String.fromEnvironment('PACK', defaultValue: 'premom');
const _fixtureUrl = String.fromEnvironment('FIXTURE_URL');
const _apiUrl = String.fromEnvironment('API_URL');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  test('C++ engine on device matches the host strip_cli on every fixture', () async {
    const engine = NativeStripEngine();
    // ignore: avoid_print
    print('DEVICE abi=${Platform.version.split('"')[1]} os=${Platform.operatingSystemVersion} '
        'engineVersion=${engine.version}');
    final client = http.Client();
    final expected = (await client.read(Uri.parse('$_fixtureUrl/expected.txt'))).trim().split('\n');
    expect(expected, isNotEmpty);
    var compared = 0;
    for (final line in expected) {
      final [name, status, ratio] = line.trim().split(RegExp(r'\s+'));
      final image = decodePgm(await client.readBytes(Uri.parse('$_fixtureUrl/$name')));
      expect(image, isNotNull, reason: name);
      final r = engine.read(image!);
      expect(r.status, int.parse(status), reason: '$name status');
      // strip_cli prints %.17g, which round-trips a double exactly.
      expect(r.ratio, double.parse(ratio), reason: '$name ratio');
      compared++;
    }
    client.close();
    // ignore: avoid_print
    print('ENGINE compared=$compared fixtures, all identical to host');
  }, skip: _fixtureUrl.isEmpty ? 'FIXTURE_URL not set' : false, timeout: const Timeout(Duration(minutes: 5)));

  test('storage survives reopen and sync reaches the kit server', () async {
    final pack = StagePack.parse(await rootBundle.loadString('assets/packs/$_packId.json'));
    final api = Uri.parse(_apiUrl);
    Future<Map<String, dynamic>> serverState() async =>
        jsonDecode(await http.read(api.resolve('/__control/state'))) as Map<String, dynamic>;
    await http.post(api.resolve('/__control'),
        headers: {'content-type': 'application/json'}, body: jsonEncode({'reset': {'user': 'u-device'}}));

    final dir = await getApplicationSupportDirectory();
    final dbFile = File(p.join(dir.path, 'slice-$_packId.db'));
    if (dbFile.existsSync()) dbFile.deleteSync();

    Future<AppCore> open() async => AppCore(
          pack: pack,
          store: await openDeviceStore(pack.packId), // path_provider + sqlite3, as in main.dart
          api: ApiClient(http.Client(), api),
          clock: const SystemClock(),
          engine: const NativeStripEngine(),
          billing: FakeStore(),
        );

    var core = await open();
    expect((await core.logManual('bbt', {'celsius': 36.61})).error, isNull);
    if (_fixtureUrl.isNotEmpty) {
      final image = decodePgm(await http.readBytes(Uri.parse('$_fixtureUrl/strip-001.pgm')));
      expect((await core.scanStrip('lh', image)).error, isNull);
    }
    final logged = core.snapshot().observations.length;
    expect(core.snapshot().pendingMutations, logged);
    final deviceId = core.store.deviceId;
    core.dispose();

    // "Restart": close the database file and open it again.
    expect(dbFile.existsSync(), isTrue);
    core = await open();
    expect(core.store.deviceId, deviceId);
    expect(core.snapshot().observations.length, logged);
    expect(core.snapshot().pendingMutations, logged);

    expect((await core.sync()).error, isNull);
    expect(core.snapshot().pendingMutations, 0);
    var state = await serverState();
    expect((state['observations'] as List).length, logged);
    expect(state['rejected'], isEmpty);

    // A change made elsewhere arrives by pull.
    await http.post(api.resolve('/__control'),
        headers: {'content-type': 'application/json'},
        body: jsonEncode({
          'remote': {'op': 'upsert', 'type': 'flow', 'value': {'code': 'light'}, 'observedAt': '2026-01-02T03:04:05Z'}
        }));
    expect((await core.sync()).error, isNull);
    expect(core.snapshot().observations.length, logged + 1);
    core.dispose();

    // Wipe the device database: a fresh install gets everything back from the server.
    dbFile.deleteSync();
    core = await open();
    expect(core.snapshot().observations, isEmpty);
    expect((await core.sync()).error, isNull);
    expect(core.snapshot().observations.length, logged + 1);
    expect(core.snapshot().pendingMutations, 0);
    core.dispose();
    state = await serverState();
    // ignore: avoid_print
    print('SYNC db=${dbFile.path} serverObservations=${(state['observations'] as List).length} '
        'pushRequests=${state['pushRequests']}');
  }, skip: _apiUrl.isEmpty ? 'API_URL not set' : false);
}
