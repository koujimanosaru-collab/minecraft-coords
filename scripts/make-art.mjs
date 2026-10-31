// アプリのアイコンとディメンションの背景の模様（オリジナルのドット絵）を生成して public/ に書き出す。
// ゲームの画像は使わず、ここで決めた色と形だけで描く。乱数は固定なので毎回同じ画像になる。
// 使い方: node scripts/make-art.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---- PNG（RGB, 8bit）を書き出す ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** grid: 色 [r,g,b] の 2 次元配列。scale 倍に拡大し、pad ドット分 padColor で囲む */
function png(grid, scale, pad = 0, padColor = [0, 0, 0]) {
  const h = grid.length * scale + pad * 2;
  const w = grid[0].length * scale + pad * 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const gy = Math.floor((y - pad) / scale);
      const gx = Math.floor((x - pad) / scale);
      const inside = y >= pad && x >= pad && gy < grid.length && gx < grid[0].length;
      const [r, g, b] = inside ? grid[gy][gx] : padColor;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function svg(grid) {
  const rects = grid
    .flatMap((row, y) => row.map(([r, g, b], x) => `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${r},${g},${b})"/>`))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid[0].length} ${grid.length}" shape-rendering="crispEdges">${rects}</svg>`;
}

// ---- アイコン: 斜め上から見た草ブロック＋細いピン（32×32） ----
const SKY = [148, 198, 240];
const GRASS = [[98, 160, 56], [82, 140, 45], [112, 176, 64], [90, 150, 50]];
const GRASS_SIDE = [[70, 120, 38], [62, 108, 34]];
const DIRT = [[134, 96, 67], [116, 82, 56], [150, 110, 78], [124, 88, 60]];
const DIRT_DARK = [[104, 74, 50], [92, 66, 44]];

function icon() {
  const g = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => SKY));
  const [cx, cy, hw, hh, depth] = [15.5, 13.5, 13.5, 6.75, 11];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.abs(dx) / hw + Math.abs(dy) / hh <= 1) {
        g[y][x] = pick(GRASS);
        continue;
      }
      if (Math.abs(dx) > hw) continue;
      const low = cy + hh * (1 - Math.abs(dx) / hw); // 上面の下側の縁
      const side = y + 0.5 - low;
      if (side >= 0 && side < depth) {
        const left = dx < 0;
        g[y][x] = side < 3 ? pick(left ? GRASS.slice(0, 2) : GRASS_SIDE) : pick(left ? DIRT : DIRT_DARK);
      }
    }
  }
  // 細いピン: 頭（白い点つき）＋軸＋影
  const red = [214, 48, 49];
  const dark = [120, 20, 24];
  const head = ['..ooo..', '.orrro.', 'orrwrro', 'orrrrro', 'orrrrro', '.orrro.', '..ooo..'];
  const [px, top, h] = [15, 2, 12];
  head.forEach((row, j) =>
    [...row].forEach((c, i) => {
      if (c === 'o') g[top + j][px - 3 + i] = dark;
      if (c === 'r') g[top + j][px - 3 + i] = red;
      if (c === 'w') g[top + j][px - 3 + i] = [255, 255, 255];
    }),
  );
  for (let y = top + 7; y < top + h; y++) g[y][px] = dark;
  for (let x = px - 2; x <= px + 2; x++) g[top + h][x] = g[top + h][x].map((v) => Math.round(v * 0.6));
  return g;
}

// ---- ディメンションの背景の模様（16×16 のタイル。並べてもつなぎ目が目立たない細かい模様） ----
function tile(palette, accents = [], accentRate = 0) {
  return Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, () => (accents.length && rand() < accentRate ? pick(accents) : pick(palette))),
  );
}
const overworld = tile([[96, 158, 54], [84, 142, 46], [108, 170, 62], [90, 150, 50]], [[70, 122, 40], [122, 184, 72]], 0.12);
const nether = tile([[112, 36, 36], [98, 30, 32], [126, 44, 42], [104, 34, 34]], [[70, 18, 22], [150, 62, 50]], 0.15);
const end = tile([[58, 36, 84], [50, 30, 74], [66, 42, 94], [54, 34, 80]], [[226, 220, 160], [190, 150, 230]], 0.04);

mkdirSync('public/textures', { recursive: true });
const art = icon();
writeFileSync('public/icon-192.png', png(art, 6));
writeFileSync('public/icon-512.png', png(art, 16));
writeFileSync('public/apple-touch-icon.png', png(art, 5, 10, SKY)); // 180×180（32×5＋余白）
writeFileSync('public/icon.svg', svg(art));
writeFileSync('public/textures/overworld.png', png(overworld, 1));
writeFileSync('public/textures/nether.png', png(nether, 1));
writeFileSync('public/textures/end.png', png(end, 1));
console.log('wrote icons and textures');
