import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackup, estimateBackupBytes, parseBackupText, replaceAll, validateBackup, type BackupData } from '../src/lib/backup';
import { CoordsDB, ensureSeed, savePlace } from '../src/lib/db';
import { encodeBase64 } from '../src/lib/image-header';
import type { Place } from '../src/lib/types';
import { fakeJpeg } from './helpers/jpeg';

const blob = (b: Uint8Array) => new Blob([b as BlobPart], { type: 'image/jpeg' });
let d: CoordsDB;
let w: string;
let n = 0;
const place = (extra: Partial<Place> = {}): Place => ({
  id: `p${++n}`, worldId: w, dimension: 'overworld', categoryId: 'ow-village', name: `村 #${n}`,
  x: 1, y: 64, z: 1, memo: '', visited: true, isHome: false, createdAt: n, updatedAt: n, ...extra,
});
const addWithPhoto = async (fw = 1280, fh = 960) => {
  const p = place();
  await savePlace(p, d, { full: blob(fakeJpeg(fw, fh, { body: 500 })), thumb: blob(fakeJpeg(320, 240)), width: fw, height: fh });
  return p;
};
async function snapshot() {
  const photos = await d.photos.toArray();
  return {
    places: await d.places.toArray(),
    photos: await Promise.all(photos.map(async (p) => ({ placeId: p.placeId, w: p.width, h: p.height, full: [...new Uint8Array(await p.full.arrayBuffer())], thumb: [...new Uint8Array(await p.thumb.arrayBuffer())] }))),
  };
}

beforeEach(async () => {
  d = new CoordsDB(`bp-${Math.random()}`);
  await ensureSeed(d);
  w = (await d.worlds.toArray())[0].id;
});
afterEach(async () => {
  d.close();
  await d.delete();
});

describe('画像付きバックアップ（schemaVersion 2）', () => {
  it('画像を含めて書き出し→全削除→復元で一致', async () => {
    await addWithPhoto();
    await addWithPhoto(960, 1280);
    await savePlace(place(), d);
    const before = await snapshot();
    const text = JSON.stringify(await buildBackup(d, { includePhotos: true }));
    await d.photos.clear();
    await d.places.clear();
    const r = parseBackupText(text);
    expect(r.ok).toBe(true);
    if (r.ok) await replaceAll(r.data, d);
    expect(await snapshot()).toEqual(before);
  });

  it('画像を含めないバックアップ・v1 から復元すると、今ある画像は消える（全置換）', async () => {
    await addWithPhoto();
    const noPhotos = await buildBackup(d);
    expect(noPhotos.photos).toBeUndefined();
    const r = validateBackup(noPhotos);
    expect(r.ok).toBe(true);
    if (r.ok) await replaceAll(r.data, d);
    expect(await d.photos.count()).toBe(0);
    const v1 = validateBackup({ ...noPhotos, schemaVersion: 1 });
    expect(v1.ok).toBe(true);
  });

  it('見込みのサイズ', () => {
    expect(estimateBackupBytes(3000, 10)).toBeGreaterThan(4000);
  });

  describe('不正な画像は拒否し、既存データは変わらない', () => {
    let valid: BackupData;
    beforeEach(async () => {
      await addWithPhoto();
      await addWithPhoto();
      valid = await buildBackup(d, { includePhotos: true });
    });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 5, 0, 0, 0, 3, 0xc0]);
    const cases: [string, (b: BackupData) => unknown][] = [
      ['base64 が壊れている', (b) => ({ ...b, photos: [{ ...b.photos![0], full: 'abc$' }] })],
      ['地点がない', (b) => ({ ...b, photos: [{ ...b.photos![0], placeId: 'none' }] })],
      ['ID 重複', (b) => ({ ...b, photos: [b.photos![0], { ...b.photos![1], id: b.photos![0].id }] })],
      ['1 地点に 2 枚', (b) => ({ ...b, photos: [b.photos![0], { ...b.photos![1], placeId: b.photos![0].placeId }] })],
      ['mime が違う', (b) => ({ ...b, photos: [{ ...b.photos![0], mime: 'image/png' }] })],
      ['PNG を JPEG と申告', (b) => ({ ...b, photos: [{ ...b.photos![0], full: encodeBase64(png) }] })],
      ['申告の寸法が中身と違う', (b) => ({ ...b, photos: [{ ...b.photos![0], width: 1, height: 1 }] })],
      ['full の長辺が 1280 を超える', (b) => ({ ...b, photos: [{ ...b.photos![0], width: 1281, height: 960, full: encodeBase64(fakeJpeg(1281, 960)) }] })],
      ['thumb の長辺が 320 を超える', (b) => ({ ...b, photos: [{ ...b.photos![0], thumb: encodeBase64(fakeJpeg(321, 200)) }] })],
      ['full が 600KB を超える', (b) => ({ ...b, photos: [{ ...b.photos![0], full: encodeBase64(fakeJpeg(1280, 960, { body: 620 * 1024 })) }] })],
      ['末尾が欠けた JPEG', (b) => ({ ...b, photos: [{ ...b.photos![0], full: encodeBase64(fakeJpeg(1280, 960).slice(0, -2)) }] })],
      ['width が 0', (b) => ({ ...b, photos: [{ ...b.photos![0], width: 0 }] })],
      ['画像が 101 枚', (b) => ({ ...b, photos: Array.from({ length: 101 }, (_, i) => ({ ...b.photos![0], id: `x${i}` })) })],
      ['photos が配列でない', (b) => ({ ...b, photos: 'x' })],
    ];
    for (const [name, mutate] of cases) {
      it(name, async () => {
        const before = await snapshot();
        const r = validateBackup(mutate(structuredClone(valid)));
        expect(r.ok).toBe(false);
        expect(await snapshot()).toEqual(before);
      });
    }
  });

  it('画像の書き込みで失敗したら、地点も画像も変わらない', async () => {
    await addWithPhoto();
    const before = await snapshot();
    const r = parseBackupText(JSON.stringify(await buildBackup(d, { includePhotos: true })));
    if (!r.ok) throw new Error('invalid');
    r.data.places = r.data.places.map((p) => ({ ...p, name: '変更' }));
    const spy = vi.spyOn(d.photos, 'bulkAdd').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    await expect(replaceAll(r.data, d)).rejects.toThrow();
    spy.mockRestore();
    expect(await snapshot()).toEqual(before);
  });
});
