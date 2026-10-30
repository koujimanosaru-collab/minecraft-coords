import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinCategories, mapCategoryToDimension } from '../src/lib/categories';
import { CoordsDB, ensureSeed, savePlace } from '../src/lib/db';
import { hereKey, setHere } from '../src/lib/here';
import type { Category, Place } from '../src/lib/types';

describe('mapCategoryToDimension', () => {
  const cats = builtinCategories();
  it('同じ名前が 1 つあれば引き継ぐ', () => {
    expect(mapCategoryToDimension(cats, 'ow-home', 'nether')).toBe('ne-home');
    expect(mapCategoryToDimension(cats, 'ow-portal', 'nether')).toBe('ne-portal');
    expect(mapCategoryToDimension(cats, 'ne-other', 'end')).toBe('en-other');
  });
  it('なければ未選択', () => {
    expect(mapCategoryToDimension(cats, 'ow-village', 'nether')).toBe('');
    expect(mapCategoryToDimension(cats, 'unknown', 'nether')).toBe('');
  });
  it('同じディメンションならそのまま', () => {
    expect(mapCategoryToDimension(cats, 'ow-village', 'overworld')).toBe('ow-village');
  });
  it('移動先で非表示なら未選択', () => {
    const hidden = cats.map((c) => (c.id === 'ne-home' ? { ...c, hidden: true } : c));
    expect(mapCategoryToDimension(hidden, 'ow-home', 'nether')).toBe('');
  });
  it('移動先に同じ名前が複数あれば未選択', () => {
    const dup: Category = { ...cats.find((c) => c.id === 'ne-home')!, id: 'ne-home-2', builtin: false };
    expect(mapCategoryToDimension([...cats, dup], 'ow-home', 'nether')).toBe('');
  });
});

describe('setHere', () => {
  it('指定したワールド・ディメンションだけを更新する', () => {
    const a = { x: '1', y: '2', z: '3' };
    const b = { x: '4', y: '5', z: '6' };
    const c = { x: '7', y: '8', z: '9' };
    const heres = { [hereKey('w1', 'overworld')]: a, [hereKey('w1', 'nether')]: b, [hereKey('w2', 'nether')]: c };
    const next = setHere(heres, 'w1', 'nether', { x: '10', y: '64', z: '-5' });
    expect(next[hereKey('w1', 'nether')]).toEqual({ x: '10', y: '64', z: '-5' });
    expect(next[hereKey('w1', 'overworld')]).toBe(a);
    expect(next[hereKey('w2', 'nether')]).toBe(c);
    expect(heres[hereKey('w1', 'nether')]).toBe(b);
  });
});

describe('拠点を別ディメンションに移す', () => {
  let d: CoordsDB;
  beforeEach(async () => {
    d = new CoordsDB(`dim-${Math.random()}`);
    await ensureSeed(d);
  });
  afterEach(async () => {
    d.close();
    await d.delete();
  });
  const mk = (id: string, dimension: Place['dimension'], categoryId: string): Place => ({
    id, worldId: 'w', dimension, categoryId, name: id, x: 0, y: 64, z: 0, memo: '', visited: true, isHome: true, createdAt: 0, updatedAt: 0,
  });
  it('移動先の既存の拠点は外れ、移動元には拠点がなくなる', async () => {
    await savePlace(mk('ow', 'overworld', 'ow-home'), d);
    await savePlace(mk('ne', 'nether', 'ne-home'), d);
    await savePlace({ ...mk('ne', 'overworld', 'ow-home') }, d);
    const homes = (await d.places.toArray()).filter((p) => p.isHome).map((p) => `${p.id}:${p.dimension}`);
    expect(homes).toEqual(['ne:overworld']);
  });
});
