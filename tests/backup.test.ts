import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, parseBackupText, replaceAll, validateBackup, type BackupData } from '../src/lib/backup';
import { CoordsDB, autoName, deleteWorld, ensureSeed, savePlace } from '../src/lib/db';
import type { Place } from '../src/lib/types';

let d: CoordsDB;
let n = 0;

const place = (worldId: string, extra: Partial<Place> = {}): Place => ({
  id: `p${++n}`, worldId, dimension: 'overworld', categoryId: 'ow-village', name: `村 #${n}`,
  x: 100, y: 64, z: -200, memo: '', visited: true, isHome: false, createdAt: n, updatedAt: n, ...extra,
});

async function snapshot() {
  const b = await buildBackup(d);
  return { worlds: b.worlds, categories: b.categories, places: b.places };
}

beforeEach(async () => {
  d = new CoordsDB(`test-${Math.random()}`);
  await ensureSeed(d);
});
afterEach(async () => {
  d.close();
  await d.delete();
});

describe('拠点の一意性', () => {
  it('同じワールド×ディメンションの拠点は 1 つだけ', async () => {
    const w = (await d.worlds.toArray())[0].id;
    await savePlace(place(w, { id: 'a', isHome: true }), d);
    await savePlace(place(w, { id: 'b', isHome: true }), d);
    await savePlace(place(w, { id: 'c', isHome: true, dimension: 'nether', categoryId: 'ne-home' }), d);
    const homes = (await d.places.toArray()).filter((p) => p.isHome).map((p) => p.id).sort();
    expect(homes).toEqual(['b', 'c']);
  });
});

describe('ワールド削除', () => {
  it('そのワールドの地点も消える', async () => {
    const w = (await d.worlds.toArray())[0].id;
    await savePlace(place(w), d);
    await savePlace(place('other'), d);
    await deleteWorld(w, d);
    expect((await d.places.toArray()).map((p) => p.worldId)).toEqual(['other']);
  });
});

describe('autoName', () => {
  it('カテゴリ名 #連番', async () => {
    const w = (await d.worlds.toArray())[0].id;
    const cat = (await d.categories.get('ow-village'))!;
    expect(await autoName(w, cat, d)).toBe('村 #1');
    await savePlace(place(w, { name: '村 #5' }), d);
    expect(await autoName(w, cat, d)).toBe('村 #6');
  });
});

describe('バックアップ', () => {
  it('書き出し→全削除→復元で一致', async () => {
    const w = (await d.worlds.toArray())[0].id;
    await savePlace(place(w, { isHome: true, memo: 'メモ' }), d);
    await savePlace(place(w, { dimension: 'nether', categoryId: 'ne-fortress', x: -5 }), d);
    const before = await snapshot();
    const text = JSON.stringify(await buildBackup(d));
    await d.places.clear();
    await d.worlds.clear();
    const parsed = parseBackupText(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) await replaceAll(parsed.data, d);
    expect(await snapshot()).toEqual(before);
  });

  describe('不正な入力は拒否し、既存データは変わらない', () => {
    let valid: BackupData;
    beforeEach(async () => {
      const w = (await d.worlds.toArray())[0].id;
      await savePlace(place(w, { isHome: true }), d);
      valid = await buildBackup(d);
    });
    const cases: [string, (b: any) => unknown][] = [
      ['JSON でない', () => 'not json'],
      ['別アプリ', (b) => ({ ...b, app: 'other' })],
      ['未対応バージョン', (b) => ({ ...b, schemaVersion: 99 })],
      ['座標が小数', (b) => ({ ...b, places: [{ ...b.places[0], x: 1.5 }] })],
      ['座標が文字列', (b) => ({ ...b, places: [{ ...b.places[0], y: '64' }] })],
      ['ID 重複', (b) => ({ ...b, places: [b.places[0], b.places[0]] })],
      ['存在しないワールド', (b) => ({ ...b, places: [{ ...b.places[0], worldId: 'none' }] })],
      ['存在しないカテゴリ', (b) => ({ ...b, places: [{ ...b.places[0], categoryId: 'none' }] })],
      ['カテゴリとディメンション不一致', (b) => ({ ...b, places: [{ ...b.places[0], dimension: 'nether' }] })],
      ['拠点が 2 つ', (b) => ({ ...b, places: [b.places[0], { ...b.places[0], id: 'dup' }] })],
      ['ワールドなし', (b) => ({ ...b, worlds: [], places: [] })],
    ];
    for (const [name, mutate] of cases) {
      it(name, async () => {
        const before = await snapshot();
        const input = mutate(structuredClone(valid));
        const result = typeof input === 'string' ? parseBackupText(input) : validateBackup(input);
        expect(result.ok).toBe(false);
        expect(await snapshot()).toEqual(before);
      });
    }
  });

  it('余分な項目は取り除く', () => {
    const r = validateBackup({ app: 'minecraft-coords', schemaVersion: 1, exportedAt: '', worlds: [{ id: 'w', name: 'W', sortOrder: 0, createdAt: 0, evil: 1 }], categories: [], places: [] });
    expect(r.ok && r.data.worlds[0]).toEqual({ id: 'w', name: 'W', sortOrder: 0, createdAt: 0 });
  });

  it('置換の途中で失敗したら既存データは残る', async () => {
    const w = (await d.worlds.toArray())[0].id;
    await savePlace(place(w), d);
    const before = await snapshot();
    const data = await buildBackup(d);
    data.places = [{ ...data.places[0], id: 'new' }];
    const spy = vi.spyOn(d.places, 'bulkAdd').mockRejectedValueOnce(new Error('boom'));
    await expect(replaceAll(data, d)).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await snapshot()).toEqual(before);
  });
});

describe('大きなバックアップ', () => {
  it('10MB を超えるバックアップも書き出し→復元できる', async () => {
    const w = (await d.worlds.toArray())[0].id;
    const memo = 'あ'.repeat(2000);
    await d.places.bulkAdd(Array.from({ length: 2000 }, (_, i) => place(w, { id: `big${i}`, name: `地点 ${i}`, memo })));
    const before = await snapshot();
    const text = JSON.stringify(await buildBackup(d));
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(10 * 1024 * 1024);
    await d.places.clear();
    const parsed = parseBackupText(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) await replaceAll(parsed.data, d);
    expect(await snapshot()).toEqual(before);
  });
});
