/**
 * 地点の画像を作る（ブラウザ専用）。canvas で JPEG に描き直すので、EXIF・位置情報は残らず、元の写真も保存しない。
 * 大きさは必ず上限内に収める（バックアップが 100MB に収まるように）。
 */
import type { PhotoData } from './db';
import { releaseCanvas } from './image-input';
import { FULL_MAX_BYTES, FULL_SIDE, THUMB_MAX_BYTES, THUMB_SIDE } from './photo-limits';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 長辺を side 以下にしたときの寸法（拡大はしない） */
export function fitSize(w: number, h: number, side: number): { width: number; height: number } {
  const k = Math.min(1, side / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

function toJpeg(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality));
}

/**
 * src の rect の範囲を、長辺 side 以下・maxBytes 以下の JPEG にする。
 * 品質 0.7→0.6→0.5→0.4 と下げ、それでも大きければ寸法を 0.8 倍にしてやり直す
 */
async function encodeWithin(src: CanvasImageSource, rect: Rect, side: number, maxBytes: number) {
  let { width, height } = fitSize(rect.w, rect.h, side);
  for (;;) {
    const c = document.createElement('canvas');
    try {
      c.width = width;
      c.height = height;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
      for (const q of [0.7, 0.6, 0.5, 0.4]) {
        const blob = await toJpeg(c, q);
        if (blob.size <= maxBytes) return { blob, width, height };
      }
    } finally {
      releaseCanvas(c);
    }
    if (width <= 16 && height <= 16) throw new Error('cannot fit');
    ({ width, height } = { width: Math.max(1, Math.round(width * 0.8)), height: Math.max(1, Math.round(height * 0.8)) });
  }
}

/** 開いた写真（canvas）の範囲から、地点の画像（full と thumb）を作る */
export async function makePhoto(photo: HTMLCanvasElement, rect?: Rect): Promise<PhotoData> {
  const r = rect ?? { x: 0, y: 0, w: photo.width, h: photo.height };
  const full = await encodeWithin(photo, r, FULL_SIDE, FULL_MAX_BYTES);
  const thumb = await encodeWithin(photo, r, THUMB_SIDE, THUMB_MAX_BYTES);
  return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}

