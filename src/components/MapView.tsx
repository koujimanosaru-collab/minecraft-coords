import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Category, Coords, Place } from '../lib/types';

interface MapViewProps {
  places: Place[];
  categoryMap: Map<string, Category>;
  home: Place | undefined;
  here: Coords | null;
  onSelect: (p: Place) => void;
}

interface View {
  cx: number; // 画面中心のワールド X
  cz: number; // 画面中心のワールド Z
  scale: number; // 1 ブロックあたりのピクセル数
}

const MIN_SCALE = 0.002;
const MAX_SCALE = 8;
const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 1000000];

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** 上から見た 2D マップ（北が上 = Z- が上、東が右 = X+ が右） */
export function MapView({ places, categoryMap, home, here, onSelect }: MapViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ cx: 0, cz: 0, scale: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; pinchDist?: number }>({ moved: 0 });
  const fitted = useRef(false);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitAll = useCallback(() => {
    const pts: Coords[] = [...places, ...(here ? [here] : [])];
    if (pts.length === 0 || size.w === 0) {
      setView({ cx: home?.x ?? 0, cz: home?.z ?? 0, scale: 1 });
      return;
    }
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const pad = 60;
    const scale = clampScale(Math.min((size.w - pad * 2) / Math.max(maxX - minX, 1), (size.h - pad * 2) / Math.max(maxZ - minZ, 1), 2));
    setView({ cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, scale });
  }, [places, here, home, size.w, size.h]);

  useEffect(() => {
    if (!fitted.current && size.w > 0) {
      fitted.current = true;
      fitAll();
    }
  }, [fitAll, size.w]);

  const toScreen = (x: number, z: number) => ({
    sx: size.w / 2 + (x - view.cx) * view.scale,
    sy: size.h / 2 + (z - view.cz) * view.scale,
  });

  const zoomAt = (factor: number, sx = size.w / 2, sy = size.h / 2) => {
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      // (sx, sy) の下にあるワールド座標を固定したまま拡大縮小
      const wx = v.cx + (sx - size.w / 2) / v.scale;
      const wz = v.cz + (sy - size.h / 2) / v.scale;
      return { scale, cx: wx - (sx - size.w / 2) / scale, cz: wz - (sy - size.h / 2) / scale };
    });
  };

  const local = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) gesture.current = { moved: 0 };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    if (pointers.current.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      if (gesture.current.moved > 6) {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        setView((v) => ({ ...v, cx: v.cx - dx / v.scale, cz: v.cz - dy / v.scale }));
      }
      pointers.current.set(e.pointerId, cur);
    } else if (pointers.current.size === 2) {
      pointers.current.set(e.pointerId, cur);
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.pinchDist) zoomAt(dist / gesture.current.pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current.pinchDist = dist;
      gesture.current.moved += 100;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current.pinchDist = undefined;
  };

  // グリッド間隔: 画面上で 60px 以上になる最小の刻み
  const step = GRID_STEPS.find((s) => s * view.scale >= 60) ?? GRID_STEPS[GRID_STEPS.length - 1];
  const left = view.cx - size.w / 2 / view.scale;
  const top = view.cz - size.h / 2 / view.scale;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let x = Math.ceil(left / step) * step; x <= left + size.w / view.scale; x += step) xs.push(x);
  for (let z = Math.ceil(top / step) * step; z <= top + size.h / view.scale; z += step) zs.push(z);
  // 拠点を最前面に描く。ラベルは拠点→その他の順に、近くに既にラベルがあれば省く
  const ordered = [...places].sort((a, b) => Number(a.isHome) - Number(b.isHome));
  const labeled = new Set<string>();
  const taken: { x: number; y: number }[] = [];
  for (const p of [...ordered].reverse()) {
    const { sx, sy } = toScreen(p.x, p.z);
    if (taken.some((t) => Math.abs(t.x - sx) < 70 && Math.abs(t.y - sy) < 34)) continue;
    taken.push({ x: sx, y: sy });
    labeled.add(p.id);
  }

  return (
    <div className="map-wrap">
      <div
        ref={boxRef}
        className="map-box"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg width={size.w} height={size.h} role="img" aria-label="上から見たマップ">
          {xs.map((x) => {
            const { sx } = toScreen(x, 0);
            return (
              <g key={`x${x}`}>
                <line x1={sx} x2={sx} y1={0} y2={size.h} className={x === 0 ? 'axis' : 'grid'} />
                <text x={sx + 3} y={12} className="grid-label">{x}</text>
              </g>
            );
          })}
          {zs.map((z) => {
            const { sy } = toScreen(0, z);
            return (
              <g key={`z${z}`}>
                <line y1={sy} y2={sy} x1={0} x2={size.w} className={z === 0 ? 'axis' : 'grid'} />
                <text x={3} y={sy - 3} className="grid-label">{z}</text>
              </g>
            );
          })}
          {ordered.map((p) => {
            const { sx, sy } = toScreen(p.x, p.z);
            if (sx < -40 || sy < -40 || sx > size.w + 40 || sy > size.h + 40) return null;
            const cat = categoryMap.get(p.categoryId);
            return (
              <g
                key={p.id}
                transform={`translate(${sx},${sy})`}
                className={`marker${p.isHome ? ' home' : ''}${p.visited ? '' : ' want'}`}
                onClick={() => gesture.current.moved < 10 && onSelect(p)}
              >
                <circle r={p.isHome ? 20 : 16} />
                <text className="marker-icon" y={1} fontSize={p.isHome ? 20 : 16}>
                  {cat?.icon ?? '❓'}
                </text>
                {labeled.has(p.id) && (
                  <text className="marker-label" y={p.isHome ? 34 : 30}>
                    {p.name}
                  </text>
                )}
              </g>
            );
          })}
          {here && (() => {
            const { sx, sy } = toScreen(here.x, here.z);
            return (
              <g transform={`translate(${sx},${sy})`} className="here-marker">
                <circle r={7} />
                <text y={-12} className="marker-label">いまここ</text>
              </g>
            );
          })()}
        </svg>
        <div className="compass" aria-hidden>
          北↑
        </div>
        <div className="scale-label">1 マス = {step.toLocaleString('ja-JP')} ブロック</div>
      </div>
      <div className="map-controls">
        <button type="button" onClick={() => zoomAt(1.6)} aria-label="拡大">＋</button>
        <button type="button" onClick={() => zoomAt(1 / 1.6)} aria-label="縮小">－</button>
        {home && (
          <button type="button" onClick={() => setView((v) => ({ ...v, cx: home.x, cz: home.z }))} aria-label="拠点へ戻る">
            🏠
          </button>
        )}
        {here && (
          <button type="button" onClick={() => setView((v) => ({ ...v, cx: here.x, cz: here.z }))} aria-label="今いる座標へ">
            📍
          </button>
        )}
        <button type="button" onClick={fitAll} aria-label="全体を表示">⤢</button>
      </div>
    </div>
  );
}
