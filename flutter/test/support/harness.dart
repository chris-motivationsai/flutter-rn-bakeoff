// Test support: an in-process stand-in for the slice server (so tests can see exactly what
// the client sent and inject faults), plus a harness that wires AppCore to it with the fake
// device adapters, the real SQLite storage and the real C++ engine over FFI.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:slice_app/adapters/fake/fakes.dart';
import 'package:slice_app/core/api.dart';
import 'package:slice_app/core/app_core.dart';
import 'package:slice_app/core/contracts.dart';
import 'package:slice_app/core/engine/native_strip_engine.dart';
import 'package:slice_app/core/model.dart';
import 'package:slice_app/core/pack.dart';
import 'package:slice_app/core/storage.dart';
import 'package:slice_app/core/strip.dart';

const kitDir = '../kit';
String strip(int n) => '$kitDir/scenarios/fixtures/strips/strip-${n.toString().padLeft(3, '0')}.pgm';

StagePack loadPack(String id) => StagePack.parse(File('assets/packs/$id.json').readAsStringSync());

/// Mirrors kit/server/server.ts closely enough for unit tests, and records every request.
class FakeServer {
  /// ok | down | http503
  String mode = 'ok';
  int applyThenDrop = 0;
  int counter = 0;
  final Map<String, Map<String, Object?>> obs = {};
  final Map<String, Map<String, Object?>> _seen = {};

  /// Mutations of every push request that reached the server, in order.
  final List<List<Map<String, Object?>>> pushes = [];
  final List<String> pushDeviceIds = [];
  final List<int> pullSince = [];
  final List<Object?> events = [];
  final List<String> eventViolations = [];
  final List<String> rejected = [];
  final List<String> verified = [];
  final List<String> requests = [];

  /// Called when a push request arrives, before it is handled (for staging faults mid-sync).
  void Function()? onPush;

  /// Number of upcoming pull requests to answer with 503.
  int failPulls = 0;

  /// receipt -> list of {name, expiresAt} (granted) or an error code string (refused).
  final Map<String, Object> receipts = {};

  http.Client get client => MockClient(_handle);

  List<Map<String, Object?>> get live => obs.values.where((o) => o['deleted'] != true).toList();
  Map<String, Object?>? find(String type, String observedAt) {
    for (final o in obs.values) {
      if (o['type'] == type && o['observedAt'] == observedAt) return o;
    }
    return null;
  }

  void remoteUpsert(String type, String observedAt, Map<String, Object?> value, {String source = 'manual', String? id}) {
    final cur = find(type, observedAt);
    final oid = cur?['id'] as String? ?? id ?? _uuid();
    obs[oid] = {'type': type, 'value': value, 'observedAt': observedAt, 'source': source, 'id': oid, 'revision': ++counter, 'deleted': false};
  }

  void remoteDelete(String type, String observedAt) {
    final cur = find(type, observedAt)!;
    obs[cur['id'] as String] = {...cur, 'revision': ++counter, 'deleted': true};
  }

  int _n = 0;
  String _uuid() => '00000000-0000-4000-8000-${(++_n).toString().padLeft(12, '0')}';

  String? _validateBody(Map<String, Object?> body) {
    final type = body['type'] as String;
    final schema = kValueSchemas[type];
    if (schema == null) return 'unknown_type';
    if (validateSchema(schema, body['value']) != null) return 'bad_value';
    final value = body['value'] as Map;
    for (final e in (kValueDecimals[type] ?? const <String, int>{}).entries) {
      final v = value[e.key] as num;
      if (roundTo(v, e.value) != v) return '${type}_needs_${e.value}_decimals';
    }
    final need = kRequiredReaderField[body['source']];
    if (need != null && (body['reader'] as Map?)?[need] == null) return 'reader_needs_$need';
    return null;
  }

  Map<String, Object?> _pushOne(Map<String, Object?> m) {
    final mid = m['mutationId'] as String;
    if (_seen.containsKey(mid)) {
      final prev = _seen[mid]!;
      return prev['status'] == 'applied' ? {...prev, 'status': 'duplicate'} : prev;
    }
    final id = m['id'] as String;
    final cur = obs[id];
    Map<String, Object?> reject(String reason) {
      rejected.add(reason);
      return {'mutationId': mid, 'status': 'rejected', 'reason': reason};
    }

    Map<String, Object?> res;
    if (m['op'] == 'upsert') {
      final body = (m['observation'] as Map?)?.cast<String, Object?>();
      final err = body == null ? 'missing_observation' : _validateBody(body);
      if (err != null) {
        res = reject(err);
      } else if (cur == null) {
        if (m['baseRevision'] != 0) {
          res = reject('unknown_id');
        } else {
          obs[id] = {...body!, 'id': id, 'revision': ++counter, 'deleted': false};
          res = {'mutationId': mid, 'status': 'applied', 'revision': counter};
        }
      } else if (cur['revision'] != m['baseRevision']) {
        res = {'mutationId': mid, 'status': 'conflict', 'server': cur};
      } else {
        obs[id] = {...body!, 'id': id, 'revision': ++counter, 'deleted': false};
        res = {'mutationId': mid, 'status': 'applied', 'revision': counter};
      }
    } else if (cur == null) {
      res = reject('unknown_id');
    } else if (cur['revision'] != m['baseRevision']) {
      res = {'mutationId': mid, 'status': 'conflict', 'server': cur};
    } else {
      obs[id] = {...cur, 'revision': ++counter, 'deleted': true};
      res = {'mutationId': mid, 'status': 'applied', 'revision': counter};
    }
    _seen[mid] = res;
    return res;
  }

  Future<http.Response> _handle(http.Request req) async {
    http.Response json(int code, Object body) =>
        http.Response(jsonEncode(body), code, headers: {'content-type': 'application/json'});
    requests.add('${req.method} ${req.url.path}');
    if (req.url.path == '/v1/sync/push') onPush?.call();
    if (mode == 'down') throw http.ClientException('connection dropped', req.url);
    if (mode == 'http503') return json(503, {'error': 'unavailable'});
    if (req.headers['authorization'] != 'Bearer test-token') return json(401, {'error': 'unauthorized'});
    final body = req.method == 'POST' ? jsonDecode(req.body) : null;
    switch (req.url.path) {
      case '/v1/sync/push':
        if (validateAgainst('PushRequest', body) != null) return json(400, {'error': 'bad_request'});
        final muts = [for (final m in (body as Map)['mutations'] as List) (m as Map).cast<String, Object?>()];
        pushes.add(muts);
        pushDeviceIds.add(body['deviceId'] as String);
        if (muts.length > kMaxMutationsPerPush) return json(413, {'error': 'too_many_mutations'});
        final results = muts.map(_pushOne).toList();
        if (applyThenDrop > 0) {
          applyThenDrop--;
          throw http.ClientException('dropped after apply', req.url);
        }
        return json(200, {'results': results});
      case '/v1/sync/pull':
        if (failPulls > 0) {
          failPulls--;
          return json(503, {'error': 'unavailable'});
        }
        final since = int.parse(req.url.queryParameters['since'] ?? '0');
        pullSince.add(since);
        final changes = obs.values.where((o) => (o['revision'] as int) > since).toList()
          ..sort((a, b) => (a['revision'] as int).compareTo(b['revision'] as int));
        return json(200, {'changes': changes, 'cursor': counter});
      case '/v1/entitlements/verify':
        final receipt = (body as Map)['receipt'] as String;
        verified.add(receipt);
        final known = receipts[receipt];
        if (known is List) return json(200, {'entitlements': known});
        return json(422, {'error': known ?? 'invalid_receipt'});
      case '/v1/events':
        if (validateAgainst('AnalyticsEvent', body) != null) {
          eventViolations.add(jsonEncode(body));
          return json(422, {'error': 'event_not_allowed'});
        }
        events.add(body);
        return json(202, {'ok': true});
    }
    return json(404, {'error': 'not_found'});
  }
}

class Harness {
  Harness(String packId, {StripEngine? engine})
      : pack = loadPack(packId),
        engine = engine ?? const NativeStripEngine() {
    dir = Directory.systemTemp.createTempSync('slice-test-');
    core = _open();
  }

  final StagePack pack;
  final StripEngine engine;
  final FakeServer server = FakeServer();
  final ManualClock clock = ManualClock('2026-11-03T08:00:00Z');
  final FakeStore billing = FakeStore();
  late final Directory dir;
  late AppCore core;

  AppCore _open() => AppCore(
        pack: pack,
        store: LocalStore.open('${dir.path}/slice.db'),
        api: ApiClient(server.client, Uri.parse('http://server.test')),
        clock: clock,
        engine: engine,
        billing: billing,
      );

  /// Dispose the app and open a new instance on the same storage.
  void restart() {
    core.dispose();
    core = _open();
  }

  void dispose() {
    core.dispose();
    dir.deleteSync(recursive: true);
  }

  Snapshot get snap => core.snapshot(storeFinished: billing.finished);
  Map<String, Object?> get snapJson => snap.toJson();

  Future<Outcome> logAt(String at, String type, Map<String, Object?> value) {
    clock.time = at;
    return core.logManual(type, value);
  }

  Future<Outcome> scanAt(String at, int fixture, {String type = 'lh'}) {
    clock.time = at;
    return core.scanStrip(type, decodePgm(File(strip(fixture)).readAsBytesSync()));
  }

  Future<Outcome> thermoAt(String at, List<Map<String, Object?>> events, {String type = 'bbt', String device = 'Test-Thermo'}) {
    clock.time = at;
    return core.thermometerSession(type, ScriptedThermometer({'device': {'name': device, 'service': '1809'}, 'events': events}));
  }

  Future<Outcome> buy(List<Map<String, Object?>> script, {String productId = 'premium_monthly'}) {
    billing.purchaseScript = script;
    return core.purchase(productId);
  }

  /// Registers a receipt the fake server will accept.
  String goodReceipt(String name, {String entitlement = 'premium', String expiresAt = '2026-12-03T00:00:00Z'}) {
    server.receipts[name] = [
      {'name': entitlement, 'expiresAt': expiresAt}
    ];
    return name;
  }
}

Map<String, Object?> connect() => {'event': 'connect'};
Map<String, Object?> disconnect() => {'event': 'disconnect'};
Map<String, Object?> notify(String char, String hex) => {'event': 'notify', 'char': char, 'hex': hex};
Map<String, Object?> purchased(String txId, String receipt) => {'event': 'purchased', 'txId': txId, 'receipt': receipt};

/// A synthetic strip: light background with dark lines at the test (42%) and control (67%) zones.
GrayImage synth({int background = 200, int control = 60, int test = 60, int w = 200, int h = 40}) {
  final px = Uint8List(w * h)..fillRange(0, w * h, background);
  void line(double at, int depth) {
    for (var x = (w * at).round() - 3; x <= (w * at).round() + 3; x++) {
      for (var y = 0; y < h; y++) {
        px[y * w + x] = background - depth;
      }
    }
  }

  line(0.67, control);
  line(0.42, test);
  return GrayImage(w, h, px);
}

