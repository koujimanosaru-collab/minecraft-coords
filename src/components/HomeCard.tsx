import { useState } from 'react';
import { copyText } from '../lib/device';
import { formatCoords, formatDistance, routeTo } from '../lib/geo';
import type { Place } from '../lib/types';
import { CoordFields, draftToCoords, type CoordDraft } from './CoordInput';

interface HomeCardProps {
  home: Place | undefined;
  icon: string;
  here: CoordDraft;
  onHereChange: (d: CoordDraft) => void;
  onRecordHere: () => void;
  onOpenHome: () => void;
  onAddHome: () => void;
  toast: (msg: string) => void;
}

export function HomeCard({ home, icon, here, onHereChange, onRecordHere, onOpenHome, onAddHome, toast }: HomeCardProps) {
  const [open, setOpen] = useState(false);
  const { coords: herePos } = draftToCoords(here);
  const route = home && herePos ? routeTo(herePos, home) : null;

  return (
    <section className="home-card">
      {home ? (
        <div className="home-main">
          <button type="button" className="home-info" onClick={onOpenHome}>
            <span className="home-label">
              {icon} {home.name}
            </span>
            <span className={`home-coords${coordsLong(home) ? ' long' : ''}`}>
              <span><small>X</small>{home.x}</span>
              <span><small>Y</small>{home.y}</span>
              <span><small>Z</small>{home.z}</span>
            </span>
          </button>
          <button
            type="button"
            className="chip"
            onClick={async () => toast((await copyText(formatCoords(home))) ? 'コピーしました' : 'コピーできませんでした')}
          >
            コピー
          </button>
        </div>
      ) : (
        <div className="home-main empty">
          <span>拠点がまだありません</span>
          <button type="button" className="chip primary" onClick={onAddHome}>
            拠点を登録
          </button>
        </div>
      )}

      <button type="button" className="here-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        📍 今いる座標{route ? ` → ${describeRoute(route)}` : ''} <span className="caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="here-panel">
          <CoordFields draft={here} onChange={onHereChange} />
          {home && herePos && route && (
            <p className="route">
              拠点まで <strong>{route.direction ? `${route.direction}へ ` : ''}{formatDistance(route.distance)}</strong>
              {route.dy !== 0 && <>（{Math.abs(route.dy)} ブロック{route.dy > 0 ? '上' : '下'}）</>}
            </p>
          )}
          <div className="row">
            <button type="button" className="chip" onClick={() => onHereChange({ x: '', y: '', z: '' })}>
              クリア
            </button>
            <button type="button" className="chip primary" disabled={!herePos} onClick={onRecordHere}>
              この座標を記録
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** 桁数が多い座標は文字を小さくして折り返す */
export function coordsLong(c: { x: number; y: number; z: number }): boolean {
  return `${c.x}${c.y}${c.z}`.length > 13;
}

function describeRoute(r: ReturnType<typeof routeTo>): string {
  if (r.distance === 0) return '拠点にいます';
  return `拠点は${r.direction ?? ''} ${r.distance.toLocaleString('ja-JP')}`;
}
