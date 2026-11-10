// Build hook (Dart/Flutter "native assets"): compiles the kit's C++ strip engine,
// unmodified, for whatever target is being built (host for `dart run` / `flutter test`,
// iOS / Android for a device build) and bundles it as a code asset.
// The Dart side binds to it with @Native in lib/core/engine/strip_engine_ffi.dart.
import 'dart:io';

import 'package:code_assets/code_assets.dart';
import 'package:hooks/hooks.dart';
import 'package:native_toolchain_c/native_toolchain_c.dart';

void main(List<String> args) async {
  await build(args, (input, output) async {
    // Engine source is used straight from the kit. BAKEOFF_ENGINE_DIR can point elsewhere
    // (for example a CI checkout); the default is the kit beside this package.
    final override = Platform.environment['BAKEOFF_ENGINE_DIR'];
    final engineDir = override != null
        ? Directory(override).absolute.uri
        : input.packageRoot.resolve('../kit/engine/');
    final dir = Directory.fromUri(engineDir).path;
    final source = '$dir${dir.endsWith('/') ? '' : '/'}strip_engine.cpp';
    if (!File(source).existsSync()) {
      throw StateError('strip engine source not found at $source');
    }
    final builder = CBuilder.library(
      name: 'strip_engine',
      assetName: 'core/engine/strip_engine_ffi.dart',
      sources: [source],
      includes: [dir],
      language: Language.cpp,
      std: 'c++17',
      // Android: the default is libc++_shared.so, which nothing puts in the APK, so the
      // engine fails to load on the device. Link libc++ into the engine instead.
      cppLinkStdLib: input.config.code.targetOS == OS.android ? 'c++_static' : null,
    );
    await builder.run(input: input, output: output);
  });
}
