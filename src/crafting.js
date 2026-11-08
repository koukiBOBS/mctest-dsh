// ============================================================
// crafting.js — 合成配方与匹配逻辑（纯函数）
// 槽位内容：物品 id 字符串或 null；输入为扁平数组 + 宽高。
// ============================================================

// pattern 用字符串行表示，keys 把字符映射到物品 id，' ' 表示空。
// shapeless: 任意位置、任意形状的无序配方。
export const RECIPES = [
  // 木材
  { id: 'oak_planks', shapeless: ['oak_log'], result: { id: 'oak_planks', count: 4 } },
  { id: 'birch_planks', shapeless: ['birch_log'], result: { id: 'birch_planks', count: 4 } },
  { id: 'spruce_planks', shapeless: ['spruce_log'], result: { id: 'spruce_planks', count: 4 } },
  { id: 'stick', pattern: ['P', 'P'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'] }, result: { id: 'stick', count: 4 } },
  { id: 'crafting_table', pattern: ['PP', 'PP'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'] }, result: { id: 'crafting_table', count: 1 } },
  { id: 'chest', pattern: ['PPP', 'P P', 'PPP'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'] }, result: { id: 'chest', count: 1 } },
  { id: 'furnace', pattern: ['CCC', 'C C', 'CCC'], keys: { C: 'cobblestone' }, result: { id: 'furnace', count: 1 } },
  { id: 'bread', pattern: ['WWW'], keys: { W: 'wheat' }, result: { id: 'bread', count: 1 } },
  { id: 'wooden_hoe', pattern: ['MM', ' S', ' S'], keys: { M: ['oak_planks', 'birch_planks', 'spruce_planks'], S: 'stick' }, result: { id: 'wooden_hoe', count: 1 } },
  { id: 'stone_hoe', pattern: ['MM', ' S', ' S'], keys: { M: 'cobblestone', S: 'stick' }, result: { id: 'stone_hoe', count: 1 } },
  { id: 'iron_hoe', pattern: ['MM', ' S', ' S'], keys: { M: 'iron_ingot', S: 'stick' }, result: { id: 'iron_hoe', count: 1 } },
  { id: 'bed', pattern: ['WWW', 'PPP'], keys: { W: 'wool_white', P: ['oak_planks', 'birch_planks', 'spruce_planks'] }, result: { id: 'bed', count: 1 } },
  { id: 'torch', pattern: ['C', 'S'], keys: { C: 'coal', S: 'stick' }, result: { id: 'torch', count: 4 } },
  { id: 'bow', pattern: [' SC', 'S C', ' SC'], keys: { S: 'stick', C: 'string' }, result: { id: 'bow', count: 1 } },
  { id: 'arrow', pattern: ['F', 'S', 'E'], keys: { F: 'flint', S: 'stick', E: 'feather' }, result: { id: 'arrow', count: 4 } },
  { id: 'fence', pattern: ['PSP', 'PSP'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'], S: 'stick' }, result: { id: 'fence', count: 3 } },
  { id: 'door', pattern: ['PP', 'PP', 'PP'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'] }, result: { id: 'door', count: 3 } },
  { id: 'campfire', pattern: [' S ', 'SCS', 'LLL'], keys: { S: 'stick', C: 'coal', L: ['oak_log', 'birch_log', 'spruce_log'] }, result: { id: 'campfire', count: 1 } },
  { id: 'bell', pattern: [' G ', 'GGG', ' S '], keys: { G: 'gold_ingot', S: 'stick' }, result: { id: 'bell', count: 1 } },
  { id: 'lectern', pattern: ['PPP', 'PBP'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'], B: 'book' }, result: { id: 'lectern', count: 1 } },
  { id: 'name_tag', pattern: ['B', 'S'], keys: { B: 'book', S: 'string' }, result: { id: 'name_tag', count: 1 } },
  { id: 'firework_rocket', pattern: [' G ', ' S ', ' S '], keys: { G: 'gunpowder', S: 'stick' }, result: { id: 'firework_rocket', count: 2 } },
  { id: 'fishing_rod', pattern: ['  C', ' SC', 'S C'], keys: { S: 'stick', C: 'string' }, result: { id: 'fishing_rod', count: 1 } },
  { id: 'sign', pattern: ['PPP', 'PPP', ' S '], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'], S: 'stick' }, result: { id: 'sign', count: 3 } },
  { id: 'book', pattern: ['PPP'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'] }, result: { id: 'book', count: 1 } },
  { id: 'bookshelf', pattern: ['PPP', 'BBB', 'PPP'], keys: { P: ['oak_planks', 'birch_planks', 'spruce_planks'], B: 'book' }, result: { id: 'bookshelf', count: 1 } },
  { id: 'glass_bottle', pattern: ['G G', ' G '], keys: { G: 'glass' }, result: { id: 'glass_bottle', count: 3 } },
  { id: 'brewing_stand', pattern: [' G ', 'CCC'], keys: { G: 'glass', C: 'cobblestone' }, result: { id: 'brewing_stand', count: 1 } },
  { id: 'enchanting_table', pattern: [' D ', 'OEO', 'OOO'], keys: { D: 'diamond', E: 'emerald', O: 'obsidian' }, result: { id: 'enchanting_table', count: 1 } },
  { id: 'tnt', pattern: ['GSG', 'SGS', 'GSG'], keys: { G: 'gunpowder', S: 'sand' }, result: { id: 'tnt', count: 1 } },
  { id: 'diamond_pickaxe', pattern: ['DDD', ' S ', ' S '], keys: { D: 'diamond', S: 'stick' }, result: { id: 'diamond_pickaxe', count: 1 } },
  { id: 'diamond_axe', pattern: ['DD', 'DS', ' S'], keys: { D: 'diamond', S: 'stick' }, result: { id: 'diamond_axe', count: 1 } },
  { id: 'diamond_shovel', pattern: ['D', 'S', 'S'], keys: { D: 'diamond', S: 'stick' }, result: { id: 'diamond_shovel', count: 1 } },
  { id: 'diamond_sword', pattern: ['D', 'D', 'S'], keys: { D: 'diamond', S: 'stick' }, result: { id: 'diamond_sword', count: 1 } },
  { id: 'iron_helmet', pattern: ['MMM', 'M M'], keys: { M: 'iron_ingot' }, result: { id: 'iron_helmet', count: 1 } },
  { id: 'iron_chestplate', pattern: ['M M', 'MMM', 'MMM'], keys: { M: 'iron_ingot' }, result: { id: 'iron_chestplate', count: 1 } },
  { id: 'iron_leggings', pattern: ['MMM', 'M M', 'M M'], keys: { M: 'iron_ingot' }, result: { id: 'iron_leggings', count: 1 } },
  { id: 'iron_boots', pattern: ['M M', 'M M'], keys: { M: 'iron_ingot' }, result: { id: 'iron_boots', count: 1 } },
  { id: 'diamond_helmet', pattern: ['MMM', 'M M'], keys: { M: 'diamond' }, result: { id: 'diamond_helmet', count: 1 } },
  { id: 'diamond_chestplate', pattern: ['M M', 'MMM', 'MMM'], keys: { M: 'diamond' }, result: { id: 'diamond_chestplate', count: 1 } },
  { id: 'diamond_leggings', pattern: ['MMM', 'M M', 'M M'], keys: { M: 'diamond' }, result: { id: 'diamond_leggings', count: 1 } },
  { id: 'diamond_boots', pattern: ['M M', 'M M'], keys: { M: 'diamond' }, result: { id: 'diamond_boots', count: 1 } },
  { id: 'shears', pattern: [' I', 'I '], keys: { I: 'iron_ingot' }, result: { id: 'shears', count: 1 } },
  { id: 'bucket', pattern: ['I I', ' I '], keys: { I: 'iron_ingot' }, result: { id: 'bucket', count: 1 } },

  // 石砖
  { id: 'stone_bricks', pattern: ['CC', 'CC'], keys: { C: 'cobblestone' }, result: { id: 'stone_bricks', count: 4 } },

  // 木制工具
  { id: 'wooden_pickaxe', pattern: ['WWW', ' S ', ' S '], keys: { W: ['oak_planks', 'birch_planks', 'spruce_planks'], S: 'stick' }, result: { id: 'wooden_pickaxe', count: 1 } },
  { id: 'wooden_axe', pattern: ['WW', 'WS', ' S'], keys: { W: ['oak_planks', 'birch_planks', 'spruce_planks'], S: 'stick' }, result: { id: 'wooden_axe', count: 1 } },
  { id: 'wooden_shovel', pattern: ['W', 'S', 'S'], keys: { W: ['oak_planks', 'birch_planks', 'spruce_planks'], S: 'stick' }, result: { id: 'wooden_shovel', count: 1 } },
  { id: 'wooden_sword', pattern: ['W', 'W', 'S'], keys: { W: ['oak_planks', 'birch_planks', 'spruce_planks'], S: 'stick' }, result: { id: 'wooden_sword', count: 1 } },

  // 石制工具
  { id: 'stone_pickaxe', pattern: ['CCC', ' S ', ' S '], keys: { C: 'cobblestone', S: 'stick' }, result: { id: 'stone_pickaxe', count: 1 } },
  { id: 'stone_axe', pattern: ['CC', 'CS', ' S'], keys: { C: 'cobblestone', S: 'stick' }, result: { id: 'stone_axe', count: 1 } },
  { id: 'stone_shovel', pattern: ['C', 'S', 'S'], keys: { C: 'cobblestone', S: 'stick' }, result: { id: 'stone_shovel', count: 1 } },
  { id: 'stone_sword', pattern: ['C', 'C', 'S'], keys: { C: 'cobblestone', S: 'stick' }, result: { id: 'stone_sword', count: 1 } },

  // 铁制工具
  { id: 'iron_pickaxe', pattern: ['III', ' S ', ' S '], keys: { I: 'iron_ingot', S: 'stick' }, result: { id: 'iron_pickaxe', count: 1 } },
  { id: 'iron_axe', pattern: ['II', 'IS', ' S'], keys: { I: 'iron_ingot', S: 'stick' }, result: { id: 'iron_axe', count: 1 } },
  { id: 'iron_shovel', pattern: ['I', 'S', 'S'], keys: { I: 'iron_ingot', S: 'stick' }, result: { id: 'iron_shovel', count: 1 } },
  { id: 'iron_sword', pattern: ['I', 'I', 'S'], keys: { I: 'iron_ingot', S: 'stick' }, result: { id: 'iron_sword', count: 1 } },
];

// 把 pattern 展开为二维数组，方便比较
function expandPattern(recipe) {
  const rows = recipe.pattern.length;
  let cols = 0;
  for (const row of recipe.pattern) cols = Math.max(cols, row.length);
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const line = recipe.pattern[r];
    const rowArr = [];
    for (let c = 0; c < cols; c++) {
      const ch = line[c] || ' ';
      rowArr.push(ch === ' ' ? null : recipe.keys[ch]);
    }
    grid.push(rowArr);
  }
  return { grid, rows, cols };
}

function trimGrid(grid, w, h) {
  let minR = h, maxR = -1, minC = w, maxC = -1, count = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r * w + c]) {
        count++;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (count === 0) return null;
  const tw = maxC - minC + 1;
  const th = maxR - minR + 1;
  const out = [];
  for (let r = 0; r < th; r++) {
    for (let c = 0; c < tw; c++) out.push(grid[(minR + r) * w + (minC + c)] || null);
  }
  return { grid: out, w: tw, h: th, count };
}

// slots: 长度 w*h 的数组，元素为物品 id 或 null
export function matchRecipe(slots, w, h) {
  const trimmed = trimGrid(slots, w, h);
  if (!trimmed) return null;

  // 无序配方
  if (trimmed.count === 1) {
    let only = null;
    for (const s of slots) if (s) { only = s; break; }
    for (const recipe of RECIPES) {
      if (recipe.shapeless && recipe.shapeless[0] === only) {
        return { ...recipe.result };
      }
    }
  }

  for (const recipe of RECIPES) {
    if (!recipe.pattern) continue;
    const { grid, rows, cols } = expandPattern(recipe);
    let minR = rows, maxR = -1, minC = cols, maxC = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }
    if (maxR < 0) continue;
    const pw = maxC - minC + 1;
    const ph = maxR - minR + 1;
    if (pw !== trimmed.w || ph !== trimmed.h) continue;
    let ok = true;
    for (let r = 0; r < ph && ok; r++) {
      for (let c = 0; c < pw; c++) {
        const want = grid[minR + r][minC + c];
        const got = trimmed.grid[r * trimmed.w + c] || null;
        if (Array.isArray(want)) {
          if (!want.includes(got)) { ok = false; break; }
        } else if (got !== want) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return { ...recipe.result };
  }
  return null;
}

// 给「配方书」用：返回某配方需要的材料列表
export function recipeMaterials(recipe) {
  const out = [];
  if (recipe.shapeless) {
    for (const id of recipe.shapeless) out.push({ id, count: 1 });
    return out;
  }
  const counts = {};
  for (const row of recipe.pattern) {
    for (const ch of row) {
      if (ch === ' ') continue;
      const id = recipe.keys[ch];
      counts[id] = (counts[id] || 0) + 1;
    }
  }
  for (const [id, count] of Object.entries(counts)) out.push({ id, count });
  return out;
}
