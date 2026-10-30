import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CategoryManager } from './components/CategoryManager';
import { EMPTY_DRAFT, draftToCoords, type CoordDraft } from './components/CoordInput';
import { FilterSheet } from './components/FilterSheet';
import { HomeCard } from './components/HomeCard';
import { MapView } from './components/MapView';
import { PlaceDetail } from './components/PlaceDetail';
import { PlaceForm, type PlaceFormInit } from './components/PlaceForm';
import { PlaceList } from './components/PlaceList';
import { Settings } from './components/Settings';
import { WorldSheet } from './components/WorldSheet';
import { HOME_CATEGORY_ID } from './lib/categories';
import { db, ensureSeed, getMeta } from './lib/db';
import { isStandalone, requestPersist, type PersistState } from './lib/device';
import { DEFAULT_FILTER, SORT_LABELS, filterAndSort, type PlaceFilter, type SortKey } from './lib/places';
import { DIMENSIONS, DIMENSION_LABELS, type Dimension, type World } from './lib/types';

type SheetState =
  | { type: 'form'; init: PlaceFormInit }
  | { type: 'detail'; id: string }
  | { type: 'world'; world?: World }
  | { type: 'filter' }
  | { type: 'categories' }
  | { type: 'settings' }
  | null;

const BACKUP_REMIND_MS = 14 * 24 * 60 * 60 * 1000;

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても動作は続ける
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [worldId, setWorldId] = useState(() => loadPref('worldId', ''));
  const [dimension, setDimension] = useState<Dimension>(() => {
    const d = loadPref('dimension', 'overworld') as Dimension;
    return DIMENSIONS.includes(d) ? d : 'overworld';
  });
  const [view, setView] = useState<'list' | 'map'>(() => (loadPref('view', 'list') === 'map' ? 'map' : 'list'));
  const [filter, setFilter] = useState<PlaceFilter>(DEFAULT_FILTER);
  const [heres, setHeres] = useState<Record<string, CoordDraft>>({});
  const [sheet, setSheet] = useState<SheetState>(null);
  const [persist, setPersist] = useState<PersistState | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2200);
  }, []);

  useEffect(() => {
    ensureSeed()
      .catch(() => toast('データを開けませんでした'))
      .finally(() => setReady(true));
    requestPersist().then(setPersist);
  }, [toast]);

  const worlds = useLiveQuery(() => db.worlds.orderBy('sortOrder').toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy('sortOrder').toArray(), []);
  const lastBackupAt = useLiveQuery(() => getMeta<number>('lastBackupAt'), []);
  const totalPlaces = useLiveQuery(() => db.places.count(), []);

  // 保存されたワールドが無ければ先頭のワールドを使う
  const world = worlds?.find((w) => w.id === worldId) ?? worlds?.[0];
  const activeWorldId = world?.id ?? '';
  useEffect(() => {
    if (world && world.id !== worldId) setWorldId(world.id);
  }, [world, worldId]);
  useEffect(() => savePref('worldId', worldId), [worldId]);
  useEffect(() => savePref('dimension', dimension), [dimension]);
  useEffect(() => savePref('view', view), [view]);

  const places = useLiveQuery(
    () => db.places.where('[worldId+dimension]').equals([activeWorldId, dimension]).toArray(),
    [activeWorldId, dimension],
  );

  const categoryMap = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
  const dimCategories = useMemo(() => (categories ?? []).filter((c) => c.dimension === dimension), [categories, dimension]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places ?? []) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, [places]);
  const home = places?.find((p) => p.isHome);
  const hereKey = `${activeWorldId}/${dimension}`;
  const hereDraft = heres[hereKey] ?? EMPTY_DRAFT;
  const herePos = draftToCoords(hereDraft).coords;

  // ディメンションが変わったらカテゴリの絞り込みは外す
  useEffect(() => setFilter((f) => ({ ...f, categoryIds: [] })), [dimension]);

  const shown = useMemo(() => filterAndSort(places ?? [], filter, home ?? null), [places, filter, home]);
  const filtered = filter.categoryIds.length > 0 || filter.onlyUnvisited;

  if (!ready || !worlds || !categories || !places || !world) {
    return <div className="loading">読み込み中…</div>;
  }

  const close = () => setSheet(null);
  const detailPlace = sheet?.type === 'detail' ? places.find((p) => p.id === sheet.id) : undefined;
  const needsBackup = (totalPlaces ?? 0) > 0 && (!lastBackupAt || Date.now() - lastBackupAt > BACKUP_REMIND_MS);

  return (
    <div className={`app dim-${dimension}`}>
      <header className="top">
        <HomeCard
          home={home}
          icon={home ? (categoryMap.get(home.categoryId)?.icon ?? '🏠') : '🏠'}
          here={hereDraft}
          onHereChange={(d) => setHeres((h) => ({ ...h, [hereKey]: d }))}
          onRecordHere={() => setSheet({ type: 'form', init: { draft: hereDraft } })}
          onOpenHome={() => home && setSheet({ type: 'detail', id: home.id })}
          onAddHome={() =>
            setSheet({ type: 'form', init: { categoryId: HOME_CATEGORY_ID[dimension], isHome: true, draft: hereDraft } })
          }
          toast={toast}
        />
      </header>

      {(needsBackup || !isStandalone()) && (
        <button type="button" className="notice" onClick={() => setSheet({ type: 'settings' })}>
          {needsBackup ? '💾 しばらくバックアップしていません。タップして書き出す' : '📲 ホーム画面に追加すると使いやすくなります'}
        </button>
      )}

      <div className="toolbar">
        <button
          type="button"
          className={`chip${filter.categoryIds.length ? ' active' : ''}`}
          onClick={() => setSheet({ type: 'filter' })}
        >
          絞り込み{filter.categoryIds.length ? `（${filter.categoryIds.length}）` : ''}
        </button>
        <button
          type="button"
          className={`chip${filter.onlyUnvisited ? ' active' : ''}`}
          aria-pressed={filter.onlyUnvisited}
          onClick={() => setFilter({ ...filter, onlyUnvisited: !filter.onlyUnvisited })}
        >
          ☆ まだ行ってない
        </button>
        {view === 'list' && (
          <select
            className="chip select"
            value={filter.sort}
            aria-label="並べ替え"
            onChange={(e) => setFilter({ ...filter, sort: e.target.value as SortKey })}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {k === 'distance' && !home ? '新しい順（拠点なし）' : SORT_LABELS[k]}
              </option>
            ))}
          </select>
        )}
        <span className="count">{shown.length} 件</span>
      </div>

      <main className="content">
        {view === 'list' ? (
          <PlaceList
            places={shown}
            categoryMap={categoryMap}
            home={home}
            filtered={filtered}
            onSelect={(p) => setSheet({ type: 'detail', id: p.id })}
          />
        ) : (
          <MapView
            key={hereKey}
            places={shown}
            categoryMap={categoryMap}
            home={home}
            here={herePos}
            onSelect={(p) => setSheet({ type: 'detail', id: p.id })}
          />
        )}
      </main>

      <footer className="bottom">
        <nav className="world-tabs" aria-label="ワールド">
          {worlds.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`world-tab${w.id === activeWorldId ? ' active' : ''}`}
              onClick={() => (w.id === activeWorldId ? setSheet({ type: 'world', world: w }) : setWorldId(w.id))}
            >
              {w.name}
              {w.id === activeWorldId && <span className="tab-edit"> ✎</span>}
            </button>
          ))}
          <button type="button" className="world-tab add" onClick={() => setSheet({ type: 'world' })} aria-label="ワールドを追加">
            ＋
          </button>
        </nav>
        <div className="dim-switch" role="tablist" aria-label="ディメンション">
          {DIMENSIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === dimension}
              className={`dim-btn dim-btn-${d}${d === dimension ? ' active' : ''}`}
              onClick={() => setDimension(d)}
            >
              {DIMENSION_LABELS[d]}
            </button>
          ))}
        </div>
        <nav className="nav-bar">
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <span>📋</span>一覧
          </button>
          <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            <span>🗺️</span>マップ
          </button>
          <button
            type="button"
            className="add-btn"
            aria-label="地点を記録"
            onClick={() => setSheet({ type: 'form', init: { draft: hereDraft } })}
          >
            ＋
          </button>
          <button type="button" onClick={() => setSheet({ type: 'categories' })}>
            <span>🏷️</span>カテゴリ
          </button>
          <button type="button" onClick={() => setSheet({ type: 'settings' })}>
            <span>⚙️</span>設定
          </button>
        </nav>
      </footer>

      {sheet?.type === 'form' && (
        <PlaceForm
          init={sheet.init}
          worldId={sheet.init.place?.worldId ?? activeWorldId}
          dimension={sheet.init.place?.dimension ?? dimension}
          categories={categories}
          onClose={close}
          onSaved={(msg) => {
            toast(msg);
            close();
          }}
        />
      )}
      {sheet?.type === 'detail' && detailPlace && (
        <PlaceDetail
          place={detailPlace}
          category={categoryMap.get(detailPlace.categoryId)}
          home={home}
          here={herePos}
          onClose={close}
          onEdit={() => setSheet({ type: 'form', init: { place: detailPlace } })}
          toast={toast}
        />
      )}
      {sheet?.type === 'world' && (
        <WorldSheet
          world={sheet.world}
          worldCount={worlds.length}
          onClose={close}
          onDone={(msg, id) => {
            toast(msg);
            if (id) setWorldId(id);
            close();
          }}
        />
      )}
      {sheet?.type === 'filter' && (
        <FilterSheet filter={filter} categories={dimCategories} counts={counts} onChange={setFilter} onClose={close} />
      )}
      {sheet?.type === 'categories' && (
        <CategoryManager dimension={dimension} categories={categories} counts={counts} onClose={close} toast={toast} />
      )}
      {sheet?.type === 'settings' && (
        <Settings
          persist={persist}
          lastBackupAt={lastBackupAt}
          onClose={close}
          onImported={() => {
            setFilter(DEFAULT_FILTER);
            setHeres({});
            close();
          }}
          toast={toast}
        />
      )}

      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
