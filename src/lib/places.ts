import { horizontalDistance } from './geo';
import { categoryIdsOf } from './subcategories';
import type { Coords, Place } from './types';

export type SortKey = 'distance' | 'name' | 'created';

export const SORT_LABELS: Record<SortKey, string> = {
  distance: '拠点から近い順',
  name: '名前順',
  created: '新しい順',
};

export interface PlaceFilter {
  /** 空なら全カテゴリ */
  categoryIds: string[];
  onlyUnvisited: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTER: PlaceFilter = { categoryIds: [], onlyUnvisited: false, sort: 'distance' };

/**
 * 絞り込みと並べ替え。カテゴリはメインか追加のどれかが当てはまれば表示。
 * 距離順は origin（拠点）がなければ新しい順にする
 */
export function filterAndSort(
  places: Place[],
  filter: PlaceFilter,
  origin: Coords | null,
  subs?: Map<string, string[]>,
): Place[] {
  const cats = new Set(filter.categoryIds);
  const list = places.filter(
    (p) => (cats.size === 0 || categoryIdsOf(p, subs).some((id) => cats.has(id))) && (!filter.onlyUnvisited || !p.visited),
  );
  const byCreated = (a: Place, b: Place) => b.createdAt - a.createdAt;
  if (filter.sort === 'distance' && origin) {
    return list.sort((a, b) => horizontalDistance(origin, a) - horizontalDistance(origin, b) || byCreated(a, b));
  }
  if (filter.sort === 'name') {
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }) || byCreated(a, b));
  }
  return list.sort(byCreated);
}

/** カテゴリごとの地点の数（メインと追加の両方を数える。1 地点がメインと追加で 2 回数えられることはない） */
export function countByCategory(places: Place[], subs?: Map<string, string[]>): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of places) for (const id of new Set(categoryIdsOf(p, subs))) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}
