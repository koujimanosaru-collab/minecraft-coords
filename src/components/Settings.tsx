import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { BACKUP_MAX_BYTES, backupFileName, buildBackup, estimateBackupBytes, parseBackupText, replaceAll } from '../lib/backup';
import { MAX_PHOTOS, SELFTEST, db, deleteAllPhotos, isQuotaError, photoStats, setMeta } from '../lib/db';
import { verifyPhotosDecodable } from '../lib/photo-verify';
import { createSelftestData, deleteSelftestData } from '../lib/selftest';
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

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function Settings({ persist, lastBackupAt, onClose, onImported, toast }: SettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [conv, setConv] = useState<CoordDraft>(EMPTY_DRAFT);
  const convCoords = draftToCoords(conv).coords;
  const stats = useLiveQuery(() => photoStats(), []);
  const placeCount = useLiveQuery(() => db.places.count(), []) ?? 0;
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [includePhotos, setIncludePhotos] = useState(false);
  // 書き出しは 2 段階: 作成 → サイズを見てから「保存・共有」（共有はボタンを押した直後に呼ぶ必要がある）
  const [prepared, setPrepared] = useState<{ name: string; text: string; bytes: number } | null>(null);
  const [selftestResult, setSelftestResult] = useState('');

  useEffect(() => {
    navigator.storage?.estimate?.().then(setEstimate).catch(() => setEstimate(null));
  }, [stats?.bytes]);

  const prepareBackup = async () => {
    setBusy('バックアップを作成しています…');
    setPrepared(null);
    try {
      const withPhotos = includePhotos && (stats?.count ?? 0) > 0;
      const data = await buildBackup(db, { includePhotos: withPhotos });
      const text = withPhotos ? JSON.stringify(data) : JSON.stringify(data, null, 2);
      const bytes = new Blob([text]).size;
      if (bytes > BACKUP_MAX_BYTES) {
        toast(`バックアップが ${mb(BACKUP_MAX_BYTES)} を超えるため作成できません`);
        return;
      }
      setPrepared({ name: backupFileName(), text, bytes });
    } catch {
      toast('バックアップを作成できませんでした');
    } finally {
      setBusy('');
    }
  };

  const shareBackup = async () => {
    if (!prepared) return;
    try {
      const ok = await saveFile(prepared.name, prepared.text);
      if (ok) {
        await setMeta('lastBackupAt', Date.now());
        setPrepared(null);
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
    if (file.size > BACKUP_MAX_BYTES) {
      setImportErrors([`ファイルが大きすぎます（${mb(BACKUP_MAX_BYTES)} まで）`]);
      return;
    }
    setBusy('バックアップを確かめています…');
    try {
      const result = parseBackupText(await file.text());
      if (!result.ok) {
        setImportErrors(result.errors.slice(0, 10));
        return;
      }
      const { worlds, places, photos } = result.data;
      // 画像は書き込む前に 1 枚ずつ実際に開けるか確かめる
      if (photos.length > 0) {
        const ok = await verifyPhotosDecodable(photos, (n) => setBusy(`画像を確かめています… ${n}/${photos.length}`));
        if (!ok) {
          setImportErrors(['開けない画像が含まれています']);
          return;
        }
      }
      setBusy('');
      const current = stats?.count ?? 0;
      const photoNote =
        photos.length > 0
          ? `画像 ${photos.length} 枚`
          : current > 0
            ? `このバックアップには画像がありません。今ある画像 ${current} 枚もすべて消えます`
            : '画像なし';
      const msg = `「${file.name}」から復元します。\nワールド ${worlds.length} 件・地点 ${places.length} 件・${photoNote}\n\n今のデータはすべて置き換わります。よろしいですか？`;
      if (!window.confirm(msg)) return;
      setBusy('復元しています…');
      await replaceAll(result.data);
      toast('復元しました');
      onImported();
    } catch (e) {
      const quota = isQuotaError(e);
      setImportErrors([quota ? 'iPhone の空き容量が足りないため復元できませんでした。今のデータはそのまま残っています' : '復元に失敗しました。今のデータはそのまま残っています']);
    } finally {
      setBusy('');
    }
  };

  const removeAllPhotos = async () => {
    if (!stats?.count || !window.confirm(`画像 ${stats.count} 枚をすべて削除します。地点は残ります。よろしいですか？`)) return;
    await deleteAllPhotos();
    toast('画像を削除しました');
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
        <h3>容量</h3>
        <p className="muted">
          地点の画像：{stats?.count ?? 0} 枚（{MAX_PHOTOS} 枚まで）・約 {mb(stats?.bytes ?? 0)}
          {SELFTEST && stats && `（${stats.bytes.toLocaleString('ja-JP')} バイト）`}
        </p>
        {estimate?.usage !== undefined && (
          <p className="muted">
            このアプリの推定使用量：約 {mb(estimate.usage)}
            {estimate.quota !== undefined && ` ／ 割り当て 約 ${mb(estimate.quota)}`}
          </p>
        )}
        {(stats?.count ?? 0) > 0 && (
          <button type="button" className="chip wide" onClick={removeAllPhotos}>
            画像をすべて削除
          </button>
        )}
      </section>

      <section className="form-section">
        <h3>バックアップ</h3>
        {(stats?.count ?? 0) > 0 && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={includePhotos}
              onChange={(e) => {
                setIncludePhotos(e.target.checked);
                setPrepared(null);
              }}
            />
            <span>画像も含める（約 {mb(estimateBackupBytes(stats?.bytes ?? 0, placeCount))}）</span>
          </label>
        )}
        {includePhotos && (
          <p className="photo-warn">保存先（共有先や iCloud Drive など）に、家の中が写った写真が渡ることがあります。</p>
        )}
        {prepared ? (
          <>
            <p>作成しました：{mb(prepared.bytes)}</p>
            <button type="button" className="chip primary wide" onClick={shareBackup}>
              保存・共有
            </button>
          </>
        ) : (
          <button type="button" className="chip primary wide" onClick={prepareBackup} disabled={!!busy}>
            バックアップを作成
          </button>
        )}
        <p className="muted">共有メニューで「"ファイル"に保存」を選ぶと、ファイル App に保存できます。</p>
        <button type="button" className="chip wide" onClick={() => fileRef.current?.click()}>
          バックアップから復元…
        </button>
        {busy && <p className="muted">{busy}</p>}
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

      {SELFTEST && (
        <section className="form-section">
          <h3>試験用データ（試験モード）</h3>
          <p className="muted">本番とは別の保存先です。地点 100 件と、上限に近い大きさの画像 100 枚を作ります。</p>
          <button
            type="button"
            className="chip wide"
            disabled={!!busy}
            onClick={async () => {
              try {
                const r = await createSelftestData((n) => setBusy(`作成中… ${n}/${MAX_PHOTOS}`));
                setSelftestResult(`画像 1 枚 ${r.min.toLocaleString('ja-JP')}〜${r.max.toLocaleString('ja-JP')} バイト・合計 ${r.total.toLocaleString('ja-JP')} バイト`);
              } catch (e) {
                setSelftestResult(`作成できませんでした: ${String(e)}`);
              } finally {
                setBusy('');
              }
            }}
          >
            試験用データを作る
          </button>
          <button
            type="button"
            className="chip wide"
            disabled={!!busy}
            onClick={async () => {
              await deleteSelftestData();
              toast('試験用データを削除しました');
            }}
          >
            試験用データを削除
          </button>
          {selftestResult && <p className="muted">{selftestResult}</p>}
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
