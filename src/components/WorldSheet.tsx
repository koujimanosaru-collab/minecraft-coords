import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { addWorld, db, deleteWorld } from '../lib/db';
import type { World } from '../lib/types';
import { Sheet } from './Sheet';

interface WorldSheetProps {
  /** undefined なら新規追加 */
  world?: World;
  worldCount: number;
  onClose: () => void;
  onDone: (msg: string, selectId?: string) => void;
}

export function WorldSheet({ world, worldCount, onClose, onDone }: WorldSheetProps) {
  const placeCount = useLiveQuery(() => (world ? db.places.where('worldId').equals(world.id).count() : 0), [world?.id]) ?? 0;
  const [name, setName] = useState(world?.name ?? '');
  const trimmed = name.trim();

  const save = async () => {
    if (!trimmed) return;
    if (world) {
      await db.worlds.update(world.id, { name: trimmed.slice(0, 100) });
      onDone('名前を変えました');
    } else {
      const id = await addWorld(trimmed.slice(0, 100));
      onDone(`「${trimmed}」を追加しました`, id);
    }
  };

  const remove = async () => {
    if (!world) return;
    const msg = `ワールド「${world.name}」と、その地点 ${placeCount} 件をすべて削除します。元に戻せません。よろしいですか？`;
    if (!window.confirm(msg)) return;
    await deleteWorld(world.id);
    onDone('ワールドを削除しました');
  };

  return (
    <Sheet
      title={world ? 'ワールドの設定' : 'ワールドを追加'}
      onClose={onClose}
      closeLabel="キャンセル"
      action={
        <button type="button" className="text-btn strong" onClick={save} disabled={!trimmed}>
          保存
        </button>
      }
    >
      <section className="form-section">
        <h3>ワールドの名前</h3>
        <input
          type="text"
          className="text-input"
          value={name}
          maxLength={100}
          placeholder="例：Realms のワールド"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </section>
      {world && (
        <section className="form-section">
          {worldCount > 1 ? (
            <button type="button" className="danger-btn" onClick={remove}>
              このワールドを削除（地点 {placeCount} 件）
            </button>
          ) : (
            <p className="muted">ワールドが 1 つだけのときは削除できません</p>
          )}
        </section>
      )}
    </Sheet>
  );
}
