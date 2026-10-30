import { describe, expect, it } from 'vitest';
import { convertDimension, direction8, parseCoord, routeTo } from '../src/lib/geo';

describe('direction8', () => {
  const o = { x: 0, y: 64, z: 0 };
  it('北は Z-、東は X+', () => {
    expect(direction8(o, { x: 0, y: 0, z: -10 })).toBe('北');
    expect(direction8(o, { x: 10, y: 0, z: 0 })).toBe('東');
    expect(direction8(o, { x: 0, y: 0, z: 10 })).toBe('南');
    expect(direction8(o, { x: -10, y: 0, z: 0 })).toBe('西');
    expect(direction8(o, { x: 10, y: 0, z: -10 })).toBe('北東');
    expect(direction8(o, { x: -10, y: 0, z: 10 })).toBe('南西');
  });
  it('同じ位置は null', () => {
    expect(direction8(o, { x: 0, y: 100, z: 0 })).toBeNull();
  });
});

describe('routeTo', () => {
  it('水平距離と高さの差', () => {
    expect(routeTo({ x: 0, y: 64, z: 0 }, { x: 30, y: 70, z: -40 })).toEqual({ distance: 50, direction: '北東', dy: 6 });
  });
});

describe('convertDimension', () => {
  it('オーバーワールド→ネザーは 1/8 で切り捨て（負数も床関数）', () => {
    expect(convertDimension({ x: 100, y: 70, z: -100 }, 'overworld')).toEqual({ to: 'nether', coords: { x: 12, y: 70, z: -13 } });
  });
  it('ネザー→オーバーワールドは 8 倍', () => {
    expect(convertDimension({ x: 12, y: 70, z: -13 }, 'nether')).toEqual({ to: 'overworld', coords: { x: 96, y: 70, z: -104 } });
  });
  it('エンドは換算なし', () => {
    expect(convertDimension({ x: 1, y: 1, z: 1 }, 'end')).toBeNull();
  });
});

describe('parseCoord', () => {
  it('整数・全角・各種マイナス', () => {
    expect(parseCoord('123')).toBe(123);
    expect(parseCoord(' -45 ')).toBe(-45);
    expect(parseCoord('－４５')).toBe(-45);
    expect(parseCoord('−7')).toBe(-7);
  });
  it('不正な値は null', () => {
    expect(parseCoord('')).toBeNull();
    expect(parseCoord('1.5')).toBeNull();
    expect(parseCoord('12a')).toBeNull();
    expect(parseCoord('-')).toBeNull();
  });
});
