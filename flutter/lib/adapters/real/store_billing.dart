/// Real store adapter: package:in_app_purchase (StoreKit on iOS, Play Billing on Android).
/// Maps the plugin's purchase stream onto the core's [StoreEvent]s. What happens to a
/// receipt (hold, verify, finish) is decided in lib/core/app_core.dart, shared with the fake.
///
/// NOT exercised on this machine: needs a store account and a device. Statically checked only.
library;

import 'dart:async';

import 'package:in_app_purchase/in_app_purchase.dart';

import '../../core/adapters.dart';

class InAppPurchaseStore implements StoreAdapter {
  InAppPurchaseStore({InAppPurchase? iap, this.onDeferredPurchase}) : _iap = iap ?? InAppPurchase.instance {
    _sub = _iap.purchaseStream.listen(_onUpdates);
  }

  final InAppPurchase _iap;
  late final StreamSubscription<List<PurchaseDetails>> _sub;

  /// Called for purchases the store reports when no purchase() or restore() is waiting
  /// (for example one approved days later). Wire it to AppCore.handleStorePurchase.
  final Future<void> Function(StorePurchased purchase)? onDeferredPurchase;

  final Map<String, PurchaseDetails> _unfinished = {};
  StreamController<StoreEvent>? _active;
  List<StorePurchased>? _restoring;

  static String _txId(PurchaseDetails d) => d.purchaseID ?? '${d.productID}:${d.transactionDate ?? ''}';

  void _onUpdates(List<PurchaseDetails> updates) {
    for (final d in updates) {
      switch (d.status) {
        case PurchaseStatus.pending:
          _active?.add(const StorePending());
        case PurchaseStatus.canceled:
          _active?.add(const StoreCancelled());
          _endActive();
          if (d.pendingCompletePurchase) unawaited(_iap.completePurchase(d));
        case PurchaseStatus.error:
          _active?.add(StoreFailed(d.error?.code));
          _endActive();
          if (d.pendingCompletePurchase) unawaited(_iap.completePurchase(d));
        case PurchaseStatus.purchased:
        case PurchaseStatus.restored:
          final p = StorePurchased(_txId(d), d.verificationData.serverVerificationData);
          _unfinished[p.txId] = d;
          if (d.status == PurchaseStatus.restored && _restoring != null) {
            _restoring!.add(p);
          } else if (_active != null) {
            _active!.add(p);
            _endActive();
          } else {
            unawaited(onDeferredPurchase?.call(p));
          }
      }
    }
  }

  void _endActive() {
    final a = _active;
    _active = null;
    unawaited(a?.close());
  }

  @override
  Stream<StoreEvent> purchase(String productId) {
    final out = _active = StreamController<StoreEvent>();
    () async {
      try {
        if (!await _iap.isAvailable()) throw StateError('store_unavailable');
        final details = await _iap.queryProductDetails({productId});
        if (details.productDetails.isEmpty) throw StateError('product_not_found');
        final started = await _iap.buyNonConsumable(purchaseParam: PurchaseParam(productDetails: details.productDetails.first));
        if (!started) throw StateError('purchase_not_started');
      } catch (e) {
        if (identical(_active, out)) {
          out.add(StoreFailed('$e'));
          _endActive();
        }
      }
    }();
    // A purchase left pending (awaiting approval) ends the wait; its result arrives later
    // through onDeferredPurchase.
    return out.stream.transform(StreamTransformer.fromHandlers(handleData: (event, sink) {
      sink.add(event);
      if (event is StorePending && identical(_active, out)) _endActive();
    }));
  }

  @override
  Future<List<StorePurchased>> restore() async {
    final found = _restoring = <StorePurchased>[];
    try {
      await _iap.restorePurchases();
      // The plugin reports restored purchases on purchaseStream with no end marker.
      await Future<void>.delayed(const Duration(seconds: 2));
    } finally {
      _restoring = null;
    }
    return found;
  }

  @override
  Future<void> finish(String txId) async {
    final d = _unfinished.remove(txId);
    if (d != null && d.pendingCompletePurchase) await _iap.completePurchase(d);
  }

  Future<void> dispose() => _sub.cancel();
}
