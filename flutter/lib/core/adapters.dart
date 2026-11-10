/// The device seams. Core logic only ever sees these interfaces; lib/adapters/real has the
/// plugin-backed implementations a phone uses and lib/adapters/fake the scripted ones that
/// tests and the scenario runner use.
library;

import 'strip.dart';
import 'thermometer.dart';

/// Camera / gallery: yields a cropped grayscale strip image, or null if the user backed out.
abstract class StripImageSource {
  Future<GrayImage?> capture();
}

/// Bluetooth: connects to a Health Thermometer and reports what it says until it disconnects.
abstract class ThermometerTransport {
  Stream<BleEvent> session();
}

sealed class StoreEvent {
  const StoreEvent();
}

class StorePending extends StoreEvent {
  const StorePending();
}

class StoreCancelled extends StoreEvent {
  const StoreCancelled();
}

class StoreFailed extends StoreEvent {
  const StoreFailed(this.code);
  final String? code;
}

class StorePurchased extends StoreEvent {
  const StorePurchased(this.txId, this.receipt);
  final String txId;
  final String receipt;
}

/// App store billing.
abstract class StoreAdapter {
  /// Starts a purchase and reports what the store says about it. The stream closes when the
  /// store has nothing more to say for now (a lone [StorePending] is a legitimate end).
  Stream<StoreEvent> purchase(String productId);

  /// Asks the store for past purchases.
  Future<List<StorePurchased>> restore();

  /// Tells the store the transaction has been dealt with.
  Future<void> finish(String txId);
}

/// "Now" is injected so behaviour never depends on the wall clock.
abstract class Clock {
  /// Current time as a canonical UTC string (second precision).
  String now();
}
