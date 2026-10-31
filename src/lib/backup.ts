import { MAX_PHOTOS, db, newId, type CoordsDB } from './db';
import { decodeBase64, encodeBase64, isCompleteJpeg, jpegSize } from './image-header';
import { FULL_MAX_BYTES, FULL_SIDE, THUMB_MAX_BYTES, THUMB_SIDE } from './photo-limits';
import { MAX_SUB_CATEGORIES, normalizeSubCategories, type PlaceCategory } from './subcategories';
import {
  CATEGORY_GROUPS,
  COORD_LIMIT,
  DIMENSIONS,
  type Category,
  type Place,
  type World,
} from './types';

export const BACKUP_APP = 'minecraft-coords';
/** 3: 地点の追加カテゴリ（places[].subCategoryIds）。2: 画像（photos）を含められる形式。1・2 も復元できる */
export const SCHEMA_VERSION = 3;
/** バックアップのファイルの上限（書き出し・復元とも） */
export const BACKUP_MAX_BYTES = 100 * 1024 * 1024;

export interface BackupPhoto {
  id: string;
  placeId: string;
  mime: 'image/jpeg';
  /** full の寸法 */
  width: number;
  height: number;
  full: string; // base64
  thumb: string; // base64
}

export type BackupPlace = Place & { subCategoryIds?: string[] };

export interface BackupData {
  app: typeof BACKUP_APP;
  schemaVersion: 1 | 2 | 3;
  exportedAt: string;
  worlds: World[];
  categories: Category[];
  places: BackupPlace[];
  photos?: BackupPhoto[];
}

/** 検証済みの復元データ（画像はバイト列にしてある） */
export interface RestorePhoto {
  id: string;
  placeId: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  full: Uint8Array;
  thumb: Uint8Array;
}
export interface RestoreData {
  worlds: World[];
  categories: Category[];
  places: Place[];
  photos: RestorePhoto[];
  placeCategories: PlaceCategory[];
}

export async function buildBackup(d: CoordsDB = db, opts: { includePhotos?: boolean } = {}): Promise<BackupData> {
  const data = await d.transaction('r', d.worlds, d.categories, d.places, d.photos, d.placeCategories, async () => ({
    worlds: await d.worlds.toArray(),
    categories: await d.categories.toArray(),
    places: await d.places.toArray(),
    photos: opts.includePhotos ? await d.photos.toArray() : [],
    placeCategories: await d.placeCategories.toArray(),
  }));
  // 追加カテゴリは画面と同じ規則で整えてから書き出す（旧版の操作で残った行で、復元できないバックアップにならないように）
  const subs = normalizeSubCategories(
    data.placeCategories,
    new Map(data.places.map((p) => [p.id, p])),
    new Map(data.categories.map((c) => [c.id, c])),
  );
  const backup: BackupData = {
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    worlds: data.worlds,
    categories: data.categories,
    places: data.places.map((p) => ({ ...p, subCategoryIds: subs.get(p.id) ?? [] })),
  };
  if (opts.includePhotos) {
    backup.photos = [];
    for (const p of data.photos) {
      backup.photos.push({
        id: p.id,
        placeId: p.placeId,
        mime: 'image/jpeg',
        width: p.width,
        height: p.height,
        full: encodeBase64(new Uint8Array(await p.full.arrayBuffer())),
        thumb: encodeBase64(new Uint8Array(await p.thumb.arrayBuffer())),
      });
    }
  }
  return backup;
}

/** 画像を含めたときのファイルの大きさの見込み（base64 で約 4/3 倍） */
export function estimateBackupBytes(photoBytes: number, placeCount: number): number {
  return Math.ceil((photoBytes * 4) / 3) + placeCount * 400 + 20_000;
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `minecraft-coords-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

export type ValidationResult = { ok: true; data: RestoreData } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max;
const isNonEmptyStr = (v: unknown, max = 500): v is string => isStr(v, max) && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** バックアップ JSON を検証する。1 つでも問題があれば取り込まない */
export function validateBackup(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(input) || input.app !== BACKUP_APP) {
    return { ok: false, errors: ['このアプリのバックアップファイルではありません'] };
  }
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2 && input.schemaVersion !== 3) {
    return { ok: false, errors: [`対応していない形式です（schemaVersion: ${String(input.schemaVersion)}）`] };
  }
  const { worlds, categories, places } = input;
  if (!Array.isArray(worlds) || !Array.isArray(categories) || !Array.isArray(places)) {
    return { ok: false, errors: ['worlds / categories / places が見つかりません'] };
  }
  if (worlds.length === 0) errors.push('ワールドが 1 つもありません');

  const worldIds = new Set<string>();
  worlds.forEach((w, i) => {
    if (!isObj(w) || !isNonEmptyStr(w.id, 100) || !isNonEmptyStr(w.name, 100) || !isNum(w.sortOrder) || !isNum(w.createdAt)) {
      errors.push(`ワールド ${i + 1} 件目の形式が正しくありません`);
      return;
    }
    if (worldIds.has(w.id)) errors.push(`ワールドの ID が重複しています（${w.id}）`);
    worldIds.add(w.id);
  });

  const categoryDims = new Map<string, string>();
  categories.forEach((c, i) => {
    if (
      !isObj(c) ||
      !isNonEmptyStr(c.id, 100) ||
      !oneOf(DIMENSIONS, c.dimension) ||
      !oneOf(CATEGORY_GROUPS, c.group) ||
      !isNonEmptyStr(c.name, 100) ||
      !isNonEmptyStr(c.icon, 20) ||
      !isBool(c.hidden) ||
      !isNum(c.sortOrder) ||
      !isBool(c.builtin)
    ) {
      errors.push(`カテゴリ ${i + 1} 件目の形式が正しくありません`);
      return;
    }
    if (categoryDims.has(c.id)) errors.push(`カテゴリの ID が重複しています（${c.id}）`);
    categoryDims.set(c.id, c.dimension);
  });

  const placeIds = new Set<string>();
  const homes = new Set<string>();
  const placeCategories: PlaceCategory[] = [];
  places.forEach((p, i) => {
    const label = `地点 ${i + 1} 件目`;
    if (
      !isObj(p) ||
      !isNonEmptyStr(p.id, 100) ||
      !isNonEmptyStr(p.worldId, 100) ||
      !oneOf(DIMENSIONS, p.dimension) ||
      !isNonEmptyStr(p.categoryId, 100) ||
      !isNonEmptyStr(p.name, 100) ||
      !isStr(p.memo, 2000) ||
      !isBool(p.visited) ||
      !isBool(p.isHome) ||
      !isNum(p.createdAt) ||
      !isNum(p.updatedAt)
    ) {
      errors.push(`${label}の形式が正しくありません`);
      return;
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      const v = p[axis];
      if (!isInt(v) || Math.abs(v) > COORD_LIMIT) errors.push(`${label}（${p.name}）の ${axis.toUpperCase()} 座標が整数ではありません`);
    }
    if (placeIds.has(p.id)) errors.push(`地点の ID が重複しています（${p.id}）`);
    placeIds.add(p.id);
    if (!worldIds.has(p.worldId)) errors.push(`${label}（${p.name}）のワールドが見つかりません`);
    const catDim = categoryDims.get(p.categoryId);
    if (catDim === undefined) errors.push(`${label}（${p.name}）のカテゴリが見つかりません`);
    else if (catDim !== p.dimension) errors.push(`${label}（${p.name}）のカテゴリとディメンションが一致しません`);
    if (input.schemaVersion === 3 && p.subCategoryIds !== undefined) {
      const subs = p.subCategoryIds;
      if (!Array.isArray(subs) || subs.length > MAX_SUB_CATEGORIES || !subs.every((x) => isNonEmptyStr(x, 100))) {
        errors.push(`${label}（${p.name}）の追加カテゴリの形式が正しくありません`);
      } else if (new Set(subs).size !== subs.length || subs.includes(p.categoryId)) {
        errors.push(`${label}（${p.name}）の追加カテゴリが重複しています`);
      } else if (subs.some((id) => categoryDims.get(id) !== p.dimension)) {
        errors.push(`${label}（${p.name}）の追加カテゴリが見つからないか、ディメンションが一致しません`);
      } else {
        (subs as string[]).forEach((categoryId, order) => placeCategories.push({ placeId: p.id as string, categoryId, order }));
      }
    }
    if (p.isHome) {
      const key = `${p.worldId}/${p.dimension}`;
      if (homes.has(key)) errors.push(`${label}（${p.name}）: 同じワールド・ディメンションに拠点が 2 つあります`);
      homes.add(key);
    }
  });

  const photos = validatePhotos(input.schemaVersion === 1 ? undefined : input.photos, placeIds, errors);

  if (errors.length > 0) return { ok: false, errors };
  // 既知の項目だけを取り出す（余分な項目は保存しない）
  const pick = <T,>(o: unknown, keys: (keyof T)[]) =>
    Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k as string]])) as T;
  return {
    ok: true,
    data: {
      photos,
      placeCategories,
      worlds: worlds.map((w) => pick<World>(w, ['id', 'name', 'sortOrder', 'createdAt'])),
      categories: categories.map((c) =>
        pick<Category>(c, ['id', 'dimension', 'group', 'name', 'icon', 'hidden', 'sortOrder', 'builtin']),
      ),
      places: places.map((p) =>
        pick<Place>(p, ['id', 'worldId', 'dimension', 'categoryId', 'name', 'x', 'y', 'z', 'memo', 'visited', 'isHome', 'createdAt', 'updatedAt']),
      ),
    },
  };
}

/**
 * photos の検証（v2）。中身が本当に JPEG か、寸法・大きさが上限内か、申告の寸法と一致するかを、
 * デコードせずにバイト列から確かめる（デコードしての確認は画面側で 1 枚ずつ行う）
 */
function validatePhotos(raw: unknown, placeIds: Set<string>, errors: string[]): RestorePhoto[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push('画像（photos）の形式が正しくありません');
    return [];
  }
  if (raw.length > MAX_PHOTOS) errors.push(`画像が ${MAX_PHOTOS} 枚を超えています`);
  if (raw.length > placeIds.size) errors.push('画像が地点の数より多くあります');
  const out: RestorePhoto[] = [];
  const ids = new Set<string>();
  const owners = new Set<string>();
  raw.forEach((p, i) => {
    const label = `画像 ${i + 1} 件目`;
    if (
      !isObj(p) ||
      !isNonEmptyStr(p.id, 100) ||
      !isNonEmptyStr(p.placeId, 100) ||
      p.mime !== 'image/jpeg' ||
      !isInt(p.width) ||
      !isInt(p.height) ||
      typeof p.full !== 'string' ||
      typeof p.thumb !== 'string'
    ) {
      errors.push(`${label}の形式が正しくありません`);
      return;
    }
    if (ids.has(p.id)) errors.push(`画像の ID が重複しています（${p.id}）`);
    ids.add(p.id);
    if (!placeIds.has(p.placeId)) errors.push(`${label}の地点が見つかりません`);
    if (owners.has(p.placeId)) errors.push(`${label}: 1 つの地点に画像が 2 枚あります`);
    owners.add(p.placeId);
    const full = decodeBase64(p.full);
    const thumb = decodeBase64(p.thumb);
    if (!full || !thumb) {
      errors.push(`${label}のデータが壊れています`);
      return;
    }
    if (full.length > FULL_MAX_BYTES || thumb.length > THUMB_MAX_BYTES) {
      errors.push(`${label}が大きすぎます`);
      return;
    }
    const fs = isCompleteJpeg(full) ? jpegSize(full) : null;
    const ts = isCompleteJpeg(thumb) ? jpegSize(thumb) : null;
    if (!fs || !ts) {
      errors.push(`${label}は JPEG 画像ではありません`);
      return;
    }
    if (fs.width !== p.width || fs.height !== p.height || Math.max(fs.width, fs.height) > FULL_SIDE) {
      errors.push(`${label}の寸法が正しくありません`);
      return;
    }
    if (Math.max(ts.width, ts.height) > THUMB_SIDE) {
      errors.push(`${label}の小さい画像の寸法が正しくありません`);
      return;
    }
    out.push({ id: p.id, placeId: p.placeId, width: fs.width, height: fs.height, thumbWidth: ts.width, thumbHeight: ts.height, full, thumb });
  });
  return out;
}

/**
 * 検証済みデータで全置換する（ワールド・カテゴリ・地点・画像）。画像を含まないバックアップから戻すと、今ある画像も消える。
 * 途中で失敗したらトランザクションごと取り消され、既存データは残る
 */
export async function replaceAll(data: RestoreData, d: CoordsDB = db): Promise<void> {
  const now = Date.now();
  const photos = data.photos.map((p) => {
    const full = new Blob([p.full as BlobPart], { type: 'image/jpeg' });
    const thumb = new Blob([p.thumb as BlobPart], { type: 'image/jpeg' });
    return { id: p.id || newId(), placeId: p.placeId, full, thumb, width: p.width, height: p.height, bytes: full.size + thumb.size, createdAt: now };
  });
  await d.transaction('rw', d.worlds, d.categories, d.places, d.photos, d.placeCategories, async () => {
    await d.placeCategories.clear();
    await d.photos.clear();
    await d.places.clear();
    await d.categories.clear();
    await d.worlds.clear();
    await d.worlds.bulkAdd(data.worlds);
    await d.categories.bulkAdd(data.categories);
    await d.places.bulkAdd(data.places);
    await d.photos.bulkAdd(photos);
    await d.placeCategories.bulkAdd(data.placeCategories);
  });
}

/** JSON テキストを検証する（取り込みは確認後に replaceAll で行う） */
export function parseBackupText(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSON として読み込めませんでした'] };
  }
  return validateBackup(parsed);
}
