import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  clipPlanes,
  fitDistance,
  fitRadius,
  gridStep,
  pickNear,
  sceneOrigin,
  toScene,
  truncateLabel,
  type Vec3,
} from '../lib/scene3d';
import type { Category, Coords, Place } from '../lib/types';

interface MapView3DProps {
  places: Place[];
  categoryMap: Map<string, Category>;
  home: Place | undefined;
  here: Coords | null;
  onSelect: (p: Place) => void;
  onPickMany: (ps: Place[]) => void;
  onFallback2D: () => void;
}

const FOV = 50;
const ICON_PX = 48; // アイコン札の表示サイズ（CSS ピクセル）
const NAME_W = 128; // 名前札の表示サイズ
const NAME_H = 20;
const NAME_GAP = 22; // アイコン中心から名前札の上端まで
const TEX_SCALE = 2; // canvas は表示サイズの 2 倍（アイコン 96×96、名前 256×40）
const Y_SCALES = [1, 5, 10, 20]; // 高さ倍率の選択肢（ボタンで巡回）
const DEFAULT_Y_SCALE = 10;
const COLORS = { home: '#3f7d34', want: '#d39b00', normal: '#9aa093' };

type Status = 'ok' | 'unsupported' | 'lost';

interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  textures: Map<string, { tex: THREE.CanvasTexture; mat: THREE.SpriteMaterial }>;
  material: (key: string, draw: () => HTMLCanvasElement) => THREE.SpriteMaterial;
  sprites: { icon: THREE.Sprite; label: THREE.Sprite | null; name: string; place: Place }[];
  extras: THREE.Sprite[];
  radius: number;
  render: () => void;
}

/** アイコン札（白い円＋縁＋絵文字）の canvas。同じアイコン・状態で共有する */
function drawIcon(icon: string, ring: string, big: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ICON_PX * TEX_SCALE;
  c.height = ICON_PX * TEX_SCALE;
  const g = c.getContext('2d')!;
  g.scale(TEX_SCALE, TEX_SCALE);
  const mid = ICON_PX / 2;
  g.beginPath();
  g.arc(mid, mid, big ? 20 : 16, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = big ? 4 : 3;
  g.strokeStyle = ring;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${big ? 22 : 18}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.fillText(icon, mid, mid + 1);
  return c;
}

/** 名前札の canvas（256×40）。画面に名前を出すときだけ作る */
function drawName(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = NAME_W * TEX_SCALE;
  c.height = NAME_H * TEX_SCALE;
  const g = c.getContext('2d')!;
  g.scale(TEX_SCALE, TEX_SCALE);
  g.font = '600 11px -apple-system, "Hiragino Sans", sans-serif';
  const w = Math.min(g.measureText(name).width + 10, NAME_W - 2);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.roundRect((NAME_W - w) / 2, 1, w, NAME_H - 2, 5);
  g.fill();
  g.fillStyle = '#22251f';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, NAME_W / 2, NAME_H / 2 + 0.5, NAME_W - 8);
  return c;
}

function textSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.font = '700 56px -apple-system, "Hiragino Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 48, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  s.userData.px = [40, 40];
  return s;
}

/** グリッド・面・線のジオメトリとマテリアルを解放する（札のマテリアルはキャッシュ側で管理） */
function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Sprite) return;
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
}

export default function MapView3D({ places, categoryMap, home, here, onSelect, onPickMany, onFallback2D }: MapView3DProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<SceneCtx | null>(null);
  const [status, setStatus] = useState<Status>('ok');
  const [yScale, setYScale] = useState(DEFAULT_Y_SCALE);
  const [topView, setTopView] = useState(false);
  const fitRef = useRef<(top: boolean) => void>(() => {});
  const homeTargetRef = useRef<Vec3 | null>(null);
  const topViewRef = useRef(false);
  topViewRef.current = topView;
  const userMovedRef = useRef(false);
  const prevFrameRef = useRef<{ origin: { x: number; z: number }; yScale: number } | null>(null);
  const callbacks = useRef({ onSelect, onPickMany });
  callbacks.current = { onSelect, onPickMany };

  // レンダラー・カメラ・操作の作成と破棄
  useEffect(() => {
    const box = boxRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('unsupported');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    box.appendChild(renderer.domElement);
    const canvas = renderer.domElement;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.autoRotate = false;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI / 2 + 0.35; // 少しだけ下からも見られる
    const content = new THREE.Group();
    scene.add(content);

    const ctx: SceneCtx = {
      renderer,
      scene,
      camera,
      controls,
      content,
      textures: new Map(),
      material: (key, draw) => {
        let entry = ctx.textures.get(key);
        if (!entry) {
          const tex = new THREE.CanvasTexture(draw());
          tex.colorSpace = THREE.SRGBColorSpace;
          entry = { tex, mat: new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }) };
          ctx.textures.set(key, entry);
        }
        return entry.mat;
      },
      sprites: [],
      extras: [],
      radius: 32,
      render: () => {
        // カメラの行列を先に更新する（名前の間引きは更新後の向きで判定する）
        const dist = camera.position.distanceTo(controls.target);
        const { near, far } = clipPlanes(ctx.radius, dist);
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        // sizeAttenuation=false の札を画面上で一定ピクセルにする
        const h = canvas.clientHeight || 1;
        const k = (2 * Math.tan((FOV * Math.PI) / 360)) / h;
        for (const s of ctx.sprites) {
          const px = s.place.isHome ? ICON_PX * 1.15 : ICON_PX;
          s.icon.scale.set(px * k, px * k, 1);
        }
        declutter(k);
        for (const s of ctx.extras) s.scale.set(s.userData.px[0] * k, s.userData.px[1] * k, 1);
        renderer.render(scene, camera);
        canvas.dataset.textures = String(renderer.info.memory.textures);
        canvas.dataset.geometries = String(renderer.info.memory.geometries);
      },
    };
    // 名前が重なる札は名前を出さない（拠点 → 手前の札の順に名前を残す）。名前札は出すときに作る
    const v = new THREE.Vector3();
    const declutter = (k: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const items = ctx.sprites.map((s) => {
        v.copy(s.icon.position).project(camera);
        return { s, sx: ((v.x + 1) / 2) * w, sy: ((1 - v.y) / 2) * h, d: camera.position.distanceTo(s.icon.position) };
      });
      items.sort((a, b) => Number(b.s.place.isHome) - Number(a.s.place.isHome) || a.d - b.d);
      const taken: { x: number; y: number }[] = [];
      for (const { s, sx, sy } of items) {
        const clash = taken.some((t) => Math.abs(t.x - sx) < NAME_W - 10 && Math.abs(t.y - sy) < 30);
        if (clash) {
          if (s.label) s.label.visible = false;
          continue;
        }
        taken.push({ x: sx, y: sy });
        if (!s.label) {
          s.label = new THREE.Sprite(ctx.material(`n|${s.name}`, () => drawName(s.name)));
          s.label.center.set(0.5, 1 + NAME_GAP / NAME_H);
          s.label.position.copy(s.icon.position);
          s.label.renderOrder = s.icon.renderOrder;
          ctx.content.add(s.label);
        }
        s.label.scale.set(NAME_W * k, NAME_H * k, 1);
        s.label.visible = true;
      }
    };
    ctxRef.current = ctx;
    controls.addEventListener('change', ctx.render);
    // 一度でも視点を動かしたら、データが変わっても自動で全体表示し直さない
    const onStart = () => {
      userMovedRef.current = true;
    };
    controls.addEventListener('start', onStart);

    const resize = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      ctx.render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    // タップ判定（移動が小さいときだけ）
    let down: { x: number; y: number; moved: boolean; multi: boolean } | null = null;
    const pointers = new Set<number>();
    const onDown = (e: PointerEvent) => {
      pointers.add(e.pointerId);
      if (pointers.size === 1) down = { x: e.clientX, y: e.clientY, moved: false, multi: false };
      else if (down) down.multi = true;
    };
    const onMove = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.moved = true;
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (!down || down.moved || down.multi || pointers.size > 0) {
        if (pointers.size === 0) down = null;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const tx = e.clientX - rect.left;
      const ty = e.clientY - rect.top;
      down = null;
      const v = new THREE.Vector3();
      const items = ctx.sprites.map((s) => {
        v.copy(s.icon.position).project(camera);
        return { place: s.place, sx: ((v.x + 1) / 2) * rect.width, sy: ((1 - v.y) / 2) * rect.height, front: v.z < 1 };
      });
      const visible = items.filter((i) => i.front);
      // 一番近い札を決め、そのアイコンと重なっている札（中心が 40px 以内）も候補にする
      const first = pickNear(visible, tx, ty, 28)[0];
      const hits = first ? pickNear(visible, first.sx, first.sy, 40).map((i) => i.place) : [];
      if (hits.length === 1) callbacks.current.onSelect(hits[0]);
      else if (hits.length > 1) callbacks.current.onPickMany(hits);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    // 画面ロック・アプリ切替などで描画が止まったとき
    const onLost = (e: Event) => {
      e.preventDefault();
      setStatus('lost');
    };
    const onRestored = () => {
      setStatus('ok');
      ctx.render();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    return () => {
      ro.disconnect();
      controls.removeEventListener('change', ctx.render);
      controls.removeEventListener('start', onStart);
      controls.dispose();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      disposeObject(content);
      for (const { tex, mat } of ctx.textures.values()) {
        tex.dispose();
        mat.dispose();
      }
      for (const s of ctx.extras) {
        s.material.map?.dispose();
        s.material.dispose();
      }
      renderer.dispose();
      canvas.remove();
      ctxRef.current = null;
    };
  }, []);

  // 地点・倍率が変わったらシーンの中身を作り直す
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { content, textures } = ctx;
    disposeObject(content);
    content.clear();
    for (const s of ctx.extras) {
      s.material.map?.dispose();
      s.material.dispose();
    }
    ctx.extras = [];
    ctx.sprites = [];

    const all: Coords[] = [...places, ...(here ? [here] : [])];
    const origin = sceneOrigin(all, home ?? null);
    const pts: Vec3[] = all.map((p) => toScene(p, origin, yScale));
    const radius = fitRadius(pts);
    ctx.radius = radius;
    const step = gridStep(radius);

    // 基準面（海面）のグリッド。ワールド座標の step の倍数に線が来るようにずらす
    const size = Math.ceil((radius * 2.4) / step) * step;
    const divisions = Math.min(Math.round(size / step), 200);
    const grid = new THREE.GridHelper(size, divisions, 0x888888, 0xbbbbbb);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    (grid.material as THREE.Material).depthWrite = false;
    grid.position.set(Math.round(origin.x / step) * step - origin.x, 0, Math.round(origin.z / step) * step - origin.z);
    content.add(grid);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color: 0x5b8f4e, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.copy(grid.position);
    content.add(plane);

    // 方位
    const edge = size / 2;
    for (const [text, x, z] of [['北', 0, -edge], ['南', 0, edge], ['東', edge, 0], ['西', -edge, 0]] as const) {
      const s = textSprite(text, text === '北' ? '#c0392b' : '#8a8f84');
      s.position.set(x, 0, z);
      content.add(s);
      ctx.extras.push(s);
    }

    // 高さの線（1 つのジオメトリにまとめる）
    const linePos: number[] = [];
    for (const s of pts.slice(0, places.length)) linePos.push(s.x, 0, s.z, s.x, s.y, s.z);
    if (linePos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      content.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.8 })));
    }

    // 札。アイコンは見た目（アイコン・縁・拠点）ごとに共有、名前札は表示するときに作る
    const valid = new Set<string>();
    places.forEach((p, i) => {
      const icon = categoryMap.get(p.categoryId)?.icon ?? '❓';
      const ring = p.isHome ? COLORS.home : p.visited ? COLORS.normal : COLORS.want;
      const iconKey = `i|${icon}|${ring}|${p.isHome ? 1 : 0}`;
      const name = truncateLabel(p.name);
      valid.add(iconKey);
      valid.add(`n|${name}`);
      const sprite = new THREE.Sprite(ctx.material(iconKey, () => drawIcon(icon, ring, p.isHome)));
      sprite.position.set(pts[i].x, pts[i].y, pts[i].z);
      sprite.renderOrder = p.isHome ? 2 : 1;
      content.add(sprite);
      ctx.sprites.push({ icon: sprite, label: null, name, place: p });
    });
    // 今の地点で使わなくなったテクスチャを解放する
    for (const [key, { tex, mat }] of textures) {
      if (!valid.has(key)) {
        tex.dispose();
        mat.dispose();
        textures.delete(key);
      }
    }

    // 今いる座標
    if (here) {
      const s = textSprite('●', '#e53935');
      s.userData.px = [26, 26];
      const hp = pts[pts.length - 1];
      s.position.set(hp.x, hp.y, hp.z);
      s.renderOrder = 3;
      content.add(s);
      ctx.extras.push(s);
    }

    fitRef.current = (top: boolean) => {
      const c = ctxRef.current;
      if (!c) return;
      const d = fitDistance(radius, FOV, c.camera.aspect);
      c.controls.target.set(0, 0, 0);
      if (top) c.camera.position.set(0, d, 0.001);
      else c.camera.position.set(0, d * 0.6, d * 0.8);
      c.controls.minDistance = 2;
      c.controls.maxDistance = d * 6;
      c.controls.update();
      c.render();
    };
    const prev = prevFrameRef.current;
    prevFrameRef.current = { origin, yScale };
    if (!userMovedRef.current || !prev) {
      fitRef.current(topViewRef.current);
    } else {
      // 原点・高さ倍率が変わっても、同じワールド上の位置を見続けるようにカメラをずらす
      const { camera, controls } = ctx;
      const shift = new THREE.Vector3(prev.origin.x - origin.x, 0, prev.origin.z - origin.z);
      const offset = camera.position.clone().sub(controls.target);
      controls.target.add(shift);
      controls.target.y *= yScale / prev.yScale;
      camera.position.copy(controls.target).add(offset);
      controls.maxDistance = Math.max(fitDistance(radius, FOV, camera.aspect) * 6, offset.length());
      controls.update();
      ctx.render();
    }
    // 「拠点を中心に」用に拠点のシーン座標を保存
    homeTargetRef.current = home ? toScene(home, origin, yScale) : null;
  }, [places, categoryMap, home, here, yScale]);

  const dolly = (factor: number) => {
    const c = ctxRef.current;
    if (!c) return;
    userMovedRef.current = true;
    const offset = c.camera.position.clone().sub(c.controls.target).multiplyScalar(factor);
    const len = THREE.MathUtils.clamp(offset.length(), c.controls.minDistance, c.controls.maxDistance);
    c.camera.position.copy(c.controls.target).add(offset.setLength(len));
    c.controls.update();
  };

  const centerHome = () => {
    const c = ctxRef.current;
    const t = homeTargetRef.current;
    if (!c || !t) return;
    userMovedRef.current = true;
    const offset = c.camera.position.clone().sub(c.controls.target);
    c.controls.target.set(t.x, t.y, t.z);
    c.camera.position.copy(c.controls.target).add(offset);
    c.controls.update();
  };

  if (status === 'unsupported') {
    return (
      <div className="map3d-message">
        <p>この端末では 3D を表示できません。</p>
        <button type="button" className="chip primary" onClick={onFallback2D}>
          2D マップに戻す
        </button>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div ref={boxRef} className="map-box map3d-box" />
      {places.length === 0 && <p className="map3d-empty">表示する地点がありません</p>}
      {status === 'lost' && (
        <div className="map3d-message overlay">
          <p>3D の表示が止まりました。再開を待っています…</p>
          <button type="button" className="chip primary" onClick={onFallback2D}>
            2D マップに戻す
          </button>
        </div>
      )}
      <div className="map3d-top">
        <button
          type="button"
          className={`chip small${yScale > 1 ? ' active' : ''}`}
          aria-pressed={yScale > 1}
          onClick={() => setYScale(Y_SCALES[(Y_SCALES.indexOf(yScale) + 1) % Y_SCALES.length])}
        >
          高さ ×{yScale}
        </button>
        <button
          type="button"
          className="chip small"
          onClick={() => {
            const next = !topView;
            setTopView(next);
            userMovedRef.current = false;
            fitRef.current(next);
          }}
        >
          {topView ? '斜めから' : '真上から'}
        </button>
      </div>
      <div className="map-controls">
        <button type="button" onClick={() => dolly(1 / 1.6)} aria-label="拡大">＋</button>
        <button type="button" onClick={() => dolly(1.6)} aria-label="縮小">－</button>
        {home && (
          <button type="button" onClick={centerHome} aria-label="拠点を中心に">
            🏠
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            userMovedRef.current = false;
            fitRef.current(topView);
          }}
          aria-label="全体を表示"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
