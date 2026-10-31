import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, parseBackupText, replaceAll, validateBackup, type BackupData } from '../src/lib/backup';
import { CoordsDB, ensureSeed, newId, savePlace } from '../src/lib/db';
import type { Place } from '../src/lib/types';

let d: CoordsDB;
let w: string;
const P = (extra: Partial<Place> = {}): Place => ({
  id: newId(), worldId: w, dimension: 'overworld', categoryId: 'ow-home', name: '拠点', x: 0, y: 64, z: 0, memo: '', visited: true, isHome: false, createdAt: 0, updatedAt: 0, ...extra,
});
const subsOf = async (placeId: string) => (await d.placeCategories.where('placeId').equals(placeId).sortBy('order')).map((r) => r.categoryId);

beforeEach(async () => {
  d = new CoordsDB(`bs-${Math.random()}`);
  await ensureSeed(d);
  w = (await d.worlds.toArray())[0].id;
});
afterEach(async () => {
  d.close();
  await d.delete();
});

describe('バックアップ v3（追加カテゴリ）', () => {
  it('書き出し→全削除→復元で追加カテゴリも一致（順番も）', async () => {
    const a = P();
    await savePlace(a, d, undefined, ['ow-village', 'ow-portal']);
    const text = JSON.stringify(await buildBackup(d));
    await d.placeCategories.clear();
    await d.places.clear();
    const r = parseBackupText(text);
    expect(r.ok).toBe(true);
    if (r.ok) await replaceAll(r.data, d);
    expect(await subsOf(a.id)).toEqual(['ow-village', 'ow-portal']);
  });

  it('v1・v2 の復元では追加カテゴリなし（今ある追加も消える）', async () => {
    const a = P();
    await savePlace(a, d, undefined, ['ow-village']);
    const b = await buildBackup(d);
    for (const v of [1, 2] as const) {
      const r = validateBackup({ ...b, schemaVersion: v, places: b.places.map(({ subCategoryIds: _x, ...p }) => p) });
      expect(r.ok).toBe(true);
      if (r.ok) await replaceAll(r.data, d);
      expect(await subsOf(a.id)).toEqual([]);
    }
  });

  it('旧版で地点のディメンションを変えた後でも、書き出したバックアップを検証・復元できる', async () => {
    const a = P();
    await savePlace(a, d, undefined, ['ow-village']);
    await d.places.put({ ...a, dimension: 'nether', categoryId: 'ne-home' }); // 旧版の編集（追加の行は残る）
    const r = parseBackupText(JSON.stringify(await buildBackup(d)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      await replaceAll(r.data, d);
      expect(await subsOf(a.id)).toEqual([]);
    }
  });

  it('旧版の復元で混入した追加は、新版で同じバックアップを復元し直すと消える', async () => {
    const a = P();
    await savePlace(a, d);
    const backup = await buildBackup(d); // 追加なしの時点
    await savePlace(a, d, undefined, ['ow-village']); // その後に追加を付ける
    // 旧版の replaceAll 相当（placeCategories に触れない）
    await d.transaction('rw', d.worlds, d.categories, d.places, d.photos, async () => {
      await d.places.clear();
      await d.places.bulkAdd(backup.places.map(({ subCategoryIds: _x, ...p }) => p));
    });
    expect(await subsOf(a.id)).toEqual(['ow-village']); // 混入する（既知の制限）
    const r = validateBackup(backup);
    if (!r.ok) throw new Error('invalid');
    await replaceAll(r.data, d);
    expect(await subsOf(a.id)).toEqual([]); // 新版の復元で回復
  });

  describe('不正な追加カテゴリは拒否し、既存データは変わらない', () => {
    let valid: BackupData;
    beforeEach(async () => {
      await savePlace(P(), d, undefined, ['ow-village']);
      valid = await buildBackup(d);
    });
    const withSubs = (b: BackupData, subs: unknown) => ({ ...b, places: [{ ...b.places[0], subCategoryIds: subs }] });
    const cases: [string, unknown][] = [
      ['4 件', ['ow-village', 'ow-portal', 'ow-farm', 'ow-marker']],
      ['重複', ['ow-village', 'ow-village']],
      ['メインと同じ', ['ow-home']],
      ['存在しない', ['none']],
      ['ディメンション違い', ['ne-fortress']],
      ['配列でない', 'ow-village'],
      ['文字列でない', [1]],
    ];
    for (const [name, subs] of cases) {
      it(name, async () => {
        const before = await d.placeCategories.toArray();
        expect(validateBackup(withSubs(structuredClone(valid), subs)).ok).toBe(false);
        expect(await d.placeCategories.toArray()).toEqual(before);
      });
    }
  });
});
