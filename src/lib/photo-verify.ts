/**
 * 復元する画像を、書き込む前にブラウザで 1 枚ずつ実際にデコードして確かめる（ブラウザ専用）。
 * 寸法はバイト列（SOF）で確かめた値とも照合する。1 枚ずつ処理して、その都度解放する
 */
import type { RestorePhoto } from './backup';

export async function verifyPhotosDecodable(photos: RestorePhoto[], onProgress?: (done: number) => void): Promise<boolean> {
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    for (const [bytes, w, h] of [
      [p.full, p.width, p.height],
      [p.thumb, p.thumbWidth, p.thumbHeight],
    ] as const) {
      let bmp: ImageBitmap | null = null;
      try {
        bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
        if (bmp.width !== w || bmp.height !== h) return false;
      } catch {
        return false;
      } finally {
        bmp?.close();
      }
    }
    onProgress?.(i + 1);
  }
  return true;
}
