export type PersistState = 'persisted' | 'denied' | 'unsupported' | 'error';

/** 端末に「データを消さないで」と要求する。拒否・未対応・失敗でもアプリは動き続ける */
export async function requestPersist(): Promise<PersistState> {
  try {
    if (!navigator.storage?.persist) return 'unsupported';
    if (await navigator.storage.persisted()) return 'persisted';
    return (await navigator.storage.persist()) ? 'persisted' : 'denied';
  } catch {
    return 'error';
  }
}

/** ホーム画面に追加して起動しているか */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * ファイルを端末に保存する。iPhone では共有シート（「"ファイル"に保存」）を使い、
 * 使えない環境ではダウンロードにする。ユーザーが共有を取り消したら false。
 */
export async function saveFile(name: string, text: string, type = 'application/json'): Promise<boolean> {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      // 共有に失敗したらダウンロードを試す
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
