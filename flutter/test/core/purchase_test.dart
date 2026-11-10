import 'package:flutter_test/flutter_test.dart';
import 'package:slice_app/core/model.dart';

import '../support/harness.dart';

void main() {
  late Harness h;
  setUp(() {
    h = Harness('premom');
    h.clock.time = '2026-11-03T14:00:00Z';
  });
  tearDown(() => h.dispose());

  Map<String, Object?> lhDisplay() => h.snap.observations.firstWhere((o) => o.obs.type == 'lh').display;

  test('verified purchase: entitlement saved, transaction finished, number unlocks', () async {
    await h.scanAt('2026-11-03T14:00:00Z', 1);
    final ratio = h.snap.observations.single.obs.value['ratio'];
    expect(lhDisplay()['locked'], isTrue);
    expect(lhDisplay()['ratio'], isNull);
    final r = await h.buy([
      {'event': 'pending'},
      purchased('tx-1', h.goodReceipt('r-1')),
    ]);
    expect(r.ok, isTrue);
    expect(h.server.verified, ['r-1']);
    final s = h.snap;
    expect(s.entitlements, ['premium']);
    expect(s.purchaseState, 'idle');
    expect(s.lastPurchaseError, isNull);
    expect(s.storeFinished, ['tx-1']);
    expect(lhDisplay(), {'level': isNotNull, 'ratio': ratio, 'locked': false});
    expect(h.core.store.heldReceipts(), isEmpty);
  });

  test('the entitlement survives a restart and works offline', () async {
    await h.scanAt('2026-11-03T14:00:00Z', 1);
    await h.buy([purchased('tx-1', h.goodReceipt('r-1'))]);
    h.server.mode = 'down';
    h.restart();
    expect(h.snap.entitlements, ['premium']);
    expect(lhDisplay()['locked'], isFalse);
  });

  test('cancelled is a step failure but not an error', () async {
    final r = await h.buy([
      {'event': 'cancelled'}
    ]);
    expect(r.error, Err.cancelled);
    expect(h.snap.lastPurchaseError, isNull);
    expect(h.snap.purchaseState, 'idle');
    expect(h.snap.entitlements, isEmpty);
    expect(h.server.verified, isEmpty);
  });

  test('store error: step result and lastPurchaseError are store_error, whatever code the store gave', () async {
    final r = await h.buy([
      {'event': 'error', 'code': 'billing_unavailable'}
    ]);
    expect(r.error, Err.storeError);
    expect(h.snap.lastPurchaseError, Err.storeError);
    expect(h.snap.purchaseState, 'idle');
    expect(h.snap.storeFinished, isEmpty);
  });

  test('pending with nothing following: state pending, step ok; a restart makes it idle', () async {
    final r = await h.buy([
      {'event': 'pending'}
    ]);
    expect(r.ok, isTrue);
    expect(h.snap.purchaseState, 'pending');
    expect(h.snap.entitlements, isEmpty);
    h.restart();
    expect(h.snap.purchaseState, 'idle');
  });

  test('pending followed by cancel or error is no longer pending', () async {
    await h.buy([
      {'event': 'pending'},
      {'event': 'cancelled'}
    ]);
    expect(h.snap.purchaseState, 'idle');
    await h.buy([
      {'event': 'pending'},
      {'event': 'error'}
    ]);
    expect(h.snap.purchaseState, 'idle');
  });

  test('a new purchase or restore clears the previous error and pending state', () async {
    await h.buy([
      {'event': 'error'}
    ]);
    expect(h.snap.lastPurchaseError, Err.storeError);
    await h.buy([
      {'event': 'cancelled'}
    ]);
    expect(h.snap.lastPurchaseError, isNull);
    await h.buy([
      {'event': 'error'}
    ]);
    await h.core.restore();
    expect(h.snap.lastPurchaseError, isNull);
    await h.buy([
      {'event': 'pending'}
    ]);
    await h.core.restore();
    expect(h.snap.purchaseState, 'idle');
  });

  test('refused receipt: discarded, finished, nothing granted, error is the server code', () async {
    h.server.receipts['r-other'] = 'receipt_user_mismatch';
    expect((await h.buy([purchased('tx-1', 'r-tampered')])).error, 'invalid_receipt');
    expect(h.snap.lastPurchaseError, 'invalid_receipt');
    expect((await h.buy([purchased('tx-2', 'r-other')])).error, 'receipt_user_mismatch');
    final s = h.snap;
    expect(s.lastPurchaseError, 'receipt_user_mismatch');
    expect(s.entitlements, isEmpty);
    expect(s.purchaseState, 'idle');
    expect(s.storeFinished, ['tx-1', 'tx-2']);
    expect(h.core.store.heldReceipts(), isEmpty);
    // not retried later
    await h.core.sync();
    expect(h.server.verified.length, 2);
  });

  test('server unreachable: receipt is held, state verifying, nothing unlocks, not finished', () async {
    await h.scanAt('2026-11-03T14:00:00Z', 1);
    for (final mode in ['down', 'http503']) {
      h.server.mode = mode;
      final r = await h.buy([purchased('tx-$mode', h.goodReceipt('r-$mode'))]);
      expect(r.ok, isTrue, reason: mode);
    }
    var s = h.snap;
    expect(s.purchaseState, 'verifying');
    expect(s.entitlements, isEmpty);
    expect(s.lastPurchaseError, isNull);
    expect(s.storeFinished, isEmpty);
    expect(lhDisplay()['locked'], isTrue);

    // verifying survives a restart, and the receipts are verified at the start of the next sync
    h.restart();
    expect(h.snap.purchaseState, 'verifying');
    h.server.mode = 'ok';
    h.server.requests.clear();
    expect((await h.core.sync()).ok, isTrue);
    expect(h.server.requests, [
      'POST /v1/entitlements/verify',
      'POST /v1/entitlements/verify',
      'POST /v1/sync/push',
      'GET /v1/sync/pull',
    ]);
    s = h.snap;
    expect(s.purchaseState, 'idle');
    expect(s.entitlements, ['premium']);
    expect(s.storeFinished, ['tx-down', 'tx-http503']);
    expect(lhDisplay()['locked'], isFalse);
  });

  test('a sync that still cannot reach the server keeps the receipt', () async {
    h.server.mode = 'down';
    await h.buy([purchased('tx-1', h.goodReceipt('r-1'))]);
    expect((await h.core.sync()).error, Err.network);
    expect(h.snap.purchaseState, 'verifying');
    expect(h.snap.storeFinished, isEmpty);
  });

  test('a held receipt refused during sync sets lastPurchaseError but the sync is ok', () async {
    h.server.mode = 'down';
    await h.buy([purchased('tx-1', 'r-bad')]);
    h.server.mode = 'ok';
    expect((await h.core.sync()).ok, isTrue);
    final s = h.snap;
    expect(s.lastPurchaseError, 'invalid_receipt');
    expect(s.purchaseState, 'idle');
    expect(s.entitlements, isEmpty);
    expect(s.storeFinished, ['tx-1']);
  });

  test('entitlement is active strictly before expiresAt, by the injected clock', () async {
    await h.scanAt('2026-11-03T14:00:00Z', 1);
    await h.buy([purchased('tx-1', h.goodReceipt('r-1', expiresAt: '2026-11-27T14:01:00Z'))]);
    h.clock.time = '2026-11-27T14:00:59Z';
    expect(h.snap.entitlements, ['premium']);
    expect(lhDisplay()['locked'], isFalse);
    h.clock.time = '2026-11-27T14:01:00Z';
    expect(h.snap.entitlements, isEmpty);
    expect(lhDisplay(), {'level': isNotNull, 'ratio': null, 'locked': true});
    // renewing unlocks again
    await h.buy([purchased('tx-2', h.goodReceipt('r-2', expiresAt: '2026-12-27T14:01:00Z'))]);
    expect(h.snap.entitlements, ['premium']);
    expect(h.snap.storeFinished, ['tx-1', 'tx-2']);
  });

  test('an entitlement the numeric rule does not name leaves the number locked', () async {
    await h.scanAt('2026-11-03T14:00:00Z', 1);
    await h.buy([purchased('tx-1', h.goodReceipt('r-1', entitlement: 'something_else'))]);
    expect(h.snap.entitlements, ['something_else']);
    expect(lhDisplay()['locked'], isTrue);
  });

  test('entitlement names are sorted', () async {
    await h.buy([purchased('tx-1', h.goodReceipt('r-1', entitlement: 'zeta'))]);
    await h.buy([purchased('tx-2', h.goodReceipt('r-2', entitlement: 'alpha'))]);
    expect(h.snap.entitlements, ['alpha', 'zeta']);
  });

  test('unknown product: not_available and the store is never called', () async {
    expect((await h.buy([purchased('tx-1', h.goodReceipt('r-1'))], productId: 'gold_yearly')).error, Err.notAvailable);
    expect(h.billing.purchaseCalls, 0);
    expect(h.snap.entitlements, isEmpty);
    expect(h.server.verified, isEmpty);

    final polly = Harness('polly');
    addTearDown(polly.dispose);
    expect((await polly.buy([purchased('tx-1', 'r')])).error, Err.notAvailable);
    expect(polly.billing.purchaseCalls, 0);
    expect(polly.snap.lastPurchaseError, Err.notAvailable);
    expect(polly.snap.storeFinished, isEmpty);
  });

  test('restore handles each receipt like a purchase; the step is ok even when one is refused', () async {
    h.server.receipts['r-theirs'] = 'receipt_user_mismatch';
    h.billing.restoreScript = [
      {'txId': 'tx-b', 'receipt': h.goodReceipt('r-mine')},
      {'txId': 'tx-a', 'receipt': 'r-theirs'},
    ];
    expect((await h.core.restore()).ok, isTrue);
    final s = h.snap;
    expect(s.entitlements, ['premium']);
    expect(s.lastPurchaseError, 'receipt_user_mismatch');
    expect(s.storeFinished, ['tx-a', 'tx-b']); // sorted
    expect(s.purchaseState, 'idle');
  });

  test('restore while offline holds every receipt until the next sync', () async {
    h.server.mode = 'down';
    h.billing.restoreScript = [
      {'txId': 'tx-1', 'receipt': h.goodReceipt('r-1')},
      {'txId': 'tx-2', 'receipt': h.goodReceipt('r-2')},
    ];
    expect((await h.core.restore()).ok, isTrue);
    expect(h.snap.purchaseState, 'verifying');
    expect(h.core.store.heldReceipts().map((r) => r.txId), ['tx-1', 'tx-2']);
    h.server.mode = 'ok';
    await h.core.sync();
    expect(h.snap.purchaseState, 'idle');
    expect(h.snap.entitlements, ['premium']);
    expect(h.snap.storeFinished, ['tx-1', 'tx-2']);
  });

  test('after a restart lastPurchaseError is cleared', () async {
    await h.buy([purchased('tx-1', 'r-bad')]);
    expect(h.snap.lastPurchaseError, 'invalid_receipt');
    h.restart();
    expect(h.snap.lastPurchaseError, isNull);
  });
}
