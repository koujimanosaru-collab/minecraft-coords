import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoordsDB, MAX_PHOTOS, PhotoLimitError, dbNameFor, deletePlace, deleteWorld, ensureSeed, photoStats, savePlace, type PhotoData } from '../src/lib/db';
import type { Place } from '../src/lib/types';

const jpeg = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
const photo = (n = 100): PhotoData => ({ full: jpeg(n), thumb: jpeg(10), width: 1280, height: 960 });
let d: CoordsDB;
let w: string;
let k = 0;
const place = (extra: Partial<Place> = {}): Place => ({
  id: `p${++k}`, worldId: w, dimension: 'overworld', categoryId: 'ow-village', name: `村 #${k}`,
  x: 1, y: 64, z: 1, memo: '', visited: true, isHome: false, createdAt: k, updatedAt: k, ...extra,
});

beforeEach(async () => {
  d = new CoordsDB(`photos-${Math.random()}`);
  await ensureSeed(d);
  w = (await d.worlds.toArray())[0].id;
});
afterEach(async () => {
  d.close();
  await d.delete();
});

describe('DB の更新（version 1 → 2）', () => {
  it('既存のデータを保ったまま画像テーブルが増える', async () => {
    const name = `upgrade-${Math.random()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ worlds: 'id, sortOrder', categories: 'id, dimension, sortOrder', places: 'id, worldId, [worldId+dimension], categoryId', meta: 'key' });
    await v1.table('worlds').add({ id: 'w1', name: 'W', sortOrder: 0, createdAt: 0 });
    await v1.table('places').add({ ...place(), id: 'old', worldId: 'w1' });
    v1.close();
    const v2 = new CoordsDB(name);
    expect(await v2.places.get('old')).toBeTruthy();
    expect(await v2.worlds.count()).toBe(1);
    expect(await v2.photos.count()).toBe(0);
    v2.close();
    await Dexie.delete(name);
  });
});

describe('試験モードの DB', () => {
  it('?selftest=1 のときだけ別の DB 名', () => {
    expect(dbNameFor('')).toBe('minecraft-coords');
    expect(dbNameFor('?x=1')).toBe('minecraft-coords');
    expect(dbNameFor('?selftest=1')).toBe('minecraft-coords-selftest');
  });
});

describe('地点の画像', () => {
  it('付ける・差し替える・外す（1 地点 1 枚）', async () => {
    const p = place();
    await savePlace(p, d, photo(100));
    await savePlace(p, d, photo(200));
    let ps = await d.photos.toArray();
    expect(ps).toHaveLength(1);
    expect(ps[0].bytes).toBe(210);
    await savePlace(p, d); // 省略は変更なし
    expect(await d.photos.count()).toBe(1);
    await savePlace(p, d, null);
    ps = await d.photos.toArray();
    expect(ps).toHaveLength(0);
  });

  it('地点・ワールドの削除で画像も消える', async () => {
    const a = place();
    const b = place();
    await savePlace(a, d, photo());
    await savePlace(b, d, photo());
    await deletePlace(a.id, d);
    expect((await d.photos.toArray()).map((x) => x.placeId)).toEqual([b.id]);
    await deleteWorld(w, d);
    expect(await d.photos.count()).toBe(0);
    expect(await d.places.count()).toBe(0);
  });

  it(`${MAX_PHOTOS} 枚を超えて付けられない（地点も保存されない）`, async () => {
    await d.photos.bulkAdd(Array.from({ length: MAX_PHOTOS }, (_, i) => ({ id: `ph${i}`, placeId: `x${i}`, full: jpeg(1), thumb: jpeg(1), width: 1, height: 1, bytes: 2, createdAt: 0 })));
    const p = place();
    await expect(savePlace(p, d, photo())).rejects.toBeInstanceOf(PhotoLimitError);
    expect(await d.places.get(p.id)).toBeUndefined();
    // 既に画像がある地点の差し替えはできる
    await d.photos.update('ph0', { placeId: p.id });
    await savePlace(p, d, photo());
    expect(await d.photos.count()).toBe(MAX_PHOTOS);
  });

  it('画像の保存に失敗したら地点も変わらない', async () => {
    const p = place({ name: '元の名前' });
    await savePlace(p, d);
    const spy = vi.spyOn(d.photos, 'add').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(savePlace({ ...p, name: '新しい名前' }, d, photo())).rejects.toThrow();
    spy.mockRestore();
    expect((await d.places.get(p.id))!.name).toBe('元の名前');
    expect(await d.photos.count()).toBe(0);
  });

  it('枚数と合計バイト数', async () => {
    await savePlace(place(), d, photo(100));
    await savePlace(place(), d, photo(300));
    expect(await photoStats(d)).toEqual({ count: 2, bytes: 420 });
  });
});

describe('容量不足の判定', () => {
  it('Dexie に包まれたエラー・BulkError の中の容量不足も見分ける', async () => {
    const { isQuotaError } = await import('../src/lib/db');
    expect(isQuotaError(new Dexie.QuotaExceededError('full'))).toBe(true);
    expect(isQuotaError(new Dexie.AbortError('aborted', new Dexie.QuotaExceededError('full')))).toBe(true);
    expect(isQuotaError(new Dexie.BulkError('bulk', [new Dexie.QuotaExceededError('full')]))).toBe(true);
    expect(isQuotaError(new Dexie.AbortError('aborted'))).toBe(false);
    expect(isQuotaError(new Error('x'))).toBe(false);
  });

  it('画像の保存で Dexie の容量不足が起きても判定でき、地点は変わらない', async () => {
    const { isQuotaError } = await import('../src/lib/db');
    const p = place({ name: '元' });
    await savePlace(p, d);
    const spy = vi.spyOn(d.photos, 'add').mockRejectedValueOnce(new Dexie.QuotaExceededError('full'));
    const err = await savePlace({ ...p, name: '新' }, d, photo()).catch((e) => e);
    spy.mockRestore();
    expect(isQuotaError(err)).toBe(true);
    expect((await d.places.get(p.id))!.name).toBe('元');
  });
});
