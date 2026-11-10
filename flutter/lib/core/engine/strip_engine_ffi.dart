import 'dart:ffi';
import 'package:ffi/ffi.dart';

final class StripResultC extends Struct {
  @Int32()
  external int status;
  @Double()
  external double ratio;
  @Double()
  external double controlIntensity;
  @Double()
  external double testIntensity;
}

@Native<Int32 Function(Pointer<Uint8>, Int32, Int32, Pointer<StripResultC>)>(symbol: 'strip_read')
external int stripRead(Pointer<Uint8> gray, int width, int height, Pointer<StripResultC> out);

@Native<Pointer<Utf8> Function()>(symbol: 'strip_engine_version')
external Pointer<Utf8> stripEngineVersion();
