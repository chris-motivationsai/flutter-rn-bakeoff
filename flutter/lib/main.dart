// Device entry point. One codebase, two apps: the stage pack is picked at build time, e.g.
//   flutter build ipa --dart-define=PACK=premom --dart-define=API_URL=https://api.example.com
//   flutter build apk --dart-define=PACK=polly  --dart-define=API_URL=https://api.example.com
// Everything below the adapters is the same code the tests and the scenario runner drive.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_blue_plus/flutter_blue_plus.dart' show License;
import 'package:http/http.dart' as http;

import 'adapters/real/ble_thermometer.dart';
import 'adapters/real/device_storage.dart';
import 'adapters/real/store_billing.dart';
import 'adapters/real/strip_camera.dart';
import 'core/api.dart';
import 'core/app_core.dart';
import 'core/engine/native_strip_engine.dart';
import 'core/pack.dart';
import 'ui/app.dart';
import 'ui/app_controller.dart';

const _packId = String.fromEnvironment('PACK', defaultValue: 'premom');
const _apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://127.0.0.1:8787');
const _apiToken = String.fromEnvironment('API_TOKEN', defaultValue: 'test-token');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final pack = StagePack.parse(await rootBundle.loadString('assets/packs/$_packId.json'));

  late final AppController controller;
  final billing = InAppPurchaseStore(onDeferredPurchase: (p) async {
    await controller.core.handleStorePurchase(p);
    controller.refresh();
  });
  final core = AppCore(
    pack: pack,
    store: await openDeviceStore(pack.packId),
    api: ApiClient(http.Client(), Uri.parse(_apiUrl), token: _apiToken),
    clock: const SystemClock(),
    engine: const NativeStripEngine(),
    billing: billing,
  );
  controller = AppController(
    core: core,
    stripSource: ImagePickerStripSource(),
    // flutter_blue_plus is free for non-profit use only; a commercial build needs its paid licence.
    thermometer: () => FlutterBluePlusThermometer(license: License.commercial),
  );
  runApp(SliceApp(controller: controller));
}
