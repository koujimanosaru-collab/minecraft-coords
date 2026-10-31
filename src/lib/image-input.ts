/**
 * 写真を開くときの共通の入口（地点の画像と、写真からの座標読み取りの両方で使う）。
 * 大きすぎる写真はデコードする前に断り、開いた写真は長辺 MAX_PHOTO_SIDE 以下の canvas にする（原寸の canvas は作らない）。
 */
import { headerSize } from './image-header';

/** 開く写真のファイルの大きさの上限 */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** 開く写真の画素数の上限（iPhone の 48MP 写真 8064×6048＝約 4877 万画素が入る値。iPhone で安全かは実機で未確認） */
export const MAX_PIXELS = 50_000_000;
/** 開いた写真を保持する長辺の上限（メモリ対策） */
export const MAX_PHOTO_SIDE = 2400;

export class ImageInputError extends Error {
  constructor(public kind: 'too-big-file' | 'too-many-pixels' | 'decode') {
    super(kind);
  }
}

export const IMAGE_INPUT_TEXT: Record<ImageInputError['kind'], string> = {
  'too-big-file': '写真のファイルが大きすぎます（30MB まで）',
  'too-many-pixels': '写真の画素数が大きすぎます（5000 万画素まで）',
  decode: '写真を開けませんでした。別の写真で試してください',
};

/** デコードする前に、ファイルの大きさと（JPEG・PNG なら）画素数を確かめる */
export async function checkImageFile(file: Blob): Promise<void> {
  if (file.size > MAX_FILE_BYTES) throw new ImageInputError('too-big-file');
  // 寸法の情報は先頭にある（EXIF の後ろでも 512KB 以内）
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const size = headerSize(head);
  if (size && size.width * size.height > MAX_PIXELS) throw new ImageInputError('too-many-pixels');
}

/** 写真ファイルを、向きを補正したうえで長辺 MAX_PHOTO_SIDE 以下の canvas にする */
export async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  await checkImageFile(file);
  const url = URL.createObjectURL(file);
  try {
    // img 要素は EXIF の向きを反映して描画される。decode() は環境によって終わらないことがあるので load を待つ
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageInputError('decode'));
      el.src = url;
    });
    // ヘッダーから寸法を読めない形式（HEIC など）は、ここで確かめる
    if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) throw new ImageInputError('too-many-pixels');
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** canvas を解放する（iOS は canvas のメモリ上限が厳しい） */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined) {
  if (c) {
    c.width = 0;
    c.height = 0;
  }
}
