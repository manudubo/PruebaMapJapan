import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

// Detects "this is not a map" raster tiles: provider placeholders such as
// CartoDB's "API KEY REQUIRED" image or OSM's "Access blocked" image. Those
// come back as HTTP 200 + image/png, so status codes alone cannot catch them
// (that is exactly how the Carto regression reached production).
//
// Used by the offline unit test (tests/tile-guard.test.ts, with the real
// placeholder bytes as fixtures) and by the opt-in live check
// (scripts/check-live-tiles.ts). Node-only: uses zlib, never bundled.

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && Buffer.from(bytes.subarray(0, 8)).equals(PNG_SIGNATURE);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Minimal PNG decoder (non-interlaced; palette/grey at 1-8 bits, RGB/RGBA/grey+alpha
 * at 8 bits): enough for map tiles without adding an image dependency.
 */
export function decodePng(input: Uint8Array): DecodedImage {
  const buf = Buffer.from(input);
  if (!isPng(buf)) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = channels[colorType];
  if (!ch || (bitDepth !== 8 && !(colorType === 0 || colorType === 3))) {
    throw new Error(`unsupported PNG format (colour type ${colorType}, depth ${bitDepth})`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = ch * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const lines = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = lines.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const x = src[i]!;
      out[i] =
        filter === 0 ? x
        : filter === 1 ? (x + a) & 0xff
        : filter === 2 ? (x + b) & 0xff
        : filter === 3 ? (x + ((a + b) >> 1)) & 0xff
        : (x + paeth(a, b, c)) & 0xff;
    }
    prev = out;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const line = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bitDepth < 8) {
        const bit = x * bitDepth;
        const v = (line[bit >> 3]! >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
        if (colorType === 3) {
          rgba.set([palette![v * 3]!, palette![v * 3 + 1]!, palette![v * 3 + 2]!, trns && v < trns.length ? trns[v]! : 255], o);
        } else {
          const g = Math.round((v * 255) / ((1 << bitDepth) - 1));
          rgba.set([g, g, g, 255], o);
        }
        continue;
      }
      const p = x * ch;
      if (colorType === 3) {
        const v = line[p]!;
        rgba.set([palette![v * 3]!, palette![v * 3 + 1]!, palette![v * 3 + 2]!, trns && v < trns.length ? trns[v]! : 255], o);
      } else if (colorType === 0) rgba.set([line[p]!, line[p]!, line[p]!, 255], o);
      else if (colorType === 4) rgba.set([line[p]!, line[p]!, line[p]!, line[p + 1]!], o);
      else if (colorType === 2) rgba.set([line[p]!, line[p + 1]!, line[p + 2]!, 255], o);
      else rgba.set([line[p]!, line[p + 1]!, line[p + 2]!, line[p + 3]!], o);
    }
  }
  return { width, height, rgba };
}

/** 16x16 greyscale thumbnail (box filter), values 0-255. */
export function thumbnail(img: DecodedImage, size = 16): number[] {
  const out: number[] = [];
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      let sum = 0;
      let n = 0;
      const x0 = Math.floor((tx * img.width) / size);
      const x1 = Math.floor(((tx + 1) * img.width) / size);
      const y0 = Math.floor((ty * img.height) / size);
      const y1 = Math.floor(((ty + 1) * img.height) / size);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * img.width + x) * 4;
          sum += 0.299 * img.rgba[o]! + 0.587 * img.rgba[o + 1]! + 0.114 * img.rgba[o + 2]!;
          n++;
        }
      }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}

export interface TileStats {
  sha256: string;
  /** Distinct RGB colours. */
  colours: number;
  /** Share of pixels with the single most frequent colour (0-1). */
  dominantShare: number;
}

export function tileStats(bytes: Uint8Array, img: DecodedImage = decodePng(bytes)): TileStats {
  const counts = new Map<number, number>();
  for (let i = 0; i < img.rgba.length; i += 4) {
    const key = (img.rgba[i]! << 16) | (img.rgba[i + 1]! << 8) | img.rgba[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    colours: counts.size,
    dominantShare: max / (img.width * img.height),
  };
}

/** Mean absolute difference between two thumbnails (0 = identical, 255 = opposite). */
export function thumbnailDistance(a: number[], b: number[]): number {
  return a.reduce((acc, v, i) => acc + Math.abs(v - b[i]!), 0) / a.length;
}

/** Below this thumbnail distance a tile counts as a (re-encoded) known placeholder. */
export const PLACEHOLDER_DISTANCE = 6;
/** A real tile of a land area with roads/labels never is (almost) one flat colour. */
export const MAX_DOMINANT_SHARE = 0.9;

export type TileVerdict =
  | { ok: true; stats: TileStats }
  | { ok: false; reason: string; stats?: TileStats };

/**
 * Classify a downloaded tile. `placeholders` are the known bad images (raw bytes);
 * the tile is rejected when it is byte-identical or visually near-identical to one
 * of them, when it is not a PNG, or when it is almost a single flat colour (only
 * meaningful for a tile of a detailed land area, which is what the live check fetches).
 */
export function classifyTile(bytes: Uint8Array, placeholders: Uint8Array[]): TileVerdict {
  if (!isPng(bytes)) return { ok: false, reason: 'response is not a PNG image' };
  let img: DecodedImage;
  try {
    img = decodePng(bytes);
  } catch (err) {
    return { ok: false, reason: `PNG could not be decoded: ${(err as Error).message}` };
  }
  const stats = tileStats(bytes, img);
  const thumb = thumbnail(img);
  for (const [i, p] of placeholders.entries()) {
    const pImg = decodePng(p);
    if (tileStats(p, pImg).sha256 === stats.sha256) {
      return { ok: false, reason: `byte-identical to known placeholder #${i}`, stats };
    }
    const d = thumbnailDistance(thumb, thumbnail(pImg));
    if (d < PLACEHOLDER_DISTANCE) {
      return { ok: false, reason: `looks like known placeholder #${i} (distance ${d.toFixed(1)})`, stats };
    }
  }
  if (stats.dominantShare > MAX_DOMINANT_SHARE) {
    return { ok: false, reason: `tile is ${(stats.dominantShare * 100).toFixed(0)}% one colour (no map detail)`, stats };
  }
  return { ok: true, stats };
}
