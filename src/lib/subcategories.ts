/**
 * 地点の追加カテゴリ（メイン 1 つ＋追加 3 つまで）。
 * 追加は places とは別のテーブルに持つ（旧版のアプリが地点を上書きしても消えないように）ので、
 * 読み込むときは必ず normalizeSubCategories で整える（画面・絞り込み・件数・バックアップで共通）。
 */
import { mapCategoryToDimension } from './categories';
import type { Category, Dimension, Place } from './types';

export const MAX_SUB_CATEGORIES = 3;

export interface PlaceCategory {
  placeId: string;
  categoryId: string;
  order: number;
}

/**
 * 追加カテゴリの行を地点ごとにまとめる。存在しない地点・カテゴリ、メインと同じ、ディメンション違い、
 * 重複、4 件目以降は除く（旧版での削除・ディメンション変更の後に残った行など）
 */
export function normalizeSubCategories(
  rows: PlaceCategory[],
  places: Map<string, Place>,
  categories: Map<string, Category>,
): Map<string, string[]> {
  const byPlace = new Map<string, PlaceCategory[]>();
  for (const r of rows) {
    if (!places.has(r.placeId)) continue;
    byPlace.set(r.placeId, [...(byPlace.get(r.placeId) ?? []), r]);
  }
  const out = new Map<string, string[]>();
  for (const [placeId, list] of byPlace) {
    const place = places.get(placeId)!;
    const ids: string[] = [];
    for (const r of [...list].sort((a, b) => a.order - b.order)) {
      const c = categories.get(r.categoryId);
      if (!c || c.id === place.categoryId || c.dimension !== place.dimension || ids.includes(c.id)) continue;
      ids.push(c.id);
      if (ids.length === MAX_SUB_CATEGORIES) break;
    }
    if (ids.length) out.set(placeId, ids);
  }
  return out;
}

/** 地点に付いているカテゴリ（メイン＋追加、重複なし） */
export function categoryIdsOf(place: Place, subs: Map<string, string[]> | undefined): string[] {
  return [place.categoryId, ...(subs?.get(place.id) ?? [])];
}

// ---- 記録画面での選び方 ----

export interface CategorySelection {
  /** メイン（未選択なら ''） */
  main: string;
  /** 追加（3 つまで） */
  subs: string[];
}

/**
 * タイルを押したとき。未選択→メインが空ならメイン、そうでなければ追加（3 つまで）。
 * 追加を押す→外す。メインを押す→外して追加の先頭を繰り上げ。full は追加が上限で付けられなかったとき
 */
export function tapCategory(sel: CategorySelection, id: string): { sel: CategorySelection; full: boolean } {
  if (id === sel.main) return { sel: { main: sel.subs[0] ?? '', subs: sel.subs.slice(1) }, full: false };
  if (sel.subs.includes(id)) return { sel: { ...sel, subs: sel.subs.filter((s) => s !== id) }, full: false };
  if (!sel.main) return { sel: { ...sel, main: id }, full: false };
  if (sel.subs.length >= MAX_SUB_CATEGORIES) return { sel, full: true };
  return { sel: { ...sel, subs: [...sel.subs, id] }, full: false };
}

/** 追加のカテゴリをメインにする（元のメインは追加の先頭へ） */
export function makeMain(sel: CategorySelection, id: string): CategorySelection {
  if (!sel.subs.includes(id)) return sel;
  const rest = sel.subs.filter((s) => s !== id);
  return { main: id, subs: (sel.main ? [sel.main, ...rest] : rest).slice(0, MAX_SUB_CATEGORIES) };
}

/** 選んだカテゴリを外す（メインなら追加の先頭を繰り上げ） */
export function removeCategory(sel: CategorySelection, id: string): CategorySelection {
  return id === sel.main || sel.subs.includes(id) ? tapCategory(sel, id).sel : sel;
}

/**
 * ディメンションを切り替えたときの引き継ぎ（メイン・追加とも「同じ名前の表示中カテゴリがちょうど 1 つ」）。
 * メインが引き継げず追加が引き継げたら、追加の先頭をメインに繰り上げる
 */
export function mapSelection(sel: CategorySelection, categories: Category[], to: Dimension): CategorySelection {
  const main = sel.main ? mapCategoryToDimension(categories, sel.main, to) : '';
  const subs: string[] = [];
  for (const s of sel.subs) {
    const m = mapCategoryToDimension(categories, s, to);
    if (m && m !== main && !subs.includes(m)) subs.push(m);
  }
  if (!main && subs.length) return { main: subs[0], subs: subs.slice(1) };
  return { main, subs };
}
