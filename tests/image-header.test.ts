import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64, headerSize, isCompleteJpeg, jpegSize, pngSize } from '../src/lib/image-header';
import { fakeJpeg } from './helpers/jpeg';

describe('jpegSize', () => {
  it('SOF から寸法を読む（SOF2 も）', () => {
    expect(jpegSize(fakeJpeg(1280, 960))).toEqual({ width: 1280, height: 960 });
    expect(jpegSize(fakeJpeg(320, 240, { sof: 0xc2 }))).toEqual({ width: 320, height: 240 });
  });
  it('大きな APP セグメント（EXIF）の後ろの SOF も読む', () => {
    expect(jpegSize(fakeJpeg(4032, 3024, { app: 60000 }))).toEqual({ width: 4032, height: 3024 });
  });
  it('壊れたデータは null', () => {
    const j = fakeJpeg(100, 100);
    expect(jpegSize(j.slice(0, 10))).toBeNull(); // 途中で切れた
    const badLen = j.slice(); badLen[4] = 0; badLen[5] = 1; // セグメント長 1
    expect(jpegSize(badLen)).toBeNull();
    const huge = j.slice(); huge[4] = 0xff; huge[5] = 0xff; // セグメント長が範囲外
    expect(jpegSize(huge)).toBeNull();
    const noSof = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
    expect(jpegSize(noSof)).toBeNull();
    expect(jpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
  it('末尾の EOI を確認', () => {
    expect(isCompleteJpeg(fakeJpeg(1, 1))).toBe(true);
    expect(isCompleteJpeg(fakeJpeg(1, 1).slice(0, -1))).toBe(false);
  });
});

describe('pngSize / headerSize', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x1f, 0x80, 0, 0, 0x17, 0xa0]);
  it('IHDR から寸法を読む', () => {
    expect(pngSize(png)).toEqual({ width: 8064, height: 6048 });
    expect(headerSize(png)).toEqual({ width: 8064, height: 6048 });
  });
  it('JPEG でも PNG でもなければ null（HEIC など）', () => {
    expect(headerSize(new TextEncoder().encode('....ftypheic....'))).toBeNull();
  });
});

describe('base64', () => {
  it('往復', () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
    expect(decodeBase64(encodeBase64(b))).toEqual(b);
  });
  it('不正な文字列は null', () => {
    expect(decodeBase64('abc')).toBeNull();
    expect(decodeBase64('ab$c')).toBeNull();
    expect(decodeBase64('====')).toBeNull();
  });
});
