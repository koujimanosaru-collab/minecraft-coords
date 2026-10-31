import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinCategories } from '../src/lib/categories';
import { CoordsDB, cleanupPlaceCategories, deleteCategory, deletePlace, deleteWorld, ensureSeed, newId, savePlace } from '../src/lib/db';
import { countByCategory, filterAndSort, DEFAULT_FILTER } from '../src/lib/places';
import { makeMain, mapSelection, normalizeSubCategories, removeCategory, tapCategory, type CategorySelection } from '../src/lib/subcategories';
import type { Category, Place } from '../src/lib/types';
import Dexie from 'dexie';

const cats = builtinCategories();
const catMap = new Map(cats.map((c) => [c.id, c]));
const sel = (main: string, subs: string[] = []): CategorySelection => ({ main, subs });

describe('選び方', () => {
  it('メイン→追加（3 つまで）', () => {
    let s = sel('');
    s = tapCategory(s, 'ow-home').sel;
    s = tapCategory(s, 'ow-village').sel;
    s = tapCategory(s, 'ow-portal').sel;
    s = tapCategory(s, 'ow-farm').sel;
    expect(s).toEqual(sel('ow-home', ['ow-village', 'ow-portal', 'ow-farm']));
    const r = tapCategory(s, 'ow-marker');
    expect(r.full).toBe(true);
    expect(r.sel).toEqual(s);
  });
  it('追加を押すと外れる・メインを押すと追加の先頭が繰り上がる', () => {
    expect(tapCategory(sel('a', ['b', 'c']), 'b').sel).toEqual(sel('a', ['c']));
    expect(tapCategory(sel('a', ['b', 'c']), 'a').sel).toEqual(sel('b', ['c']));
    expect(tapCategory(sel('a'), 'a').sel).toEqual(sel(''));
  });
  it('メインにする・外す', () => {
    expect(makeMain(sel('a', ['b', 'c']), 'c')).toEqual(sel('c', ['a', 'b']));
    expect(makeMain(sel('a', ['b']), 'x')).toEqual(sel('a', ['b']));
    expect(removeCategory(sel('a', ['b']), 'b')).toEqual(sel('a'));
    expect(removeCategory(sel('a', ['b']), 'a')).toEqual(sel('b'));
  });
});

describe('ディメンションの切り替え', () => {
  it('同名 1 件なら引き継ぎ、なければ外す', () => {
    expect(mapSelection(sel('ow-home', ['ow-village', 'ow-portal']), cats, 'nether')).toEqual(sel('ne-home', ['ne-portal']));
  });
  it('メインが引き継げず追加が引き継げたら繰り上げ', () => {
    expect(mapSelection(sel('ow-village', ['ow-home', 'ow-portal']), cats, 'nether')).toEqual(sel('ne-home', ['ne-portal']));
  });
  it('どれも引き継げなければメインは未選択', () => {
    expect(mapSelection(sel('ow-village', ['ow-desert']), cats, 'nether')).toEqual(sel(''));
  });
  it('非表示・同名複数は引き継がない、重複は除く', () => {
    const hidden = cats.map((c) => (c.id === 'ne-portal' ? { ...c, hidden: true } : c));
    expect(mapSelection(sel('ow-home', ['ow-portal']), hidden, 'nether')).toEqual(sel('ne-home'));
    const dup: Category = { ...catMap.get('ne-marker')!, id: 'ne-marker-2', builtin: false };
    expect(mapSelection(sel('ow-home', ['ow-marker']), [...cats, dup], 'nether')).toEqual(sel('ne-home'));
    expect(mapSelection(sel('ow-home', ['ow-other', 'ow-other']), cats, 'end')).toEqual(sel('en-home', ['en-other']));
  });
});

const P = (id: string, extra: Partial<Place> = {}): Place => ({
  id, worldId: 'w', dimension: 'overworld', categoryId: 'ow-home', name: id, x: 0, y: 64, z: 0, memo: '', visited: true, isHome: false, createdAt: 0, updatedAt: 0, ...extra,
});

describe('normalizeSubCategories', () => {
  it('存在しない地点・カテゴリ、メインと同じ、ディメンション違い、重複、4 件目以降を除く', () => {
    const places = new Map([['a', P('a')], ['n', P('n', { dimension: 'nether', categoryId: 'ne-home' })]]);
    const rows = [
      { placeId: 'a', categoryId: 'ow-portal', order: 1 },
      { placeId: 'a', categoryId: 'ow-village', order: 0 },
      { placeId: 'a', categoryId: 'ow-home', order: 2 }, // メインと同じ
      { placeId: 'a', categoryId: 'ne-fortress', order: 3 }, // ディメンション違い
      { placeId: 'a', categoryId: 'gone', order: 4 }, // 存在しない
      { placeId: 'a', categoryId: 'ow-farm', order: 5 },
      { placeId: 'a', categoryId: 'ow-marker', order: 6 }, // 4 件目
      { placeId: 'zzz', categoryId: 'ow-farm', order: 0 }, // 存在しない地点
      { placeId: 'n', categoryId: 'ow-village', order: 0 }, // 旧版でディメンションが変わった地点
    ];
    const m = normalizeSubCategories(rows, places, catMap);
    expect(m.get('a')).toEqual(['ow-village', 'ow-portal', 'ow-farm']);
    expect(m.has('n')).toBe(false);
    expect(m.has('zzz')).toBe(false);
  });
});

describe('絞り込み・件数', () => {
  const places = [P('a'), P('b', { categoryId: 'ow-village' })];
  const subs = new Map([['a', ['ow-village', 'ow-portal']]]);
  it('追加カテゴリでも一致', () => {
    expect(filterAndSort(places, { ...DEFAULT_FILTER, categoryIds: ['ow-portal'] }, null, subs).map((p) => p.id)).toEqual(['a']);
    expect(filterAndSort(places, { ...DEFAULT_FILTER, categoryIds: ['ow-village'], sort: 'name' }, null, subs).map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('件数は追加も数え、同じ地点を 2 回数えない', () => {
    const c = countByCategory(places, subs);
    expect(c.get('ow-village')).toBe(2);
    expect(c.get('ow-home')).toBe(1);
    expect(c.get('ow-portal')).toBe(1);
  });
});

describe('DB', () => {
  let d: CoordsDB;
  let w: string;
  beforeEach(async () => {
    d = new CoordsDB(`sub-${Math.random()}`);
    await ensureSeed(d);
    w = (await d.worlds.toArray())[0].id;
  });
  afterEach(async () => {
    d.close();
    await d.delete();
  });
  const rows = async (placeId: string) => (await d.placeCategories.where('placeId').equals(placeId).sortBy('order')).map((r) => r.categoryId);

  it('DB の更新 v2→v3: 地点・画像は残り、追加はなし', async () => {
    const name = `up-${Math.random()}`;
    const v2 = new Dexie(name);
    v2.version(1).stores({ worlds: 'id, sortOrder', categories: 'id, dimension, sortOrder', places: 'id, worldId, [worldId+dimension], categoryId', meta: 'key' });
    v2.version(2).stores({ photos: 'id, placeId' });
    await v2.table('places').add(P('old'));
    await v2.table('photos').add({ id: 'ph', placeId: 'old', full: new Blob(['x']), thumb: new Blob(['y']), width: 1, height: 1, bytes: 2, createdAt: 0 });
    v2.close();
    const v3 = new CoordsDB(name);
    expect(await v3.places.get('old')).toBeTruthy();
    expect(await v3.photos.count()).toBe(1);
    expect(await v3.placeCategories.count()).toBe(0);
    v3.close();
    await Dexie.delete(name);
  });

  it('保存: メインと同じ・ディメンション違い・重複・4 つ目以降は保存しない／省略は変えない', async () => {
    const p = P(newId(), { worldId: w });
    await savePlace(p, d, undefined, ['ow-village', 'ow-home', 'ne-fortress', 'ow-village', 'ow-portal', 'ow-farm', 'ow-marker']);
    expect(await rows(p.id)).toEqual(['ow-village', 'ow-portal', 'ow-farm']);
    await savePlace({ ...p, name: '改名' }, d);
    expect(await rows(p.id)).toEqual(['ow-village', 'ow-portal', 'ow-farm']);
    await savePlace(p, d, undefined, []);
    expect(await rows(p.id)).toEqual([]);
  });

  it('地点・ワールドの削除で追加も消える', async () => {
    const a = P(newId(), { worldId: w });
    const b = P(newId(), { worldId: w });
    await savePlace(a, d, undefined, ['ow-village']);
    await savePlace(b, d, undefined, ['ow-portal']);
    await deletePlace(a.id, d);
    expect(await d.placeCategories.count()).toBe(1);
    await deleteWorld(w, d);
    expect(await d.placeCategories.count()).toBe(0);
  });

  it('追加として使われているカテゴリは削除できない', async () => {
    await d.categories.add({ ...catMap.get('ow-other')!, id: 'mine', builtin: false, name: '自作' });
    const p = P(newId(), { worldId: w });
    await savePlace(p, d, undefined, ['mine']);
    expect(await deleteCategory('mine', d)).toBe(false);
    await savePlace(p, d, undefined, []);
    expect(await deleteCategory('mine', d)).toBe(true);
  });

  it('無効になった追加の行だけなら、カテゴリを削除できる（旧版でディメンションを変えた後）', async () => {
    await d.categories.add({ ...catMap.get('ow-other')!, id: 'mine', builtin: false, name: '自作' });
    const p = P(newId(), { worldId: w });
    await savePlace(p, d, undefined, ['mine']);
    await d.places.put({ ...p, dimension: 'nether', categoryId: 'ne-home' }); // 旧版でディメンションを変更
    const places = new Map([[p.id, { ...p, dimension: 'nether' as const, categoryId: 'ne-home' }]]);
    const cm = new Map((await d.categories.toArray()).map((c) => [c.id, c]));
    expect(countByCategory([...places.values()], normalizeSubCategories(await d.placeCategories.toArray(), places, cm)).get('mine')).toBeUndefined();
    expect(await deleteCategory('mine', d)).toBe(true);
    expect(await d.placeCategories.count()).toBe(0);
  });

  describe('旧版（dfca9e7）の操作との共存', () => {
    it('旧版の地点の上書き（put）では追加は消えない', async () => {
      const p = P(newId(), { worldId: w });
      await savePlace(p, d, undefined, ['ow-village']);
      await d.places.put({ ...p, name: '旧版で編集' }); // 旧版は places だけを書き換える
      expect(await rows(p.id)).toEqual(['ow-village']);
    });
    it('旧版の地点削除・カテゴリ削除の後は、掃除で消える', async () => {
      await d.categories.add({ ...catMap.get('ow-other')!, id: 'mine', builtin: false, name: '自作' });
      const a = P(newId(), { worldId: w });
      const b = P(newId(), { worldId: w });
      await savePlace(a, d, undefined, ['ow-village']);
      await savePlace(b, d, undefined, ['mine', 'ow-portal']);
      await d.places.delete(a.id); // 旧版の地点削除
      await d.categories.delete('mine'); // 旧版のカテゴリ削除（追加の使用を確かめない）
      expect(await cleanupPlaceCategories(d)).toBe(2);
      expect(await rows(b.id)).toEqual(['ow-portal']);
    });
  });
});
