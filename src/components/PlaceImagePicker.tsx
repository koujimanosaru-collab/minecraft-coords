import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhotoData } from '../lib/db';
import { IMAGE_INPUT_TEXT, ImageInputError, loadPhoto, releaseCanvas } from '../lib/image-input';
import { makePhoto, type Rect } from '../lib/photo';
import { CropArea } from './CropArea';
import { Sheet } from './Sheet';

/** 「📷 画像を付ける／変える」ボタン。写真を選び、保存する範囲を決めて地点の画像を作る */
export function PlaceImagePicker({ label, onPicked }: { label: string; onPicked: (photo: PhotoData) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <button type="button" className="chip" onClick={() => inputRef.current?.click()}>
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
        createPortal(
          <PickSheet
            file={file}
            onClose={() => setFile(null)}
            onPicked={(p) => {
              setFile(null);
              onPicked(p);
            }}
          />,
          document.querySelector('.app') ?? document.body,
        )}
    </>
  );
}

function PickSheet({ file, onClose, onPicked }: { file: File; onClose: () => void; onPicked: (p: PhotoData) => void }) {
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');

  useEffect(() => {
    let alive = true;
    loadPhoto(file)
      .then((c) => {
        if (!alive) return releaseCanvas(c);
        photoRef.current = c;
        setState('ready');
      })
      .catch((e) => alive && setState({ error: IMAGE_INPUT_TEXT[e instanceof ImageInputError ? e.kind : 'decode'] }));
    return () => {
      alive = false;
      releaseCanvas(photoRef.current);
      photoRef.current = null;
    };
  }, [file]);

  return (
    <Sheet title="地点の画像" onClose={onClose} closeLabel="やめる">
      {state === 'loading' && <p className="muted center">写真を開いています…</p>}
      {typeof state === 'object' && (
        <p className="errors" role="alert">
          {state.error}
        </p>
      )}
      {state === 'ready' && photoRef.current && <AttachCrop photo={photoRef.current} onDone={onPicked} />}
    </Sheet>
  );
}

/** 保存する範囲を選んで地点の画像を作る（写真から座標を読み取る画面でも使う） */
export function AttachCrop({ photo, onDone, onSkip }: { photo: HTMLCanvasElement; onDone: (p: PhotoData) => void; onSkip?: () => void }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const make = async (r?: Rect) => {
    setBusy(true);
    setError('');
    try {
      onDone(await makePhoto(photo, r));
    } catch {
      setError('画像を作れませんでした。もう一度試してください');
      setBusy(false);
    }
  };
  return (
    <div className="photo-result">
      <p className="photo-hint">
        地点の画像として保存する範囲を囲んでください。ゲームの画面だけを囲むと、部屋や家族が写りません。
      </p>
      <CropArea photo={photo} rect={rect} onRect={setRect} />
      {error && (
        <p className="errors" role="alert">
          {error}
        </p>
      )}
      <div className="row photo-actions">
        {onSkip && (
          <button type="button" className="chip" disabled={busy} onClick={onSkip}>
            画像にしない
          </button>
        )}
        <button type="button" className="chip" disabled={busy} onClick={() => make()}>
          写真全体を使う
        </button>
        <button type="button" className="chip primary" disabled={busy || !rect} onClick={() => rect && make(rect)}>
          {busy ? '作成中…' : 'この範囲を使う'}
        </button>
      </div>
    </div>
  );
}
