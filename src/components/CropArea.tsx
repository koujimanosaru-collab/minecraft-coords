import { useEffect, useRef, useState } from 'react';
import { releaseCanvas } from '../lib/image-input';
import type { Rect } from '../lib/photo';

/** 写真を表示し、1 本指で範囲を囲む（角の近くから始めると角を動かす）。2 本指で拡大・移動 */
export function CropArea({ photo, rect, onRect }: { photo: HTMLCanvasElement; rect: Rect | null; onRect: (r: Rect | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 }); // 表示倍率（画面px / 写真px）と平行移動
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ mode: 'draw' | 'corner'; ax: number; ay: number } | null>(null);
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);

  // 最初は写真の幅を画面の幅に合わせる
  useEffect(() => {
    const box = boxRef.current!;
    const fit = box.clientWidth / photo.width;
    setView({ scale: fit, tx: 0, ty: 0 });
  }, [photo]);

  useEffect(() => {
    const c = canvasRef.current;
    const box = boxRef.current;
    if (!c || !box) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = box.clientWidth;
    const h = box.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#111';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(photo, view.tx, view.ty, photo.width * view.scale, photo.height * view.scale);
    if (rect) {
      const x = view.tx + rect.x * view.scale;
      const y = view.ty + rect.y * view.scale;
      const rw = rect.w * view.scale;
      const rh = rect.h * view.scale;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, 0, w, y);
      g.fillRect(0, y + rh, w, h - y - rh);
      g.fillRect(0, y, x, rh);
      g.fillRect(x + rw, y, w - x - rw, rh);
      g.strokeStyle = '#ffd400';
      g.lineWidth = 2;
      g.strokeRect(x, y, rw, rh);
      g.fillStyle = '#ffd400';
      for (const [cx, cy] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) g.fillRect(cx - 5, cy - 5, 10, 10);
    }
  }, [photo, view, rect]);

  useEffect(() => {
    const c = canvasRef.current;
    return () => releaseCanvas(c);
  }, []);

  const local = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toPhoto = (p: { x: number; y: number }) => ({
    x: Math.min(photo.width, Math.max(0, (p.x - view.tx) / view.scale)),
    y: Math.min(photo.height, Math.max(0, (p.y - view.ty) / view.scale)),
  });
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      drag.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    const p = local(e);
    // 既存の範囲の角の近く（24px 以内）なら、反対側の角を固定して動かす
    if (rect) {
      const corners = [
        [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h],
        [rect.x + rect.w, rect.y, rect.x, rect.y + rect.h],
        [rect.x, rect.y + rect.h, rect.x + rect.w, rect.y],
        [rect.x + rect.w, rect.y + rect.h, rect.x, rect.y],
      ];
      for (const [cx, cy, ox, oy] of corners) {
        if (Math.hypot(view.tx + cx * view.scale - p.x, view.ty + cy * view.scale - p.y) < 24) {
          drag.current = { mode: 'corner', ax: ox, ay: oy };
          return;
        }
      }
    }
    const a = toPhoto(p);
    drag.current = { mode: 'draw', ax: a.x, ay: a.y };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const k = dist / pinch.current.dist;
      const prev = pinch.current;
      setView((v) => {
        const fit = boxRef.current!.clientWidth / photo.width;
        const scale = Math.min(fit * 8, Math.max(fit, v.scale * k));
        const kk = scale / v.scale;
        return { scale, tx: mx - (prev.mx - v.tx) * kk, ty: my - (prev.my - v.ty) * kk };
      });
      pinch.current = { dist, mx, my };
      return;
    }
    if (drag.current) {
      const b = toPhoto(local(e));
      onRect(rectFrom({ x: drag.current.ax, y: drag.current.ay }, b));
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      // 小さすぎる範囲は取り消す
      if (rect && (rect.w * view.scale < 20 || rect.h * view.scale < 8)) onRect(null);
    }
  };

  return (
    <div ref={boxRef} className="crop-area" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <canvas ref={canvasRef} />
    </div>
  );
}
