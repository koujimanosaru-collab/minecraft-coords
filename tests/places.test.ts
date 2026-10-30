import { describe, expect, it } from 'vitest';
import { filterAndSort } from '../src/lib/places';
import type { Place } from '../src/lib/types';

const mk = (id: string, x: number, z: number, extra: Partial<Place> = {}): Place => ({
  id, worldId: 'w', dimension: 'overworld', categoryId: 'ow-village', name: id, x, y: 64, z,
  memo: '', visited: true, isHome: false, createdAt: 0, updatedAt: 0, ...extra,
});

describe('filterAndSort', () => {
  const list = [mk('far', 1000, 0, { createdAt: 3 }), mk('near', 10, 0, { createdAt: 1 }), mk('desert', 50, 0, { categoryId: 'ow-desert', visited: false, createdAt: 2 })];
  it('拠点から近い順', () => {
    expect(filterAndSort(list, { categoryIds: [], onlyUnvisited: false, sort: 'distance' }, { x: 0, y: 0, z: 0 }).map((p) => p.id)).toEqual(['near', 'desert', 'far']);
  });
  it('拠点がなければ新しい順', () => {
    expect(filterAndSort(list, { categoryIds: [], onlyUnvisited: false, sort: 'distance' }, null).map((p) => p.id)).toEqual(['far', 'desert', 'near']);
  });
  it('カテゴリと未訪問で絞り込み', () => {
    expect(filterAndSort(list, { categoryIds: ['ow-village'], onlyUnvisited: false, sort: 'name' }, null).map((p) => p.id)).toEqual(['far', 'near']);
    expect(filterAndSort(list, { categoryIds: [], onlyUnvisited: true, sort: 'name' }, null).map((p) => p.id)).toEqual(['desert']);
  });
  it('元の配列を変更しない', () => {
    const copy = [...list];
    filterAndSort(list, { categoryIds: [], onlyUnvisited: false, sort: 'name' }, null);
    expect(list).toEqual(copy);
  });
});
