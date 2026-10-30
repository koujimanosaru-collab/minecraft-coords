import { describe, expect, it } from 'vitest';
import { coordSymbolConfidence, decideCoords } from '../src/lib/ocr/parse';
import { extractTextLine, percentile, type Mask } from '../src/lib/ocr/preprocess';

describe('decideCoords', () => {
  it('「位置: X, Y, Z」を読む', () => {
    expect(decideCoords(': 686, 133, 1792', 90)).toEqual({ x: 686, y: 133, z: 1792 });
    expect(decideCoords('28: : -2348, 127, -285', 90)).toEqual({ x: -2348, y: 127, z: -285 });
  });
  it('余分な数字・記号があれば拒否（全文一致）', () => {
    expect(decideCoords(': 686, 133, 1792 -', 90)).toBeNull();
    expect(decideCoords(': 1, 686, 133, 1792', 90)).toBeNull();
    expect(decideCoords(': 686, 133, 1792, 5', 90)).toBeNull();
    expect(decideCoords(': 686, 133', 90)).toBeNull();
    expect(decideCoords('', 90)).toBeNull();
  });
  it('確信度が低ければ拒否', () => {
    expect(decideCoords(': 686, 133, 1792', 59)).toBeNull();
  });
  it('Y が範囲外なら拒否', () => {
    expect(decideCoords(': 1, 321, 1', 90)).toBeNull();
    expect(decideCoords(': 1, -65, 1', 90)).toBeNull();
    expect(decideCoords(': 1, -64, 1', 90)).toEqual({ x: 1, y: -64, z: 1 });
  });
  it('X・Z がワールド境界を超えたら拒否', () => {
    expect(decideCoords(': 30000001, 64, 1', 90)).toBeNull();
  });
});

describe('percentile', () => {
  it('numpy と同じ線形補間', () => {
    expect(percentile(Float32Array.from([0, 10, 20, 30, 40]), 50)).toBe(20);
    expect(percentile(Float32Array.from([0, 100]), 97)).toBeCloseTo(97);
  });
});

/** テスト用: 指定した矩形を塗ったマスク */
function maskWith(w: number, h: number, rects: [number, number, number, number][]): Mask {
  const data = new Uint8Array(w * h);
  for (const [x0, y0, rw, rh] of rects) for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) data[y * w + x] = 1;
  return { width: w, height: h, data };
}

describe('extractTextLine', () => {
  it('文字が横に並ぶ行だけを残し、大きな塊（雲）を除く', () => {
    // 高さ 20・幅 12 の「0」のような枠の文字 6 つ（y=60〜79）と、上に大きな雲（y=0〜40）
    const glyph = (x: number): [number, number, number, number][] => [
      [x, 60, 12, 3], [x, 77, 12, 3], [x, 60, 3, 20], [x + 9, 60, 3, 20],
    ];
    const chars = Array.from({ length: 6 }, (_, i) => glyph(20 + i * 25)).flat();
    const m = extractTextLine(maskWith(300, 120, [[0, 0, 300, 40], ...chars]));
    expect(m).not.toBeNull();
    // 雲の行（上端）は含まれない: 結果の高さは文字の高さ程度
    expect(m!.height).toBeLessThan(45);
    const on = m!.data.reduce((a, b) => a + b, 0);
    const perGlyph = maskWith(12, 20, [[0, 0, 12, 3], [0, 17, 12, 3], [0, 0, 3, 20], [9, 0, 3, 20]]).data.reduce((a, b) => a + b, 0);
    expect(on).toBe(6 * perGlyph);
  });
  it('文字の行が見つからなければ null', () => {
    expect(extractTextLine(maskWith(200, 100, [[0, 0, 200, 50]]))).toBeNull();
    expect(extractTextLine(maskWith(200, 100, [[10, 10, 12, 20], [40, 10, 12, 20]]))).toBeNull();
  });
});

describe('coordSymbolConfidence', () => {
  const sym = (text: string, confidence: number) => ({ text, confidence });
  it('コンマの確信度も含める（数字は高く、コンマだけ低い）', () => {
    const s = [sym(':', 90), sym('6', 95), sym('8', 95), sym(',', 30), sym('1', 95), sym(',', 92), sym('2', 95)];
    expect(coordSymbolConfidence(s)).toBe(30);
  });
  it('コロンより左（「位置」の部分）は含めない', () => {
    const s = [sym('2', 10), sym('8', 10), sym(':', 50), sym('-', 88), sym('4', 97)];
    expect(coordSymbolConfidence(s)).toBe(88);
  });
  it('座標の記号がなければ 0', () => {
    expect(coordSymbolConfidence([sym(':', 90)])).toBe(0);
  });
});

describe('rectShapeOk', () => {
  it('縦に長すぎる範囲は断る（処理する画素数の上限も兼ねる）', async () => {
    const { rectShapeOk } = await import('../src/lib/ocr/reader');
    expect(rectShapeOk({ x: 0, y: 0, w: 400, h: 60 })).toBe(true);
    expect(rectShapeOk({ x: 0, y: 0, w: 400, h: 200 })).toBe(true);
    expect(rectShapeOk({ x: 0, y: 0, w: 20, h: 400 })).toBe(false);
    expect(rectShapeOk({ x: 0, y: 0, w: 0, h: 10 })).toBe(false);
  });
});
