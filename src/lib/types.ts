export const DIMENSIONS = ['overworld', 'nether', 'end'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  overworld: 'オーバーワールド',
  nether: 'ネザー',
  end: 'エンド',
};

export const CATEGORY_GROUPS = ['mine', 'structure', 'biome', 'resource'] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  mine: '自分の場所',
  structure: '構造物',
  biome: 'バイオーム',
  resource: '資源・その他',
};

export interface World {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
}

export interface Category {
  id: string;
  dimension: Dimension;
  group: CategoryGroup;
  name: string;
  icon: string;
  hidden: boolean;
  sortOrder: number;
  builtin: boolean;
}

export interface Place {
  id: string;
  worldId: string;
  dimension: Dimension;
  categoryId: string;
  name: string;
  x: number;
  y: number;
  z: number;
  memo: string;
  visited: boolean;
  isHome: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Coords {
  x: number;
  y: number;
  z: number;
}

/** Bedrock のワールド境界（X/Z） */
export const COORD_LIMIT = 30_000_000;
