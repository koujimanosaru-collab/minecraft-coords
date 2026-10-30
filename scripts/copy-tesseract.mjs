// 写真からの座標読み取りに使う tesseract.js のファイルを dist/tesseract/ にコピーする。
// vite build は出力先を空にするので、必ずビルドの後に実行する。CDN は使わず同じサイトから配信する。
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = 'dist/tesseract';
const files = [
  [join(dirname(require.resolve('tesseract.js/package.json')), 'dist/worker.min.js'), 'worker.min.js'],
  // LSTM 専用版のみ（端末に合う 1 つだけが読まれる）
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [
    join(dirname(require.resolve('tesseract.js-core/package.json')), f),
    f,
  ]),
  [join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];

if (!existsSync('dist')) throw new Error('dist がありません。vite build の後に実行してください');
mkdirSync(out, { recursive: true });
for (const [src, name] of files) {
  copyFileSync(src, join(out, name));
  console.log('copied', name);
}
