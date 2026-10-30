import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReadError,
  cropPreview,
  loadPhoto,
  prepareWorker,
  readCoords,
  releaseCanvas,
  terminateWorker,
  type Rect,
} from '../lib/ocr/reader';
import type { Coords, Dimension } from '../lib/types';
import { CoordFields, coordsToDraft, draftToCoords, EMPTY_DRAFT, type CoordDraft } from './CoordInput';
import { DimensionPicker } from './DimensionPicker';
import { Sheet } from './Sheet';

/** 「📷 写真から読み取る」ボタン。押すとカメラ／写真の選択を出し、選んだら読み取り画面を開く */
export function PhotoButton({
  dimension,
  onResult,
  label = '📷 写真から読み取る',
}: {
  dimension: Dimension;
  onResult: (coords: Coords, dimension: Dimension) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <button type="button" className="chip wide photo-btn" onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) setFile(f);
        }}
      />
      {file &&
        // 拠点カード（緑の帯）の文字色などを引き継がないよう、アプリ全体の直下に出す
        createPortal(
          <PhotoReader
            file={file}
            dimension={dimension}
            onClose={() => setFile(null)}
            onResult={(c, d) => {
              setFile(null);
              onResult(c, d);
            }}
          />,
          document.querySelector('.app') ?? document.body,
        )}
    </>
  );
}

type Step =
  | { kind: 'loading' }
  | { kind: 'crop' }
  | { kind: 'reading'; status: string }
  | { kind: 'confirm'; preview: string; found: boolean }
  | { kind: 'error'; message: string; canRetry: boolean };

const ERROR_TEXT: Record<ReadError['kind'], string> = {
  decode: '写真を開けませんでした。別の写真で試してください',
  offline: '初めて使うときはインターネット接続が必要です（読み取り用のデータをダウンロードします）',
  init: '読み取りの準備に失敗しました。もう一度試してください',
  recognize: '読み取り中にエラーが起きました。もう一度試してください',
  shape: '縦に長すぎます。座標の 1 行だけを横長に囲んでください',
  cancelled: '',
};

function PhotoReader({
  file,
  dimension,
  onClose,
  onResult,
}: {
  file: File;
  dimension: Dimension;
  onClose: () => void;
  onResult: (coords: Coords, dimension: Dimension) => void;
}) {
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef(0); // 実行ごとの番号。中断・閉じた後に届いた結果は捨てる
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [rect, setRect] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<CoordDraft>(EMPTY_DRAFT);
  const [dim, setDim] = useState<Dimension>(dimension);

  useEffect(() => {
    const run = ++runRef.current;
    loadPhoto(file)
      .then((c) => {
        if (run !== runRef.current) return releaseCanvas(c);
        photoRef.current = c;
        setStep({ kind: 'crop' });
      })
      .catch(() => run === runRef.current && setStep({ kind: 'error', message: ERROR_TEXT.decode, canRetry: false }));
    // 初回のダウンロードを先に始めておく（失敗は読み取り時に表示する）
    prepareWorker().catch(() => {});
    return () => {
      runRef.current++;
      releaseCanvas(photoRef.current);
      photoRef.current = null;
      terminateWorker();
    };
  }, [file]);

  const read = async () => {
    const photo = photoRef.current;
    if (!photo || !rect) return;
    const run = ++runRef.current;
    setStep({ kind: 'reading', status: 'preparing' });
    const isCurrent = () => run === runRef.current;
    try {
      await prepareWorker((status) => isCurrent() && setStep({ kind: 'reading', status }));
      if (!isCurrent()) return;
      const { coords } = await readCoords(photo, rect, isCurrent);
      if (!isCurrent()) return;
      setDraft(coords ? coordsToDraft(coords) : EMPTY_DRAFT);
      setStep({ kind: 'confirm', preview: cropPreview(photo, rect), found: !!coords });
    } catch (e) {
      if (!isCurrent()) return;
      const kind = e instanceof ReadError ? e.kind : 'recognize';
      if (kind === 'cancelled') return;
      setStep({ kind: 'error', message: ERROR_TEXT[kind], canRetry: true });
    }
  };

  // 中断: worker を終了して読み取りを打ち切る（次の読み取りでは準備し直す。2 回目以降はキャッシュから読む）
  const cancelReading = () => {
    runRef.current++;
    terminateWorker();
    setStep({ kind: 'crop' });
  };

  const { coords: confirmed, invalid } = draftToCoords(draft);

  return (
    <Sheet title="写真から読み取る" onClose={onClose} closeLabel="やめる">
      {step.kind === 'loading' && <p className="muted center">写真を開いています…</p>}

      {(step.kind === 'crop' || step.kind === 'reading') && photoRef.current && (
        <>
          <p className="photo-hint">座標（位置: X, Y, Z）の部分を指でなぞって囲んでください。2 本指で拡大できます。</p>
          <CropArea photo={photoRef.current} rect={rect} onRect={setRect} />
          <div className="row photo-actions">
            {step.kind === 'reading' ? (
              <>
                <span className="muted">{/load|initializ|prepar/.test(step.status) ? '読み取りの準備中…（初回のみ数 MB をダウンロード）' : '読み取り中…'}</span>
                <button type="button" className="chip" onClick={cancelReading}>
                  中断
                </button>
              </>
            ) : (
              <button type="button" className="chip primary" disabled={!rect} onClick={read}>
                読み取る
              </button>
            )}
          </div>
        </>
      )}

      {step.kind === 'error' && (
        <div className="photo-result">
          <p className="errors" role="alert">{step.message}</p>
          <div className="row">
            {step.canRetry && (
              <button type="button" className="chip" onClick={() => setStep({ kind: 'crop' })}>
                範囲をやり直す
              </button>
            )}
            <button type="button" className="chip" onClick={onClose}>
              手で入力する
            </button>
          </div>
        </div>
      )}

      {step.kind === 'confirm' && (
        <div className="photo-result">
          <img className="photo-crop" src={step.preview} alt="囲んだ部分" />
          {step.found ? (
            <p className="photo-warn">
              写真の数字と同じか確かめてください。<strong>マイナス・桁数</strong>と、<strong>4 と 9、6 と 8</strong> は間違えやすいです。
            </p>
          ) : (
            <p className="errors" role="alert">
              読み取れませんでした。範囲をやり直すか、写真を見ながら入力してください。
            </p>
          )}
          <h3>どのディメンションの座標？</h3>
          <DimensionPicker value={dim} onChange={setDim} />
          <CoordFields draft={draft} onChange={setDraft} invalid={draft === EMPTY_DRAFT ? [] : invalid} />
          <div className="row photo-actions">
            <button type="button" className="chip" onClick={() => setStep({ kind: 'crop' })}>
              範囲をやり直す
            </button>
            <button type="button" className="chip primary" disabled={!confirmed} onClick={() => confirmed && onResult(confirmed, dim)}>
              入力欄に入れる
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** 写真を表示し、1 本指で範囲を囲む（角の近くから始めると角を動かす）。2 本指で拡大・移動 */
function CropArea({ photo, rect, onRect }: { photo: HTMLCanvasElement; rect: Rect | null; onRect: (r: Rect | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 }); // 表示倍率（画面px / 写真px）と平行移動
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ mode: 'draw' | 'corner'; ax: number; ay: number } | null>(null);
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);

  // 最初は写真の幅を画面の幅に合わせる
  useEffect(() => {
    const box = boxRef.current!;
    const fit = box.clientWidth / photo.width;
    setView({ scale: fit, tx: 0, ty: 0 });
  }, [photo]);

  useEffect(() => {
    const c = canvasRef.current;
    const box = boxRef.current;
    if (!c || !box) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = box.clientWidth;
    const h = box.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#111';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(photo, view.tx, view.ty, photo.width * view.scale, photo.height * view.scale);
    if (rect) {
      const x = view.tx + rect.x * view.scale;
      const y = view.ty + rect.y * view.scale;
      const rw = rect.w * view.scale;
      const rh = rect.h * view.scale;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, 0, w, y);
      g.fillRect(0, y + rh, w, h - y - rh);
      g.fillRect(0, y, x, rh);
      g.fillRect(x + rw, y, w - x - rw, rh);
      g.strokeStyle = '#ffd400';
      g.lineWidth = 2;
      g.strokeRect(x, y, rw, rh);
      g.fillStyle = '#ffd400';
      for (const [cx, cy] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) g.fillRect(cx - 5, cy - 5, 10, 10);
    }
  }, [photo, view, rect]);

  useEffect(() => {
    const c = canvasRef.current;
    return () => releaseCanvas(c);
  }, []);

  const local = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toPhoto = (p: { x: number; y: number }) => ({
    x: Math.min(photo.width, Math.max(0, (p.x - view.tx) / view.scale)),
    y: Math.min(photo.height, Math.max(0, (p.y - view.ty) / view.scale)),
  });
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      drag.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    const p = local(e);
    // 既存の範囲の角の近く（24px 以内）なら、反対側の角を固定して動かす
    if (rect) {
      const corners = [
        [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
        [rect.x + rect.w, rect.y, rect.x, rect.y + rect.h],
        [rect.x, rect.y + rect.h, rect.x + rect.w, rect.y],
        [rect.x + rect.w, rect.y + rect.h, rect.x, rect.y],
      ];
      for (const [cx, cy, ox, oy] of corners) {
        if (Math.hypot(view.tx + cx * view.scale - p.x, view.ty + cy * view.scale - p.y) < 24) {
          drag.current = { mode: 'corner', ax: ox, ay: oy };
          return;
        }
      }
    }
    const a = toPhoto(p);
    drag.current = { mode: 'draw', ax: a.x, ay: a.y };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const k = dist / pinch.current.dist;
      const prev = pinch.current;
      setView((v) => {
        const fit = boxRef.current!.clientWidth / photo.width;
        const scale = Math.min(fit * 8, Math.max(fit, v.scale * k));
        const kk = scale / v.scale;
        return { scale, tx: mx - (prev.mx - v.tx) * kk, ty: my - (prev.my - v.ty) * kk };
      });
      pinch.current = { dist, mx, my };
      return;
    }
    if (drag.current) {
      const b = toPhoto(local(e));
      onRect(rectFrom({ x: drag.current.ax, y: drag.current.ay }, b));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      // 小さすぎる範囲は取り消す
      if (rect && (rect.w * view.scale < 20 || rect.h * view.scale < 8)) onRect(null);
    }
  };

  return (
    <div ref={boxRef} className="crop-area" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <canvas ref={canvasRef} />
    </div>
  );
}
