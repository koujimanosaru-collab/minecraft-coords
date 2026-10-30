import type { Coords, Dimension } from './types';

const DIRECTIONS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const;

/** 水平距離（X/Z 平面のユークリッド距離） */
export function horizontalDistance(a: Coords, b: Coords): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * from から to への方角（8 方位）。Minecraft は北 = Z-、東 = X+。
 * 同じ位置なら null。
 */
export function direction8(from: Coords, to: Coords): string | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return null;
  // 北を 0°、時計回り
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const idx = Math.round(((deg + 360) % 360) / 45) % 8;
  return DIRECTIONS[idx];
}

export interface Route {
  distance: number;
  direction: string | null;
  dy: number;
}

export function routeTo(from: Coords, to: Coords): Route {
  return {
    distance: Math.round(horizontalDistance(from, to)),
    direction: direction8(from, to),
    dy: to.y - from.y,
  };
}

/** ネザー⇔オーバーワールドの座標換算。X/Z は 1/8（端数は切り捨て）、Y はそのまま */
export function convertDimension(c: Coords, from: Dimension): { to: Dimension; coords: Coords } | null {
  if (from === 'overworld') {
    return { to: 'nether', coords: { x: Math.floor(c.x / 8), y: c.y, z: Math.floor(c.z / 8) } };
  }
  if (from === 'nether') {
    return { to: 'overworld', coords: { x: c.x * 8, y: c.y, z: c.z * 8 } };
  }
  return null;
}

export function formatCoords(c: Coords): string {
  return `${c.x}, ${c.y}, ${c.z}`;
}

export function formatDistance(m: number): string {
  return `${m.toLocaleString('ja-JP')} ブロック`;
}

/** 入力文字列を整数座標に。全角数字・各種マイナス記号も受け付ける */
export function parseCoord(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[−ー－‐―]/g, '-');
  if (!/^-?\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isSafeInteger(n) ? n : null;
}
