import { routeTo } from '../lib/geo';
import { useBlobUrl } from '../lib/useBlobUrl';
import type { Category, Place } from '../lib/types';

interface PlaceListProps {
  places: Place[];
  categoryMap: Map<string, Category>;
  home: Place | undefined;
  filtered: boolean;
  /** 地点 ID → 一覧用の小さい画像 */
  thumbs: Map<string, Blob>;
  /** 地点 ID → 追加カテゴリ（整えたもの） */
  subs: Map<string, string[]>;
  onSelect: (p: Place) => void;
}

export function PlaceList({ places, categoryMap, home, filtered, thumbs, subs, onSelect }: PlaceListProps) {
  if (places.length === 0) {
    return (
      <p className="empty-state">
        {filtered ? '条件に合う地点がありません' : 'まだ地点がありません。\n下の「＋」で記録しよう！'}
        {!filtered && <small className="empty-disclaimer">Minecraft の公式アプリではありません（Mojang・Microsoft とは無関係です）</small>}
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
              <PlaceIcon icon={cat?.icon ?? '❓'} thumb={thumbs.get(p.id)} />
              <span className="place-main">
                <span className="place-name">
                  {p.name}
                  {(subs.get(p.id) ?? []).map((id) => (
                    <span key={id} className="sub-icon" title={categoryMap.get(id)?.name}>
                      {categoryMap.get(id)?.icon}
                    </span>
                  ))}
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

/** 画像があれば小さい画像（角にカテゴリのアイコン）、なければカテゴリのアイコン */
function PlaceIcon({ icon, thumb }: { icon: string; thumb: Blob | undefined }) {
  const url = useBlobUrl(thumb);
  if (!url) return <span className="place-icon">{icon}</span>;
  return (
    <span className="place-icon with-thumb">
      <img src={url} alt="" />
      <span className="place-icon-badge">{icon}</span>
    </span>
  );
}
