// ============================================================
// blocks.js — 方块与物品注册表（纯数据，无副作用）
// 方块 id 为 0..255 的整数，用于区块 Uint8Array；
// 物品 id 为字符串，用于背包/合成。
// ============================================================

export const BLOCK = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  COBBLE: 4,
  SAND: 5,
  SANDSTONE: 6,
  GRAVEL: 7,
  LOG: 8,
  LEAVES: 9,
  PLANKS: 10,
  GLASS: 11,
  WATER: 12,
  BEDROCK: 13,
  COAL_ORE: 14,
  IRON_ORE: 15,
  GOLD_ORE: 16,
  DIAMOND_ORE: 17,
  SNOW: 18,
  ICE: 19,
  CRAFTING_TABLE: 20,
  TORCH: 21,
  ROSE: 22,
  DANDELION: 23,
  TALL_GRASS: 24,
  STONE_BRICKS: 25,
  OBSIDIAN: 26,
  GLOWSTONE: 27,
  LAVA: 28,
  WOOL: 29,
  BRICK: 30,
  BIRCH_LOG: 31,
  BIRCH_LEAVES: 32,
  BIRCH_PLANKS: 33,
  SPRUCE_LOG: 34,
  SPRUCE_LEAVES: 35,
  SPRUCE_PLANKS: 36,
  CACTUS: 37,
  CLAY: 38,
  FURNACE: 39,
  CHEST: 40,
  BED: 41,
  FARMLAND: 42,
  WHEAT_0: 43,
  WHEAT_1: 44,
  WHEAT_2: 45,
  WHEAT_3: 46,
  WATER_FLOW_1: 47,
  WATER_FLOW_2: 48,
  WATER_FLOW_3: 49,
  WATER_FLOW_4: 50,
  WATER_FLOW_5: 51,
  WATER_FLOW_6: 52,
  WATER_FLOW_7: 53,
  TNT: 54,
  DOOR_X: 55,
  DOOR_Z: 56,
  DOOR_X_OPEN: 57,
  DOOR_Z_OPEN: 58,
  FENCE: 59,
  ENCHANTING_TABLE: 60,
  BREWING_STAND: 61,
  NETHERRACK: 62,
  NETHER_PORTAL: 63,
  FIRE: 64,
  END_STONE: 65,
  END_PORTAL: 66,
  END_PORTAL_FRAME: 67,
  PRISMARINE: 68,
  SEA_LANTERN: 69,
  BOOKSHELF: 70,
  SIGN: 71,
  DEEPSLATE: 72,
  SCULK: 73,
  SCULK_SENSOR: 74,
  TRIAL_SPAWNER: 75,
  CAMPFIRE: 76,
  BELL: 77,
  LECTERN: 78,
  PURPUR_BLOCK: 79,
  IRON_BLOCK: 80,
  PUMPKIN: 81,
  NETHER_BRICKS: 82,
  SOUL_SAND: 83,
  NETHER_WART: 84,
  WITHER_SKULL: 85,
  BEACON: 86,
});

export const BLOCK_DEFS = [];

function def(id, name, display, opts = {}) {
  const d = {
    id,
    name,
    display,
    tiles: opts.tiles || { all: name },
    solid: opts.solid !== undefined ? opts.solid : true,
    opaque: opts.opaque !== undefined ? opts.opaque : true,
    liquid: !!opts.liquid,
    cross: !!opts.cross,
    transparent: !!opts.transparent,
    emissive: !!opts.emissive,
    light: opts.light || 0,
    hardness: opts.hardness !== undefined ? opts.hardness : 1,
    tool: opts.tool || null,
    minTier: opts.minTier || 0,
    drop: opts.drop !== undefined ? opts.drop : name,
    dropChance: opts.dropChance !== undefined ? opts.dropChance : 1,
    sound: opts.sound || 'stone',
    needsSupport: !!opts.needsSupport,
  };
  BLOCK_DEFS[id] = d;
  return d;
}

// id 0：空气
def(BLOCK.AIR, 'air', '空气', { solid: false, opaque: false, transparent: true, hardness: Infinity, drop: null });

// 土壤 / 石头类
def(BLOCK.GRASS, 'grass_block', '草方块', {
  tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
  hardness: 0.6, sound: 'grass', drop: 'dirt',
});
def(BLOCK.DIRT, 'dirt', '泥土', { tiles: { all: 'dirt' }, hardness: 0.5, sound: 'grass' });
def(BLOCK.STONE, 'stone', '石头', { tiles: { all: 'stone' }, hardness: 1.5, tool: 'pickaxe', minTier: 1, drop: 'cobblestone' });
def(BLOCK.COBBLE, 'cobblestone', '圆石', { tiles: { all: 'cobblestone' }, hardness: 2, tool: 'pickaxe', minTier: 1 });
def(BLOCK.SAND, 'sand', '沙子', { tiles: { all: 'sand' }, hardness: 0.5, sound: 'sand', tool: 'shovel' });
def(BLOCK.SANDSTONE, 'sandstone', '砂岩', {
  tiles: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' },
  hardness: 0.8, tool: 'pickaxe', minTier: 1,
});
def(BLOCK.GRAVEL, 'gravel', '沙砾', { tiles: { all: 'gravel' }, hardness: 0.6, sound: 'sand' });

// 木头
def(BLOCK.LOG, 'oak_log', '橡木原木', {
  tiles: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log_side' },
  hardness: 2, sound: 'wood', tool: 'axe',
});
def(BLOCK.LEAVES, 'oak_leaves', '橡树叶', {
  tiles: { all: 'oak_leaves' }, hardness: 0.2, sound: 'grass', opaque: false, drop: null,
});
def(BLOCK.PLANKS, 'oak_planks', '橡木木板', { tiles: { all: 'oak_planks' }, hardness: 2, sound: 'wood', tool: 'axe' });

// 透明 / 液体
def(BLOCK.GLASS, 'glass', '玻璃', {
  tiles: { all: 'glass' }, hardness: 0.3, sound: 'glass', opaque: false, transparent: true, drop: null,
});
def(BLOCK.WATER, 'water', '水', {
  tiles: { all: 'water' }, solid: false, opaque: false, transparent: true, liquid: true,
  hardness: Infinity, sound: 'splash', drop: null,
});
def(BLOCK.BEDROCK, 'bedrock', '基岩', { tiles: { all: 'bedrock' }, hardness: Infinity, drop: null });

// 矿石
def(BLOCK.COAL_ORE, 'coal_ore', '煤矿石', {
  tiles: { all: 'coal_ore' }, hardness: 3, tool: 'pickaxe', minTier: 1, drop: 'coal',
});
def(BLOCK.IRON_ORE, 'iron_ore', '铁矿石', {
  tiles: { all: 'iron_ore' }, hardness: 3, tool: 'pickaxe', minTier: 2, drop: 'iron_ingot',
});
def(BLOCK.GOLD_ORE, 'gold_ore', '金矿石', {
  tiles: { all: 'gold_ore' }, hardness: 3, tool: 'pickaxe', minTier: 3, drop: 'gold_ingot',
});
def(BLOCK.DIAMOND_ORE, 'diamond_ore', '钻石矿石', {
  tiles: { all: 'diamond_ore' }, hardness: 3, tool: 'pickaxe', minTier: 3, drop: 'diamond',
});

// 寒冷
def(BLOCK.SNOW, 'snow', '雪块', { tiles: { all: 'snow' }, hardness: 0.2, sound: 'sand', tool: 'shovel' });
def(BLOCK.ICE, 'ice', '冰', { tiles: { all: 'ice' }, hardness: 0.5, sound: 'glass', opaque: false, transparent: true });

// 功能方块
def(BLOCK.CRAFTING_TABLE, 'crafting_table', '工作台', {
  tiles: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_front' },
  hardness: 2.5, sound: 'wood', tool: 'axe',
});
def(BLOCK.TORCH, 'torch', '火把', {
  tiles: { all: 'torch' }, solid: false, opaque: false, transparent: true, cross: true,
  hardness: 0.05, sound: 'wood', light: 14, emissive: true, needsSupport: true,
});
def(BLOCK.ROSE, 'rose', '玫瑰', {
  tiles: { all: 'rose' }, solid: false, opaque: false, transparent: true, cross: true,
  hardness: 0.05, sound: 'grass', needsSupport: true,
});
def(BLOCK.DANDELION, 'dandelion', '蒲公英', {
  tiles: { all: 'dandelion' }, solid: false, opaque: false, transparent: true, cross: true,
  hardness: 0.05, sound: 'grass', needsSupport: true,
});
def(BLOCK.TALL_GRASS, 'tall_grass', '草丛', {
  tiles: { all: 'tall_grass' }, solid: false, opaque: false, transparent: true, cross: true,
  hardness: 0.05, sound: 'grass', drop: null, needsSupport: true,
});

// 石材 / 其他
def(BLOCK.STONE_BRICKS, 'stone_bricks', '石砖', { tiles: { all: 'stone_bricks' }, hardness: 1.5, tool: 'pickaxe', minTier: 1 });
def(BLOCK.OBSIDIAN, 'obsidian', '黑曜石', { tiles: { all: 'obsidian' }, hardness: 50, tool: 'pickaxe', minTier: 3 });
def(BLOCK.GLOWSTONE, 'glowstone', '荧石', {
  tiles: { all: 'glowstone' }, hardness: 0.3, light: 15, emissive: true, drop: 'glowstone',
});
def(BLOCK.LAVA, 'lava', '岩浆', {
  tiles: { all: 'lava' }, solid: false, opaque: false, transparent: true, liquid: true,
  hardness: Infinity, light: 15, emissive: true, sound: 'splash', drop: null,
});
def(BLOCK.WOOL, 'wool_white', '白色羊毛', { tiles: { all: 'wool_white' }, hardness: 0.8, sound: 'grass' });
def(BLOCK.BRICK, 'brick', '红砖块', { tiles: { all: 'brick' }, hardness: 2, tool: 'pickaxe', minTier: 1 });

// 新树种
def(BLOCK.BIRCH_LOG, 'birch_log', '白桦原木', {
  tiles: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log_side' },
  hardness: 2, sound: 'wood', tool: 'axe',
});
def(BLOCK.BIRCH_LEAVES, 'birch_leaves', '白桦树叶', {
  tiles: { all: 'birch_leaves' }, hardness: 0.2, sound: 'grass', opaque: false, drop: null,
});
def(BLOCK.BIRCH_PLANKS, 'birch_planks', '白桦木板', { tiles: { all: 'birch_planks' }, hardness: 2, sound: 'wood', tool: 'axe' });
def(BLOCK.SPRUCE_LOG, 'spruce_log', '云杉原木', {
  tiles: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log_side' },
  hardness: 2, sound: 'wood', tool: 'axe',
});
def(BLOCK.SPRUCE_LEAVES, 'spruce_leaves', '云杉树叶', {
  tiles: { all: 'spruce_leaves' }, hardness: 0.2, sound: 'grass', opaque: false, drop: null,
});
def(BLOCK.SPRUCE_PLANKS, 'spruce_planks', '云杉木板', { tiles: { all: 'spruce_planks' }, hardness: 2, sound: 'wood', tool: 'axe' });

// 沙漠与黏土
def(BLOCK.CACTUS, 'cactus', '仙人掌', {
  tiles: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' },
  hardness: 0.4, sound: 'grass',
});
def(BLOCK.CLAY, 'clay', '黏土块', { tiles: { all: 'clay' }, hardness: 0.6, sound: 'sand', drop: { id: 'clay_ball', count: 4 } });

// 功能方块（容器界面在后续版本开放）
def(BLOCK.FURNACE, 'furnace', '熔炉', {
  tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_front' },
  hardness: 3.5, sound: 'stone', tool: 'pickaxe', minTier: 1,
});
def(BLOCK.CHEST, 'chest', '箱子', {
  tiles: { top: 'chest_top', bottom: 'chest_top', side: 'chest_front' },
  hardness: 2.5, sound: 'wood', tool: 'axe',
});
def(BLOCK.BED, 'bed', '床', {
  tiles: { top: 'bed_top', bottom: 'oak_planks', side: 'bed_side' },
  hardness: 0.2, sound: 'wood',
});
def(BLOCK.FARMLAND, 'farmland', '耕地', {
  tiles: { top: 'farmland_top', bottom: 'dirt', side: 'farmland_side' },
  hardness: 0.6, sound: 'grass', drop: 'dirt',
});
def(BLOCK.DOOR_X, 'door_x', '门', {
  tiles: { all: 'door' }, model: 'door', doorAxis: 'x', doorOpen: false,
  solid: true, opaque: false, transparent: true, hardness: 0.4, sound: 'wood', drop: 'door',
});
def(BLOCK.DOOR_Z, 'door_z', '门', {
  tiles: { all: 'door' }, model: 'door', doorAxis: 'z', doorOpen: false,
  solid: true, opaque: false, transparent: true, hardness: 0.4, sound: 'wood', drop: 'door',
});
def(BLOCK.DOOR_X_OPEN, 'door_x_open', '门', {
  tiles: { all: 'door' }, model: 'door', doorAxis: 'x', doorOpen: true,
  solid: false, opaque: false, transparent: true, hardness: 0.4, sound: 'wood', drop: 'door',
});
def(BLOCK.DOOR_Z_OPEN, 'door_z_open', '门', {
  tiles: { all: 'door' }, model: 'door', doorAxis: 'z', doorOpen: true,
  solid: false, opaque: false, transparent: true, hardness: 0.4, sound: 'wood', drop: 'door',
});
def(BLOCK.FENCE, 'fence', '栅栏', {
  tiles: { all: 'oak_planks' }, model: 'fence', fence: true,
  solid: true, opaque: false, transparent: true, hardness: 0.4, sound: 'wood', drop: 'fence',
});
def(BLOCK.ENCHANTING_TABLE, 'enchanting_table', '附魔台', {
  tiles: { top: 'obsidian', bottom: 'obsidian', side: 'oak_planks' },
  hardness: 1.2, sound: 'wood',
});
def(BLOCK.BREWING_STAND, 'brewing_stand', '酿造台', {
  tiles: { top: 'cobble', bottom: 'cobble', side: 'oak_planks' },
  hardness: 1.0, sound: 'wood',
});
def(BLOCK.NETHERRACK, 'netherrack', '下界岩', {
  tiles: { all: 'netherrack' }, hardness: 0.4, sound: 'stone',
});
def(BLOCK.NETHER_PORTAL, 'nether_portal', '下界传送门', {
  tiles: { all: 'nether_portal' }, solid: false, opaque: false, transparent: true,
  hardness: 0.2, sound: 'glass', drop: null, light: 11,
});
def(BLOCK.FIRE, 'fire', '火焰', {
  tiles: { all: 'fire' }, solid: false, opaque: false, transparent: true,
  cross: true, hardness: 0, sound: 'fire', drop: null, light: 15,
});
def(BLOCK.END_STONE, 'end_stone', '末地石', {
  tiles: { all: 'end_stone' }, hardness: 1.2, sound: 'stone',
});
def(BLOCK.END_PORTAL, 'end_portal', '末地传送门', {
  tiles: { all: 'end_portal' }, solid: false, opaque: false, transparent: true,
  hardness: 0.2, sound: 'glass', drop: null, light: 15,
});
def(BLOCK.END_PORTAL_FRAME, 'end_portal_frame', '末地传送门框架', {
  tiles: { all: 'end_stone' }, hardness: 4, sound: 'stone',
});
def(BLOCK.PRISMARINE, 'prismarine', '海晶石', {
  tiles: { all: 'prismarine' }, hardness: 1.5, sound: 'stone',
});
def(BLOCK.SEA_LANTERN, 'sea_lantern', '海晶灯', {
  tiles: { all: 'sea_lantern' }, hardness: 0.3, sound: 'glass', light: 15,
});
def(BLOCK.BOOKSHELF, 'bookshelf', '书架', {
  tiles: { all: 'bookshelf' }, hardness: 1.5, sound: 'wood',
});
def(BLOCK.SIGN, 'sign', '告示牌', {
  tiles: { all: 'sign' }, model: 'sign',
  solid: false, opaque: false, transparent: true, hardness: 0.5, sound: 'wood', drop: 'sign',
});
def(BLOCK.DEEPSLATE, 'deepslate', '深板岩', {
  tiles: { all: 'deepslate' }, hardness: 3, sound: 'stone',
});
def(BLOCK.SCULK, 'sculk', '幽匿块', {
  tiles: { all: 'sculk' }, hardness: 0.6, sound: 'grass',
});
def(BLOCK.SCULK_SENSOR, 'sculk_sensor', '幽匿感测体', {
  tiles: { all: 'sculk_sensor' }, hardness: 0.6, sound: 'grass', light: 2,
});
def(BLOCK.TRIAL_SPAWNER, 'trial_spawner', '试炼刷怪笼', {
  tiles: { all: 'trial_spawner' }, hardness: 2.5, sound: 'stone', light: 6,
});
def(BLOCK.NETHER_BRICKS, 'nether_bricks', '下界砖块', {
  tiles: { all: 'nether_bricks' }, hardness: 2.0, sound: 'stone',
});
def(BLOCK.SOUL_SAND, 'soul_sand', '灵魂沙', {
  tiles: { all: 'soul_sand' }, hardness: 0.5, sound: 'sand',
});
def(BLOCK.NETHER_WART, 'nether_wart', '下界疣', {
  tiles: { all: 'nether_wart' }, solid: false, opaque: false, transparent: true,
  cross: true, needsSupport: true, hardness: 0.05, sound: 'grass', drop: 'nether_wart',
});
def(BLOCK.WITHER_SKULL, 'wither_skull', '凋灵骷髅头', {
  tiles: { all: 'wither_skull' }, solid: false, opaque: false, transparent: true,
  cross: true, needsSupport: true, hardness: 1.0, sound: 'grass',
});
def(BLOCK.BEACON, 'beacon', '信标', {
  tiles: { all: 'beacon' }, hardness: 3.0, sound: 'glass', light: 15,
});
def(BLOCK.IRON_BLOCK, 'iron_block', '铁块', {
  tiles: { all: 'iron_block' }, hardness: 3.0, sound: 'stone',
});
def(BLOCK.PUMPKIN, 'pumpkin', '南瓜', {
  tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_face' }, hardness: 0.6, sound: 'wood',
});
def(BLOCK.PURPUR_BLOCK, 'purpur_block', '紫珀块', {
  tiles: { all: 'purpur' }, hardness: 1.5, sound: 'stone',
});
def(BLOCK.CAMPFIRE, 'campfire', '营火', {
  tiles: { top: 'campfire', bottom: 'oak_planks', side: 'campfire' }, hardness: 1.0, sound: 'wood', light: 15,
});
def(BLOCK.BELL, 'bell', '钟', {
  tiles: { all: 'bell' }, hardness: 2.0, sound: 'stone',
});
def(BLOCK.LECTERN, 'lectern', '讲台', {
  tiles: { top: 'lectern_top', bottom: 'oak_planks', side: 'bookshelf' }, hardness: 1.0, sound: 'wood',
});
def(BLOCK.TNT, 'tnt', 'TNT', {
  tiles: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' },
  hardness: 0.1,
  sound: 'grass',
});
for (let level = 1; level <= 7; level++) {
  def(BLOCK.WATER_FLOW_1 + level - 1, 'water_flow_' + level, '流动的水', {
    tiles: { all: 'water' },
    solid: false,
    opaque: false,
    transparent: true,
    liquid: true,
    hardness: Infinity,
    sound: 'splash',
    drop: null,
  });
}
for (let stage = 0; stage < 4; stage++) {
  def(BLOCK.WHEAT_0 + stage, 'wheat_' + stage, '小麦', {
    tiles: { all: 'wheat_stage' + stage },
    solid: false,
    opaque: false,
    transparent: true,
    cross: true,
    hardness: 0.05,
    sound: 'grass',
    needsSupport: true,
    drop: stage === 3 ? { id: 'wheat', count: 1 } : { id: 'wheat_seeds', count: 1 },
  });
}

// ---------------- 物品 ----------------
export const ITEMS = {};

// 方块物品
for (const d of BLOCK_DEFS) {
  if (!d || d.id === BLOCK.AIR) continue;
  ITEMS[d.name] = {
    id: d.name,
    display: d.display,
    block: d.id,
    maxStack: 64,
    icon: null,
  };
}

// 基础材料
const MATERIALS = {
  stick: { display: '木棍', icon: 'stick' },
  coal: { display: '煤炭', icon: 'coal' },
  iron_ingot: { display: '铁锭', icon: 'iron_ingot' },
  gold_ingot: { display: '金锭', icon: 'gold_ingot' },
  diamond: { display: '钻石', icon: 'diamond' },
  apple: { display: '苹果', icon: 'apple', food: 4 },
};
for (const [id, m] of Object.entries(MATERIALS)) {
  ITEMS[id] = { id, maxStack: 64, ...m };
}

// 生物掉落与食物
const EXTRA_ITEMS = {
  beef: { display: '生牛肉', icon: 'beef', food: 3 },
  cooked_beef: { display: '牛排', icon: 'cooked_beef', food: 8 },
  porkchop: { display: '生猪排', icon: 'porkchop', food: 3 },
  cooked_porkchop: { display: '熟猪排', icon: 'cooked_porkchop', food: 8 },
  chicken: { display: '生鸡肉', icon: 'chicken', food: 2 },
  cooked_chicken: { display: '熟鸡肉', icon: 'cooked_chicken', food: 6 },
  feather: { display: '羽毛', icon: 'feather' },
  leather: { display: '皮革', icon: 'leather' },
  bone: { display: '骨头', icon: 'bone' },
  string: { display: '线', icon: 'string' },
  gunpowder: { display: '火药', icon: 'gunpowder' },
  rotten_flesh: { display: '腐肉', icon: 'rotten_flesh', food: 1 },
  arrow: { display: '箭', icon: 'arrow' },
  clay_ball: { display: '黏土球', icon: 'clay_ball' },
  bread: { display: '面包', icon: 'bread', food: 5 },
  wheat_seeds: { display: '小麦种子', icon: 'wheat_seeds' },
  wheat: { display: '小麦', icon: 'wheat' },
  bow: { display: '弓', icon: 'bow', maxStack: 1 },
  flint: { display: '燧石', icon: 'flint' },
  egg: { display: '鸡蛋', icon: 'egg' },
  shears: { display: '剪刀', icon: 'shears', maxStack: 1, durability: 238, tool: { type: 'shears', tier: 1, speed: 1 } },
  bucket: { display: '桶', icon: 'bucket', maxStack: 16 },
  water_bucket: { display: '水桶', icon: 'water_bucket', maxStack: 1 },
  lava_bucket: { display: '岩浆桶', icon: 'lava_bucket', maxStack: 1 },
  door: { display: '门', icon: 'door', block: BLOCK.DOOR_X },
  fence: { display: '栅栏', icon: 'fence', block: BLOCK.FENCE },
  emerald: { display: '绿宝石', icon: 'emerald' },
  book: { display: '书', icon: 'book' },
  fishing_rod: { display: '钓竿', icon: 'fishing_rod', maxStack: 1, durability: 64, tool: { type: 'rod', tier: 1, speed: 1 } },
  cod: { display: '生鳕鱼', icon: 'cod', food: 2 },
  cooked_cod: { display: '熟鳕鱼', icon: 'cooked_cod', food: 5 },
  mutton: { display: '生羊肉', icon: 'mutton', food: 2 },
  cooked_mutton: { display: '熟羊肉', icon: 'cooked_mutton', food: 6 },
  pumpkin_pie: { display: '南瓜派', icon: 'pumpkin_pie', food: 8 },
  golden_apple: { display: '金苹果', icon: 'golden_apple', food: 4 },
  blaze_rod: { display: '烈焰棒', icon: 'blaze_rod', maxStack: 64 },
  potion_regen: { display: '再生药水', icon: 'potion_regen', maxStack: 1, potion: 'regen' },
  nether_star: { display: '下界之星', icon: 'nether_star', maxStack: 64 },
  firework_rocket: { display: '烟花火箭', icon: 'firework_rocket', maxStack: 16 },
  name_tag: { display: '命名牌', icon: 'name_tag', maxStack: 16 },
  shulker_shell: { display: '潜影壳', icon: 'shulker_shell', maxStack: 64 },
  ink_sac: { display: '墨囊', icon: 'ink_sac', maxStack: 64 },
  elytra: { display: '鞘翅', icon: 'elytra', maxStack: 1, armor: { slot: 1, points: 0, elytra: true } },
  glass_bottle: { display: '玻璃瓶', icon: 'glass_bottle', maxStack: 16 },
  water_bottle: { display: '水瓶', icon: 'water_bottle', maxStack: 1 },
  potion_healing: { display: '治疗药水', icon: 'potion_healing', maxStack: 1, potion: 'healing' },
  potion_strength: { display: '力量药水', icon: 'potion_strength', maxStack: 1, potion: 'strength' },
  potion_speed: { display: '迅捷药水', icon: 'potion_speed', maxStack: 1, potion: 'speed' },
  potion_fire_resist: { display: '抗火药水', icon: 'potion_fire_resist', maxStack: 1, potion: 'fire_resist' },
  potion_night_vision: { display: '夜视药水', icon: 'potion_night_vision', maxStack: 1, potion: 'night_vision' },
  potion_jump: { display: '跳跃药水', icon: 'potion_jump', maxStack: 1, potion: 'jump' },
  iron_helmet: { display: '铁头盔', icon: 'iron_helmet', maxStack: 1, armor: { slot: 0, points: 2 } },
  iron_chestplate: { display: '铁胸甲', icon: 'iron_chestplate', maxStack: 1, armor: { slot: 1, points: 6 } },
  iron_leggings: { display: '铁护腿', icon: 'iron_leggings', maxStack: 1, armor: { slot: 2, points: 5 } },
  iron_boots: { display: '铁靴子', icon: 'iron_boots', maxStack: 1, armor: { slot: 3, points: 2 } },
  diamond_helmet: { display: '钻石头盔', icon: 'diamond_helmet', maxStack: 1, armor: { slot: 0, points: 3 } },
  diamond_chestplate: { display: '钻石胸甲', icon: 'diamond_chestplate', maxStack: 1, armor: { slot: 1, points: 8 } },
  diamond_leggings: { display: '钻石护腿', icon: 'diamond_leggings', maxStack: 1, armor: { slot: 2, points: 6 } },
  diamond_boots: { display: '钻石靴子', icon: 'diamond_boots', maxStack: 1, armor: { slot: 3, points: 3 } },
};
for (const [id, m] of Object.entries(EXTRA_ITEMS)) {
  ITEMS[id] = { id, maxStack: 64, ...m };
}

// 工具
export const TOOL_TIERS = {
  wood: { tier: 1, speed: 3, uses: 60, display: '木' },
  stone: { tier: 2, speed: 5, uses: 132, display: '石' },
  iron: { tier: 3, speed: 8, uses: 251, display: '铁' },
  diamond: { tier: 4, speed: 12, uses: 1561, display: '钻石' },
};
export const TOOL_TYPES = {
  pickaxe: { display: '镐', speedTool: true },
  axe: { display: '斧', speedTool: true },
  shovel: { display: '锹', speedTool: true },
  sword: { display: '剑', speedTool: false },
  hoe: { display: '锄', speedTool: false },
};
for (const [matName, mat] of Object.entries(TOOL_TIERS)) {
  for (const [typeName, type] of Object.entries(TOOL_TYPES)) {
    const id = `${matName}_${typeName}`;
    ITEMS[id] = {
      id,
      display: mat.display + type.display,
      icon: id,
      maxStack: 1,
      durability: mat.uses,
      tool: { type: typeName, tier: mat.tier, speed: mat.speed, uses: mat.uses },
    };
  }
}

// 工具挖掘速度倍率（按 tier 索引，tier 1..3）
export const TOOL_SPEED_MULT = [0, 3, 5, 8, 12];

export function getBlockDef(id) {
  return BLOCK_DEFS[id] || BLOCK_DEFS[0];
}
export function isSolidBlock(id) {
  return getBlockDef(id).solid;
}
export function isOpaqueBlock(id) {
  return getBlockDef(id).opaque;
}
export function isLiquidBlock(id) {
  return getBlockDef(id).liquid;
}
export function isWaterLike(id) {
  return id === BLOCK.WATER || (id >= BLOCK.WATER_FLOW_1 && id <= BLOCK.WATER_FLOW_7);
}
export function isPlantBlock(id) {
  return getBlockDef(id).cross;
}
export function getItem(id) {
  return ITEMS[id] || null;
}
export function itemMaxStack(id) {
  const it = ITEMS[id];
  return it && it.maxStack ? it.maxStack : 64;
}
export function itemDisplay(id) {
  const it = ITEMS[id];
  return it ? it.display : id;
}
export function itemIsBlock(id) {
  const it = ITEMS[id];
  return !!(it && it.block !== undefined && it.block !== null);
}
export function toolOf(id) {
  const it = ITEMS[id];
  return it && it.tool ? it.tool : null;
}
export function itemDurability(id) {
  const it = ITEMS[id];
  return it && it.durability ? it.durability : 0;
}

// 挖掘耗时（秒）：硬度 / 工具倍率
export function breakTimeSeconds(blockId, heldItemId) {
  const d = getBlockDef(blockId);
  if (!isFinite(d.hardness)) return Infinity;
  const tool = toolOf(heldItemId);
  let mult = 1;
  if (tool) {
    if (d.tool === tool.type) mult = TOOL_SPEED_MULT[tool.tier] || 1;
    else if (tool.type === 'sword' && (blockId === BLOCK.LEAVES || isPlantBlock(blockId))) mult = 4;
  }
  return d.hardness / mult;
}

// 生存模式破坏后的掉落（考虑工具等级）
export function breakDrop(blockId, heldItemId) {
  const d = getBlockDef(blockId);
  if (d.drop === null || d.drop === undefined) return null;
  if (d.tool && d.minTier > 0) {
    const tool = toolOf(heldItemId);
    if (!tool || tool.type !== d.tool || tool.tier < d.minTier) return null;
  }
  if (typeof d.drop === 'object') return { id: d.drop.id, count: d.drop.count || 1 };
  return { id: d.drop, count: 1 };
}

// 音效组
export function breakSoundName(blockId) {
  return 'break_' + getBlockDef(blockId).sound;
}
export function placeSoundName(blockId) {
  return 'place_' + getBlockDef(blockId).sound;
}
export function stepSoundName(blockId) {
  return 'step_' + getBlockDef(blockId).sound;
}
