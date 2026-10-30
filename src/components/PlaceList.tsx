import { routeTo } from '../lib/geo';
import type { Category, Place } from '../lib/types';

interface PlaceListProps {
  places: Place[];
  categoryMap: Map<string, Category>;
  home: Place | undefined;
  filtered: boolean;
  onSelect: (p: Place) => void;
}

export function PlaceList({ places, categoryMap, home, filtered, onSelect }: PlaceListProps) {
  if (places.length === 0) {
    return (
      <p className="empty-state">
        {filtered ? '条件に合う地点がありません' : 'まだ地点がありません。\n下の「＋」で記録しよう！'}
      </p>
    );
  }
  return (
    <ul className="place-list">
      {places.map((p) => {
        const cat = categoryMap.get(p.categoryId);
        const r = home && home.id !== p.id ? routeTo(home, p) : null;
        return (
          <li key={p.id}>
            <button type="button" className="place-row" onClick={() => onSelect(p)}>
              <span className="place-icon">{cat?.icon ?? '❓'}</span>
              <span className="place-main">
                <span className="place-name">
                  {p.name}
                  {p.isHome && <span className="badge home">拠点</span>}
                  {!p.visited && <span className="badge want">☆</span>}
                </span>
                <span className="place-coords">
                  {p.x}, {p.y}, {p.z}
                </span>
              </span>
              {r && (
                <span className="place-dist">
                  {r.direction}
                  <br />
                  {r.distance.toLocaleString('ja-JP')}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
