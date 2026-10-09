import type { Page } from '@playwright/test';

/**
 * Pixel diff of two PNG screenshots taken in the same run, computed in a browser canvas (no extra
 * dependency, no stored baseline: the "baseline" is the demo screenshot of the same run).
 *
 * A pixel counts as different when its colour distance (sum of |dR|+|dG|+|dB|) is above
 * `pixelTolerance`, which absorbs anti-aliasing noise. `ratio` is differing pixels / all pixels of
 * the larger image; a size mismatch counts the non-overlapping area as different.
 * Sizes within `sizeTolerance` px compare the common area. `composite` is one PNG: demo | user | diff (differences in red over a faded demo), for the
 * Playwright report and docs/design/demo-parity/.
 */

export interface PixelDiffResult {
  width: number;
  height: number;
  sizeA: [number, number];
  sizeB: [number, number];
  diffPixels: number;
  total: number;
  ratio: number;
  composite: Buffer;
}

export async function pixelDiff(scratch: Page, a: Buffer, b: Buffer, pixelTolerance = 48, sizeTolerance = 1): Promise<PixelDiffResult> {
  const out = await scratch.evaluate(async ({ a64, b64, tol, sizeTol }) => {
    const load = async (b64png: string): Promise<ImageBitmap> => {
      const bin = atob(b64png);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    };
    const [ia, ib] = await Promise.all([load(a64), load(b64)]);
    // sub-pixel layout can make one image 1px taller: within the tolerance compare the common area
    const near = Math.abs(ia.width - ib.width) <= sizeTol && Math.abs(ia.height - ib.height) <= sizeTol;
    const w = near ? Math.min(ia.width, ib.width) : Math.max(ia.width, ib.width);
    const h = near ? Math.min(ia.height, ib.height) : Math.max(ia.height, ib.height);
    const read = (img: ImageBitmap): Uint8ClampedArray => {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const da = read(ia);
    const db = read(ib);
    const diff = new ImageData(w, h);
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inA = x < ia.width && y < ia.height;
        const inB = x < ib.width && y < ib.height;
        const dist = Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!);
        const differs = inA !== inB || dist > tol;
        if (differs) {
          count++;
          diff.data.set([255, 0, 64, 255], i);
        } else {
          const g = Math.round(0.299 * da[i]! + 0.587 * da[i + 1]! + 0.114 * da[i + 2]!);
          diff.data.set([g, g, g, 60], i);
        }
      }
    }
    const gap = 8;
    const comp = new OffscreenCanvas(w * 3 + gap * 2, h);
    const cx = comp.getContext('2d')!;
    cx.fillStyle = '#888';
    cx.fillRect(0, 0, comp.width, comp.height);
    cx.drawImage(ia, 0, 0);
    cx.drawImage(ib, w + gap, 0);
    const dc = new OffscreenCanvas(w, h);
    dc.getContext('2d')!.putImageData(diff, 0, 0);
    cx.fillStyle = '#fff';
    cx.fillRect((w + gap) * 2, 0, w, h);
    cx.drawImage(dc, (w + gap) * 2, 0);
    const blob = await comp.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { w, h, sa: [ia.width, ia.height], sb: [ib.width, ib.height], count, png: btoa(bin) };
  }, { a64: a.toString('base64'), b64: b.toString('base64'), tol: pixelTolerance, sizeTol: sizeTolerance });

  const total = out.w * out.h;
  return {
    width: out.w,
    height: out.h,
    sizeA: out.sa as [number, number],
    sizeB: out.sb as [number, number],
    diffPixels: out.count,
    total,
    ratio: total === 0 ? 0 : out.count / total,
    composite: Buffer.from(out.png, 'base64'),
  };
}
