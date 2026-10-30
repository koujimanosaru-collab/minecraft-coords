import { describe, expect, it } from 'vitest';
import { clipPlanes, fitDistance, fitRadius, gridStep, MIN_RADIUS, pickNear, sceneOrigin, toScene, truncateLabel } from '../src/lib/scene3d';

describe('sceneOrigin / toScene', () => {
  it('外接範囲の中心を原点にする', () => {
    expect(sceneOrigin([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: -50 }], null)).toEqual({ x: 50, z: -25 });
  });
  it('点がなければ拠点、拠点もなければ 0', () => {
    expect(sceneOrigin([], { x: 7, y: 64, z: -3 })).toEqual({ x: 7, z: -3 });
    expect(sceneOrigin([], null)).toEqual({ x: 0, z: 0 });
  });
  it('大きな絶対座標でも近接地点の差が保たれる', () => {
    const pts = [{ x: 29_999_990, y: 70, z: -29_999_990 }, { x: 29_999_991, y: 70, z: -29_999_989 }];
    const o = sceneOrigin(pts, null);
    const [a, b] = pts.map((p) => toScene(p, o, 1));
    expect(b.x - a.x).toBe(1);
    expect(b.z - a.z).toBe(1);
    expect(Math.abs(a.x)).toBeLessThan(1);
  });
  it('描画の Y は (Y−63)×倍率', () => {
    expect(toScene({ x: 0, y: 70, z: 0 }, { x: 0, z: 0 }, 1).y).toBe(7);
    expect(toScene({ x: 0, y: -51, z: 0 }, { x: 0, z: 0 }, 5).y).toBe(-570);
  });
});

describe('fitRadius / gridStep / clip', () => {
  it('空・1 件・全部同じ座標でも最小半径', () => {
    expect(fitRadius([])).toBe(MIN_RADIUS);
    expect(fitRadius([{ x: 0, y: 0, z: 0 }])).toBe(MIN_RADIUS);
    expect(fitRadius([{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBe(MIN_RADIUS);
  });
  it('一番遠い点までの距離', () => {
    expect(fitRadius([{ x: 300, y: 0, z: 400 }])).toBe(500);
  });
  it('グリッド間隔は線が 20 本以下', () => {
    expect(gridStep(32)).toBe(10);
    expect(gridStep(500)).toBe(50);
    expect(gridStep(5000)).toBe(500);
    expect(gridStep(30_000_000)).toBe(5_000_000);
  });
  it('縦長の画面では横の視野角で距離を決める', () => {
    const tall = fitDistance(1000, 50, 390 / 500);
    const square = fitDistance(1000, 50, 1);
    expect(tall).toBeGreaterThan(square);
    // 横の半画角で見て、半径が収まる
    const hHalf = Math.atan(Math.tan((25 * Math.PI) / 180) * (390 / 500));
    expect(tall * Math.sin(hHalf)).toBeGreaterThanOrEqual(1000);
  });
  it('near は正、far はカメラ距離より遠い', () => {
    const r = 1000;
    const d = fitDistance(r, 50);
    const { near, far } = clipPlanes(r, d);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(d + r);
  });
});

describe('truncateLabel', () => {
  it('12 文字を超えると省略', () => {
    expect(truncateLabel('砂漠のピラミッド')).toBe('砂漠のピラミッド');
    expect(truncateLabel('あ'.repeat(100))).toBe(`${'あ'.repeat(11)}…`);
  });
  it('絵文字を途中で切らない', () => {
    expect([...truncateLabel('🏠'.repeat(20))].length).toBe(12);
  });
});

describe('pickNear', () => {
  it('しきい値内を近い順に', () => {
    const items = [{ id: 'a', sx: 100, sy: 100 }, { id: 'b', sx: 110, sy: 100 }, { id: 'c', sx: 200, sy: 200 }];
    expect(pickNear(items, 108, 100).map((i) => i.id)).toEqual(['b', 'a']);
    expect(pickNear(items, 0, 0)).toEqual([]);
  });
});
