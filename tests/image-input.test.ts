import { describe, expect, it } from 'vitest';
import { ImageInputError, MAX_FILE_BYTES, checkImageFile } from '../src/lib/image-input';

const png = (w: number, h: number) =>
  new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, w >>> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >>> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255])]);

describe('checkImageFile', () => {
  it('iPhone の 48MP 写真（8064×6048）は受け付ける', async () => {
    await expect(checkImageFile(png(8064, 6048))).resolves.toBeUndefined();
  });
  it('画素数が上限を超えたら、デコードせずに断る', async () => {
    await expect(checkImageFile(png(8200, 6200))).rejects.toMatchObject({ kind: 'too-many-pixels' });
  });
  it('ファイルが 30MB を超えたら断る', async () => {
    await expect(checkImageFile(new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]))).rejects.toBeInstanceOf(ImageInputError);
  });
  it('寸法を読めない形式（HEIC など）はここでは通す（デコード後に確かめる）', async () => {
    await expect(checkImageFile(new Blob([new TextEncoder().encode('....ftypheic....')]))).resolves.toBeUndefined();
  });
});
