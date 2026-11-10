/// Real camera adapter: package:image_picker takes the photo, package:image decodes it.
/// The decoded picture is reduced to the 8-bit grayscale, row-major buffer the C++ engine
/// takes. [encodedImageToGray] is pure Dart and is unit-tested on this machine; the picker
/// call itself needs a device.
///
/// The engine expects a pre-cropped strip. Finding and cropping the strip inside a camera
/// frame is outside this slice: the user frames the strip and the whole photo is passed on.
library;

import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

import '../../core/adapters.dart';
import '../../core/strip.dart';

/// Decodes JPEG/PNG/... bytes to grayscale. Returns null if the bytes are not an image.
GrayImage? encodedImageToGray(Uint8List encoded, {int? maxWidth}) {
  var image = img.decodeImage(encoded);
  if (image == null) return null;
  if (maxWidth != null && image.width > maxWidth) image = img.copyResize(image, width: maxWidth);
  final out = Uint8List(image.width * image.height);
  var i = 0;
  // package:image computes luminance from r, g and b, which is wrong for images that only
  // have a gray channel (g and b read as 0), so those take the gray channel directly.
  final colour = image.numChannels >= 3;
  if (image.format != img.Format.uint8) image = image.convert(format: img.Format.uint8);
  for (final px in image) {
    out[i++] = (colour ? px.luminance : px.r).round().clamp(0, 255);
  }
  return GrayImage(image.width, image.height, out);
}

class ImagePickerStripSource implements StripImageSource {
  ImagePickerStripSource({ImagePicker? picker, this.source = ImageSource.camera}) : _picker = picker ?? ImagePicker();
  final ImagePicker _picker;
  final ImageSource source;

  @override
  Future<GrayImage?> capture() async {
    final file = await _picker.pickImage(source: source, requestFullMetadata: false);
    if (file == null) return null;
    return encodedImageToGray(await file.readAsBytes(), maxWidth: 1200);
  }
}
