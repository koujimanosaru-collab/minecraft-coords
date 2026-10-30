import { COORD_LIMIT, type Coords } from '../types';

/** 数字・記号 1 文字ごとの確信度の最低値の下限（B-1 の調整用画像で決めた値） */
export const MIN_SYMBOL_CONFIDENCE = 60;

/**
 * OCR の結果から座標を決める。少しでも怪しければ null（推測した値は出さない）。
 * 「位置: X, Y, Z」の最後の「:」より後ろが、空白を除いて「整数,整数,整数」に完全に一致する場合だけ採用する。
 */
export function decideCoords(text: string, minSymbolConfidence: number): Coords | null {
  if (minSymbolConfidence < MIN_SYMBOL_CONFIDENCE) return null;
  const tail = text.split(':').pop()!.replace(/\s+/g, '');
  const m = /^(-?\d{1,8}),(-?\d{1,8}),(-?\d{1,8})$/.exec(tail);
  if (!m) return null;
  const [x, y, z] = [m[1], m[2], m[3]].map(Number);
  if (y < -64 || y > 320) return null;
  if (Math.abs(x) > COORD_LIMIT || Math.abs(z) > COORD_LIMIT) return null;
  return { x, y, z };
}

/**
 * 座標部分（最後の「:」より右）の数字・マイナス・コンマの確信度の最低値。
 * 左側の「位置」の部分は数字に限定した OCR では意味のない記号になるので含めない
 */
export function coordSymbolConfidence(symbols: { text: string; confidence: number }[]): number {
  const lastColon = symbols.map((s) => s.text).lastIndexOf(':');
  const coord = symbols.slice(lastColon + 1).filter((s) => /^[0-9,-]$/.test(s.text));
  return coord.length ? Math.min(...coord.map((s) => s.confidence)) : 0;
}
