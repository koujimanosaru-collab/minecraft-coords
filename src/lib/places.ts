import { horizontalDistance } from './geo';
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

/** 絞り込みと並べ替え。距離順は origin（拠点）がなければ新しい順にする */
export function filterAndSort(places: Place[], filter: PlaceFilter, origin: Coords | null): Place[] {
  const cats = new Set(filter.categoryIds);
  const list = places.filter(
    (p) => (cats.size === 0 || cats.has(p.categoryId)) && (!filter.onlyUnvisited || !p.visited),
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
