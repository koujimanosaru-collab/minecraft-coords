import type { Coords } from './types';

/** 基準面（海面）の高さ */
export const SEA_LEVEL = 63;
/** 全体表示の最小半径（ブロック） */
export const MIN_RADIUS = 32;
/** 札の名前の最大文字数 */
export const LABEL_MAX_CHARS = 12;

const GRID_STEPS = [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * シーンの原点（ワールド座標）。表示する点の外接範囲の中心をグリッド間隔に合わせて丸める。
 * 大きな座標でも相対座標で描くことで浮動小数の精度落ちを防ぐ。
 */
export function sceneOrigin(points: Coords[], fallback: Coords | null): { x: number; z: number } {
  if (points.length === 0) return { x: fallback?.x ?? 0, z: fallback?.z ?? 0 };
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
}

/** ワールド座標 → シーン座標。描画の Y は (Y − 海面) × 倍率 */
export function toScene(p: Coords, origin: { x: number; z: number }, yScale: number): Vec3 {
  return { x: p.x - origin.x, y: (p.y - SEA_LEVEL) * yScale, z: p.z - origin.z };
}

/** 原点から最も遠い点までの距離（最小 MIN_RADIUS） */
export function fitRadius(scenePoints: Vec3[]): number {
  let r = 0;
  for (const p of scenePoints) r = Math.max(r, Math.hypot(p.x, p.y, p.z));
  return Math.max(r, MIN_RADIUS);
}

/** グリッド間隔: 半径の範囲に線が 20 本程度以下になる最小の刻み */
export function gridStep(radius: number): number {
  return GRID_STEPS.find((s) => (radius * 2) / s <= 20) ?? GRID_STEPS[GRID_STEPS.length - 1];
}

/** カメラの near / far。半径とカメラ距離から決める */
export function clipPlanes(radius: number, distance: number): { near: number; far: number } {
  return { near: Math.max(0.1, distance / 1000), far: distance + radius * 4 };
}

/**
 * 半径が画面に収まるカメラ距離。fovDeg は縦の視野角、aspect は幅÷高さ。
 * 縦と横のうち狭い方の視野角で決め、札が端で切れないよう余白を足す
 */
export function fitDistance(radius: number, fovDeg: number, aspect = 1): number {
  const vHalf = ((fovDeg / 2) * Math.PI) / 180;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.15;
}

export function truncateLabel(name: string): string {
  const chars = [...name];
  return chars.length > LABEL_MAX_CHARS ? `${chars.slice(0, LABEL_MAX_CHARS - 1).join('')}…` : name;
}

/** タップ位置の近くにある札（画面座標）を近い順に返す */
export function pickNear<T extends { sx: number; sy: number }>(items: T[], tx: number, ty: number, threshold = 24): T[] {
  return items
    .map((it) => ({ it, d: Math.hypot(it.sx - tx, it.sy - ty) }))
    .filter((e) => e.d <= threshold)
    .sort((a, b) => a.d - b.d)
    .map((e) => e.it);
}
