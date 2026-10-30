import type { Category, Place } from '../lib/types';
import { Sheet } from './Sheet';

interface PickSheetProps {
  places: Place[];
  categoryMap: Map<string, Category>;
  onPick: (p: Place) => void;
  onClose: () => void;
}

/** 3D で札が重なっているときに、どの地点かを選ぶ */
export function PickSheet({ places, categoryMap, onPick, onClose }: PickSheetProps) {
  return (
    <Sheet title="どの地点？" onClose={onClose}>
      <ul className="place-list flush">
        {places.map((p) => (
          <li key={p.id}>
            <button type="button" className="place-row" onClick={() => onPick(p)}>
              <span className="place-icon">{categoryMap.get(p.categoryId)?.icon ?? '❓'}</span>
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
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
