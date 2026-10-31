import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhotoData } from '../lib/db';
import { IMAGE_INPUT_TEXT, ImageInputError, loadPhoto, releaseCanvas } from '../lib/image-input';
import { ReadError, cropPreview, prepareWorker, readCoords, terminateWorker } from '../lib/ocr/reader';
import type { Rect } from '../lib/photo';
import type { Coords, Dimension } from '../lib/types';
import { CoordFields, coordsToDraft, draftToCoords, EMPTY_DRAFT, type CoordDraft } from './CoordInput';
import { CropArea } from './CropArea';
import { DimensionPicker } from './DimensionPicker';
import { AttachCrop } from './PlaceImagePicker';
import { Sheet } from './Sheet';

/** 「📷 写真から読み取る」ボタン。押すとカメラ／写真の選択を出し、選んだら読み取り画面を開く */
export function PhotoButton({
  dimension,
  onResult,
  allowAttach = false,
  label = '📷 写真から読み取る',
}: {
  dimension: Dimension;
  /** photo は「この写真を地点の画像にする」を選んだときだけ渡る */
  onResult: (coords: Coords, dimension: Dimension, photo?: PhotoData) => void;
  /** 記録画面から開いたときだけ、写真を地点の画像にできる */
  allowAttach?: boolean;
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
            allowAttach={allowAttach}
            onClose={() => setFile(null)}
            onResult={(c, d, photo) => {
              setFile(null);
              onResult(c, d, photo);
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
  | { kind: 'attach'; coords: Coords }
  | { kind: 'error'; message: string; canRetry: boolean };

const ERROR_TEXT: Record<ReadError['kind'], string> = {
  offline: '初めて使うときはインターネット接続が必要です（読み取り用のデータをダウンロードします）',
  init: '読み取りの準備に失敗しました。もう一度試してください',
  recognize: '読み取り中にエラーが起きました。もう一度試してください',
  shape: '縦に長すぎます。座標の 1 行だけを横長に囲んでください',
  cancelled: '',
};

function PhotoReader({
  file,
  dimension,
  allowAttach,
  onClose,
  onResult,
}: {
  file: File;
  dimension: Dimension;
  allowAttach: boolean;
  onClose: () => void;
  onResult: (coords: Coords, dimension: Dimension, photo?: PhotoData) => void;
}) {
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef(0); // 実行ごとの番号。中断・閉じた後に届いた結果は捨てる
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [rect, setRect] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<CoordDraft>(EMPTY_DRAFT);
  const [dim, setDim] = useState<Dimension>(dimension);
  // 部屋や家族が写ることがあるので、初期値はオフ
  const [attach, setAttach] = useState(false);

  useEffect(() => {
    const run = ++runRef.current;
    loadPhoto(file)
      .then((c) => {
        if (run !== runRef.current) return releaseCanvas(c);
        photoRef.current = c;
        setStep({ kind: 'crop' });
      })
      .catch(
        (e) =>
          run === runRef.current &&
          setStep({ kind: 'error', message: IMAGE_INPUT_TEXT[e instanceof ImageInputError ? e.kind : 'decode'], canRetry: false }),
      );
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
          {allowAttach && (
            <label className="toggle">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              <span>この写真を地点の画像にする（次の画面で保存する範囲を選べます）</span>
            </label>
          )}
          <div className="row photo-actions">
            <button type="button" className="chip" onClick={() => setStep({ kind: 'crop' })}>
              範囲をやり直す
            </button>
            <button
              type="button"
              className="chip primary"
              disabled={!confirmed}
              onClick={() => {
                if (!confirmed) return;
                if (attach) setStep({ kind: 'attach', coords: confirmed });
                else onResult(confirmed, dim);
              }}
            >
              入力欄に入れる
            </button>
          </div>
        </div>
      )}

      {step.kind === 'attach' && photoRef.current && (
        <AttachCrop
          photo={photoRef.current}
          onDone={(photo) => onResult(step.coords, dim, photo)}
          onSkip={() => onResult(step.coords, dim)}
        />
      )}
    </Sheet>
  );
}
