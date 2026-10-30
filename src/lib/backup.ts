import { db, type CoordsDB } from './db';
import {
  CATEGORY_GROUPS,
  COORD_LIMIT,
  DIMENSIONS,
  type Category,
  type Place,
  type World,
} from './types';

export const BACKUP_APP = 'minecraft-coords';
export const SCHEMA_VERSION = 1;

export interface BackupData {
  app: typeof BACKUP_APP;
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  worlds: World[];
  categories: Category[];
  places: Place[];
}

export async function buildBackup(d: CoordsDB = db): Promise<BackupData> {
  return d.transaction('r', d.worlds, d.categories, d.places, async () => ({
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    worlds: await d.worlds.toArray(),
    categories: await d.categories.toArray(),
    places: await d.places.toArray(),
  }));
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `minecraft-coords-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

export type ValidationResult = { ok: true; data: BackupData } | { ok: false; errors: string[] };

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
  if (input.schemaVersion !== SCHEMA_VERSION) {
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
    if (p.isHome) {
      const key = `${p.worldId}/${p.dimension}`;
      if (homes.has(key)) errors.push(`${label}（${p.name}）: 同じワールド・ディメンションに拠点が 2 つあります`);
      homes.add(key);
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  // 既知の項目だけを取り出す（余分な項目は保存しない）
  const pick = <T,>(o: unknown, keys: (keyof T)[]) =>
    Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k as string]])) as T;
  return {
    ok: true,
    data: {
      app: BACKUP_APP,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: isStr(input.exportedAt, 100) ? input.exportedAt : '',
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

/** 検証済みデータで全置換する。途中で失敗したらトランザクションごと取り消され、既存データは残る */
export async function replaceAll(data: BackupData, d: CoordsDB = db): Promise<void> {
  await d.transaction('rw', d.worlds, d.categories, d.places, async () => {
    await d.places.clear();
    await d.categories.clear();
    await d.worlds.clear();
    await d.worlds.bulkAdd(data.worlds);
    await d.categories.bulkAdd(data.categories);
    await d.places.bulkAdd(data.places);
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
