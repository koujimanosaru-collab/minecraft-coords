import Dexie, { type EntityTable } from 'dexie';
import { builtinCategories } from './categories';
import { MAX_SUB_CATEGORIES, normalizeSubCategories, type PlaceCategory } from './subcategories';
import type { Category, Dimension, Place, World } from './types';

export interface Meta {
  key: string;
  value: unknown;
}

/** 地点の画像（1 地点 1 枚）。full・thumb は JPEG。width・height は full の寸法 */
export interface Photo {
  id: string;
  placeId: string;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** full と thumb のバイト数の合計 */
  bytes: number;
  createdAt: number;
}

/** 新しく付ける画像の中身（保存前） */
export type PhotoData = Pick<Photo, 'full' | 'thumb' | 'width' | 'height'>;

/** 画像は全体で 100 枚まで（バックアップが 100MB に収まるように） */
export const MAX_PHOTOS = 100;

/**
 * 容量不足のエラーか。Dexie は IndexedDB のエラーを独自のエラーで包む（inner）ことがあり、
 * まとめて追加したときは BulkError の failures に入ることもあるので、中までたどる
 */
export function isQuotaError(e: unknown, depth = 0): boolean {
  if (!e || typeof e !== 'object' || depth > 5) return false;
  const err = e as { name?: string; inner?: unknown; failures?: unknown[]; failuresByPos?: Record<string, unknown> };
  if (err.name === 'QuotaExceededError') return true;
  if (isQuotaError(err.inner, depth + 1)) return true;
  const failures = [...(err.failures ?? []), ...Object.values(err.failuresByPos ?? {})];
  return failures.some((f) => isQuotaError(f, depth + 1));
}

export class PhotoLimitError extends Error {
  constructor() {
    super(`画像は ${MAX_PHOTOS} 枚までです`);
  }
}

/**
 * 使う DB の名前。URL に ?selftest=1 があれば試験用の DB を使う（本番のデータに触れないため）。
 * 起動時に 1 度だけ決める
 */
export function dbNameFor(search: string): string {
  return new URLSearchParams(search).get('selftest') === '1' ? 'minecraft-coords-selftest' : 'minecraft-coords';
}
export const DB_NAME = dbNameFor(typeof location === 'undefined' ? '' : location.search);
export const SELFTEST = DB_NAME !== 'minecraft-coords';

export class CoordsDB extends Dexie {
  worlds!: EntityTable<World, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  places!: EntityTable<Place, 'id'>;
  meta!: EntityTable<Meta, 'key'>;
  photos!: EntityTable<Photo, 'id'>;
  placeCategories!: Dexie.Table<PlaceCategory, [string, string]>;

  constructor(name = 'minecraft-coords') {
    super(name);
    this.version(1).stores({
      worlds: 'id, sortOrder',
      categories: 'id, dimension, sortOrder',
      places: 'id, worldId, [worldId+dimension], categoryId',
      meta: 'key',
    });
    // 画像のテーブルを追加（Blob はインデックスに含めない）。既存のテーブルはそのまま
    this.version(2).stores({
      photos: 'id, placeId',
    });
    // 追加カテゴリのテーブルを追加（places の定義・データは変えない。旧版が地点を上書きしても追加は残る）
    this.version(3).stores({
      placeCategories: '[placeId+categoryId], placeId, categoryId',
    });
  }
}

export const db = new CoordsDB(DB_NAME);

export function newId(): string {
  return crypto.randomUUID();
}

/** 初回起動時にワールドとカテゴリの初期データを入れる */
export async function ensureSeed(d: CoordsDB = db): Promise<void> {
  await d.transaction('rw', d.worlds, d.categories, async () => {
    if ((await d.categories.count()) === 0) {
      await d.categories.bulkAdd(builtinCategories());
    }
    if ((await d.worlds.count()) === 0) {
      await d.worlds.add({ id: newId(), name: 'Realms のワールド', sortOrder: 0, createdAt: Date.now() });
    }
  });
}

export async function addWorld(name: string, d: CoordsDB = db): Promise<string> {
  const id = newId();
  const last = await d.worlds.orderBy('sortOrder').last();
  await d.worlds.add({ id, name, sortOrder: (last?.sortOrder ?? -1) + 1, createdAt: Date.now() });
  return id;
}

export async function deleteWorld(id: string, d: CoordsDB = db): Promise<void> {
  await d.transaction('rw', d.worlds, d.places, d.photos, d.placeCategories, async () => {
    const placeIds = (await d.places.where('worldId').equals(id).primaryKeys()) as string[];
    await d.photos.where('placeId').anyOf(placeIds).delete();
    await d.placeCategories.where('placeId').anyOf(placeIds).delete();
    await d.places.where('worldId').equals(id).delete();
    await d.worlds.delete(id);
  });
}

/** 地点を削除する（画像も一緒に） */
export async function deletePlace(id: string, d: CoordsDB = db): Promise<void> {
  await d.transaction('rw', d.places, d.photos, d.placeCategories, async () => {
    await d.photos.where('placeId').equals(id).delete();
    await d.placeCategories.where('placeId').equals(id).delete();
    await d.places.delete(id);
  });
}

export async function deleteAllPhotos(d: CoordsDB = db): Promise<void> {
  await d.photos.clear();
}

/** 画像の枚数と合計バイト数 */
export async function photoStats(d: CoordsDB = db): Promise<{ count: number; bytes: number }> {
  let bytes = 0;
  let count = 0;
  await d.photos.each((p) => {
    count++;
    bytes += p.bytes;
  });
  return { count, bytes };
}

/** 名前が空のとき「カテゴリ名 #連番」を付ける */
export async function autoName(worldId: string, category: Category, d: CoordsDB = db): Promise<string> {
  const same = await d.places.where('worldId').equals(worldId).filter((p) => p.categoryId === category.id).toArray();
  const prefix = `${category.name} #`;
  const max = same.reduce((m, p) => {
    const n = p.name.startsWith(prefix) ? Number(p.name.slice(prefix.length)) : NaN;
    return Number.isInteger(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${Math.max(max, same.length) + 1}`;
}

/**
 * 地点を保存。拠点にした場合は同じワールド×ディメンションの他の拠点を外す。
 * photo: 省略＝画像は変えない、null＝外す、データ＝付ける・差し替える（地点と同じトランザクション）。
 * 失敗したら地点も画像も変わらない
 */
export async function savePlace(
  place: Place,
  d: CoordsDB = db,
  photo?: PhotoData | null,
  /** 追加カテゴリ（省略＝変えない）。メインと同じ・ディメンション違い・重複・4 つ目以降は保存しない */
  subCategoryIds?: string[],
): Promise<void> {
  await d.transaction('rw', d.places, d.photos, d.placeCategories, d.categories, async () => {
    if (place.isHome) {
      await clearHome(place.worldId, place.dimension, place.id, d);
    }
    await d.places.put({ ...place, updatedAt: Date.now() });
    if (subCategoryIds !== undefined) {
      const cats = await d.categories.bulkGet(subCategoryIds);
      const ids: string[] = [];
      for (const c of cats) {
        if (!c || c.id === place.categoryId || c.dimension !== place.dimension || ids.includes(c.id)) continue;
        if (ids.length < MAX_SUB_CATEGORIES) ids.push(c.id);
      }
      await d.placeCategories.where('placeId').equals(place.id).delete();
      await d.placeCategories.bulkAdd(ids.map((categoryId, order) => ({ placeId: place.id, categoryId, order })));
    }
    if (photo === undefined) return;
    const existing = await d.photos.where('placeId').equals(place.id).count();
    if (photo && existing === 0 && (await d.photos.count()) >= MAX_PHOTOS) throw new PhotoLimitError();
    await d.photos.where('placeId').equals(place.id).delete();
    if (photo) {
      await d.photos.add({
        id: newId(),
        placeId: place.id,
        ...photo,
        bytes: photo.full.size + photo.thumb.size,
        createdAt: Date.now(),
      });
    }
  });
}

async function clearHome(worldId: string, dimension: Dimension, exceptId: string, d: CoordsDB) {
  await d.places
    .where('[worldId+dimension]')
    .equals([worldId, dimension])
    .filter((p) => p.isHome && p.id !== exceptId)
    .modify({ isHome: false });
}

export async function setHome(place: Place, d: CoordsDB = db): Promise<void> {
  await savePlace({ ...place, isHome: true }, d);
}

export async function deleteCategory(id: string, d: CoordsDB = db): Promise<boolean> {
  return d.transaction('rw', d.categories, d.places, d.placeCategories, async () => {
    const cat = await d.categories.get(id);
    if (!cat || cat.builtin) return false;
    if ((await d.places.where('categoryId').equals(id).count()) > 0) return false;
    // 追加として使われているか（画面と同じ規則で有効な行だけを数える。旧版の操作で無効になった行は数えない）
    const rows = await d.placeCategories.where('categoryId').equals(id).toArray();
    const placeIds = [...new Set(rows.map((r) => r.placeId))];
    const places = (await d.places.bulkGet(placeIds)).filter((p): p is Place => !!p);
    const allRows = await d.placeCategories.where('placeId').anyOf(placeIds).toArray();
    const categories = new Map((await d.categories.toArray()).map((c) => [c.id, c]));
    const subs = normalizeSubCategories(allRows, new Map(places.map((p) => [p.id, p])), categories);
    if ([...subs.values()].some((ids) => ids.includes(id))) return false;
    await d.placeCategories.where('categoryId').equals(id).delete();
    await d.categories.delete(id);
    return true;
  });
}

/**
 * 存在しない地点・カテゴリを指す追加カテゴリの行を消す（旧版で地点・ワールド・カテゴリを削除したときの後始末）。
 * それ以外の不整合（ディメンション違いなど）は読み込み時に normalizeSubCategories で無視する
 */
export async function cleanupPlaceCategories(d: CoordsDB = db): Promise<number> {
  return d.transaction('rw', d.placeCategories, d.places, d.categories, async () => {
    const placeIds = new Set((await d.places.toCollection().primaryKeys()) as string[]);
    const catIds = new Set((await d.categories.toCollection().primaryKeys()) as string[]);
    const stale = (await d.placeCategories.toArray()).filter((r) => !placeIds.has(r.placeId) || !catIds.has(r.categoryId));
    await d.placeCategories.bulkDelete(stale.map((r) => [r.placeId, r.categoryId] as [string, string]));
    return stale.length;
  });
}

export async function getMeta<T>(key: string, d: CoordsDB = db): Promise<T | undefined> {
  return (await d.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, d: CoordsDB = db): Promise<void> {
  await d.meta.put({ key, value });
}
