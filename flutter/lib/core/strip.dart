/// Strip reading: the image type the engine takes, the engine interface, and PGM decoding.
/// The engine itself is the kit's C++ (engine/native_strip_engine.dart binds it over FFI).
library;

import 'dart:typed_data';

/// A pre-cropped 8-bit grayscale strip image, row-major.
class GrayImage {
  GrayImage(this.width, this.height, this.pixels);
  final int width;
  final int height;
  final Uint8List pixels;
}

class StripReading {
  StripReading(this.status, this.ratio);

  /// Engine status code: 0 ok, 1 no control line, 2 too dark, 3 too bright, 4 bad input.
  final int status;
  final double ratio;
}

abstract class StripEngine {
  String get version;
  StripReading read(GrayImage image);
}

/// Decodes a binary PGM (`P5`, maxval 255). Returns null if the bytes are not one.
GrayImage? decodePgm(Uint8List bytes) {
  var i = 0;
  String? token() {
    // skip whitespace and # comments
    while (i < bytes.length) {
      final c = bytes[i];
      if (c == 0x23) {
        while (i < bytes.length && bytes[i] != 0x0A) {
          i++;
        }
      } else if (c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D) {
        i++;
      } else {
        break;
      }
    }
    final start = i;
    while (i < bytes.length && !(bytes[i] == 0x20 || bytes[i] == 0x09 || bytes[i] == 0x0A || bytes[i] == 0x0D)) {
      i++;
    }
    return i == start ? null : String.fromCharCodes(bytes.sublist(start, i));
  }

  if (token() != 'P5') return null;
  final w = int.tryParse(token() ?? '');
  final h = int.tryParse(token() ?? '');
  final maxv = int.tryParse(token() ?? '');
  if (w == null || h == null || maxv != 255 || w <= 0 || h <= 0) return null;
  i++; // the single whitespace byte after maxval
  if (bytes.length - i < w * h) return null;
  return GrayImage(w, h, Uint8List.sublistView(bytes, i, i + w * h));
}
