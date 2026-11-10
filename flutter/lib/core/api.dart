/// HTTP client for the slice server. Request and response bodies are checked against the
/// generated contract schemas, so a drifted shape fails here instead of on the server.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'contracts.dart';
import 'model.dart';

/// Transport failure, non-2xx answer, or an answer that does not match the contract.
class NetworkFailure implements Exception {
  NetworkFailure(this.detail);
  final String detail;
  @override
  String toString() => 'NetworkFailure($detail)';
}

class MutationResult {
  MutationResult(this.mutationId, this.status, this.revision, this.server);
  final String mutationId;

  /// `applied` | `duplicate` | `conflict` | `rejected`.
  final String status;
  final int? revision;

  /// On conflict: the server's copy (`deleted` may be true).
  final Map<String, Object?>? server;
}

class PullResult {
  PullResult(this.changes, this.cursor);
  final List<Map<String, Object?>> changes;
  final int cursor;
}

sealed class VerifyOutcome {}

class Verified extends VerifyOutcome {
  Verified(this.entitlements);
  final List<Entitlement> entitlements;
}

class Refused extends VerifyOutcome {
  Refused(this.code);
  final String code;
}

class Unreachable extends VerifyOutcome {}

class ApiClient {
  ApiClient(this._http, this.baseUrl, {this.token = 'test-token', this.timeout = const Duration(seconds: 15)});
  final http.Client _http;
  final Uri baseUrl;
  final String token;
  final Duration timeout;

  Map<String, String> get _headers => {'authorization': 'Bearer $token', 'content-type': 'application/json'};
  Uri _u(String path, [Map<String, String>? q]) => baseUrl.replace(path: path, queryParameters: q);

  Future<http.Response> _post(String path, Object body) =>
      _http.post(_u(path), headers: _headers, body: jsonEncode(body)).timeout(timeout);

  /// Sends one push request. Throws [NetworkFailure] unless the server answered 2xx with a valid body.
  Future<List<MutationResult>> push(String deviceId, List<Map<String, Object?>> mutations) async {
    final body = {'deviceId': deviceId, 'mutations': mutations};
    final bad = validateAgainst('PushRequest', body);
    if (bad != null) throw StateError('push request violates the contract: $bad');
    final json = await _guard(() => _post('/v1/sync/push', body), 'PushResponse');
    return [
      for (final r in (json['results'] as List).cast<Map>())
        MutationResult(r['mutationId'] as String, r['status'] as String, (r['revision'] as num?)?.toInt(),
            (r['server'] as Map?)?.cast<String, Object?>())
    ];
  }

  Future<PullResult> pull(int since) async {
    final json = await _guard(
        () => _http.get(_u('/v1/sync/pull', {'since': '$since'}), headers: _headers).timeout(timeout), 'PullResponse');
    return PullResult([for (final c in json['changes'] as List) (c as Map).cast<String, Object?>()], (json['cursor'] as num).toInt());
  }

  Future<Map<String, Object?>> _guard(Future<http.Response> Function() send, String schema) async {
    final http.Response res;
    try {
      res = await send();
    } catch (e) {
      throw NetworkFailure('transport: $e');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw NetworkFailure('http ${res.statusCode}');
    final Object? json;
    try {
      json = jsonDecode(res.body);
    } catch (_) {
      throw NetworkFailure('bad json');
    }
    final bad = validateAgainst(schema, json);
    if (bad != null) throw NetworkFailure('response violates $schema: $bad');
    return (json as Map).cast<String, Object?>();
  }

  /// Asks the server whether a store receipt is good. Never throws.
  Future<VerifyOutcome> verify(String receipt) async {
    try {
      final res = await _post('/v1/entitlements/verify', {'receipt': receipt});
      if (res.statusCode == 200) {
        final json = jsonDecode(res.body);
        if (validateAgainst('VerifyResponse', json) != null) return Unreachable();
        return Verified([
          for (final e in (json as Map)['entitlements'] as List) Entitlement(e['name'] as String, e['expiresAt'] as String)
        ]);
      }
      if (res.statusCode == 422) {
        Object? code;
        try {
          code = (jsonDecode(res.body) as Map)['error'];
        } catch (_) {}
        return Refused(code is String ? code : 'invalid_receipt');
      }
      return Unreachable();
    } catch (_) {
      return Unreachable();
    }
  }

  /// The analytics gate: one attempt, awaited, dropped silently on failure. The event is
  /// built here from exactly three non-health fields; nothing else can be passed in.
  Future<void> observationLogged({required String type, required String source, required String pack}) async {
    final event = {
      'name': kAnalyticsEventName,
      'props': {'type': type, 'source': source, 'pack': pack},
    };
    if (validateAgainst('AnalyticsEvent', event) != null) return;
    try {
      await _post('/v1/events', event);
    } catch (_) {}
  }
}
