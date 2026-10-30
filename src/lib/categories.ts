import type { Category, CategoryGroup, Dimension } from './types';

type Seed = [id: string, name: string, icon: string];
type GroupSeeds = Partial<Record<CategoryGroup, Seed[]>>;

const SEEDS: Record<Dimension, GroupSeeds> = {
  overworld: {
    mine: [
      ['ow-home', '拠点', '🏠'],
      ['ow-subbase', 'サブ拠点', '🏡'],
      ['ow-farm', '畑・牧場', '🌾'],
      ['ow-machine', '装置', '⚙️'],
      ['ow-portal', 'ネザーゲート', '🟪'],
      ['ow-building', '建築中', '🚧'],
      ['ow-marker', '目印', '📍'],
    ],
    structure: [
      ['ow-village', '村', '🏘️'],
      ['ow-outpost', 'ピリジャーの前哨基地', '🏴'],
      ['ow-mansion', '森の洋館', '🏚️'],
      ['ow-witch', '魔女の小屋', '🧙'],
      ['ow-igloo', 'イグルー', '⛄'],
      ['ow-pyramid', '砂漠のピラミッド', '🔺'],
      ['ow-jungle-temple', 'ジャングルの寺院', '🗿'],
      ['ow-trail-ruins', '旅路の遺跡', '🏺'],
      ['ow-ruined-portal', '荒廃したポータル', '🌀'],
      ['ow-monument', '海底神殿', '🔱'],
      ['ow-ocean-ruins', '海底遺跡', '🏛️'],
      ['ow-shipwreck', '難破船', '🚢'],
      ['ow-treasure', '埋もれた宝', '💰'],
      ['ow-mineshaft', '廃坑', '⛏️'],
      ['ow-dungeon', 'ダンジョン', '💀'],
      ['ow-stronghold', '要塞', '🏰'],
      ['ow-ancient-city', '古代都市', '🕯️'],
      ['ow-trial', 'トライアルチャンバー', '🗝️'],
    ],
    biome: [
      ['ow-plains', '平原', '🌱'],
      ['ow-sunflower', 'ヒマワリ平原', '🌻'],
      ['ow-forest', '森', '🌳'],
      ['ow-flower-forest', '花の森', '🌷'],
      ['ow-birch', 'シラカバの森', '🪵'],
      ['ow-dark-forest', '暗い森', '🌑'],
      ['ow-pale-garden', 'ペールガーデン', '👻'],
      ['ow-cherry', 'サクラの林', '🌸'],
      ['ow-meadow', '牧草地', '🐝'],
      ['ow-desert', '砂漠', '🏜️'],
      ['ow-savanna', 'サバンナ', '🦒'],
      ['ow-badlands', '荒野', '🟧'],
      ['ow-jungle', 'ジャングル', '🌴'],
      ['ow-bamboo', '竹林', '🎋'],
      ['ow-snowy', '雪原', '❄️'],
      ['ow-ice-spikes', '樹氷', '🧊'],
      ['ow-taiga', 'タイガ', '🌲'],
      ['ow-snowy-taiga', '雪のタイガ', '🎄'],
      ['ow-old-taiga', '巨大樹のタイガ', '🍂'],
      ['ow-peaks', '雪山・山頂', '🏔️'],
      ['ow-ocean', '海', '🌊'],
      ['ow-warm-ocean', '暖かい海', '🐠'],
      ['ow-swamp', '湿地', '🐸'],
      ['ow-mangrove', 'マングローブの湿地', '🌿'],
      ['ow-river', '川', '🏞️'],
      ['ow-beach', '砂浜', '🏖️'],
      ['ow-mushroom', 'キノコ島', '🍄'],
      ['ow-dripstone', '鍾乳洞', '🦇'],
      ['ow-lush', '繁茂した洞窟', '🍃'],
      ['ow-deep-dark', 'ディープダーク', '👁️'],
    ],
    resource: [
      ['ow-ore', 'ダイヤ・鉱石', '💎'],
      ['ow-lava', '溶岩湖', '🌋'],
      ['ow-view', '景色のいい所', '📸'],
      ['ow-danger', '危険な場所', '⚠️'],
      ['ow-other', 'その他', '❓'],
    ],
  },
  nether: {
    mine: [
      ['ne-home', '拠点', '🏠'],
      ['ne-portal', 'ネザーゲート', '🟪'],
      ['ne-marker', '目印', '📍'],
    ],
    structure: [
      ['ne-fortress', 'ネザー要塞', '🏯'],
      ['ne-bastion', '砦の遺跡', '🐷'],
    ],
    biome: [
      ['ne-wastes', 'ネザーの荒地', '🔥'],
      ['ne-soul', 'ソウルサンドの谷', '🦴'],
      ['ne-crimson', '真紅の森', '🌺'],
      ['ne-warped', '歪んだ森', '🫧'],
      ['ne-basalt', '玄武岩デルタ', '🌫️'],
    ],
    resource: [
      ['ne-debris', '古代の残骸', '🪨'],
      ['ne-other', 'その他', '❓'],
    ],
  },
  end: {
    mine: [['en-home', '拠点', '🏠']],
    structure: [
      ['en-exit', '帰還ポータル', '🐉'],
      ['en-city', 'エンドシティ', '🗼'],
      ['en-gateway', 'エンドゲートウェイ', '✨'],
    ],
    resource: [['en-other', 'その他', '❓']],
  },
};

export function builtinCategories(): Category[] {
  const list: Category[] = [];
  let order = 0;
  for (const [dimension, groups] of Object.entries(SEEDS) as [Dimension, GroupSeeds][]) {
    for (const [group, seeds] of Object.entries(groups) as [CategoryGroup, Seed[]][]) {
      for (const [id, name, icon] of seeds) {
        list.push({ id, dimension, group, name, icon, hidden: false, sortOrder: order++, builtin: true });
      }
    }
  }
  return list;
}

/** 各ディメンションで「拠点」に使う既定カテゴリ */
export const HOME_CATEGORY_ID: Record<Dimension, string> = {
  overworld: 'ow-home',
  nether: 'ne-home',
  end: 'en-home',
};
