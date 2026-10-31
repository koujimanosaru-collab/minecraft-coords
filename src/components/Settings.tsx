import { useRef, useState } from 'react';
import { backupFileName, buildBackup, parseBackupText, replaceAll } from '../lib/backup';
import { setMeta } from '../lib/db';
import { isStandalone, saveFile, type PersistState } from '../lib/device';
import { convertDimension, formatCoords } from '../lib/geo';
import { CoordFields, EMPTY_DRAFT, draftToCoords, type CoordDraft } from './CoordInput';
import { Sheet } from './Sheet';

interface SettingsProps {
  persist: PersistState | null;
  lastBackupAt: number | undefined;
  onClose: () => void;
  onImported: () => void;
  toast: (msg: string) => void;
}

const PERSIST_TEXT: Record<PersistState, string> = {
  persisted: '保護されています（それでもバックアップはおすすめです）',
  denied: '保護されていません。こまめにバックアップしてください',
  unsupported: 'この環境では保護を要求できません。こまめにバックアップしてください',
  error: '状態を確認できませんでした。こまめにバックアップしてください',
};

/** ホーム画面から起動していれば、未使用期間による削除の対象外（WebKit の方針）なので不安をあおらない説明にする */
const STANDALONE_TEXT =
  'ホーム画面から起動しているので、使わない期間があってもデータは消えません。iPhone の空き容量が少なくなったときや機種変更に備えて、ときどきバックアップしてください。';

export function Settings({ persist, lastBackupAt, onClose, onImported, toast }: SettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [conv, setConv] = useState<CoordDraft>(EMPTY_DRAFT);
  const convCoords = draftToCoords(conv).coords;

  const exportBackup = async () => {
    try {
      const data = await buildBackup();
      const ok = await saveFile(backupFileName(), JSON.stringify(data, null, 2));
      if (ok) {
        await setMeta('lastBackupAt', Date.now());
        toast('バックアップを書き出しました');
      }
    } catch {
      toast('書き出せませんでした');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setImportErrors([]);
    const result = parseBackupText(await file.text());
    if (!result.ok) {
      setImportErrors(result.errors.slice(0, 10));
      return;
    }
    const { worlds, places } = result.data;
    const msg = `「${file.name}」から復元します。\nワールド ${worlds.length} 件・地点 ${places.length} 件\n\n今のデータはすべて置き換わります。よろしいですか？`;
    if (!window.confirm(msg)) return;
    try {
      await replaceAll(result.data);
      toast('復元しました');
      onImported();
    } catch {
      setImportErrors(['復元に失敗しました。今のデータはそのまま残っています']);
    }
  };

  return (
    <Sheet title="設定・バックアップ" onClose={onClose}>
      <section className="form-section disclaimer">
        <h3>このアプリについて</h3>
        <p>
          Minecraft の公式アプリではありません。Mojang Studios・Microsoft とは関係ありません。
          <br />
          NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
        </p>
      </section>

      <section className="form-section">
        <h3>データの保存場所</h3>
        <p>
          記録した地点は<strong>この iPhone の中だけ</strong>に保存されています。iPhone の変更や、まれに iOS
          の判断で消えることがあるので、ときどきバックアップしてください。
        </p>
        <p className="muted">
          保護の状態：
          {!persist
            ? '確認中…'
            : persist !== 'persisted' && isStandalone()
              ? STANDALONE_TEXT
              : PERSIST_TEXT[persist]}
        </p>
        <p className="muted">
          最後のバックアップ：{lastBackupAt ? new Date(lastBackupAt).toLocaleString('ja-JP') : 'まだありません'}
        </p>
      </section>

      <section className="form-section">
        <h3>バックアップ</h3>
        <button type="button" className="chip primary wide" onClick={exportBackup}>
          バックアップを書き出す
        </button>
        <p className="muted">共有メニューで「"ファイル"に保存」を選ぶと、ファイル App に保存できます。</p>
        <button type="button" className="chip wide" onClick={() => fileRef.current?.click()}>
          バックアップから復元…
        </button>
        <input ref={fileRef} type="file" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {importErrors.length > 0 && (
          <ul className="errors" role="alert">
            <li>復元しませんでした（今のデータはそのままです）</li>
            {importErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      {!isStandalone() && (
        <section className="form-section">
          <h3>ホーム画面に追加</h3>
          <p>
            Safari の共有ボタン（□↑）→「ホーム画面に追加」で、アプリのようにすぐ開けます。ホーム画面から開くと、データも消えにくくなります。
          </p>
        </section>
      )}

      <section className="form-section">
        <h3>ネザー座標の換算</h3>
        <p className="muted">オーバーワールドの座標を入れると、ネザーでの座標（X・Z を 8 で割る）を出します。</p>
        <CoordFields draft={conv} onChange={setConv} />
        {convCoords && (
          <dl className="detail-list">
            <dt>ネザーだと</dt>
            <dd>{formatCoords(convertDimension(convCoords, 'overworld')!.coords)}</dd>
            <dt>ネザーの座標として見ると、オーバーワールドでは</dt>
            <dd>{formatCoords(convertDimension(convCoords, 'nether')!.coords)}</dd>
          </dl>
        )}
      </section>

      <p className="muted center">マイクラ座標メモ v{__APP_VERSION__}</p>
    </Sheet>
  );
}
