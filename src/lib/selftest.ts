/**
 * 試験モード（?selftest=1。専用の DB を使う）で、上限に近い大きさの画像 100 枚の試験用データを作る（ブラウザ専用）。
 * 画像は乱数の模様（JPEG で圧縮しにくい）なので、作る処理の上限（full 600KB・thumb 60KB）の近くまで大きくなる
 */
import { HOME_CATEGORY_ID } from './categories';
import { MAX_PHOTOS, SELFTEST, addWorld, db, deleteWorld, newId, savePlace } from './db';
import { releaseCanvas } from './image-input';
import { makePhoto } from './photo';

export const SELFTEST_WORLD = '試験用';

export async function createSelftestData(onProgress: (done: number) => void): Promise<{ min: number; max: number; total: number }> {
  if (!SELFTEST) throw new Error('試験モードではありません');
  const worldId = await addWorld(SELFTEST_WORLD);
  const sizes: number[] = [];
  const c = document.createElement('canvas');
  try {
    c.width = 1280;
    c.height = 960;
    const g = c.getContext('2d')!;
    for (let i = 0; i < MAX_PHOTOS; i++) {
      const img = g.createImageData(c.width, c.height);
      for (let j = 0; j < img.data.length; j++) img.data[j] = j % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
      g.putImageData(img, 0, 0);
      const photo = await makePhoto(c);
      const now = Date.now();
      await savePlace(
        {
          id: newId(),
          worldId,
          dimension: 'overworld',
          categoryId: i === 0 ? HOME_CATEGORY_ID.overworld : 'ow-other',
          name: `試験 #${i + 1}`,
          x: i * 10,
          y: 64,
          z: -i * 10,
          memo: '',
          visited: true,
          isHome: i === 0,
          createdAt: now,
          updatedAt: now,
        },
        db,
        photo,
      );
      sizes.push(photo.full.size + photo.thumb.size);
      onProgress(i + 1);
    }
  } finally {
    releaseCanvas(c);
  }
  return { min: Math.min(...sizes), max: Math.max(...sizes), total: sizes.reduce((a, b) => a + b, 0) };
}

export async function deleteSelftestData(): Promise<void> {
  if (!SELFTEST) throw new Error('試験モードではありません');
  const worlds = (await db.worlds.toArray()).filter((w) => w.name === SELFTEST_WORLD);
  for (const w of worlds) await deleteWorld(w.id);
}
