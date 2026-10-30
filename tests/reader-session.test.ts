// reader.ts の worker の準備と後始末（ブラウザの Worker・fetch と tesseract.js を偽物に差し替えて確認）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Opts = { errorHandler: (e: unknown) => void; logger: (m: { status: string }) => void };
const created: { opts: Opts; resolve: (w: unknown) => void; raw: FakeWorker }[] = [];

class FakeWorker {
  terminated = false;
  constructor(public url: string) {}
  terminate() {
    this.terminated = true;
  }
}

vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  PSM: { SINGLE_LINE: '7' },
  createWorker: (_lang: string, _oem: number, opts: Opts & { workerPath: string }) => {
    // tesseract.js と同じく、呼び出し中に同期的に new Worker する
    const raw = new (globalThis as unknown as { Worker: typeof FakeWorker }).Worker(opts.workerPath) as FakeWorker;
    return new Promise((resolve) => created.push({ opts, resolve, raw }));
  },
}));

let fetchImpl: () => Promise<Response>;

beforeEach(() => {
  created.length = 0;
  vi.resetModules();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { baseURI: 'http://localhost/app/' });
  vi.stubGlobal('navigator', { onLine: true });
  fetchImpl = () => Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', (_u: string, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      fetchImpl().then(resolve, reject);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const fakeTessWorker = () => ({ setParameters: vi.fn(() => Promise.resolve()), terminate: vi.fn() });

describe('worker の準備', () => {
  it('成功すれば使い回し、Worker の作成後は元の Worker に戻す', async () => {
    const r = await import('../src/lib/ocr/reader');
    const p1 = r.prepareWorker();
    await tick(); await tick();
    expect(created).toHaveLength(1);
    expect(globalThis.Worker).toBe(FakeWorker);
    const w = fakeTessWorker();
    created[0].resolve(w);
    expect(await p1).toBe(w);
    expect(await r.prepareWorker()).toBe(w);
    expect(created).toHaveLength(1);
  });

  it('初期化に失敗したら（errorHandler）reject し、実際の Worker を終了する', async () => {
    const r = await import('../src/lib/ocr/reader');
    const p = r.prepareWorker();
    await tick(); await tick();
    created[0].opts.errorHandler('loadLanguage failed');
    await expect(p).rejects.toMatchObject({ kind: 'init' });
    expect(created[0].raw.terminated).toBe(true);
    // 次の呼び出しでは新しく準備する
    void r.prepareWorker().catch(() => {});
    await tick(); await tick();
    expect(created).toHaveLength(2);
  });

  it('準備中に中断したら、結果を待たずに Worker を終了する', async () => {
    const r = await import('../src/lib/ocr/reader');
    const p = r.prepareWorker();
    await tick(); await tick();
    r.terminateWorker();
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });
    expect(created[0].raw.terminated).toBe(true);
  });

  it('古い準備の失敗が、新しい準備の状態と進捗表示を変えない', async () => {
    const r = await import('../src/lib/ocr/reader');
    const old = r.prepareWorker().catch(() => {});
    await tick(); await tick();
    const oldOpts = created[0].opts;
    r.terminateWorker();
    await old;
    const seen: string[] = [];
    const p2 = r.prepareWorker((s) => seen.push(s));
    await tick(); await tick();
    oldOpts.logger({ status: 'old progress' });
    oldOpts.errorHandler('old failure');
    const w = fakeTessWorker();
    created[1].resolve(w);
    expect(await p2).toBe(w);
    expect(seen).not.toContain('old progress');
    expect(await r.prepareWorker()).toBe(w);
    expect(created[1].raw.terminated).toBe(false);
  });

  it('言語データの取得が止まっても時間切れで reject する', async () => {
    vi.useFakeTimers();
    fetchImpl = () => new Promise(() => {});
    const r = await import('../src/lib/ocr/reader');
    const p = r.prepareWorker();
    const check = expect(p).rejects.toMatchObject({ kind: 'init' });
    await vi.advanceTimersByTimeAsync(90_001);
    await check;
  });

  it('言語データの取得に失敗したら、オフラインなら offline として reject', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    fetchImpl = () => Promise.reject(new Error('network'));
    const r = await import('../src/lib/ocr/reader');
    await expect(r.prepareWorker()).rejects.toMatchObject({ kind: 'offline' });
    expect(created).toHaveLength(0);
  });
});
