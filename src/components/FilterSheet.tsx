import { CATEGORY_GROUPS, GROUP_LABELS, type Category } from '../lib/types';
import type { PlaceFilter } from '../lib/places';
import { Sheet } from './Sheet';

interface FilterSheetProps {
  filter: PlaceFilter;
  categories: Category[];
  counts: Map<string, number>;
  onChange: (f: PlaceFilter) => void;
  onClose: () => void;
}

/** カテゴリで絞り込む。登録がないカテゴリは出さない */
export function FilterSheet({ filter, categories, counts, onChange, onClose }: FilterSheetProps) {
  const selected = new Set(filter.categoryIds);
  const used = categories.filter((c) => (counts.get(c.id) ?? 0) > 0 || selected.has(c.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...filter, categoryIds: [...next] });
  };

  return (
    <Sheet
      title="カテゴリで絞り込み"
      onClose={onClose}
      action={
        <button type="button" className="text-btn" onClick={() => onChange({ ...filter, categoryIds: [] })}>
          すべて
        </button>
      }
    >
      {used.length === 0 && <p className="empty-state">このディメンションにはまだ地点がありません</p>}
      {CATEGORY_GROUPS.map((g) => {
        const list = used.filter((c) => c.group === g);
        if (list.length === 0) return null;
        return (
          <div key={g} className="cat-group">
            <h4>{GROUP_LABELS[g]}</h4>
            <div className="cat-grid">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cat-tile${selected.has(c.id) ? ' selected' : ''}`}
                  aria-pressed={selected.has(c.id)}
                  onClick={() => toggle(c.id)}
                >
                  <span className="cat-icon">{c.icon}</span>
                  <span className="cat-name">
                    {c.name}
                    <small> {counts.get(c.id) ?? 0}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="muted center">何も選ばないと、すべて表示します</p>
    </Sheet>
  );
}
