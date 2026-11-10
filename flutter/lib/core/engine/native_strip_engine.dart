import 'dart:ffi';

import 'package:ffi/ffi.dart';

import '../strip.dart';
import 'strip_engine_ffi.dart';

/// The kit's C++ strip engine, called through Dart FFI. The library is compiled from
/// kit/engine/strip_engine.cpp by hook/build.dart for whichever platform is being built,
/// so this class is the code path on a phone as well as in tests and the scenario runner.
class NativeStripEngine implements StripEngine {
  const NativeStripEngine();

  @override
  String get version => stripEngineVersion().toDartString();

  @override
  StripReading read(GrayImage image) {
    final n = image.width * image.height;
    if (n <= 0 || image.pixels.length < n) return StripReading(4, 0);
    return using((arena) {
      final gray = arena<Uint8>(n);
      gray.asTypedList(n).setRange(0, n, image.pixels);
      final out = arena<StripResultC>();
      final status = stripRead(gray, image.width, image.height, out);
      return StripReading(status, out.ref.ratio);
    });
  }
}
