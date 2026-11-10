// Widget tests: the real screens on the real core (SQLite + C++ engine over FFI), with
// the fake device adapters and the in-process fake server.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:slice_app/adapters/fake/fakes.dart';
import 'package:slice_app/core/strip.dart';
import 'package:slice_app/ui/app.dart';
import 'package:slice_app/ui/app_controller.dart';

import '../support/harness.dart';

class Ui {
  Ui(String packId) : h = Harness(packId) {
    controller = AppController(
      core: h.core,
      stripSource: camera,
      thermometer: () => ScriptedThermometer({'device': {'name': 'EasyHome-EBT-100'}, 'events': thermoEvents}),
      storeFinished: () => h.billing.finished,
    );
  }
  final Harness h;
  final FakeStripSource camera = FakeStripSource();
  List<Map<String, Object?>> thermoEvents = [connect(), notify('2A1E', '00130e00fe'), notify('2A1C', '00540e00fe'), disconnect()];
  late final AppController controller;

  Future<void> pump(WidgetTester tester) async {
    addTearDown(h.dispose);
    await tester.pumpWidget(SliceApp(controller: controller));
  }
}

Future<void> tapKey(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

String textOf(WidgetTester tester, String key) => tester.widget<Text>(find.byKey(Key(key))).data!;

void main() {
  group('Today', () {
    testWidgets('title comes from the pack; empty state', (tester) async {
      await Ui('premom').pump(tester);
      expect(find.widgetWithText(AppBar, 'Premom'), findsOneWidget);
      expect(find.text('Nothing logged yet'), findsOneWidget);
      expect(find.text('Everything is synced'), findsOneWidget);
      expect(find.byKey(const Key('conflict-notice')), findsNothing);
    });

    testWidgets('Polly gets its own title from the same code', (tester) async {
      await Ui('polly').pump(tester);
      expect(find.widgetWithText(AppBar, 'Polly'), findsOneWidget);
      expect(find.widgetWithText(AppBar, 'Premom'), findsNothing);
    });

    testWidgets('lists observations with sync state and pending count; Sync clears them', (tester) async {
      final ui = Ui('premom');
      await ui.h.logAt('2026-11-03T06:40:00Z', 'bbt', {'celsius': 36.1});
      await ui.h.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'medium'});
      ui.controller.refresh();
      await ui.pump(tester);
      expect(find.text('BBT: 36.1'), findsOneWidget);
      expect(find.text('FLOW: medium'), findsOneWidget);
      expect(find.text('2 waiting to sync'), findsOneWidget);
      expect(find.textContaining('· pending'), findsNWidgets(2));

      await tapKey(tester, 'sync-button');
      expect(find.text('Everything is synced'), findsOneWidget);
      expect(find.textContaining('· synced'), findsNWidgets(2));
      expect(find.textContaining('· pending'), findsNothing);
      expect(ui.h.server.live.length, 2);
    });

    testWidgets('a failed sync says so and keeps the pending count', (tester) async {
      final ui = Ui('premom');
      await ui.h.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'medium'});
      ui.controller.refresh();
      ui.h.server.mode = 'down';
      await ui.pump(tester);
      await tapKey(tester, 'sync-button');
      expect(find.textContaining('[network]'), findsOneWidget);
      expect(find.text('1 waiting to sync'), findsOneWidget);
    });

    testWidgets('shows a conflict notice when the server copy replaced a local change', (tester) async {
      final ui = Ui('premom');
      await ui.h.logAt('2026-11-03T08:00:00Z', 'flow', {'code': 'light'});
      await ui.h.core.sync();
      ui.h.server.remoteUpsert('flow', '2026-11-03T08:00:00Z', {'code': 'spotting'});
      ui.controller.refresh();
      await ui.pump(tester);

      // edit through the UI, then sync
      await tapKey(tester, 'obs-menu-0');
      await tester.tap(find.text('Edit'));
      await tester.pumpAndSettle();
      await tapKey(tester, 'value-heavy');
      await tapKey(tester, 'save-button');
      expect(find.text('FLOW: heavy'), findsOneWidget);
      expect(find.text('1 waiting to sync'), findsOneWidget);

      await tapKey(tester, 'sync-button');
      expect(find.byKey(const Key('conflict-notice')), findsOneWidget);
      expect(find.textContaining('FLOW 2026-11-03T08:00:00Z'), findsOneWidget);
      expect(find.text('FLOW: spotting'), findsOneWidget);
      expect(find.text('FLOW: heavy'), findsNothing);
    });

    testWidgets('reader results offer Delete but not Edit; delete removes the row', (tester) async {
      final ui = Ui('premom');
      await ui.h.scanAt('2026-11-03T14:00:00Z', 1);
      await ui.h.logAt('2026-11-03T15:00:00Z', 'flow', {'code': 'light'});
      ui.controller.refresh();
      await ui.pump(tester);

      await tapKey(tester, 'obs-menu-1'); // manual flow
      expect(find.text('Edit'), findsOneWidget);
      await tester.tapAt(const Offset(5, 5));
      await tester.pumpAndSettle();

      await tapKey(tester, 'obs-menu-0'); // strip result
      expect(find.text('Edit'), findsNothing);
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      expect(find.textContaining('LH:'), findsNothing);
      expect(find.text('FLOW: light'), findsOneWidget);
      expect(ui.h.snap.observations.map((o) => o.obs.type), ['flow']);
    });

    testWidgets('scan and thermometer buttons appear only if the pack has such an entry', (tester) async {
      await Ui('polly').pump(tester);
      expect(find.byKey(const Key('scan-strip-button')), findsOneWidget);
      expect(find.byKey(const Key('thermometer-button')), findsOneWidget);
      expect(find.byKey(const Key('add-log-button')), findsOneWidget);
    });
  });

  group('Add log', () {
    testWidgets('the form offers exactly the pack entries that allow manual logging', (tester) async {
      await Ui('polly').pump(tester);
      await tapKey(tester, 'add-log-button');
      expect(find.byKey(const Key('type-bbt')), findsOneWidget);
      expect(find.byKey(const Key('type-flow')), findsOneWidget);
      expect(find.byKey(const Key('type-mucus')), findsNothing); // not in Polly
      expect(find.byKey(const Key('type-lh')), findsNothing); // strip only
    });

    testWidgets('Premom also offers mucus, with the values from the pack', (tester) async {
      final ui = Ui('premom');
      ui.h.clock.time = '2026-11-03T20:10:00Z';
      await ui.pump(tester);
      await tapKey(tester, 'add-log-button');
      await tapKey(tester, 'type-mucus');
      for (final v in ['dry', 'sticky', 'creamy', 'watery', 'eggwhite']) {
        expect(find.byKey(Key('value-$v')), findsOneWidget);
      }
      expect(find.byKey(const Key('value-heavy')), findsNothing);
      await tapKey(tester, 'value-eggwhite');
      await tapKey(tester, 'save-button');
      expect(find.text('MUCUS: eggwhite'), findsOneWidget);
      expect(find.text('1 waiting to sync'), findsOneWidget);
      final o = ui.h.snap.observations.single.obs;
      expect([o.type, o.value, o.source, o.observedAt], ['mucus', {'code': 'eggwhite'}, 'manual', '2026-11-03T20:10:00Z']);
    });

    testWidgets('a number entry saves a valid temperature', (tester) async {
      final ui = Ui('premom');
      await ui.pump(tester);
      await tapKey(tester, 'add-log-button');
      await tapKey(tester, 'type-bbt');
      await tester.enterText(find.byKey(const Key('number-field')), '36.55');
      await tapKey(tester, 'save-button');
      expect(find.text('BBT: 36.55'), findsOneWidget);
    });

    testWidgets('an out-of-range or empty number shows an error and saves nothing', (tester) async {
      final ui = Ui('premom');
      await ui.pump(tester);
      await tapKey(tester, 'add-log-button');
      await tapKey(tester, 'type-bbt');
      await tester.enterText(find.byKey(const Key('number-field')), '50');
      await tapKey(tester, 'save-button');
      expect(textOf(tester, 'form-error'), contains('[invalid_value]'));
      await tester.enterText(find.byKey(const Key('number-field')), '');
      await tapKey(tester, 'save-button');
      expect(textOf(tester, 'form-error'), contains('[invalid_value]'));
      expect(ui.h.snap.observations, isEmpty);
      expect(ui.h.server.events, isEmpty);
    });

    testWidgets('saving an enum entry with nothing chosen is an error', (tester) async {
      final ui = Ui('premom');
      await ui.pump(tester);
      await tapKey(tester, 'add-log-button');
      await tapKey(tester, 'type-flow');
      await tapKey(tester, 'save-button');
      expect(textOf(tester, 'form-error'), contains('[invalid_value]'));
      expect(ui.h.snap.observations, isEmpty);
    });
  });

  group('Scan strip', () {
    testWidgets('Premom without premium: level shown, number locked', (tester) async {
      final ui = Ui('premom');
      ui.camera.next = synth(control: 100, test: 70);
      await ui.pump(tester);
      await tapKey(tester, 'scan-strip-button');
      await tapKey(tester, 'scan-button');
      expect(textOf(tester, 'scan-level'), 'high');
      expect(find.byKey(const Key('scan-locked')), findsOneWidget);
      expect(find.byKey(const Key('scan-ratio')), findsNothing);
      expect(find.text('0.7'), findsNothing);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('LH: high (number locked)'), findsOneWidget);
    });

    testWidgets('Premom with premium: the number is shown', (tester) async {
      final ui = Ui('premom');
      ui.h.clock.time = '2026-11-03T14:00:00Z';
      await ui.h.buy([purchased('tx-1', ui.h.goodReceipt('r-1'))]);
      ui.camera.next = synth(control: 100, test: 70);
      await ui.pump(tester);
      await tapKey(tester, 'scan-strip-button');
      await tapKey(tester, 'scan-button');
      expect(textOf(tester, 'scan-level'), 'high');
      expect(textOf(tester, 'scan-ratio'), '0.7');
      expect(find.byKey(const Key('scan-locked')), findsNothing);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('LH: high (0.7)'), findsOneWidget);
    });

    testWidgets('Polly: positive or negative, never a number, never an upsell', (tester) async {
      final ui = Ui('polly');
      ui.camera.next = synth(control: 100, test: 90);
      await ui.pump(tester);
      await tapKey(tester, 'scan-strip-button');
      await tapKey(tester, 'scan-button');
      expect(textOf(tester, 'scan-level'), 'positive');
      expect(find.byKey(const Key('scan-ratio')), findsNothing);
      expect(find.byKey(const Key('scan-locked')), findsNothing);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('LH: positive'), findsOneWidget);
    });

    testWidgets('a failed read shows the reason and logs nothing', (tester) async {
      final ui = Ui('premom');
      ui.camera.next = synth(control: 0);
      await ui.pump(tester);
      await tapKey(tester, 'scan-strip-button');
      await tapKey(tester, 'scan-button');
      expect(textOf(tester, 'scan-error'), contains('[strip_no_control_line]'));
      expect(find.byKey(const Key('scan-result')), findsNothing);
      ui.camera.next = synth(background: 30, control: 10, test: 10);
      await tapKey(tester, 'scan-button');
      expect(textOf(tester, 'scan-error'), contains('[strip_too_dark]'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Nothing logged yet'), findsOneWidget);
    });

    testWidgets('a kit fixture photo goes through the fake camera and the engine', (tester) async {
      final ui = Ui('premom');
      ui.camera.next = decodePgm(File(strip(1)).readAsBytesSync());
      await ui.pump(tester);
      await tapKey(tester, 'scan-strip-button');
      await tapKey(tester, 'scan-button');
      expect(find.byKey(const Key('scan-result')), findsOneWidget);
      expect(ui.h.snap.observations.single.obs.reader, {'engineVersion': 'bakeoff-1.0.0'});
    });
  });

  group('Thermometer', () {
    testWidgets('a session ends with the final reading on screen and in the list', (tester) async {
      final ui = Ui('premom');
      ui.h.clock.time = '2026-11-03T06:30:00Z';
      await ui.pump(tester);
      await tapKey(tester, 'thermometer-button');
      await tapKey(tester, 'connect-button');
      expect(textOf(tester, 'thermo-result'), contains('36.68'));
      expect(textOf(tester, 'thermo-result'), contains('EasyHome-EBT-100'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('BBT: 36.68'), findsOneWidget);
      expect(find.textContaining('thermometer · pending'), findsOneWidget);
    });

    testWidgets('no final reading: error shown, nothing logged', (tester) async {
      final ui = Ui('premom');
      ui.thermoEvents = [connect(), notify('2A1E', '00130e00fe'), disconnect()];
      await ui.pump(tester);
      await tapKey(tester, 'thermometer-button');
      await tapKey(tester, 'connect-button');
      expect(textOf(tester, 'thermo-error'), contains('[thermo_no_final_reading]'));
      expect(ui.h.snap.observations, isEmpty);
    });
  });

  group('Upgrade', () {
    testWidgets('Polly has nothing to buy', (tester) async {
      await Ui('polly').pump(tester);
      await tapKey(tester, 'upgrade-button');
      expect(find.byKey(const Key('no-products')), findsOneWidget);
      expect(find.byKey(const Key('restore-button')), findsNothing);
    });

    testWidgets('buying the pack product unlocks the number on Today', (tester) async {
      final ui = Ui('premom');
      await ui.h.scanAt('2026-11-03T14:00:00Z', 1);
      final ratio = ui.h.snap.observations.single.obs.value['ratio'];
      ui.controller.refresh();
      await ui.pump(tester);
      expect(find.textContaining('(number locked)'), findsOneWidget);

      await tapKey(tester, 'upgrade-button');
      expect(textOf(tester, 'entitlements'), 'No active entitlements');
      ui.h.billing.purchaseScript = [purchased('tx-1', ui.h.goodReceipt('r-1'))];
      await tapKey(tester, 'buy-premium_monthly');
      expect(textOf(tester, 'entitlements'), 'Active: premium');
      expect(textOf(tester, 'purchase-state'), 'Purchase state: idle');
      expect(find.byKey(const Key('purchase-error')), findsNothing);
      expect(ui.h.billing.finished, ['tx-1']);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.textContaining('($ratio)'), findsOneWidget);
      expect(find.textContaining('(number locked)'), findsNothing);
    });

    testWidgets('offline purchase: verifying note, nothing unlocked', (tester) async {
      final ui = Ui('premom');
      ui.h.server.mode = 'down';
      await ui.pump(tester);
      await tapKey(tester, 'upgrade-button');
      ui.h.billing.purchaseScript = [purchased('tx-1', ui.h.goodReceipt('r-1'))];
      await tapKey(tester, 'buy-premium_monthly');
      expect(textOf(tester, 'purchase-state'), 'Purchase state: verifying');
      expect(find.byKey(const Key('verifying-note')), findsOneWidget);
      expect(textOf(tester, 'entitlements'), 'No active entitlements');
    });

    testWidgets('a refused receipt shows the error and grants nothing', (tester) async {
      final ui = Ui('premom');
      await ui.pump(tester);
      await tapKey(tester, 'upgrade-button');
      ui.h.billing.purchaseScript = [purchased('tx-1', 'r-tampered')];
      await tapKey(tester, 'buy-premium_monthly');
      expect(textOf(tester, 'purchase-error'), contains('[invalid_receipt]'));
      expect(textOf(tester, 'entitlements'), 'No active entitlements');
    });

    testWidgets('a cancelled purchase leaves no error behind', (tester) async {
      final ui = Ui('premom');
      await ui.pump(tester);
      await tapKey(tester, 'upgrade-button');
      ui.h.billing.purchaseScript = [
        {'event': 'cancelled'}
      ];
      await tapKey(tester, 'buy-premium_monthly');
      expect(find.byKey(const Key('purchase-error')), findsNothing);
      expect(textOf(tester, 'purchase-state'), 'Purchase state: idle');
    });

    testWidgets('restore brings an entitlement back', (tester) async {
      final ui = Ui('premom');
      await ui.pump(tester);
      await tapKey(tester, 'upgrade-button');
      ui.h.billing.restoreScript = [
        {'txId': 'tx-9', 'receipt': ui.h.goodReceipt('r-9')}
      ];
      await tapKey(tester, 'restore-button');
      expect(textOf(tester, 'entitlements'), 'Active: premium');
      expect(ui.h.billing.restoreCalls, 1);
    });
  });
}
