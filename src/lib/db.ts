import Dexie, { type EntityTable } from 'dexie';
import { builtinCategories } from './categories';
import type { Category, Dimension, Place, World } from './types';

export interface Meta {
  key: string;
  value: unknown;
}

export class CoordsDB extends Dexie {
  worlds!: EntityTable<World, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  places!: EntityTable<Place, 'id'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor(name = 'minecraft-coords') {
    super(name);
    this.version(1).stores({
      worlds: 'id, sortOrder',
      categories: 'id, dimension, sortOrder',
      places: 'id, worldId, [worldId+dimension], categoryId',
      meta: 'key',
    });
  }
}

export const db = new CoordsDB();

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
  await d.transaction('rw', d.worlds, d.places, async () => {
    await d.places.where('worldId').equals(id).delete();
    await d.worlds.delete(id);
  });
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

/** 地点を保存。拠点にした場合は同じワールド×ディメンションの他の拠点を外す */
export async function savePlace(place: Place, d: CoordsDB = db): Promise<void> {
  await d.transaction('rw', d.places, async () => {
    if (place.isHome) {
      await clearHome(place.worldId, place.dimension, place.id, d);
    }
    await d.places.put({ ...place, updatedAt: Date.now() });
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
  return d.transaction('rw', d.categories, d.places, async () => {
    const used = await d.places.where('categoryId').equals(id).count();
    const cat = await d.categories.get(id);
    if (used > 0 || !cat || cat.builtin) return false;
    await d.categories.delete(id);
    return true;
  });
}

export async function getMeta<T>(key: string, d: CoordsDB = db): Promise<T | undefined> {
  return (await d.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, d: CoordsDB = db): Promise<void> {
  await d.meta.put({ key, value });
}
