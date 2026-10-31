/**
 * 画像ファイルの先頭部分から寸法を読む（デコードせずに大きさを確かめるため）。
 * 壊れたデータ・途中で切れたデータは null を返す。
 */

export interface Size {
  width: number;
  height: number;
}

/** JPEG の SOF から寸法を読む。先頭が FF D8 でない・SOF がない・セグメント長が壊れていれば null */
export function jpegSize(b: Uint8Array): Size | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i++; // 詰め物の FF を飛ばす
    if (i >= b.length) return null;
    const marker = b[i++];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // 長さのないマーカー
    if (marker === 0xd9 || marker === 0xda) return null; // SOF より先に画像の終わり・本体が来た
    if (i + 2 > b.length) return null;
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 7) return null;
      const height = (b[i + 3] << 8) | b[i + 4];
      const width = (b[i + 5] << 8) | b[i + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += len;
  }
  return null;
}

/** JPEG として先頭（FF D8 FF）と末尾（FF D9）がそろっているか */
export function isCompleteJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG の IHDR から寸法を読む */
export function pngSize(b: Uint8Array): Size | null {
  if (b.length < 24 || PNG_SIG.some((v, i) => b[i] !== v)) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(...b.slice(12, 16)) !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** JPEG か PNG なら寸法、それ以外（HEIC など）は null */
export function headerSize(b: Uint8Array): Size | null {
  return jpegSize(b) ?? pngSize(b);
}

/** base64 を検証してバイト列にする。不正なら null */
export function decodeBase64(s: string): Uint8Array | null {
  if (typeof s !== 'string' || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodeBase64(b: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < b.length; i += CHUNK) s += String.fromCharCode(...b.subarray(i, i + CHUNK));
  return btoa(s);
}
