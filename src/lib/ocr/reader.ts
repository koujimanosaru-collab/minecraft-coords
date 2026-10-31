/**
 * 写真の読み取り（ブラウザ専用）。tesseract.js は「写真から読み取る」を使うときだけ読み込む。
 * worker・wasm・言語データはすべてアプリと同じサイトの tesseract/ から読む（CDN を使わない）。
 */
import type { Worker } from 'tesseract.js';
import type { Coords } from '../types';
import { coordSymbolConfidence, decideCoords } from './parse';
import { releaseCanvas } from '../image-input';
import { WORK_WIDTH, preprocess, type Mask } from './preprocess';

/** 囲んだ範囲の縦÷横の上限。座標は横長の 1 行なので、これより縦長なら囲み直してもらう（処理する画素数の上限も兼ねる） */
export const MAX_RECT_ASPECT = 0.5;
/** 初期化の待ち時間の上限 */
const INIT_TIMEOUT_MS = 90_000;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ReadError extends Error {
  constructor(
    public kind: 'offline' | 'init' | 'recognize' | 'shape' | 'cancelled',
    message: string = kind,
  ) {
    super(message);
  }
}

const asset = (name: string) => new URL(`tesseract/${name}`, document.baseURI).href;

/**
 * worker の準備 1 回分。中断・失敗・時間切れのときは、tesseract.js の Promise の結果を待たずに
 * 実際の Web Worker を直接終了する（tesseract.js は初期化の失敗で Promise を settle しないことがあるため）
 */
interface Session {
  ready: Promise<Worker>;
  /** tesseract.js が作った Web Worker（作成の瞬間にとらえる） */
  raw?: globalThis.Worker;
  abort: AbortController;
  fail: (e: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  listener?: (status: string) => void;
}

let current: Session | null = null;

/** worker を用意する（2 回目以降は使い回す）。失敗したら ReadError で reject する */
export function prepareWorker(onProgress?: (status: string) => void): Promise<Worker> {
  current ??= startSession();
  if (onProgress) current.listener = onProgress;
  return current.ready;
}

function startSession(): Session {
  let fail: (e: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => {}); // 未処理の reject として扱わない
  const session: Session = { ready: failed, abort: new AbortController(), fail };
  // 進捗は、この準備がまだ現役のときだけ伝える（古い準備が新しい画面の表示を書き換えないように）
  const report = (status: string) => current === session && session.listener?.(status);
  // 取得からパラメータ設定までの全体に期限をつける
  session.timer = setTimeout(() => fail(new ReadError('init', 'timeout')), INIT_TIMEOUT_MS);
  const race = <T,>(p: Promise<T>) => Promise.race([p, failed]);

  session.ready = (async () => {
    report('loading language');
    // tesseract.js は言語データの取得に失敗しても Promise を reject しないため、先にここで取得して失敗を検知する。
    // 取得したデータは Service Worker のキャッシュに入り、worker はそこから読む
    try {
      const res = await race(fetch(asset('eng.traineddata.gz'), { signal: session.abort.signal }));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await race(res.arrayBuffer());
    } catch (e) {
      throw e instanceof ReadError ? e : new ReadError(navigator.onLine ? 'init' : 'offline', String(e));
    }

    const { createWorker, OEM, PSM } = await race(import('tesseract.js'));
    // tesseract.js は createWorker の呼び出し中に同期的に new Worker する。その瞬間をとらえて、後で直接終了できるようにする
    const OriginalWorker = globalThis.Worker;
    globalThis.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof OriginalWorker>) {
        super(...args);
        session.raw = this;
      }
    };
    let creating: Promise<Worker>;
    try {
      creating = createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: asset('worker.min.js'),
        corePath: asset(''),
        langPath: asset('').replace(/\/$/, ''),
        workerBlobURL: false,
        cacheMethod: 'none', // 言語データの保存は Service Worker のキャッシュに任せる
        logger: (m) => report(m.status),
        errorHandler: (e) => fail(e),
      });
    } finally {
      globalThis.Worker = OriginalWorker;
    }
    creating.catch(() => {});
    const worker = await race(creating);
    await race(
      worker.setParameters({
        tessedit_char_whitelist: '0123456789-,: ',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      }),
    );
    clearTimeout(session.timer);
    return worker;
  })().catch((e) => {
    endSession(session);
    throw e instanceof ReadError ? e : new ReadError(navigator.onLine ? 'init' : 'offline', String(e));
  });
  session.ready.catch(() => {});
  return session;
}

/** 準備を打ち切り、実際の Web Worker を終了する。共有状態は、その準備が現役のときだけ消す */
function endSession(session: Session) {
  clearTimeout(session.timer);
  session.abort.abort();
  session.fail(new ReadError('cancelled'));
  session.raw?.terminate();
  if (current === session) current = null;
}

/** worker を終了してメモリを返す（準備中・読み取り中なら打ち切られる） */
export function terminateWorker(): void {
  if (current) endSession(current);
}

/** 文字行のマスクを PNG にする（canvas はすぐ解放する） */
async function maskToPng(m: Mask): Promise<Blob> {
  const c = document.createElement('canvas');
  try {
    c.width = m.width;
    c.height = m.height;
    const g = c.getContext('2d')!;
    const img = g.createImageData(m.width, m.height);
    for (let i = 0; i < m.data.length; i++) {
      const v = m.data[i] ? 0 : 255; // 白地に黒い文字
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  } finally {
    releaseCanvas(c);
  }
}

/** 囲んだ範囲が座標の 1 行として扱える形か */
export function rectShapeOk(rect: Rect): boolean {
  return rect.w > 0 && rect.h > 0 && rect.h / rect.w <= MAX_RECT_ASPECT;
}

/**
 * 範囲を切り出して読み取る。読み取れなければ coords は null。
 * isCurrent() が false になったら（中断・画面を閉じた）、その時点で打ち切る
 */
export async function readCoords(photo: HTMLCanvasElement, rect: Rect, isCurrent: () => boolean): Promise<{ coords: Coords | null }> {
  if (!rectShapeOk(rect)) throw new ReadError('shape');
  if (!isCurrent()) throw new ReadError('cancelled');
  const worker = await prepareWorker();
  if (!isCurrent()) throw new ReadError('cancelled');

  const work = document.createElement('canvas');
  let png: Blob | null = null;
  try {
    work.width = WORK_WIDTH;
    work.height = Math.max(1, Math.round((rect.h * WORK_WIDTH) / rect.w));
    const g = work.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(photo, rect.x, rect.y, rect.w, rect.h, 0, 0, work.width, work.height);
    const mask = preprocess(g.getImageData(0, 0, work.width, work.height));
    if (!mask) return { coords: null };
    png = await maskToPng(mask);
  } finally {
    releaseCanvas(work);
  }
  if (!isCurrent()) throw new ReadError('cancelled');

  let data;
  try {
    ({ data } = await worker.recognize(png, {}, { blocks: true }));
  } catch (e) {
    throw new ReadError('recognize', String(e));
  }
  const symbols = (data.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.flatMap((w) => w.symbols))),
  );
  return { coords: decideCoords(data.text, coordSymbolConfidence(symbols)) };
}

/** 確認画面に出す、元の写真の切り出し（色付き） */
export function cropPreview(photo: HTMLCanvasElement, rect: Rect): string {
  const c = document.createElement('canvas');
  try {
    const scale = Math.min(1, 900 / rect.w);
    c.width = Math.max(1, Math.round(rect.w * scale));
    c.height = Math.max(1, Math.round(rect.h * scale));
    c.getContext('2d')!.drawImage(photo, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    releaseCanvas(c);
  }
}
