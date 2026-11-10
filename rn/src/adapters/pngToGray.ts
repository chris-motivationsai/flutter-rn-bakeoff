// PNG file bytes -> gray image. Pure JS (fast-png), so the phone and the tests run the same code.
import { decode } from 'fast-png';
import { toGray } from '../core/image';
import type { GrayImage } from '../core/ports';

export function pngToGray(png: Uint8Array): GrayImage {
  const image = decode(png);
  if (image.depth !== 8) throw new Error('expected an 8-bit PNG');
  return toGray(image.data as Uint8Array, image.width, image.height, image.channels);
}
