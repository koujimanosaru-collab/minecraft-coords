import { useState } from 'react';
import { autoName, db, newId, savePlace } from '../lib/db';
import { GROUP_LABELS, CATEGORY_GROUPS, DIMENSION_LABELS, type Category, type Dimension, type Place } from '../lib/types';
import { CoordFields, EMPTY_DRAFT, coordsToDraft, draftToCoords, type CoordDraft } from './CoordInput';
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
  dimension: Dimension;
  categories: Category[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export function PlaceForm({ init, worldId, dimension, categories, onClose, onSaved }: PlaceFormProps) {
  const editing = init.place;
  const [draft, setDraft] = useState<CoordDraft>(editing ? coordsToDraft(editing) : (init.draft ?? EMPTY_DRAFT));
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? init.categoryId ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [wantToGo, setWantToGo] = useState(editing ? !editing.visited : false);
  const [isHome, setIsHome] = useState(editing?.isHome ?? init.isHome ?? false);
  const [errors, setErrors] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<(keyof CoordDraft)[]>([]);
  const [saving, setSaving] = useState(false);

  const dimCategories = categories.filter((c) => c.dimension === dimension && (!c.hidden || c.id === categoryId));
  const selected = categories.find((c) => c.id === categoryId);

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
      await savePlace({
        id: editing?.id ?? newId(),
        worldId,
        dimension,
        categoryId: selected.id,
        name: finalName.slice(0, 100),
        ...coords,
        memo: memo.slice(0, 2000),
        visited: !wantToGo,
        isHome,
        createdAt: editing?.createdAt ?? now,
        updatedAt: now,
      });
      onSaved(editing ? '更新しました' : `「${finalName}」を記録しました`);
    } catch {
      setErrors(['保存できませんでした。もう一度試してください']);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`「${editing.name}」を削除しますか？`)) return;
    await db.places.delete(editing.id);
    onSaved('削除しました');
  };

  return (
    <Sheet
      title={editing ? '地点を編集' : `地点を記録（${DIMENSION_LABELS[dimension]}）`}
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
        <h3>座標</h3>
        <CoordFields draft={draft} onChange={setDraft} invalid={invalid} />
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
          <span>🏠 ここを{DIMENSION_LABELS[dimension]}の拠点にする</span>
        </label>
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
