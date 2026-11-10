import type { GrayImage } from './ports';

/** Parses a binary PGM (P5, maxval 255) into gray bytes. Throws on anything else. */
export function parsePgm(file: Uint8Array): GrayImage {
  let pos = 0;
  const token = (): string => {
    // skip whitespace and # comments
    for (;;) {
      while (pos < file.length && isSpace(file[pos])) pos++;
      if (file[pos] !== 0x23) break;
      while (pos < file.length && file[pos] !== 0x0a) pos++;
    }
    let out = '';
    while (pos < file.length && !isSpace(file[pos])) out += String.fromCharCode(file[pos++]);
    return out;
  };
  if (token() !== 'P5') throw new Error('not a binary PGM (P5) file');
  const width = Number(token());
  const height = Number(token());
  const maxValue = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('bad PGM size');
  if (maxValue !== 255) throw new Error('only 8-bit PGM is supported');
  pos += 1; // exactly one whitespace byte separates the header from the pixels
  const gray = file.subarray(pos, pos + width * height);
  if (gray.length !== width * height) throw new Error('PGM pixel data is truncated');
  return { width, height, gray: new Uint8Array(gray) };
}

const isSpace = (byte: number) => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;

/** Converts interleaved 8-bit pixels (1 = gray, 2 = gray+alpha, 3 = RGB, 4 = RGBA) to gray bytes (BT.601 luma). */
export function toGray(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number): GrayImage {
  if (pixels.length < width * height * channels) throw new Error('pixel data is truncated');
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * channels;
    gray[i] = channels >= 3 ? Math.round(0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) : pixels[p];
  }
  return { width, height, gray };
}
