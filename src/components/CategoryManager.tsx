import { useState } from 'react';
import { db, deleteCategory, newId } from '../lib/db';
import { CATEGORY_GROUPS, DIMENSION_LABELS, GROUP_LABELS, type Category, type CategoryGroup, type Dimension } from '../lib/types';
import { Sheet } from './Sheet';

interface CategoryManagerProps {
  dimension: Dimension;
  categories: Category[];
  counts: Map<string, number>;
  onClose: () => void;
  toast: (msg: string) => void;
}

export function CategoryManager({ dimension, categories, counts, onClose, toast }: CategoryManagerProps) {
  const list = categories.filter((c) => c.dimension === dimension);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Sheet title={`カテゴリ（${DIMENSION_LABELS[dimension]}）`} onClose={onClose}>
      <p className="muted">非表示にすると、記録するときの選択肢に出なくなります（登録済みの地点はそのまま表示されます）。</p>
      {CATEGORY_GROUPS.map((g) => {
        const items = list.filter((c) => c.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g} className="cat-group">
            <h4>{GROUP_LABELS[g]}</h4>
            <ul className="cat-manage">
              {items.map((c) =>
                editing === c.id ? (
                  <CategoryEditor
                    key={c.id}
                    initial={c}
                    onCancel={() => setEditing(null)}
                    onSave={async (patch) => {
                      await db.categories.update(c.id, patch);
                      setEditing(null);
                      toast('変更しました');
                    }}
                  />
                ) : (
                  <li key={c.id} className={c.hidden ? 'hidden-cat' : ''}>
                    <span className="cat-icon">{c.icon}</span>
                    <span className="cat-name">
                      {c.name}
                      <small> {counts.get(c.id) ?? 0} 件</small>
                    </span>
                    <button type="button" className="chip small" onClick={() => setEditing(c.id)}>
                      編集
                    </button>
                    <button
                      type="button"
                      className="chip small"
                      onClick={() => db.categories.update(c.id, { hidden: !c.hidden })}
                    >
                      {c.hidden ? '表示する' : '隠す'}
                    </button>
                    {!c.builtin && (
                      <button
                        type="button"
                        className="chip small danger"
                        onClick={async () => {
                          if (!window.confirm(`カテゴリ「${c.name}」を削除しますか？`)) return;
                          toast((await deleteCategory(c.id)) ? '削除しました' : '使っている地点があるので削除できません');
                        }}
                      >
                        削除
                      </button>
                    )}
                  </li>
                ),
              )}
            </ul>
          </div>
        );
      })}

      <section className="form-section">
        {adding ? (
          <ul className="cat-manage">
            <CategoryEditor
              initial={{ name: '', icon: '⭐', group: 'resource' }}
              showGroup
              onCancel={() => setAdding(false)}
              onSave={async (patch) => {
                const last = list.reduce((m, c) => Math.max(m, c.sortOrder), 0);
                await db.categories.add({
                  id: newId(),
                  dimension,
                  group: patch.group ?? 'resource',
                  name: patch.name!,
                  icon: patch.icon!,
                  hidden: false,
                  sortOrder: last + 1,
                  builtin: false,
                });
                setAdding(false);
                toast('カテゴリを追加しました');
              }}
            />
          </ul>
        ) : (
          <button type="button" className="chip primary wide" onClick={() => setAdding(true)}>
            ＋ カテゴリを追加
          </button>
        )}
      </section>
    </Sheet>
  );
}

function CategoryEditor({
  initial,
  showGroup,
  onCancel,
  onSave,
}: {
  initial: Pick<Category, 'name' | 'icon' | 'group'>;
  showGroup?: boolean;
  onCancel: () => void;
  onSave: (patch: Partial<Category>) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);
  const [group, setGroup] = useState<CategoryGroup>(initial.group);
  const ok = name.trim().length > 0 && icon.trim().length > 0;
  return (
    <li className="cat-editor">
      <input
        className="text-input icon-input"
        value={icon}
        maxLength={8}
        aria-label="アイコン（絵文字）"
        onChange={(e) => setIcon(e.target.value)}
      />
      <input
        className="text-input"
        value={name}
        maxLength={30}
        placeholder="カテゴリ名"
        aria-label="カテゴリ名"
        onChange={(e) => setName(e.target.value)}
      />
      {showGroup && (
        <select className="text-input" value={group} onChange={(e) => setGroup(e.target.value as CategoryGroup)}>
          {CATEGORY_GROUPS.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABELS[g]}
            </option>
          ))}
        </select>
      )}
      <div className="row">
        <button type="button" className="chip small" onClick={onCancel}>
          やめる
        </button>
        <button
          type="button"
          className="chip small primary"
          disabled={!ok}
          onClick={() => onSave({ name: name.trim(), icon: icon.trim(), group })}
        >
          決定
        </button>
      </div>
    </li>
  );
}
