/** 最小限の JPEG 風バイト列: SOI, APP0, SOF0(寸法), SOS, データ, EOI */
export function fakeJpeg(width: number, height: number, { app = 16, body = 10, sof = 0xc0 } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, app >> 8, app & 255, ...new Array(app - 2).fill(0)];
  const sofSeg = [0xff, sof, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, ...new Array(9).fill(0)];
  const sos = [0xff, 0xda, 0, 12, ...new Array(10).fill(0)];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sofSeg, ...sos, ...new Array(body).fill(0x55), 0xff, 0xd9]);
}
