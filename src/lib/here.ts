import type { CoordDraft } from '../components/CoordInput';
import type { Dimension } from './types';

/** 「今いる座標」はワールド×ディメンションごとに持つ */
export function hereKey(worldId: string, dimension: Dimension): string {
  return `${worldId}/${dimension}`;
}

/** 指定したワールド・ディメンションの「今いる座標」だけを置き換える */
export function setHere(
  heres: Record<string, CoordDraft>,
  worldId: string,
  dimension: Dimension,
  draft: CoordDraft,
): Record<string, CoordDraft> {
  return { ...heres, [hereKey(worldId, dimension)]: draft };
}
