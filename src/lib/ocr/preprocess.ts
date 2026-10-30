/**
 * 写真から切り出した座標部分を、OCR しやすい「白地に黒い文字 1 行」にする。
 * B-1 の評価で使った手順（拡大 → メディアン → 白い文字の抽出 → 文字行の抽出）を移植したもの。
 * 入力・出力はブラウザに依存しない配列なので単体テストできる。
 */

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface Mask {
  width: number;
  height: number;
  /** 1 = 文字 */
  data: Uint8Array;
}

/** 前処理の幅（切り出しをこの幅に拡大してから処理する） */
export const WORK_WIDTH = 1200;

function median9(v: number[]): number {
  v.sort((a, b) => a - b);
  return v[4];
}

/** 3×3 のメディアンフィルタ（チャンネルごと）。端は近い画素で補う */
export function medianFilter(img: RGBAImage): RGBAImage {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const buf: number[] = new Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            buf[k++] = data[(yy * w + xx) * 4 + ch];
          }
        }
        out[(y * w + x) * 4 + ch] = median9(buf);
      }
      out[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/** 白っぽい文字だけを取り出す。明るさは写真ごとに違うので上位 3% の明るさを基準にする */
export function whiteTextMask(img: RGBAImage): Mask {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const gray = new Float32Array(n);
  const sat = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = (r + g + b) / 3;
    sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  const t = Math.max(150, percentile(gray, 97) - 45);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = gray[i] >= t && sat[i] < 70 ? 1 : 0;
  return { width: w, height: h, data: mask };
}

/** numpy.percentile（線形補間）と同じ値 */
export function percentile(values: Float32Array, p: number): number {
  const s = Float32Array.from(values).sort();
  if (s.length === 0) return 0;
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

interface Component {
  id: number;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  area: number;
}

/** 4 近傍の連結成分 */
export function components(mask: Mask): { labels: Int32Array; comps: Component[] } {
  const { width: w, height: h, data } = mask;
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const queue = new Int32Array(w * h);
  let n = 0;
  for (let start = 0; start < w * h; start++) {
    if (!data[start] || labels[start]) continue;
    n++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = n;
    const c: Component = { id: n, y0: h, y1: -1, x0: w, x1: -1, area: 0 };
    while (head < tail) {
      const p = queue[head++];
      const y = (p / w) | 0;
      const x = p - y * w;
      c.area++;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y + 1 < h) visit(p + w);
      if (y > 0) visit(p - w);
      if (x + 1 < w) visit(p + 1);
      if (x > 0) visit(p - 1);
    }
    comps.push(c);
    function visit(q: number) {
      if (data[q] && !labels[q]) {
        labels[q] = n;
        queue[tail++] = q;
      }
    }
  }
  return { labels, comps };
}

/**
 * 高さのそろった文字が横に 4 つ以上並ぶ 1 行だけを残して切り出す（雲などの大きな白い塊を除く）。
 * 行が見つからなければ null。
 */
export function extractTextLine(mask: Mask): Mask | null {
  const { width: W, height: H } = mask;
  const { labels, comps } = components(mask);
  const cand = comps
    .map((c) => ({ ...c, h: c.y1 - c.y0 + 1, w: c.x1 - c.x0 + 1, cy: (c.y0 + c.y1) / 2 }))
    .filter((c) => c.h >= 10 && c.h <= H * 0.9 && c.w <= 2.5 * c.h && c.area >= 20 && c.area <= 0.8 * c.h * c.w + 1);
  let best: typeof cand = [];
  for (const c of cand) {
    const grp = cand.filter((d) => Math.abs(d.cy - c.cy) < 0.35 * c.h && d.h / c.h > 0.6 && d.h / c.h < 1.6);
    if (grp.length > best.length) best = grp;
  }
  if (best.length < 4) return null;

  const y0 = Math.min(...best.map((c) => c.y0));
  const y1 = Math.max(...best.map((c) => c.y1));
  const x0 = Math.min(...best.map((c) => c.x0));
  const x1 = Math.max(...best.map((c) => c.x1));
  const hh = y1 - y0;
  const third = Math.floor(hh / 3);
  // 行の範囲内の小さい部品（コンマ・コロン・マイナス）も残す
  const keep = new Set(best.map((c) => c.id));
  for (const c of comps) {
    if (c.area < 0.5 * hh * hh && c.y0 >= y0 - third && c.y1 <= y1 + third && c.x0 >= x0 - hh && c.x1 <= x1 + hh) keep.add(c.id);
  }
  const by0 = Math.max(0, y0 - third);
  const by1 = Math.min(H - 1, y1 + third);
  const bx0 = Math.max(0, x0 - hh);
  const bx1 = Math.min(W - 1, x1 + hh);

  const pad = Math.floor(hh / 2);
  const oy0 = Math.max(0, y0 - pad);
  const oy1 = Math.min(H - 1, y1 + pad);
  const ox0 = Math.max(0, x0 - pad);
  const ox1 = Math.min(W - 1, x1 + pad);
  const ow = ox1 - ox0 + 1;
  const oh = oy1 - oy0 + 1;
  const out = new Uint8Array(ow * oh);
  for (let y = oy0; y <= oy1; y++) {
    for (let x = ox0; x <= ox1; x++) {
      const inBand = y >= by0 && y <= by1 && x >= bx0 && x <= bx1;
      if (inBand && keep.has(labels[y * W + x])) out[(y - oy0) * ow + (x - ox0)] = 1;
    }
  }
  return { width: ow, height: oh, data: out };
}

/** 拡大済みの切り出し画像 → 文字行のマスク */
export function preprocess(img: RGBAImage): Mask | null {
  return extractTextLine(whiteTextMask(medianFilter(img)));
}
