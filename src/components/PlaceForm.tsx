import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { mapCategoryToDimension } from '../lib/categories';
import { PhotoLimitError, autoName, db, deletePlace, isQuotaError, newId, savePlace, type PhotoData } from '../lib/db';
import { useBlobUrl } from '../lib/useBlobUrl';
import { GROUP_LABELS, CATEGORY_GROUPS, DIMENSION_LABELS, type Category, type Dimension, type Place } from '../lib/types';
import { CoordFields, EMPTY_DRAFT, coordsToDraft, draftToCoords, type CoordDraft } from './CoordInput';
import { DimensionPicker } from './DimensionPicker';
import { PhotoButton } from './PhotoReader';
import { PlaceImagePicker } from './PlaceImagePicker';
import { Sheet } from './Sheet';

export interface PlaceFormInit {
  place?: Place;
  draft?: CoordDraft;
  categoryId?: string;
  isHome?: boolean;
}

interface PlaceFormProps {
  init: PlaceFormInit;
  worldId: string;
  /** 新規なら今のタブ、編集なら地点のディメンション（記録画面の中で変えられる） */
  dimension: Dimension;
  categories: Category[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export function PlaceForm({ init, worldId, dimension, categories, onClose, onSaved }: PlaceFormProps) {
  const editing = init.place;
  const [dim, setDim] = useState<Dimension>(editing?.dimension ?? dimension);
  const [draft, setDraft] = useState<CoordDraft>(editing ? coordsToDraft(editing) : (init.draft ?? EMPTY_DRAFT));
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? init.categoryId ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [wantToGo, setWantToGo] = useState(editing ? !editing.visited : false);
  const [isHome, setIsHome] = useState(editing?.isHome ?? init.isHome ?? false);
  const [errors, setErrors] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<(keyof CoordDraft)[]>([]);
  const [saving, setSaving] = useState(false);
  // 画像: undefined＝変えない、null＝外す、データ＝付ける・差し替える（保存ボタンまで画面内だけに持つ）
  const [photoChange, setPhotoChange] = useState<PhotoData | null | undefined>(undefined);
  const savedPhoto = useLiveQuery(() => (editing ? db.photos.where('placeId').equals(editing.id).first() : undefined), [editing?.id]);
  const shownThumb = photoChange === undefined ? savedPhoto?.thumb : (photoChange?.thumb ?? null);
  const thumbUrl = useBlobUrl(shownThumb);

  const dimCategories = categories.filter((c) => c.dimension === dim && (!c.hidden || c.id === categoryId));
  const selected = categories.find((c) => c.id === categoryId && c.dimension === dim);

  // 拠点にすると外れてしまう、選択中ディメンションの今の拠点
  const otherHome = useLiveQuery(
    () =>
      db.places
        .where('[worldId+dimension]')
        .equals([worldId, dim])
        .filter((p) => p.isHome && p.id !== editing?.id)
        .first(),
    [worldId, dim, editing?.id],
  );

  const changeDimension = (next: Dimension) => {
    if (next === dim) return;
    setCategoryId((id) => mapCategoryToDimension(categories, id, next));
    setDim(next);
  };

  const save = async () => {
    const { coords, invalid: bad } = draftToCoords(draft);
    const errs: string[] = [];
    if (!coords) errs.push('座標は整数で入力してください（マイナスは ± ボタン）');
    if (!selected) errs.push('カテゴリを選んでください');
    setInvalid(bad);
    setErrors(errs);
    if (!coords || !selected) {
      document.querySelector('.sheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const finalName = name.trim() || (editing && editing.categoryId === selected.id ? editing.name : await autoName(worldId, selected));
      await savePlace(
        {
          id: editing?.id ?? newId(),
          worldId,
          dimension: dim,
          categoryId: selected.id,
          name: finalName.slice(0, 100),
          ...coords,
          memo: memo.slice(0, 2000),
          visited: !wantToGo,
          isHome,
          createdAt: editing?.createdAt ?? now,
          updatedAt: now,
        },
        db,
        photoChange,
      );
      const moved = editing ? editing.dimension !== dim : dim !== dimension;
      const where = moved ? `${DIMENSION_LABELS[dim]}に` : '';
      onSaved(editing ? (moved ? `${where}移しました` : '更新しました') : `「${finalName}」を${where}記録しました`);
    } catch (e) {
      // 失敗したときは地点も画像も変わっていない（同じトランザクション）
      const quota = isQuotaError(e);
      setErrors([
        e instanceof PhotoLimitError
          ? `${e.message}。ほかの地点の画像を外すか、画像を付けずに保存してください`
          : quota
            ? 'iPhone の空き容量が足りないため保存できませんでした'
            : '保存できませんでした。もう一度試してください',
      ]);
      setSaving(false);
      document.querySelector('.sheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`「${editing.name}」を削除しますか？`)) return;
    await deletePlace(editing.id);
    onSaved('削除しました');
  };

  return (
    <Sheet
      title={editing ? '地点を編集' : '地点を記録'}
      onClose={onClose}
      closeLabel="キャンセル"
      action={
        <button type="button" className="text-btn strong" onClick={save} disabled={saving}>
          保存
        </button>
      }
    >
      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <section className="form-section">
        <h3>ディメンション</h3>
        <DimensionPicker value={dim} onChange={changeDimension} />
      </section>

      <section className="form-section">
        <h3>座標</h3>
        <PhotoButton
          dimension={dim}
          allowAttach
          onResult={(coords, d, photo) => {
            setDraft(coordsToDraft(coords));
            setInvalid([]);
            changeDimension(d);
            if (photo) setPhotoChange(photo);
          }}
        />
        <CoordFields draft={draft} onChange={setDraft} invalid={invalid} />
      </section>

      <section className="form-section">
        <h3>画像</h3>
        <div className="image-field">
          {thumbUrl ? <img className="image-thumb" src={thumbUrl} alt="地点の画像" /> : <span className="muted">なし</span>}
          <div className="row">
            <PlaceImagePicker label={shownThumb ? '変える' : '📷 画像を付ける'} onPicked={setPhotoChange} />
            {shownThumb && (
              <button type="button" className="chip" onClick={() => setPhotoChange(null)}>
                外す
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="form-section">
        <h3>カテゴリ{selected && <span className="selected-cat">：{selected.icon} {selected.name}</span>}</h3>
        {CATEGORY_GROUPS.map((g) => {
          const list = dimCategories.filter((c) => c.group === g);
          if (list.length === 0) return null;
          return (
            <div key={g} className="cat-group">
              <h4>{GROUP_LABELS[g]}</h4>
              <div className="cat-grid">
                {list.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`cat-tile${c.id === categoryId ? ' selected' : ''}`}
                    onClick={() => setCategoryId(c.id)}
                    aria-pressed={c.id === categoryId}
                  >
                    <span className="cat-icon">{c.icon}</span>
                    <span className="cat-name">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="form-section">
        <h3>名前・メモ</h3>
        <input
          type="text"
          className="text-input"
          placeholder={selected ? `空なら「${selected.name} #番号」` : '名前（空なら自動）'}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="text-input"
          placeholder="メモ（例：川の向こう側、夜は危ない）"
          rows={3}
          value={memo}
          maxLength={2000}
          onChange={(e) => setMemo(e.target.value)}
        />
      </section>

      <section className="form-section toggles">
        <label className="toggle">
          <input type="checkbox" checked={wantToGo} onChange={(e) => setWantToGo(e.target.checked)} />
          <span>☆ まだ行ってない（今度行く）</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={isHome} onChange={(e) => setIsHome(e.target.checked)} />
          <span>🏠 ここを{DIMENSION_LABELS[dim]}の拠点にする</span>
        </label>
        {isHome && otherHome && (
          <p className="home-warn">
            保存すると、今の{DIMENSION_LABELS[dim]}の拠点「{otherHome.name}」は拠点ではなくなります。
          </p>
        )}
      </section>

      {editing && (
        <section className="form-section">
          <button type="button" className="danger-btn" onClick={remove}>
            この地点を削除
          </button>
        </section>
      )}
    </Sheet>
  );
}
