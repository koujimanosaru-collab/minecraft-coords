import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, deletePlace, savePlace, setHome } from '../lib/db';
import { useBlobUrl } from '../lib/useBlobUrl';
import { copyText } from '../lib/device';
import { convertDimension, formatCoords, formatDistance, routeTo } from '../lib/geo';
import { DIMENSION_LABELS, type Category, type Coords, type Place } from '../lib/types';
import { coordsLong } from './HomeCard';
import { Sheet } from './Sheet';

interface PlaceDetailProps {
  place: Place;
  category: Category | undefined;
  home: Place | undefined;
  here: Coords | null;
  onClose: () => void;
  onEdit: () => void;
  toast: (msg: string) => void;
}

export function PlaceDetail({ place, category, home, here, onClose, onEdit, toast }: PlaceDetailProps) {
  const converted = convertDimension(place, place.dimension);
  const photo = useLiveQuery(() => db.photos.where('placeId').equals(place.id).first(), [place.id]);
  const photoUrl = useBlobUrl(photo?.full);
  const [zoom, setZoom] = useState(false);
  const fromHome = home && home.id !== place.id ? routeTo(home, place) : null;
  const fromHere = here ? routeTo(here, place) : null;

  const remove = async () => {
    if (!window.confirm(`「${place.name}」を削除しますか？`)) return;
    await deletePlace(place.id);
    toast('削除しました');
    onClose();
  };

  return (
    <Sheet
      title="地点の詳細"
      onClose={onClose}
      action={
        <button type="button" className="text-btn strong" onClick={onEdit}>
          編集
        </button>
      }
    >
      {photoUrl && (
        <button type="button" className="detail-photo" onClick={() => setZoom(true)} aria-label="画像を大きく表示">
          <img src={photoUrl} alt="地点の画像" />
        </button>
      )}
      {zoom && photoUrl && (
        <div className="photo-zoom" role="dialog" aria-label="地点の画像" onClick={() => setZoom(false)}>
          <img src={photoUrl} alt="地点の画像" />
          <span className="photo-zoom-hint">タップで閉じる・2 本指で拡大</span>
        </div>
      )}
      <div className="detail-head">
        <span className="detail-icon">{category?.icon ?? '❓'}</span>
        <div>
          <h3>
            {place.name}
            {place.isHome && <span className="badge home">拠点</span>}
            {!place.visited && <span className="badge want">☆ まだ行ってない</span>}
          </h3>
          <p className="muted">
            {category?.name ?? '不明なカテゴリ'} ・ {DIMENSION_LABELS[place.dimension]}
          </p>
        </div>
      </div>

      <div className={`detail-coords${coordsLong(place) ? ' long' : ''}`}>
        <span><small>X</small>{place.x}</span>
        <span><small>Y</small>{place.y}</span>
        <span><small>Z</small>{place.z}</span>
      </div>
      <button
        type="button"
        className="chip wide"
        onClick={async () => toast((await copyText(formatCoords(place))) ? 'コピーしました' : 'コピーできませんでした')}
      >
        座標をコピー
      </button>

      <dl className="detail-list">
        {fromHere && (
          <>
            <dt>今いる座標から</dt>
            <dd>
              {fromHere.direction ? `${fromHere.direction}へ ` : ''}
              {formatDistance(fromHere.distance)}
              {fromHere.dy !== 0 && `（${Math.abs(fromHere.dy)} ブロック${fromHere.dy > 0 ? '上' : '下'}）`}
            </dd>
          </>
        )}
        {fromHome && (
          <>
            <dt>拠点から</dt>
            <dd>
              {fromHome.direction ? `${fromHome.direction}へ ` : ''}
              {formatDistance(fromHome.distance)}
            </dd>
          </>
        )}
        {converted && (
          <>
            <dt>{DIMENSION_LABELS[converted.to]}だと</dt>
            <dd>{formatCoords(converted.coords)}</dd>
          </>
        )}
        {place.memo && (
          <>
            <dt>メモ</dt>
            <dd className="memo">{place.memo}</dd>
          </>
        )}
      </dl>

      <div className="detail-actions">
        {!place.visited && (
          <button
            type="button"
            className="chip primary"
            onClick={async () => {
              await savePlace({ ...place, visited: true });
              toast('行ったことにしました');
            }}
          >
            ✔ 行った！
          </button>
        )}
        {!place.isHome && (
          <button
            type="button"
            className="chip"
            onClick={async () => {
              if (home && !window.confirm(`拠点を「${home.name}」から「${place.name}」に変えますか？`)) return;
              await setHome(place);
              toast('拠点にしました');
            }}
          >
            🏠 拠点にする
          </button>
        )}
        <button type="button" className="danger-btn" onClick={remove}>
          削除
        </button>
      </div>
    </Sheet>
  );
}
