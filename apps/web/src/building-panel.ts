export type BuildingId = 'treasure' | 'farm' | 'alchemy' | 'beast' | 'practice' | 'meditate' | 'divination' | 'archive';

export type ActionId =
  | 'burst'
  | 'practice'
  | 'farm'
  | 'meditate'
  | 'alchemy'
  | 'breakthrough'
  | 'divination'
  | 'treasure'
  | 'beast';

export type BuildingPanelState = {
  player: {
    realmLevel: number;
    qi: number;
    spiritStone: number;
    spiritHerb: number;
    pills: number;
    cultivation: number;
    kindling: number;
  };
  homestead: {
    omen: {
      fortune: string;
      favors: string[];
      verse: string;
    } | null;
    treasureBasin: {
      dailyCondenses: number;
      lastCondensedAt: string | null;
    };
    spiritBeast: {
      name: string;
      status: 'idle' | 'traveling';
      route: string | null;
      returnsAt: string | null;
    };
    inventory: Array<{
      id: string;
      name: string;
      kind: 'herb' | 'stone' | 'pill' | 'curio';
      quantity: number;
      createdAt: string;
      description: string;
    }>;
    logs: Array<{
      id: string;
      type: 'omen' | 'treasure' | 'beast';
      title: string;
      body: string;
      occurredAt: string;
    }>;
  };
  progression: {
    nextPracticeCost: number;
    nextBreakthroughCost: number;
  };
};

export type BuildingPanel = {
  id: BuildingId;
  title: string;
  eyebrow: string;
  description: string;
  primaryAction: ActionId | null;
  primaryLabel: string | null;
  metrics: Array<{ label: string; value: string; body: string }>;
  entries: Array<{ title: string; body: string; tone?: 'default' | 'good' | 'warning' }>;
};

export const buildingsWithPanels: BuildingId[] = [
  'farm',
  'alchemy',
  'beast',
  'divination',
  'treasure',
  'practice',
  'meditate',
  'archive'
];

function formatNumber(value: number | undefined) {
  return typeof value === 'number' ? value.toLocaleString('zh-CN') : '--';
}

function formatShortTime(value: string | null | undefined) {
  if (!value) {
    return '未记录';
  }
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function inventoryEntries(state: BuildingPanelState) {
  if (state.homestead.inventory.length === 0) {
    return [{ title: '暂无藏品', body: '聚宝盆凝出的异物会暂存于此。', tone: 'warning' as const }];
  }

  return state.homestead.inventory.slice(0, 5).map((item) => ({
    title: `${item.name} x${item.quantity}`,
    body: item.description || '一件尚未鉴定的洞府藏品。',
    tone: 'default' as const
  }));
}

function recentLogEntries(state: BuildingPanelState, type?: 'omen' | 'treasure' | 'beast') {
  const logs = type ? state.homestead.logs.filter((log) => log.type === type) : state.homestead.logs;
  if (logs.length === 0) {
    return [{ title: '暂无记录', body: '此处尚未留下新的洞府札记。', tone: 'warning' as const }];
  }

  return logs.slice(0, 4).map((log) => ({
    title: log.title,
    body: `${log.body} ${formatShortTime(log.occurredAt)}`,
    tone: 'default' as const
  }));
}

export function buildingPanelFor(building: BuildingId, state: BuildingPanelState): BuildingPanel {
  if (building === 'farm') {
    return {
      id: building,
      title: '灵植园',
      eyebrow: '三畦灵田',
      description: '照看灵植园可获得灵草与少量灵石，是丹房和日常洞府运转的基础。',
      primaryAction: 'farm',
      primaryLabel: '照看灵植园',
      metrics: [
        { label: '灵草库存', value: formatNumber(state.player.spiritHerb), body: '用于开炉炼丹。' },
        { label: '灵石库存', value: formatNumber(state.player.spiritStone), body: '用于炼丹与灵兽出游。' }
      ],
      entries: [
        { title: '本次照看', body: `预计灵草 +${3 + state.player.realmLevel}，灵石 +2。`, tone: 'good' },
        { title: '今日宜事', body: state.homestead.omen?.favors.join('、') || '尚未观星起卦。' }
      ]
    };
  }

  if (building === 'alchemy') {
    return {
      id: building,
      title: '丹房',
      eyebrow: '炉火温养',
      description: '丹房将等量灵草与灵石炼成丹药。丹药是服丹破境的必要资源。',
      primaryAction: 'alchemy',
      primaryLabel: '开炉炼丹',
      metrics: [
        { label: '可用灵草', value: formatNumber(state.player.spiritHerb), body: '每炉消耗一份。' },
        { label: '可用灵石', value: formatNumber(state.player.spiritStone), body: '每炉消耗一枚。' },
        { label: '现有丹药', value: formatNumber(state.player.pills), body: '破境时消耗。' }
      ],
      entries: [
        {
          title: '本炉可成',
          body: `按当前材料可炼 ${formatNumber(Math.min(state.player.spiritHerb, state.player.spiritStone))} 枚丹药。`,
          tone: Math.min(state.player.spiritHerb, state.player.spiritStone) > 0 ? 'good' : 'warning'
        }
      ]
    };
  }

  if (building === 'beast') {
    const beast = state.homestead.spiritBeast;
    return {
      id: building,
      title: '兽栏',
      eyebrow: `${beast.name}的栖处`,
      description: '灵兽可携符下山出游，消耗一枚灵石，归来时带回山外灵草。',
      primaryAction: 'beast',
      primaryLabel: beast.status === 'traveling' ? '灵兽出游中' : '派遣灵兽',
      metrics: [
        { label: '灵兽状态', value: beast.status === 'traveling' ? '出游' : '待命', body: beast.route ? `当前路线：${beast.route}` : '兽栏风铃未响。' },
        { label: '归山时辰', value: formatShortTime(beast.returnsAt), body: '后台到点后会自动结算。' },
        { label: '出游消耗', value: '灵石 x1', body: `当前灵石 ${formatNumber(state.player.spiritStone)}。` }
      ],
      entries: recentLogEntries(state, 'beast')
    };
  }

  if (building === 'divination') {
    const omen = state.homestead.omen;
    return {
      id: building,
      title: '观星台',
      eyebrow: '朱批天机',
      description: '观星台会为今日洞府事务起卦，给出宜事与卦辞。后续玩法加成会从这里展开。',
      primaryAction: 'divination',
      primaryLabel: '观星起卦',
      metrics: [
        { label: '今日卦象', value: omen?.fortune ?? '未卜', body: omen?.verse ?? '星盘未启，山门诸事照常。' },
        { label: '今日宜事', value: omen?.favors.join('、') ?? '未批', body: '适合安排当日洞府节奏。' }
      ],
      entries: recentLogEntries(state, 'omen')
    };
  }

  if (building === 'treasure') {
    return {
      id: building,
      title: '聚宝盆',
      eyebrow: '薪火凝物',
      description: '聚宝盆以薪火为引，凝出灵草、灵石、丹药与异宝。每日最多凝物三次。',
      primaryAction: 'treasure',
      primaryLabel: '投入薪火凝聚',
      metrics: [
        { label: '薪火余量', value: formatNumber(state.player.kindling), body: '由 Token 化灵沉淀而来。' },
        { label: '今日凝物', value: `${state.homestead.treasureBasin.dailyCondenses} / 3`, body: '每日自动重置。' },
        { label: '上次凝物', value: formatShortTime(state.homestead.treasureBasin.lastCondensedAt), body: state.homestead.inventory[0]?.name ?? '盆中灵液尚未成形。' }
      ],
      entries: recentLogEntries(state, 'treasure')
    };
  }

  if (building === 'practice') {
    return {
      id: building,
      title: '阵枢',
      eyebrow: '引灵入体',
      description: '阵枢牵引灵池余炁，将其转化为修为。境界越高，单次修炼消耗越大。',
      primaryAction: 'practice',
      primaryLabel: '开始修炼',
      metrics: [
        { label: '灵池余炁', value: formatNumber(state.player.qi), body: '修炼时会消耗。' },
        { label: '本次消耗', value: formatNumber(state.progression.nextPracticeCost), body: '转化为修为。' },
        { label: '当前修为', value: formatNumber(state.player.cultivation), body: `破境需要 ${formatNumber(state.progression.nextBreakthroughCost)}。` }
      ],
      entries: [
        { title: '修炼收益', body: `预计修为 +${Math.floor(state.progression.nextPracticeCost * 1.5)}。`, tone: 'good' },
        { title: '破境准备', body: `当前进度 ${Math.min(100, Math.round((state.player.cultivation / state.progression.nextBreakthroughCost) * 100))}%。` }
      ]
    };
  }

  if (building === 'meditate') {
    return {
      id: building,
      title: '静室',
      eyebrow: '闭关打坐',
      description: '静室无需材料，适合在资源不足时稳定积累灵气与修为。',
      primaryAction: 'meditate',
      primaryLabel: '入定片刻',
      metrics: [
        { label: '静修灵气', value: `+${6 + state.player.realmLevel}`, body: '每次打坐稳定获得。' },
        { label: '心境修为', value: `+${4 + state.player.realmLevel}`, body: '每次打坐稳定获得。' },
        { label: '当前修为', value: formatNumber(state.player.cultivation), body: '可配合阵枢推进破境。' }
      ],
      entries: [{ title: '适合时机', body: '灵池余炁不足以修炼时，可以先入定补足。', tone: 'good' }]
    };
  }

  return {
    id: building,
    title: '藏经阁',
    eyebrow: '残卷归档',
    description: '藏经阁暂存聚宝盆凝出的异物与残卷。后续可扩展鉴定、研读与装备玩法。',
    primaryAction: null,
    primaryLabel: null,
    metrics: [
      { label: '藏品数量', value: formatNumber(state.homestead.inventory.length), body: '来自聚宝盆凝物。' },
      { label: '最近入库', value: state.homestead.inventory[0]?.name ?? '无', body: state.homestead.inventory[0]?.description ?? '阁中书香尚浅。' }
    ],
    entries: inventoryEntries(state)
  };
}
