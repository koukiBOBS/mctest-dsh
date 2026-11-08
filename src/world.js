// ============================================================
// world.js — 区块世界、地形生成、方块读写、射线拾取、存档
// ============================================================

import {
  createNoise2D,
  createNoise3D,
  fbm2,
  hash2i,
  hash3i,
} from './noise.js';
import {
  BLOCK,
  getBlockDef,
  isSolidBlock,
  isLiquidBlock,
  isOpaqueBlock,
  isWaterLike,
} from './blocks.js';

export const CHUNK_SX = 16;
export const CHUNK_SZ = 16;
export const CHUNK_H = 128;
export const SEA_LEVEL = 62;

// 下界区域（同一世界的远端坐标，避免额外的世界切换系统）
export const NETHER_ORIGIN = 200000;
export const NETHER_CHUNK_START = NETHER_ORIGIN >> 4;
export const NETHER_CHUNK_SIZE = 16;
export const NETHER_DEST = { x: NETHER_ORIGIN + 128, z: NETHER_ORIGIN + 128 };

// 末地区域
export const END_ORIGIN = 300000;
export const END_CHUNK_START = END_ORIGIN >> 4;
export const END_CHUNK_SIZE = 16;
export const END_DEST = { x: END_ORIGIN + 128, z: END_ORIGIN + 128 };
export const END_CITY = { x: END_DEST.x + 70, z: END_DEST.z + 10, y: 60 };
export const END_SHIP = { x: END_DEST.x + 100, z: END_DEST.z + 18, y: 74 };
const CHUNK_AREA = CHUNK_SX * CHUNK_SZ;

export const BIOME_NAMES = {
  ocean: '海洋',
  beach: '沙滩',
  plains: '平原',
  forest: '森林',
  desert: '沙漠',
  snowy: '雪原',
  mountain: '山地',
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}
export function blockIndex(lx, y, lz) {
  return lx + lz * CHUNK_SX + y * CHUNK_AREA;
}

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SX * CHUNK_SZ * CHUNK_H);
    this.light = new Uint8Array(CHUNK_SX * CHUNK_SZ * CHUNK_H); // 方块光 0..15
    this.heightMap = new Uint8Array(CHUNK_AREA); // 每列最高不透明方块
    this.maxY = 0;
    this.empty = true;
  }
  get(lx, y, lz) {
    if (y < 0 || y >= CHUNK_H) return 0;
    return this.blocks[blockIndex(lx, y, lz)];
  }
  set(lx, y, lz, id) {
    if (y < 0 || y >= CHUNK_H) return;
    this.blocks[blockIndex(lx, y, lz)] = id;
    if (id !== 0) {
      this.empty = false;
      if (y > this.maxY) this.maxY = y;
    }
  }
}

export class World {
  constructor(seed = 1337, renderDistance = 3, opts = {}) {
    this.seed = seed >>> 0;
    this.renderDistance = renderDistance;
    this.noPlants = !!opts.noPlants;
    this.noiseBase = createNoise2D(this.seed);
    this.noiseDetail = createNoise2D(this.seed + 77);
    this.noiseTemp = createNoise2D(this.seed + 501);
    this.noiseHumid = createNoise2D(this.seed + 902);
    this.noiseCaveA = createNoise3D(this.seed + 1234);
    this.noiseCaveB = createNoise3D(this.seed + 5678);

    this.chunks = new Map();
    this.dirtyChunks = new Set();
    this.modsByChunk = new Map(); // chunkKey -> Map("x,y,z" -> id)
    this.lightSources = new Map(); // "x,y,z" -> light level
    this.villageCache = new Map();
    this.mineshaftCache = new Map();
    this.templeCache = new Map();
    this.iglooCache = new Map();
    this.strongholdCache = new Map();
    this.mansionCache = new Map();
    this.monumentCache = new Map();
    this.cityCache = new Map();
    this.trialCache = new Map();
    this.trialSpawners = new Map();
    this.endCities = new Map();
    this.ruinCache = new Map();
    this.dungeons = new Map(); // chunkKey -> {x, y, z} 地牢房间中心
    this.structureChests = new Map(); // "x,y,z" -> 箱子战利品
    this.crops = new Map(); // "x,y,z" -> 下次生长时间
    this.signs = new Map(); // "x,y,z" -> 文本
    this.waterQueue = new Set();
    this.waterTimer = 0;
    this._cropClock = 0;
    this.time = 0; // 世界时间（秒），用于昼夜
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    this._infoCache = new Map();
  }

  // ---------- 地形参数 ----------
  columnInfo(x, z) {
    const ik = x + ',' + z;
    const cached = this._infoCache.get(ik);
    if (cached) return cached;
    if (this._infoCache.size > 20000) this._infoCache.clear();

    const cont = fbm2(this.noiseBase, x * 0.0018, z * 0.0018, 4);
    const hills = fbm2(this.noiseDetail, x * 0.012, z * 0.012, 3);
    const temp = fbm2(this.noiseTemp, x * 0.0007 + 100, z * 0.0007 - 100, 2);
    const humid = fbm2(this.noiseHumid, x * 0.0009 - 200, z * 0.0009 + 200, 2);

    let h = SEA_LEVEL + cont * 16 + hills * 5;
    if (cont > 0.32) h += (cont - 0.32) * 65;
    let height = clamp(Math.round(h), 5, CHUNK_H - 24);

    let biome;
    if (height <= SEA_LEVEL - 1) biome = 'ocean';
    else if (height <= SEA_LEVEL + 1) biome = 'beach';
    else if (height > 92) biome = 'mountain';
    else if (temp < -0.28) biome = 'snowy';
    else if (temp > 0.26 && humid < 0.06) biome = 'desert';
    else if (humid > 0.04) biome = 'forest';
    else biome = 'plains';

    const info = { height, biome, temp, humid };
    this._infoCache.set(ik, info);
    return info;
  }

  isCave(x, y, z) {
    const a = this.noiseCaveA(x * 0.045, y * 0.078, z * 0.045);
    if (Math.abs(a) < 0.052) return true;
    const b = this.noiseCaveB(x * 0.09 + 31.7, y * 0.11 + 9.1, z * 0.09 - 17.3);
    return b > 0.5;
  }

  // ---------- 区块生成 ----------
  ensureChunk(cx, cz) {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (c) return c;
    c = this.generateChunk(cx, cz);
    this.chunks.set(k, c);
    this.dirtyChunks.add(k);
    if (this.lightSources.size > 0) this._seedLightForChunk(cx, cz);
    return c;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz)) || null;
  }

  isNetherChunk(cx, cz) {
    return (
      cx >= NETHER_CHUNK_START &&
      cx < NETHER_CHUNK_START + NETHER_CHUNK_SIZE &&
      cz >= NETHER_CHUNK_START &&
      cz < NETHER_CHUNK_START + NETHER_CHUNK_SIZE
    );
  }

  isEndChunk(cx, cz) {
    return (
      cx >= END_CHUNK_START &&
      cx < END_CHUNK_START + END_CHUNK_SIZE &&
      cz >= END_CHUNK_START &&
      cz < END_CHUNK_START + END_CHUNK_SIZE
    );
  }

  generateEndChunk(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    for (let lz = 0; lz < CHUNK_SZ; lz++) {
      for (let lx = 0; lx < CHUNK_SX; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const island = hash2i(wx, wz, this.seed + 5000) > 0.22;
        if (!island) continue;
        const h = 44 + Math.floor(hash2i(wx, wz, this.seed + 5010) * 14);
        for (let y = 30; y <= h; y++) chunk.set(lx, y, lz, BLOCK.END_STONE);
        chunk.heightMap[lz * CHUNK_SX + lx] = h;
        chunk.maxY = Math.max(chunk.maxY, h);
      }
    }
    chunk.empty = false;
  }

  generateNetherChunk(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    for (let lz = 0; lz < CHUNK_SZ; lz++) {
      for (let lx = 0; lx < CHUNK_SX; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const h = 33 + Math.floor(hash2i(wx, wz, this.seed + 4000) * 7);
        for (let y = 0; y <= h; y++) {
          chunk.set(lx, y, lz, y <= 30 ? BLOCK.LAVA : BLOCK.NETHERRACK);
        }
        // 下界顶层岩壳
        for (let y = 100; y < CHUNK_H; y++) {
          chunk.set(lx, y, lz, BLOCK.NETHERRACK);
        }
        chunk.heightMap[lz * CHUNK_SX + lx] = h;
      }
    }
    chunk.maxY = CHUNK_H - 1;
    chunk.empty = false;
  }

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const x0 = cx * CHUNK_SX;
    const z0 = cz * CHUNK_SZ;

    if (this.isEndChunk(cx, cz)) {
      this.generateEndChunk(chunk);
      this.stampEndCity(chunk);
      this.stampEndShip(chunk);
      const emods = this.modsByChunk.get(chunkKey(cx, cz));
      if (emods) {
        for (const [k, id] of emods) {
          const p = k.split(',');
          const wx = +p[0];
          const wy = +p[1];
          const wz = +p[2];
          chunk.set(wx - x0, wy, wz - z0, id);
          if (id !== 0) {
            chunk.maxY = Math.max(chunk.maxY, wy);
            const mdef = getBlockDef(id);
            if (mdef.light > 0) this.lightSources.set(wx + ',' + wy + ',' + wz, mdef.light);
          }
        }
      }
      return chunk;
    }

    if (this.isNetherChunk(cx, cz)) {
      this.generateNetherChunk(chunk);
      const nmods = this.modsByChunk.get(chunkKey(cx, cz));
      if (nmods) {
        for (const [k, id] of nmods) {
          const p = k.split(',');
          const wx = +p[0];
          const wy = +p[1];
          const wz = +p[2];
          chunk.set(wx - x0, wy, wz - z0, id);
          if (id !== 0) {
            chunk.maxY = Math.max(chunk.maxY, wy);
            const mdef = getBlockDef(id);
            if (mdef.light > 0) this.lightSources.set(wx + ',' + wy + ',' + wz, mdef.light);
            if (isWaterLike(id)) this._scheduleWater(wx, wy, wz);
          }
        }
      }
      return chunk;
    }

    // 1) 基础地形 + 矿石 + 洞穴 + 水
    for (let lz = 0; lz < CHUNK_SZ; lz++) {
      for (let lx = 0; lx < CHUNK_SX; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const info = this.columnInfo(wx, wz);
        const h = info.height;
        const biome = info.biome;
        let surfaceTop = 0;

        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          let id = BLOCK.AIR;
          if (y === 0 || (y === 1 && hash3i(wx, y, wz, this.seed) < 0.5)) {
            id = BLOCK.BEDROCK;
          } else if (y <= h) {
            if (y === h) {
              if (biome === 'ocean') {
                const r0 = hash3i(wx, 1, wz, this.seed + 9);
                id = r0 < 0.15 ? BLOCK.CLAY : r0 < 0.5 ? BLOCK.GRAVEL : BLOCK.SAND;
              } else if (biome === 'beach') {
                id = hash3i(wx, 2, wz, this.seed + 9) < 0.15 ? BLOCK.CLAY : BLOCK.SAND;
              } else if (biome === 'desert') id = BLOCK.SAND;
              else if (biome === 'snowy') id = BLOCK.SNOW;
              else if (biome === 'mountain' && h > 88) id = BLOCK.SNOW;
              else id = BLOCK.GRASS;
            } else if (y >= h - 3) {
              if (biome === 'desert') id = y >= h - 1 ? BLOCK.SAND : BLOCK.SANDSTONE;
              else if (biome === 'beach' || biome === 'ocean') id = hash3i(wx, 1, wz, this.seed + 77) < 0.22 ? BLOCK.CLAY : BLOCK.SAND;
              else if (biome === 'snowy') id = BLOCK.DIRT;
              else if (biome === 'mountain' && h > 88) id = BLOCK.STONE;
              else id = BLOCK.DIRT;
            } else {
              id = BLOCK.STONE;
            }

            // 洞穴（不破坏表层 4 格，避免水漏进洞）
            if (id !== BLOCK.BEDROCK && y >= 3 && y < h - 4 && this.isCave(wx, y, wz)) {
              id = BLOCK.AIR;
            }

            // 矿石
            if (id === BLOCK.STONE) {
              const r = hash3i(wx, y, wz, this.seed + 31);
              if (y < 14 && r < 0.0018) id = BLOCK.DIAMOND_ORE;
              else if (y < 32 && r < 0.006) id = BLOCK.GOLD_ORE;
              else if (y < 56 && r < 0.02) id = BLOCK.IRON_ORE;
              else if (y < 80 && r < 0.038) id = BLOCK.COAL_ORE;
              else if (r > 0.9965) id = BLOCK.GRAVEL;
            }
          } else if (y <= SEA_LEVEL) {
            // 海平面以下填水（只在低于海平面的列）
            id = h < SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
            if (y === SEA_LEVEL && biome === 'snowy' && h < SEA_LEVEL) id = BLOCK.ICE;
          }
          chunk.set(lx, y, lz, id);
          if (id !== 0 && id !== BLOCK.WATER && id !== BLOCK.ICE && getBlockDef(id).opaque) {
            surfaceTop = y;
          }
          chunk.maxY = Math.max(chunk.maxY, y);
        }
        chunk.heightMap[lz * CHUNK_SX + lx] = surfaceTop;
      }
    }

    // 2) 树木装饰（含相邻区块伸进来的部分）
    if (this.noPlants) {
      const modsOnly = this.modsByChunk.get(chunkKey(cx, cz));
      if (modsOnly) {
        for (const [k, id] of modsOnly) {
          const p = k.split(',');
          const wx = +p[0];
          const wy = +p[1];
          const wz = +p[2];
          chunk.set(wx - x0, wy, wz - z0, id);
          if (id !== 0) {
            chunk.maxY = Math.max(chunk.maxY, wy);
            const mdef = getBlockDef(id);
            if (mdef.light > 0) this.lightSources.set(wx + ',' + wy + ',' + wz, mdef.light);
            if (isWaterLike(id)) this._scheduleWater(wx, wy, wz);
          }
        }
      }
      return chunk;
    }
    for (let gz = z0 - 2; gz <= z0 + CHUNK_SZ + 1; gz++) {
      for (let gx = x0 - 2; gx <= x0 + CHUNK_SX + 1; gx++) {
        const kind = this.treeKindAt(gx, gz);
        if (kind) this.placeTree(chunk, gx, gz, kind);
      }
    }

    // 3) 花草（仅本区块自己的列，避免重复）
    for (let lz = 0; lz < CHUNK_SZ; lz++) {
      for (let lx = 0; lx < CHUNK_SX; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const h = chunk.heightMap[lz * CHUNK_SX + lx];
        if (h <= 0) continue;
        const top = chunk.get(lx, h, lz);
        const above = chunk.get(lx, h + 1, lz);
        if (above !== BLOCK.AIR) continue;
        const info = this.columnInfo(wx, wz);
        const r = hash2i(wx, wz, this.seed + 404);
        let density = 0;
        if (trustBiome(info.biome)) density = info.biome === 'plains' ? 0.09 : info.biome === 'forest' ? 0.08 : 0.03;
        if (density > 0 && r < density && top === BLOCK.GRASS) {
          const pick = hash2i(wx, wz, this.seed + 405);
          let plant = BLOCK.TALL_GRASS;
          if (pick > 0.82) plant = BLOCK.DANDELION;
          else if (pick > 0.72) plant = BLOCK.ROSE;
          chunk.set(lx, h + 1, lz, plant);
          chunk.maxY = Math.max(chunk.maxY, h + 1);
        }
      }
    }

    // 3b) 沙漠仙人掌（只在本区块自己的列）
    for (let lz = 0; lz < CHUNK_SZ; lz++) {
      for (let lx = 0; lx < CHUNK_SX; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const h = chunk.heightMap[lz * CHUNK_SX + lx];
        if (h <= SEA_LEVEL) continue;
        const info = this.columnInfo(wx, wz);
        if (info.biome !== 'desert') continue;
        if (chunk.get(lx, h, lz) !== BLOCK.SAND) continue;
        if (chunk.get(lx, h + 1, lz) !== BLOCK.AIR) continue;
        if (hash2i(wx, wz, this.seed + 606) > 0.012) continue;
        const height = 1 + Math.floor(hash2i(wx, wz, this.seed + 607) * 3);
        for (let dy = 1; dy <= height; dy++) {
          chunk.set(lx, h + dy, lz, BLOCK.CACTUS);
          chunk.maxY = Math.max(chunk.maxY, h + dy);
        }
      }
    }

    // 3b2) 平原/森林南瓜
    for (let lz = 0; lz < CHUNK_SZ; lz++) {
      for (let lx = 0; lx < CHUNK_SX; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const h = chunk.heightMap[lz * CHUNK_SX + lx];
        if (h <= SEA_LEVEL) continue;
        const info = this.columnInfo(wx, wz);
        if (info.biome !== 'plains' && info.biome !== 'forest') continue;
        if (chunk.get(lx, h, lz) !== BLOCK.GRASS) continue;
        if (chunk.get(lx, h + 1, lz) !== BLOCK.AIR) continue;
        if (hash2i(wx, wz, this.seed + 777) > 0.0016) continue;
        chunk.set(lx, h + 1, lz, BLOCK.PUMPKIN);
        chunk.maxY = Math.max(chunk.maxY, h + 1);
      }
    }

    // 3c) 结构（村庄/地牢）
    this.generateStructures(chunk);

    // 4) 应用玩家改动
    const mods = this.modsByChunk.get(chunkKey(cx, cz));
    if (mods) {
      for (const [k, id] of mods) {
        const p = k.split(',');
        const wx = +p[0];
        const wy = +p[1];
        const wz = +p[2];
        chunk.set(wx - x0, wy, wz - z0, id);
        if (id !== 0) {
          chunk.maxY = Math.max(chunk.maxY, wy);
          const mdef = getBlockDef(id);
          if (mdef.light > 0) this.lightSources.set(wx + ',' + wy + ',' + wz, mdef.light);
        }
      }
    }
    return chunk;
  }

  treeKindAt(gx, gz) {
    const info = this.columnInfo(gx, gz);
    if (info.height <= SEA_LEVEL + 1) return null;
    let oak = 0;
    let birch = 0;
    let spruce = 0;
    switch (info.biome) {
      case 'forest':
        oak = 0.02;
        birch = 0.012;
        spruce = 0.003;
        break;
      case 'plains':
        oak = 0.004;
        birch = 0.003;
        break;
      case 'snowy':
        spruce = 0.02;
        break;
      case 'mountain':
        spruce = 0.006;
        break;
      default:
        return null;
    }
    const r = hash2i(gx, gz, this.seed + 21);
    if (r < oak) return 'oak';
    if (r < oak + birch) return 'birch';
    if (r < oak + birch + spruce) return 'spruce';
    return null;
  }

  placeTree(chunk, gx, gz, kind = 'oak') {
    const info = this.columnInfo(gx, gz);
    const baseY = info.height + 1;
    const rand = hash2i(gx, gz, this.seed + 22);
    let trunkH;
    if (kind === 'spruce') trunkH = 7 + Math.floor(rand * 4);
    else if (kind === 'birch') trunkH = 5 + Math.floor(rand * 3);
    else trunkH = 4 + Math.floor(rand * 3);

    const topY = baseY + trunkH - 1;
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const woodId = kind === 'birch' ? BLOCK.BIRCH_LOG : kind === 'spruce' ? BLOCK.SPRUCE_LOG : BLOCK.LOG;
    const leafId = kind === 'birch' ? BLOCK.BIRCH_LEAVES : kind === 'spruce' ? BLOCK.SPRUCE_LEAVES : BLOCK.LEAVES;

    const replaceable = (cur) =>
      cur === BLOCK.AIR ||
      cur === BLOCK.TALL_GRASS ||
      cur === BLOCK.LEAVES ||
      cur === BLOCK.BIRCH_LEAVES ||
      cur === BLOCK.SPRUCE_LEAVES;

    const put = (wx, wy, wz, id, onlyAir) => {
      const lx = wx - x0;
      const lz = wz - z0;
      if (lx < 0 || lx >= CHUNK_SX || lz < 0 || lz >= CHUNK_SZ || wy < 0 || wy >= CHUNK_H) return;
      if (onlyAir) {
        const cur = chunk.get(lx, wy, lz);
        if (!replaceable(cur)) return;
      }
      chunk.set(lx, wy, lz, id);
      chunk.maxY = Math.max(chunk.maxY, wy);
    };

    for (let y = baseY; y <= topY; y++) put(gx, y, gz, woodId, false);

    if (kind === 'spruce') {
      for (let dy = trunkH - 6; dy <= trunkH + 1; dy++) {
        const t = dy - (trunkH - 6);
        const radius = t >= 6 ? 1 : t >= 4 ? 2 : 3;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx === 0 && dz === 0 && dy <= trunkH - 1) continue;
            if (Math.abs(dx) === radius && Math.abs(dz) === radius) {
              if (hash2i(gx + dx, gz + dz, this.seed + dy) < 0.5) continue;
            }
            put(gx + dx, baseY + dy, gz + dz, leafId, true);
          }
        }
      }
    } else {
      for (let dy = trunkH - 2; dy <= trunkH + 1; dy++) {
        const radius = dy >= trunkH ? 1 : 2;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx === 0 && dz === 0 && dy <= trunkH - 1) continue;
            if (Math.abs(dx) === radius && Math.abs(dz) === radius) {
              if (hash2i(gx + dx, gz + dz, this.seed + dy) < 0.45) continue;
            }
            put(gx + dx, baseY + dy, gz + dz, leafId, true);
          }
        }
      }
    }
  }

  // ---------------- 结构生成 ----------------
  chunkSet(chunk, wx, wy, wz, id) {
    const lx = wx - chunk.cx * CHUNK_SX;
    const lz = wz - chunk.cz * CHUNK_SZ;
    if (lx < 0 || lx >= CHUNK_SX || lz < 0 || lz >= CHUNK_SZ || wy < 0 || wy >= CHUNK_H) return;
    chunk.set(lx, wy, lz, id);
    if (id !== 0) chunk.maxY = Math.max(chunk.maxY, wy);
  }

  generateStructures(chunk) {
    this.stampVillages(chunk);
    this.stampDesertTemples(chunk);
    this.stampIgloos(chunk);
    this.stampStrongholds(chunk);
    this.stampMansions(chunk);
    this.stampMonuments(chunk);
    this.stampRuinedPortals(chunk);
    this.stampAncientCities(chunk);
    this.stampTrialChambers(chunk);
    this.stampMineshafts(chunk);
    this.stampDungeon(chunk);
  }

  getVillage(cx, cz) {
    const key = cx + ',' + cz;
    if (this.villageCache.has(key)) return this.villageCache.get(key);
    if (this.villageCache.size > 800) this.villageCache.clear();
    const seed = this.seed;
    const h = (n) => hash2i(cx * 31 + n, cz * 17 - n, seed + 900 + n);
    const centerX = Math.round(cx * 128 + 36 + h(1) * 56);
    const centerZ = Math.round(cz * 128 + 36 + h(2) * 56);
    const info = this.columnInfo(centerX, centerZ);
    let village = null;
    if (['plains', 'forest', 'desert'].includes(info.biome) && info.height > SEA_LEVEL + 2) {
      const layout = [
        [0, 0, 7, 7],
        [14, 2, 6, 5],
        [-15, 2, 6, 6],
        [2, 15, 6, 5],
        [-4, -15, 5, 6],
        [16, -13, 6, 6],
      ];
      const buildings = [];
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < layout.length; i++) {
        const [ox, oz, w, d] = layout[i];
        const jx = Math.floor(h(10 + i) * 3) - 1;
        const jz = Math.floor(h(30 + i) * 3) - 1;
        const bx = centerX + ox + jx;
        const bz = centerZ + oz + jz;
        const floorY = this.columnInfo(bx + (w >> 1), bz + (d >> 1)).height;
        buildings.push({ x: bx, z: bz, w, d, floorY });
        minX = Math.min(minX, bx - 2);
        maxX = Math.max(maxX, bx + w + 1);
        minZ = Math.min(minZ, bz - 2);
        maxZ = Math.max(maxZ, bz + d + 1);
      }
      village = {
        centerX,
        centerZ,
        floorY: info.height,
        biome: info.biome,
        buildings,
        minX: minX - 6,
        maxX: maxX + 6,
        minZ: minZ - 6,
        maxZ: maxZ + 6,
      };
    }
    this.villageCache.set(key, village);
    return village;
  }

  stampVillages(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 128);
    const ccz = Math.floor(z0 / 128);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const v = this.getVillage(ccx + dx, ccz + dz);
        if (!v) continue;
        if (x1 < v.minX || x0 > v.maxX || z1 < v.minZ || z0 > v.maxZ) continue;
        this.stampVillage(chunk, v);
      }
    }
  }

  stampVillage(chunk, v) {
    const set = (wx, wy, wz, id) => this.chunkSet(chunk, wx, wy, wz, id);
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const inChunk = (wx, wz) => wx >= x0 && wx < x0 + CHUNK_SX && wz >= z0 && wz < z0 + CHUNK_SX;
    const cy = v.floorY;

    // 村中心水井
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const wx = v.centerX + dx;
        const wz = v.centerZ + dz;
        if (!inChunk(wx, wz)) continue;
        if (dx === 0 && dz === 0) {
          set(wx, cy, wz, BLOCK.WATER);
          set(wx, cy + 1, wz, BLOCK.WATER);
        } else {
          set(wx, cy, wz, BLOCK.COBBLE);
          set(wx, cy + 1, wz, BLOCK.COBBLE);
        }
      }
    }

    const isInsideBuilding = (wx, wz) => {
      for (const b of v.buildings) {
        if (wx >= b.x && wx < b.x + b.w && wz >= b.z && wz < b.z + b.d) return true;
      }
      return false;
    };

    for (const b of v.buildings) {
      const floorY = b.floorY;
      const doorSide =
        Math.abs(b.x + b.w / 2 - v.centerX) > Math.abs(b.z + b.d / 2 - v.centerZ) ? 'x' : 'z';
      for (let dx = -1; dx <= b.w; dx++) {
        for (let dz = -1; dz <= b.d; dz++) {
          const wx = b.x + dx;
          const wz = b.z + dz;
          if (!inChunk(wx, wz)) continue;
          // 地基与地板
          for (let wy = floorY - 6; wy <= floorY; wy++) {
            if (wy === floorY) set(wx, wy, wz, BLOCK.PLANKS);
            else if (dx < 0 || dx >= b.w || dz < 0 || dz >= b.d) set(wx, wy, wz, BLOCK.COBBLE);
          }
          const wall = dx >= 0 && dx < b.w && dz >= 0 && dz < b.d &&
            (dx === 0 || dx === b.w - 1 || dz === 0 || dz === b.d - 1);
          if (wall) {
            for (let wy = floorY + 1; wy <= floorY + 3; wy++) {
              const isDoor =
                (doorSide === 'z' && dz === 0 && dx === Math.floor(b.w / 2) && wy <= floorY + 2) ||
                (doorSide === 'x' && dx === 0 && dz === Math.floor(b.d / 2) && wy <= floorY + 2);
              if (isDoor) {
                set(wx, wy, wz, BLOCK.AIR);
                continue;
              }
              const isWindow = wy === floorY + 2 && (dx + dz) % 4 === 0 && !(dx === 0 && dz === 0);
              if (isWindow) {
                set(wx, wy, wz, BLOCK.GLASS);
                continue;
              }
              const corner = (dx === 0 || dx === b.w - 1) && (dz === 0 || dz === b.d - 1);
              set(wx, wy, wz, corner ? BLOCK.LOG : v.biome === 'desert' ? BLOCK.SANDSTONE : BLOCK.PLANKS);
            }
          } else if (dx >= 0 && dx < b.w && dz >= 0 && dz < b.d) {
            for (let wy = floorY + 1; wy <= floorY + 3; wy++) set(wx, wy, wz, BLOCK.AIR);
          }
        }
      }
      // 屋顶
      for (let dx = -1; dx <= b.w; dx++) {
        for (let dz = -1; dz <= b.d; dz++) {
          const wx = b.x + dx;
          const wz = b.z + dz;
          if (!inChunk(wx, wz)) continue;
          set(wx, floorY + 4, wz, BLOCK.PLANKS);
          if (dx >= 0 && dx < b.w && dz >= 0 && dz < b.d) set(wx, floorY + 5, wz, BLOCK.PLANKS);
        }
      }
    }

    // 通往村中心的碎石路
    for (const b of v.buildings) {
      const sx = b.x + (b.w >> 1);
      const sz = b.z + (b.d >> 1);
      const steps = Math.max(Math.abs(sx - v.centerX), Math.abs(sz - v.centerZ));
      for (let i = 0; i <= steps; i++) {
        const t = steps ? i / steps : 0;
        const wx = Math.round(v.centerX + (sx - v.centerX) * t);
        const wz = Math.round(v.centerZ + (sz - v.centerZ) * t);
        if (!inChunk(wx, wz) || isInsideBuilding(wx, wz)) continue;
        const h = this.columnInfo(wx, wz).height;
        set(wx, h, wz, BLOCK.GRAVEL);
        set(wx, h + 1, wz, BLOCK.AIR);
      }
    }
  }

  stampDungeon(chunk) {
    const r = hash2i(chunk.cx, chunk.cz, this.seed + 700);
    if (r > 0.05) return;
    const y = 16 + Math.floor(hash2i(chunk.cx, chunk.cz, this.seed + 701) * 18);
    const cx = chunk.cx * 16 + 8;
    const cz = chunk.cz * 16 + 8;
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const wx = cx + dx;
        const wz = cz + dz;
        const inside = dx > -5 && dx < 5 && dz > -5 && dz < 5;
        if (inside) {
          this.chunkSet(chunk, wx, y - 1, wz, dx === 0 && dz === 0 ? BLOCK.STONE_BRICKS : BLOCK.COBBLE);
          for (let wy = y; wy <= y + 3; wy++) this.chunkSet(chunk, wx, wy, wz, BLOCK.AIR);
          this.chunkSet(chunk, wx, y + 4, wz, BLOCK.STONE_BRICKS);
        } else {
          this.chunkSet(chunk, wx, y - 1, wz, BLOCK.COBBLE);
          for (let wy = y; wy <= y + 3; wy++) {
            this.chunkSet(chunk, wx, wy, wz, (dx + dz) % 3 === 0 ? BLOCK.COBBLE : BLOCK.STONE_BRICKS);
          }
          this.chunkSet(chunk, wx, y + 4, wz, BLOCK.STONE_BRICKS);
        }
      }
    }
    this.dungeons.set(chunkKey(chunk.cx, chunk.cz), { x: cx, y, z: cz });
    const chestX = cx + 2;
    const chestZ = cz + 2;
    this.chunkSet(chunk, chestX, y, chestZ, BLOCK.CHEST);
    const key = chestX + ',' + y + ',' + chestZ;
    if (!this.structureChests.has(key)) this.structureChests.set(key, this._dungeonLoot(chunk.cx, chunk.cz));
  }

  _dungeonLoot(cx, cz) {
    const r = (n) => hash2i(cx * 7 + n, cz * 5 - n, this.seed + 730 + n);
    const loot = [];
    if (r(1) < 0.85) loot.push({ id: 'iron_ingot', count: 1 + Math.floor(r(2) * 4) });
    if (r(3) < 0.7) loot.push({ id: 'coal', count: 2 + Math.floor(r(4) * 6) });
    if (r(5) < 0.6) loot.push({ id: 'bread', count: 1 + Math.floor(r(6) * 3) });
    if (r(7) < 0.35) loot.push({ id: 'gold_ingot', count: 1 + Math.floor(r(8) * 2) });
    if (r(9) < 0.12) loot.push({ id: 'diamond', count: 1 });
    if (r(10) < 0.5) loot.push({ id: 'arrow', count: 4 + Math.floor(r(11) * 8) });
    return loot;
  }

  // ---------------- 矿洞（废弃矿井） ----------------
  getMineshaft(cx, cz) {
    const key = cx + ',' + cz;
    if (this.mineshaftCache.has(key)) return this.mineshaftCache.get(key);
    if (this.mineshaftCache.size > 600) this.mineshaftCache.clear();
    const h = (n) => hash2i(cx * 13 + n, cz * 29 - n, this.seed + 1100 + n);
    let m = null;
    if (h(1) < 0.32) {
      const centerX = Math.round(cx * 128 + 30 + h(2) * 60);
      const centerZ = Math.round(cz * 128 + 30 + h(3) * 60);
      const y = 15 + Math.floor(h(4) * 20);
      m = {
        centerX,
        centerZ,
        y,
        minX: centerX - 27,
        maxX: centerX + 27,
        minZ: centerZ - 27,
        maxZ: centerZ + 27,
      };
    }
    this.mineshaftCache.set(key, m);
    return m;
  }

  stampMineshafts(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 128);
    const ccz = Math.floor(z0 / 128);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getMineshaft(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampMineshaft(chunk, m);
      }
    }
  }

  stampMineshaft(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const carve = (x, z) => {
      for (let dy = 0; dy < 3; dy++) set(x, m.y + dy, z, BLOCK.AIR);
      set(x, m.y + 3, z, BLOCK.STONE);
      set(x, m.y - 1, z, BLOCK.PLANKS);
    };
    // 主矿道（沿 X）
    for (let x = m.centerX - 24; x <= m.centerX + 24; x++) {
      for (let dz = -1; dz <= 1; dz++) carve(x, m.centerZ + dz);
    }
    // 分支矿道（沿 Z）
    for (const bx of [-16, -8, 8, 16]) {
      for (let z = m.centerZ - 9; z <= m.centerZ + 9; z++) {
        for (let dx = -1; dx <= 1; dx++) carve(m.centerX + bx + dx, z);
      }
    }
    // 木支架
    for (let x = m.centerX - 24; x <= m.centerX + 24; x += 6) {
      for (const dz of [-1, 1]) {
        for (let dy = 0; dy < 3; dy++) set(x, m.y + dy, m.centerZ + dz, BLOCK.LOG);
      }
      for (let dz = -1; dz <= 1; dz++) set(x, m.y + 3, m.centerZ + dz, BLOCK.PLANKS);
    }
    // 分支尽头支撑
    for (const bx of [-16, -8, 8, 16]) {
      for (const zEnd of [m.centerZ - 9, m.centerZ + 9]) {
        for (const dx of [-1, 1]) {
          for (let dy = 0; dy < 3; dy++) set(m.centerX + bx + dx, m.y + dy, zEnd, BLOCK.LOG);
        }
        for (let dx = -1; dx <= 1; dx++) set(m.centerX + bx + dx, m.y + 3, zEnd, BLOCK.PLANKS);
      }
    }
  }

  findNearestMineshaft(x, z) {
    const ccx = Math.floor(x / 128);
    const ccz = Math.floor(z / 128);
    let best = null;
    let bestD = Infinity;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) {
        const m = this.getMineshaft(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 沙漠神殿 ----------------
  getDesertTemple(cx, cz) {
    const key = cx + ',' + cz;
    if (this.templeCache.has(key)) return this.templeCache.get(key);
    if (this.templeCache.size > 600) this.templeCache.clear();
    const h = (n) => hash2i(cx * 41 + n, cz * 23 - n, this.seed + 1400 + n);
    let m = null;
    if (h(1) < 0.24) {
      const centerX = Math.round(cx * 128 + 32 + h(2) * 56);
      const centerZ = Math.round(cz * 128 + 32 + h(3) * 56);
      const info = this.columnInfo(centerX, centerZ);
      if (info.biome === 'desert' && info.height > SEA_LEVEL + 2) {
        m = {
          centerX,
          centerZ,
          floorY: info.height,
          minX: centerX - 12,
          maxX: centerX + 12,
          minZ: centerZ - 12,
          maxZ: centerZ + 12,
        };
      }
    }
    this.templeCache.set(key, m);
    return m;
  }

  stampDesertTemples(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 128);
    const ccz = Math.floor(z0 / 128);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getDesertTemple(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampDesertTemple(chunk, m);
      }
    }
  }

  stampDesertTemple(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const baseY = m.floorY;
    // 地基
    for (let dx = -8; dx <= 8; dx++) {
      for (let dz = -8; dz <= 8; dz++) {
        const wx = m.centerX + dx;
        const wz = m.centerZ + dz;
        for (let wy = baseY - 4; wy < baseY; wy++) set(wx, wy, wz, BLOCK.SANDSTONE);
        set(wx, baseY, wz, BLOCK.SANDSTONE);
        for (let wy = baseY + 1; wy <= baseY + 14; wy++) set(wx, wy, wz, BLOCK.AIR);
      }
    }
    // 阶梯金字塔
    for (let layer = 0; layer <= 6; layer++) {
      const half = 7 - layer;
      for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
          set(m.centerX + dx, baseY + 1 + layer, m.centerZ + dz, BLOCK.SANDSTONE);
        }
      }
    }
    // 中空房间
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dy = 1; dy <= 3; dy++) set(m.centerX + dx, baseY + dy, m.centerZ + dz, BLOCK.AIR);
        set(m.centerX + dx, baseY, m.centerZ + dz, BLOCK.SANDSTONE);
      }
    }
    // 入口通道（-X 方向）
    for (let dx = -7; dx <= -3; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        set(m.centerX + dx, baseY + 1, m.centerZ + dz, BLOCK.AIR);
        set(m.centerX + dx, baseY + 2, m.centerZ + dz, BLOCK.AIR);
      }
    }
    // 宝藏箱
    const chests = [
      [m.centerX - 2, baseY + 1, m.centerZ - 2],
      [m.centerX + 2, baseY + 1, m.centerZ + 2],
    ];
    for (const [cx, cy, cz] of chests) {
      set(cx, cy, cz, BLOCK.CHEST);
      const key = cx + ',' + cy + ',' + cz;
      if (!this.structureChests.has(key)) this.structureChests.set(key, this._templeLoot(cx, cz));
    }
  }

  _templeLoot(cx, cz) {
    const r = (n) => hash2i(cx * 11 + n, cz * 7 - n, this.seed + 1500 + n);
    const loot = [];
    loot.push({ id: 'gold_ingot', count: 1 + Math.floor(r(1) * 3) });
    if (r(2) < 0.8) loot.push({ id: 'iron_ingot', count: 1 + Math.floor(r(3) * 4) });
    if (r(4) < 0.4) loot.push({ id: 'diamond', count: 1 + Math.floor(r(5) * 2) });
    if (r(6) < 0.7) loot.push({ id: 'bone', count: 1 + Math.floor(r(7) * 4) });
    if (r(8) < 0.6) loot.push({ id: 'bread', count: 1 + Math.floor(r(9) * 3) });
    if (r(10) < 0.5) loot.push({ id: 'gunpowder', count: 1 + Math.floor(r(11) * 5) });
    return loot;
  }

  findNearestTemple(x, z) {
    const ccx = Math.floor(x / 128);
    const ccz = Math.floor(z / 128);
    let best = null;
    let bestD = Infinity;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) {
        const m = this.getDesertTemple(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 雪屋 ----------------
  getIgloo(cx, cz) {
    const key = cx + ',' + cz;
    if (this.iglooCache.has(key)) return this.iglooCache.get(key);
    if (this.iglooCache.size > 600) this.iglooCache.clear();
    const h = (n) => hash2i(cx * 37 + n, cz * 19 - n, this.seed + 1600 + n);
    let m = null;
    if (h(1) < 0.3) {
      const centerX = Math.round(cx * 128 + 32 + h(2) * 56);
      const centerZ = Math.round(cz * 128 + 32 + h(3) * 56);
      const info = this.columnInfo(centerX, centerZ);
      if (info.biome === 'snowy' && info.height > SEA_LEVEL + 1) {
        m = {
          centerX,
          centerZ,
          floorY: info.height,
          minX: centerX - 9,
          maxX: centerX + 9,
          minZ: centerZ - 9,
          maxZ: centerZ + 9,
        };
      }
    }
    this.iglooCache.set(key, m);
    return m;
  }

  stampIgloos(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 128);
    const ccz = Math.floor(z0 / 128);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getIgloo(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampIgloo(chunk, m);
      }
    }
  }

  stampIgloo(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const baseY = m.floorY;
    const radius = 4;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const wx = m.centerX + dx;
        const wz = m.centerZ + dz;
        const edge = Math.abs(dx) === radius || Math.abs(dz) === radius;
        const inner = Math.abs(dx) <= radius - 1 && Math.abs(dz) <= radius - 1;
        for (let wy = baseY - 3; wy <= baseY; wy++) set(wx, wy, wz, edge ? BLOCK.SNOW : BLOCK.SNOW);
        set(wx, baseY, wz, BLOCK.SNOW);
        for (let wy = baseY + 1; wy <= baseY + 3; wy++) {
          if (edge) set(wx, wy, wz, BLOCK.SNOW);
          else if (inner) set(wx, wy, wz, BLOCK.AIR);
        }
        set(wx, baseY + 4, wz, edge ? BLOCK.SNOW : BLOCK.SNOW);
      }
    }
    // 门洞（-Z）
    for (let dx = -1; dx <= 1; dx++) {
      set(m.centerX + dx, baseY + 1, m.centerZ - radius, BLOCK.AIR);
      set(m.centerX + dx, baseY + 2, m.centerZ - radius, BLOCK.AIR);
    }
    // 内部箱子
    const cx = m.centerX;
    const cz = m.centerZ;
    set(cx, baseY + 1, cz, BLOCK.CHEST);
    const key = cx + ',' + (baseY + 1) + ',' + cz;
    if (!this.structureChests.has(key)) {
      this.structureChests.set(key, [
        { id: 'iron_ingot', count: 2 },
        { id: 'bread', count: 2 },
        { id: 'coal', count: 4 },
      ]);
    }
  }

  findNearestIgloo(x, z) {
    const ccx = Math.floor(x / 128);
    const ccz = Math.floor(z / 128);
    let best = null;
    let bestD = Infinity;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) {
        const m = this.getIgloo(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 地下要塞 ----------------
  getStronghold(cx, cz) {
    const key = cx + ',' + cz;
    if (this.strongholdCache.has(key)) return this.strongholdCache.get(key);
    if (this.strongholdCache.size > 600) this.strongholdCache.clear();
    const h = (n) => hash2i(cx * 53 + n, cz * 31 - n, this.seed + 1700 + n);
    let m = null;
    if (h(1) < 0.42) {
      const centerX = Math.round(cx * 512 + 50 + h(2) * 410);
      const centerZ = Math.round(cz * 512 + 50 + h(3) * 410);
      const y = 17 + Math.floor(h(4) * 12);
      m = {
        centerX,
        centerZ,
        y,
        minX: centerX - 44,
        maxX: centerX + 44,
        minZ: centerZ - 44,
        maxZ: centerZ + 44,
      };
    }
    this.strongholdCache.set(key, m);
    return m;
  }

  stampStrongholds(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 512);
    const ccz = Math.floor(z0 / 512);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getStronghold(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampStronghold(chunk, m);
      }
    }
  }

  stampStronghold(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const B = BLOCK.STONE_BRICKS;
    const baseY = m.y;
    const room = (cx, cz, halfX, halfZ, height) => {
      for (let dx = -halfX; dx <= halfX; dx++) {
        for (let dz = -halfZ; dz <= halfZ; dz++) {
          const x = cx + dx;
          const z = cz + dz;
          set(x, baseY - 1, z, B);
          for (let dy = 0; dy < height; dy++) {
            const edge = Math.abs(dx) === halfX || Math.abs(dz) === halfZ;
            set(x, baseY + dy, z, edge ? B : BLOCK.AIR);
          }
          set(x, baseY + height, z, B);
        }
      }
    };
    // 中央大厅
    room(m.centerX, m.centerZ, 6, 6, 6);
    // 东西向走廊
    for (let x = m.centerX - 32; x <= m.centerX + 32; x++) {
      for (let dz = -1; dz <= 1; dz++) {
        const z = m.centerZ + dz;
        set(x, baseY - 1, z, B);
        for (let dy = 0; dy < 4; dy++) set(x, baseY + dy, z, BLOCK.AIR);
        set(x, baseY + 4, z, B);
      }
      for (const dz of [-2, 2]) {
        for (let dy = 0; dy < 4; dy++) set(x, baseY + dy, m.centerZ + dz, B);
        set(x, baseY + 4, m.centerZ + dz, B);
      }
    }
    // 南北向走廊
    for (let z = m.centerZ - 32; z <= m.centerZ + 32; z++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = m.centerX + dx;
        set(x, baseY - 1, z, B);
        for (let dy = 0; dy < 4; dy++) set(x, baseY + dy, z, BLOCK.AIR);
        set(x, baseY + 4, z, B);
      }
      for (const dx of [-2, 2]) {
        for (let dy = 0; dy < 4; dy++) set(m.centerX + dx, baseY + dy, z, B);
        set(m.centerX + dx, baseY + 4, z, B);
      }
    }
    // 四个端厅
    const rooms = [
      [m.centerX - 34, m.centerZ, 4, 4, 5],
      [m.centerX + 34, m.centerZ, 4, 4, 5],
      [m.centerX, m.centerZ - 34, 4, 4, 5],
      [m.centerX, m.centerZ + 34, 4, 4, 5],
    ];
    for (const [cx, cz, hx, hz, hh] of rooms) room(cx, cz, hx, hz, hh);
    // 末地传送门（5×5 框架 + 3×3 传送门方块）
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        set(m.centerX + dx, baseY + 1, m.centerZ - 3 + dz, edge ? BLOCK.END_PORTAL_FRAME : BLOCK.END_PORTAL);
      }
    }
    // 宝箱
    const chests = [
      [m.centerX - 3, baseY + 1, m.centerZ + 3],
      [m.centerX - 34, baseY + 1, m.centerZ],
      [m.centerX + 34, baseY + 1, m.centerZ],
      [m.centerX, baseY + 1, m.centerZ + 34],
    ];
    for (const [cx, cy, cz] of chests) {
      if (this.getBlock(cx, cy, cz) !== BLOCK.AIR) continue;
      set(cx, cy, cz, BLOCK.CHEST);
      const key = cx + ',' + cy + ',' + cz;
      if (!this.structureChests.has(key)) this.structureChests.set(key, this._strongholdLoot(cx, cz));
    }
  }

  _strongholdLoot(cx, cz) {
    const r = (n) => hash2i(cx * 13 + n, cz * 17 - n, this.seed + 1800 + n);
    const loot = [];
    loot.push({ id: 'iron_ingot', count: 2 + Math.floor(r(1) * 4) });
    if (r(2) < 0.8) loot.push({ id: 'gold_ingot', count: 1 + Math.floor(r(3) * 2) });
    if (r(4) < 0.5) loot.push({ id: 'diamond', count: 1 });
    if (r(5) < 0.7) loot.push({ id: 'bread', count: 2 + Math.floor(r(6) * 2) });
    if (r(7) < 0.6) loot.push({ id: 'arrow', count: 4 + Math.floor(r(8) * 8) });
    if (r(9) < 0.5) loot.push({ id: 'apple', count: 1 + Math.floor(r(10) * 2) });
    return loot;
  }

  findNearestStronghold(x, z) {
    const ccx = Math.floor(x / 512);
    const ccz = Math.floor(z / 512);
    let best = null;
    let bestD = Infinity;
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const m = this.getStronghold(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 林地府邸 ----------------
  getMansion(cx, cz) {
    const key = cx + ',' + cz;
    if (this.mansionCache.has(key)) return this.mansionCache.get(key);
    if (this.mansionCache.size > 600) this.mansionCache.clear();
    const h = (n) => hash2i(cx * 47 + n, cz * 29 - n, this.seed + 1900 + n);
    let m = null;
    if (h(1) < 0.22) {
      const centerX = Math.round(cx * 384 + 40 + h(2) * 300);
      const centerZ = Math.round(cz * 384 + 40 + h(3) * 300);
      const info = this.columnInfo(centerX, centerZ);
      if (info.biome === 'forest' && info.height > SEA_LEVEL + 2) {
        m = {
          centerX,
          centerZ,
          floorY: info.height,
          minX: centerX - 16,
          maxX: centerX + 16,
          minZ: centerZ - 13,
          maxZ: centerZ + 13,
        };
      }
    }
    this.mansionCache.set(key, m);
    return m;
  }

  stampMansions(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 384);
    const ccz = Math.floor(z0 / 384);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getMansion(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampMansion(chunk, m);
      }
    }
  }

  stampMansion(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const baseY = m.floorY;
    const x0 = m.centerX - 10;
    const x1 = m.centerX + 10;
    const z0 = m.centerZ - 7;
    const z1 = m.centerZ + 7;
    const P = BLOCK.SPRUCE_PLANKS;
    const L = BLOCK.SPRUCE_LOG;
    const G = BLOCK.GLASS;

    // 地基 + 清理上方
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      for (let z = z0 - 1; z <= z1 + 1; z++) {
        for (let y = baseY - 4; y < baseY; y++) set(x, y, z, P);
        set(x, baseY, z, P);
        for (let y = baseY + 1; y <= baseY + 16; y++) set(x, y, z, BLOCK.AIR);
      }
    }

    // 三层楼
    for (let f = 0; f < 3; f++) {
      const fy = baseY + 1 + f * 4;
      // 楼板
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) set(x, fy - 1, z, P);
      }
      // 外墙 + 窗户
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const edge = x === x0 || x === x1 || z === z0 || z === z1;
          if (!edge) continue;
          const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
          for (let y = fy; y <= fy + 2; y++) {
            if (corner) set(x, y, z, L);
            else if (y === fy + 1 && (x - x0) % 3 === 0 && (z - z0) % 3 === 0) set(x, y, z, G);
            else set(x, y, z, P);
          }
        }
      }
      // 房间隔断 + 门洞
      for (let z = z0 + 1; z <= z1 - 1; z++) {
        for (let y = fy; y <= fy + 2; y++) {
          if (z === m.centerZ) continue;
          set(m.centerX, y, z, P);
        }
      }
      // 楼板上的门洞
      // 楼梯：从本层东南角上到下一层
      const sx = x1 - 3;
      const sz = z1 - 2;
      for (let step = 0; step < 4; step++) {
        set(sx, fy + step, sz - step, P);
        set(sx + 1, fy + step, sz - step, P);
      }
      // 书架点缀
      if (f === 1) {
        for (let dx = 0; dx < 4; dx++) {
          set(x0 + 2 + dx, fy, m.centerZ + 4, BLOCK.BOOKSHELF);
          set(x0 + 2 + dx, fy + 1, m.centerZ + 4, BLOCK.BOOKSHELF);
        }
      }
      // 宝箱
      const chests = [
        [x0 + 2, fy, z0 + 2],
        [x1 - 2, fy, z1 - 2],
      ];
      for (const [cx, cy, cz] of chests) {
        set(cx, cy, cz, BLOCK.CHEST);
        const key = cx + ',' + cy + ',' + cz;
        if (!this.structureChests.has(key)) this.structureChests.set(key, this._mansionLoot(cx, cz));
      }
    }

    // 屋顶
    const roofY = baseY + 13;
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      for (let z = z0 - 1; z <= z1 + 1; z++) {
        set(x, roofY - 1, z, P);
      }
    }
    for (let layer = 0; layer < 3; layer++) {
      const shrink = layer;
      for (let x = x0 - 1 + shrink; x <= x1 + 1 - shrink; x++) {
        for (let z = z0 - 1 + shrink; z <= z1 + 1 - shrink; z++) {
          set(x, roofY + layer, z, layer === 2 ? L : P);
        }
      }
    }

    // 正门（南侧，打通两层）
    for (let dx = -1; dx <= 1; dx++) {
      set(m.centerX + dx, baseY + 1, z1, BLOCK.AIR);
      set(m.centerX + dx, baseY + 2, z1, BLOCK.AIR);
    }
  }

  _mansionLoot(cx, cz) {
    const r = (n) => hash2i(cx * 7 + n, cz * 11 - n, this.seed + 2000 + n);
    const loot = [];
    loot.push({ id: 'emerald', count: 1 + Math.floor(r(1) * 4) });
    if (r(2) < 0.8) loot.push({ id: 'iron_ingot', count: 2 + Math.floor(r(3) * 4) });
    if (r(4) < 0.5) loot.push({ id: 'diamond', count: 1 });
    if (r(5) < 0.7) loot.push({ id: 'gold_ingot', count: 1 + Math.floor(r(6) * 3) });
    if (r(7) < 0.6) loot.push({ id: 'bread', count: 1 + Math.floor(r(8) * 3) });
    return loot;
  }

  findNearestMansion(x, z) {
    const ccx = Math.floor(x / 384);
    const ccz = Math.floor(z / 384);
    let best = null;
    let bestD = Infinity;
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const m = this.getMansion(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 海底遗迹 ----------------
  getMonument(cx, cz) {
    const key = cx + ',' + cz;
    if (this.monumentCache.has(key)) return this.monumentCache.get(key);
    if (this.monumentCache.size > 600) this.monumentCache.clear();
    const h = (n) => hash2i(cx * 61 + n, cz * 37 - n, this.seed + 2100 + n);
    let m = null;
    if (h(1) < 0.3) {
      const centerX = Math.round(cx * 512 + 40 + h(2) * 430);
      const centerZ = Math.round(cz * 512 + 40 + h(3) * 430);
      const info = this.columnInfo(centerX, centerZ);
      if (info.biome === 'ocean' && info.height < SEA_LEVEL - 4) {
        m = {
          centerX,
          centerZ,
          floorY: info.height,
          minX: centerX - 12,
          maxX: centerX + 12,
          minZ: centerZ - 12,
          maxZ: centerZ + 12,
        };
      }
    }
    this.monumentCache.set(key, m);
    return m;
  }

  stampMonuments(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 512);
    const ccz = Math.floor(z0 / 512);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getMonument(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampMonument(chunk, m);
      }
    }
  }

  stampMonument(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const B = BLOCK.PRISMARINE;
    const L = BLOCK.SEA_LANTERN;
    const baseY = m.floorY + 1;
    // 底座
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) set(m.centerX + dx, baseY, m.centerZ + dz, B);
    }
    // 三层塔身
    for (let layer = 0; layer < 3; layer++) {
      const half = 7 - layer * 2;
      const y0 = baseY + 1 + layer * 2;
      for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
          const edge = Math.abs(dx) === half || Math.abs(dz) === half;
          for (let dy = 0; dy < 2; dy++) {
            if (edge) set(m.centerX + dx, y0 + dy, m.centerZ + dz, B);
            else set(m.centerX + dx, y0 + dy, m.centerZ + dz, BLOCK.AIR);
          }
          if (edge) {
            if ((dx === -half || dx === half) && (dz === -half || dz === half)) {
              set(m.centerX + dx, y0, m.centerZ + dz, L);
            }
          }
        }
      }
    }
    // 顶部
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) set(m.centerX + dx, baseY + 7, m.centerZ + dz, B);
    }
    set(m.centerX, baseY + 8, m.centerZ, L);
    // 入口（-Z 方向）
    for (let dx = -1; dx <= 1; dx++) {
      set(m.centerX + dx, baseY + 1, m.centerZ - 7, BLOCK.AIR);
      set(m.centerX + dx, baseY + 2, m.centerZ - 7, BLOCK.AIR);
    }
    // 内部宝箱
    const chests = [
      [m.centerX - 3, baseY + 1, m.centerZ - 3],
      [m.centerX + 3, baseY + 1, m.centerZ + 3],
    ];
    for (const [cx, cy, cz] of chests) {
      set(cx, cy, cz, BLOCK.CHEST);
      const key = cx + ',' + cy + ',' + cz;
      if (!this.structureChests.has(key)) this.structureChests.set(key, this._monumentLoot(cx, cz));
    }
  }

  _monumentLoot(cx, cz) {
    const r = (n) => hash2i(cx * 9 + n, cz * 13 - n, this.seed + 2200 + n);
    const loot = [];
    loot.push({ id: 'gold_ingot', count: 2 + Math.floor(r(1) * 4) });
    if (r(2) < 0.8) loot.push({ id: 'emerald', count: 1 + Math.floor(r(3) * 3) });
    if (r(4) < 0.5) loot.push({ id: 'diamond', count: 1 });
    if (r(5) < 0.7) loot.push({ id: 'iron_ingot', count: 2 + Math.floor(r(6) * 4) });
    return loot;
  }

  findNearestMonument(x, z) {
    const ccx = Math.floor(x / 512);
    const ccz = Math.floor(z / 512);
    let best = null;
    let bestD = Infinity;
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const m = this.getMonument(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 废弃传送门 ----------------
  getRuinedPortal(cx, cz) {
    const key = cx + ',' + cz;
    if (this.ruinCache.has(key)) return this.ruinCache.get(key);
    if (this.ruinCache.size > 600) this.ruinCache.clear();
    const h = (n) => hash2i(cx * 71 + n, cz * 43 - n, this.seed + 2300 + n);
    let m = null;
    if (h(1) < 0.32) {
      const centerX = Math.round(cx * 256 + 24 + h(2) * 200);
      const centerZ = Math.round(cz * 256 + 24 + h(3) * 200);
      const info = this.columnInfo(centerX, centerZ);
      if (info.biome !== 'ocean' && info.height > SEA_LEVEL + 2) {
        m = {
          centerX,
          centerZ,
          floorY: info.height,
          minX: centerX - 8,
          maxX: centerX + 8,
          minZ: centerZ - 8,
          maxZ: centerZ + 8,
        };
      }
    }
    this.ruinCache.set(key, m);
    return m;
  }

  stampRuinedPortals(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 256);
    const ccz = Math.floor(z0 / 256);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getRuinedPortal(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampRuinedPortal(chunk, m);
      }
    }
  }

  stampRuinedPortal(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const baseY = m.floorY + 1;
    // 下界岩平台
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        set(m.centerX + dx, baseY - 1, m.centerZ + dz, BLOCK.NETHERRACK);
      }
    }
    // 黑曜石框架（4×5，部分缺失）
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) {
        const border = i === 0 || i === 3 || j === 0 || j === 4;
        if (!border) continue;
        const missing = hash2i(m.centerX + i, m.centerZ + j, this.seed + 2400) < 0.22;
        if (missing) continue;
        set(m.centerX - 2 + i, baseY + j, m.centerZ, BLOCK.OBSIDIAN);
      }
    }
    // 宝箱
    const cx = m.centerX + 3;
    const cz = m.centerZ + 2;
    set(cx, baseY, cz, BLOCK.CHEST);
    const key = cx + ',' + baseY + ',' + cz;
    if (!this.structureChests.has(key)) {
      this.structureChests.set(key, [
        { id: 'obsidian', count: 2 + Math.floor(hash2i(cx, cz, this.seed + 2410) * 4) },
        { id: 'flint', count: 1 + Math.floor(hash2i(cx, cz, this.seed + 2420) * 3) },
        { id: 'gold_ingot', count: 1 + Math.floor(hash2i(cx, cz, this.seed + 2430) * 2) },
      ]);
    }
  }

  findNearestRuinedPortal(x, z) {
    const ccx = Math.floor(x / 256);
    const ccz = Math.floor(z / 256);
    let best = null;
    let bestD = Infinity;
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const m = this.getRuinedPortal(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 远古城市 ----------------
  getAncientCity(cx, cz) {
    const key = cx + ',' + cz;
    if (this.cityCache.has(key)) return this.cityCache.get(key);
    if (this.cityCache.size > 600) this.cityCache.clear();
    const h = (n) => hash2i(cx * 67 + n, cz * 41 - n, this.seed + 2500 + n);
    let m = null;
    if (h(1) < 0.4) {
      const centerX = Math.round(cx * 512 + 36 + h(2) * 440);
      const centerZ = Math.round(cz * 512 + 36 + h(3) * 440);
      const y = 10 + Math.floor(h(4) * 10);
      m = {
        centerX,
        centerZ,
        y,
        minX: centerX - 22,
        maxX: centerX + 22,
        minZ: centerZ - 22,
        maxZ: centerZ + 22,
      };
    }
    this.cityCache.set(key, m);
    return m;
  }

  stampAncientCities(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 512);
    const ccz = Math.floor(z0 / 512);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getAncientCity(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampAncientCity(chunk, m);
      }
    }
  }

  stampAncientCity(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const D = BLOCK.DEEPSLATE;
    const S = BLOCK.SCULK;
    const baseY = m.y;
    const half = 17;
    // 地板、天花板、空气
    for (let dx = -half - 1; dx <= half + 1; dx++) {
      for (let dz = -half - 1; dz <= half + 1; dz++) {
        set(m.centerX + dx, baseY - 2, m.centerZ + dz, D);
        set(m.centerX + dx, baseY - 1, m.centerZ + dz, D);
        for (let dy = 0; dy <= 8; dy++) set(m.centerX + dx, baseY + dy, m.centerZ + dz, BLOCK.AIR);
        set(m.centerX + dx, baseY + 9, m.centerZ + dz, D);
        // 外墙
        if (Math.abs(dx) === half || Math.abs(dz) === half) {
          for (let dy = 0; dy <= 8; dy++) set(m.centerX + dx, baseY + dy, m.centerZ + dz, D);
        }
      }
    }
    // 幽匿斑块
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const wx = m.centerX + dx;
        const wz = m.centerZ + dz;
        if (hash2i(wx, wz, this.seed + 3100) < 0.16) set(wx, baseY - 1, wz, S);
      }
    }
    // 立柱与幽匿感测体
    for (const [px, pz] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, 0]]) {
      for (let dy = 0; dy <= 6; dy++) set(m.centerX + px, baseY + dy, m.centerZ + pz, D);
      set(m.centerX + px, baseY + 7, m.centerZ + pz, BLOCK.SCULK_SENSOR);
      set(m.centerX + px, baseY + 8, m.centerZ + pz, S);
    }
    // 幽匿灯柱（用海晶灯作为发光装饰）
    for (const [px, pz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
      set(m.centerX + px, baseY + 3, m.centerZ + pz, BLOCK.SEA_LANTERN);
    }
    // 宝箱
    const chests = [
      [m.centerX - 4, baseY, m.centerZ - 4],
      [m.centerX + 4, baseY, m.centerZ - 4],
      [m.centerX - 4, baseY, m.centerZ + 4],
      [m.centerX + 4, baseY, m.centerZ + 4],
    ];
    for (const [cx, cy, cz] of chests) {
      set(cx, cy, cz, BLOCK.CHEST);
      const key = cx + ',' + cy + ',' + cz;
      if (!this.structureChests.has(key)) this.structureChests.set(key, this._cityLoot(cx, cz));
    }
  }

  _cityLoot(cx, cz) {
    const r = (n) => hash2i(cx * 11 + n, cz * 19 - n, this.seed + 3200 + n);
    const loot = [];
    loot.push({ id: 'diamond', count: 1 + Math.floor(r(1) * 2) });
    loot.push({ id: 'emerald', count: 2 + Math.floor(r(2) * 5) });
    if (r(3) < 0.8) loot.push({ id: 'iron_ingot', count: 3 + Math.floor(r(4) * 5) });
    if (r(5) < 0.7) loot.push({ id: 'gold_ingot', count: 2 + Math.floor(r(6) * 4) });
    if (r(7) < 0.6) loot.push({ id: 'book', count: 1 + Math.floor(r(8) * 3) });
    return loot;
  }

  findNearestAncientCity(x, z) {
    const ccx = Math.floor(x / 512);
    const ccz = Math.floor(z / 512);
    let best = null;
    let bestD = Infinity;
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const m = this.getAncientCity(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 试炼密室 ----------------
  getTrialChamber(cx, cz) {
    const key = cx + ',' + cz;
    if (this.trialCache.has(key)) return this.trialCache.get(key);
    if (this.trialCache.size > 600) this.trialCache.clear();
    const h = (n) => hash2i(cx * 73 + n, cz * 47 - n, this.seed + 2700 + n);
    let m = null;
    if (h(1) < 0.35) {
      const centerX = Math.round(cx * 384 + 30 + h(2) * 320);
      const centerZ = Math.round(cz * 384 + 30 + h(3) * 320);
      const y = 20 + Math.floor(h(4) * 14);
      m = {
        centerX,
        centerZ,
        y,
        minX: centerX - 16,
        maxX: centerX + 16,
        minZ: centerZ - 16,
        maxZ: centerZ + 16,
      };
    }
    this.trialCache.set(key, m);
    return m;
  }

  stampTrialChambers(chunk) {
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const ccx = Math.floor(x0 / 384);
    const ccz = Math.floor(z0 / 384);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.getTrialChamber(ccx + dx, ccz + dz);
        if (!m) continue;
        if (x1 < m.minX || x0 > m.maxX || z1 < m.minZ || z0 > m.maxZ) continue;
        this.stampTrialChamber(chunk, m);
      }
    }
  }

  stampTrialChamber(chunk, m) {
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const D = BLOCK.DEEPSLATE;
    const B = BLOCK.STONE_BRICKS;
    const baseY = m.y;
    const half = 10;
    for (let dx = -half - 1; dx <= half + 1; dx++) {
      for (let dz = -half - 1; dz <= half + 1; dz++) {
        set(m.centerX + dx, baseY - 2, m.centerZ + dz, D);
        set(m.centerX + dx, baseY - 1, m.centerZ + dz, D);
        for (let dy = 0; dy <= 6; dy++) set(m.centerX + dx, baseY + dy, m.centerZ + dz, BLOCK.AIR);
        set(m.centerX + dx, baseY + 7, m.centerZ + dz, D);
        if (Math.abs(dx) === half || Math.abs(dz) === half) {
          for (let dy = 0; dy <= 6; dy++) {
            set(m.centerX + dx, baseY + dy, m.centerZ + dz, (dx + dz) % 2 === 0 ? D : B);
          }
        }
      }
    }
    // 立柱
    for (const [px, pz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
      for (let dy = 0; dy <= 3; dy++) set(m.centerX + px, baseY + dy, m.centerZ + pz, B);
    }
    // 试炼刷怪笼
    set(m.centerX, baseY + 1, m.centerZ, BLOCK.TRIAL_SPAWNER);
    this.trialSpawners.set(m.centerX + ',' + (baseY + 1) + ',' + m.centerZ, {
      x: m.centerX,
      y: baseY + 1,
      z: m.centerZ,
    });
    // 宝箱
    const chests = [
      [m.centerX - 7, baseY, m.centerZ - 7],
      [m.centerX + 7, baseY, m.centerZ + 7],
    ];
    for (const [cx, cy, cz] of chests) {
      set(cx, cy, cz, BLOCK.CHEST);
      const key = cx + ',' + cy + ',' + cz;
      if (!this.structureChests.has(key)) this.structureChests.set(key, this._trialLoot(cx, cz));
    }
    // 入口通道（-Z）
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = 0; dy <= 2; dy++) set(m.centerX + dx, baseY + dy, m.centerZ - half, BLOCK.AIR);
    }
  }

  _trialLoot(cx, cz) {
    const r = (n) => hash2i(cx * 17 + n, cz * 23 - n, this.seed + 2800 + n);
    const loot = [];
    loot.push({ id: 'diamond', count: 1 + Math.floor(r(1) * 3) });
    loot.push({ id: 'emerald', count: 2 + Math.floor(r(2) * 4) });
    if (r(3) < 0.85) loot.push({ id: 'iron_ingot', count: 2 + Math.floor(r(4) * 4) });
    if (r(5) < 0.6) loot.push({ id: 'apple', count: 1 });
    if (r(6) < 0.7) loot.push({ id: 'arrow', count: 6 + Math.floor(r(7) * 10) });
    return loot;
  }

  findNearestTrialChamber(x, z) {
    const ccx = Math.floor(x / 384);
    const ccz = Math.floor(z / 384);
    let best = null;
    let bestD = Infinity;
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const m = this.getTrialChamber(ccx + dx, ccz + dz);
        if (!m) continue;
        const d = (m.centerX - x) ** 2 + (m.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }

  // ---------------- 末地城 ----------------
  stampEndCity(chunk) {
    const city = END_CITY;
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    const half = 8;
    if (x1 < city.x - half || x0 > city.x + half || z1 < city.z - half || z0 > city.z + half) {
      return;
    }
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const baseY = city.y;
    const P = BLOCK.PURPUR_BLOCK;
    const w = 7;
    for (let dx = -w - 1; dx <= w + 1; dx++) {
      for (let dz = -w - 1; dz <= w + 1; dz++) {
        set(city.x + dx, baseY, city.z + dz, BLOCK.END_STONE);
        for (let dy = 1; dy <= 28; dy++) set(city.x + dx, baseY + dy, city.z + dz, BLOCK.AIR);
      }
    }
    // 塔身
    for (let dy = 1; dy <= 22; dy++) {
      for (let dx = -w; dx <= w; dx++) {
        for (let dz = -w; dz <= w; dz++) {
          const edge = Math.abs(dx) === w || Math.abs(dz) === w;
          if (!edge) continue;
          const window = dy % 5 === 2 && (dx + dz) % 3 === 0;
          set(city.x + dx, baseY + dy, city.z + dz, window ? BLOCK.GLASS : P);
        }
      }
    }
    // 楼层
    for (const fy of [7, 14, 21]) {
      for (let dx = -w; dx <= w; dx++) {
        for (let dz = -w; dz <= w; dz++) set(city.x + dx, baseY + fy, city.z + dz, P);
      }
    }
    // 顶部
    for (let layer = 0; layer < 4; layer++) {
      const shrink = layer;
      for (let dx = -w + shrink; dx <= w - shrink; dx++) {
        for (let dz = -w + shrink; dz <= w - shrink; dz++) set(city.x + dx, baseY + 23 + layer, city.z + dz, P);
      }
    }
    // 屋顶信标（荧石）
    set(city.x, baseY + 27, city.z, BLOCK.GLOWSTONE);
    // 门洞
    for (let dx = -1; dx <= 1; dx++) {
      set(city.x + dx, baseY + 1, city.z - w, BLOCK.AIR);
      set(city.x + dx, baseY + 2, city.z - w, BLOCK.AIR);
    }
    // 宝箱
    const chests = [
      [city.x - 4, baseY + 8, city.z - 4],
      [city.x + 4, baseY + 8, city.z + 4],
      [city.x - 4, baseY + 15, city.z + 4],
      [city.x + 4, baseY + 15, city.z - 4],
    ];
    for (const [cx, cy, cz] of chests) {
      set(cx, cy, cz, BLOCK.CHEST);
      const key = cx + ',' + cy + ',' + cz;
      if (!this.structureChests.has(key)) this.structureChests.set(key, this._endCityLoot(cx, cz));
    }
    this.endCities.set('fixed', { x: city.x, y: baseY, z: city.z });
  }

  _endCityLoot(cx, cz) {
    const r = (n) => hash2i(cx * 19 + n, cz * 29 - n, this.seed + 3300 + n);
    const loot = [];
    loot.push({ id: 'diamond', count: 1 + Math.floor(r(1) * 3) });
    loot.push({ id: 'shulker_shell', count: 1 + Math.floor(r(2) * 2) });
    if (r(3) < 0.8) loot.push({ id: 'emerald', count: 2 + Math.floor(r(4) * 5) });
    if (r(5) < 0.7) loot.push({ id: 'iron_ingot', count: 3 + Math.floor(r(6) * 4) });
    if (r(7) < 0.6) loot.push({ id: 'gold_ingot', count: 2 + Math.floor(r(8) * 3) });
    return loot;
  }

  stampEndShip(chunk) {
    const ship = END_SHIP;
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;
    const x1 = x0 + CHUNK_SX - 1;
    const z1 = z0 + CHUNK_SZ - 1;
    if (x1 < ship.x - 5 || x0 > ship.x + 5 || z1 < ship.z - 7 || z0 > ship.z + 7) return;
    const set = (x, y, z, id) => this.chunkSet(chunk, x, y, z, id);
    const P = BLOCK.PURPUR_BLOCK;
    const baseY = ship.y;
    for (let dz = -6; dz <= 6; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        set(ship.x + dx, baseY, ship.z + dz, P);
        set(ship.x + dx, baseY + 1, ship.z + dz, BLOCK.AIR);
        set(ship.x + dx, baseY + 2, ship.z + dz, BLOCK.AIR);
        if (Math.abs(dx) === 3) set(ship.x + dx, baseY + 1, ship.z + dz, P);
      }
    }
    // 船头
    for (let dy = 0; dy <= 1; dy++) set(ship.x, baseY + dy, ship.z + 7, P);
    // 桅杆与帆
    for (let dy = 2; dy <= 8; dy++) set(ship.x, baseY + dy, ship.z, P);
    for (let dy = 4; dy <= 7; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(ship.x + dx, baseY + dy, ship.z + 1, BLOCK.WOOL);
    }
    // 宝箱（鞘翅）
    const cx = ship.x + 2;
    const cy = baseY + 1;
    const cz = ship.z - 4;
    set(cx, cy, cz, BLOCK.CHEST);
    const key = cx + ',' + cy + ',' + cz;
    if (!this.structureChests.has(key)) {
      this.structureChests.set(key, [
        { id: 'elytra', count: 1 },
        { id: 'diamond', count: 2 },
        { id: 'emerald', count: 3 },
      ]);
    }
    this.endCities.set('ship', { x: ship.x, y: baseY, z: ship.z });
  }

  findNearestEndCity() {
    return { x: END_CITY.x, y: END_CITY.y, z: END_CITY.z };
  }

  takeStructureLoot(key) {
    const loot = this.structureChests.get(key);
    if (!loot) return null;
    this.structureChests.delete(key);
    return loot;
  }

  findNearestVillage(x, z) {
    const ccx = Math.floor(x / 128);
    const ccz = Math.floor(z / 128);
    let best = null;
    let bestD = Infinity;
    for (let dx = -12; dx <= 12; dx++) {
      for (let dz = -12; dz <= 12; dz++) {
        const v = this.getVillage(ccx + dx, ccz + dz);
        if (!v) continue;
        const d = (v.centerX - x) ** 2 + (v.centerZ - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
    }
    return best;
  }

  findNearestDungeon(x, z) {
    const px = Math.floor(x / 16);
    const pz = Math.floor(z / 16);
    for (let r = 0; r < 48; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = px + dx;
          const cz = pz + dz;
          if (hash2i(cx, cz, this.seed + 700) > 0.05) continue;
          const y = 16 + Math.floor(hash2i(cx, cz, this.seed + 701) * 18);
          return { x: cx * 16 + 8, y: y + 1, z: cz * 16 + 8 };
        }
      }
    }
    return null;
  }

  // ---------- 作物生长 ----------
  plantCrop(x, y, z, time) {
    this.crops.set(x + ',' + y + ',' + z, time);
  }

  updateCrops(dt) {
    if (this.crops.size === 0) return;
    this._cropClock += dt;
    if (this._cropClock < 0.5) return;
    this._cropClock = 0;
    const now = this.time;
    for (const [key, due] of this.crops) {
      if (due > now) continue;
      const p = key.split(',');
      const x = +p[0];
      const y = +p[1];
      const z = +p[2];
      const id = this.getBlock(x, y, z);
      if (id < BLOCK.WHEAT_0 || id > BLOCK.WHEAT_3) {
        this.crops.delete(key);
        continue;
      }
      if (id === BLOCK.WHEAT_3) {
        this.crops.delete(key);
        continue;
      }
      const next = id + 1;
      this.setBlock(x, y, z, next);
      if (next >= BLOCK.WHEAT_3) this.crops.delete(key);
      else this.crops.set(key, now + 22 + Math.random() * 20);
    }
  }

  serializeCrops() {
    return [...this.crops.entries()].map(([k, t]) => {
      const p = k.split(',');
      return [+p[0], +p[1], +p[2], t];
    });
  }

  loadCrops(list) {
    if (!Array.isArray(list)) return;
    this.crops.clear();
    for (const item of list) {
      if (!Array.isArray(item) || item.length < 4) continue;
      this.crops.set(item[0] + ',' + item[1] + ',' + item[2], item[3]);
    }
  }

  setSign(x, y, z, text) {
    const key = x + ',' + y + ',' + z;
    if (text && text.trim()) this.signs.set(key, String(text).slice(0, 120));
    else this.signs.delete(key);
  }

  getSign(x, y, z) {
    return this.signs.get(x + ',' + y + ',' + z) || '';
  }

  serializeSigns() {
    return [...this.signs.entries()];
  }

  loadSigns(list) {
    if (!Array.isArray(list)) return;
    this.signs.clear();
    for (const item of list) {
      if (Array.isArray(item) && item.length >= 2 && typeof item[1] === 'string') {
        this.signs.set(item[0], item[1]);
      }
    }
  }

  // ---------- 方块读写 ----------
  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_H) return 0;
    const cx = x >> 4;
    const cz = z >> 4;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return 0;
    return c.get(x & 15, y, z & 15);
  }

  isLoaded(x, z) {
    return this.chunks.has(chunkKey(x >> 4, z >> 4));
  }

  // ---------- 方块光 ----------
  getLight(x, y, z) {
    if (y < 0 || y >= CHUNK_H) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return 0;
    return c.light[blockIndex(x & 15, y, z & 15)];
  }

  // 区块生成后，如果附近有光源，就重新算一次该区域的方块光
  _seedLightForChunk(cx, cz) {
    const x0 = cx * CHUNK_SX;
    const z0 = cz * CHUNK_SZ;
    for (const key of this.lightSources.keys()) {
      const p = key.split(',');
      const lx = +p[0];
      const lz = +p[2];
      if (Math.abs(lx - x0) <= 48 && Math.abs(lz - z0) <= 48) {
        this.recomputeLightAroundBlock(x0 + 8, CHUNK_H >> 1, z0 + 8);
        return;
      }
    }
  }

  // 重新计算以 (bx, by, bz) 为中心的 3x3 区块方块光（只在有光源时调用）
  recomputeLightAroundBlock(bx, by, bz) {
    const ccx = bx >> 4;
    const ccz = bz >> 4;
    const affected = new Map();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.getChunk(ccx + dx, ccz + dz);
        if (!c) continue;
        affected.set(chunkKey(ccx + dx, ccz + dz), c);
      }
    }
    if (affected.size === 0) return;

    const before = new Map();
    for (const [k, c] of affected) before.set(k, c.light.slice());
    for (const c of affected.values()) c.light.fill(0);

    const buckets = [];
    for (let i = 0; i < 16; i++) buckets.push([]);
    const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

    const seed = (x, y, z, level) => {
      if (level <= 0 || y < 0 || y >= CHUNK_H) return;
      const c = this.getChunk(x >> 4, z >> 4);
      if (!c) return;
      const idx = blockIndex(x & 15, y, z & 15);
      if (c.light[idx] >= level) return;
      c.light[idx] = level;
      buckets[level].push(x, y, z);
    };

    for (const [key, level] of this.lightSources) {
      const p = key.split(',');
      const x = +p[0];
      const y = +p[1];
      const z = +p[2];
      if (Math.abs(x - bx) > 44 || Math.abs(z - bz) > 44) continue;
      seed(x, y, z, level);
    }

    for (let level = 15; level > 1; level--) {
      const arr = buckets[level];
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i];
        const y = arr[i + 1];
        const z = arr[i + 2];
        for (let d = 0; d < 6; d++) {
          const dir = DIRS[d];
          const nx = x + dir[0];
          const ny = y + dir[1];
          const nz = z + dir[2];
          if (ny < 0 || ny >= CHUNK_H) continue;
          const nc = this.getChunk(nx >> 4, nz >> 4);
          if (!nc) continue;
          const nb = nc.get(nx & 15, ny, nz & 15);
          if (nb !== 0 && getBlockDef(nb).opaque) continue;
          seed(nx, ny, nz, level - 1);
        }
      }
    }

    // 对比前后数组，只把真正发生变化的区块标脏
    for (const [k, c] of affected) {
      const oldArr = before.get(k);
      let changed = false;
      for (let i = 0; i < c.light.length; i++) {
        if (c.light[i] !== oldArr[i]) {
          changed = true;
          break;
        }
      }
      if (changed) this.dirtyChunks.add(k);
    }
  }

  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= CHUNK_H) return;
    const cx = x >> 4;
    const cz = z >> 4;
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = this.ensureChunk(cx, cz);
    }
    const lx = x & 15;
    const lz = z & 15;
    const oldId = c.get(lx, y, lz);
    c.set(lx, y, lz, id);
    if (id !== 0) {
      c.empty = false;
      c.maxY = Math.max(c.maxY, y);
      if (getBlockDef(id).opaque) {
        const cur = c.heightMap[lz * CHUNK_SX + lx];
        if (y > cur) c.heightMap[lz * CHUNK_SX + lx] = y;
      }
    } else {
      // 重新计算该列地表高度
      let top = 0;
      for (let yy = CHUNK_H - 1; yy >= 0; yy--) {
        const b = c.get(lx, yy, lz);
        if (b !== 0 && getBlockDef(b).opaque) { top = yy; break; }
      }
      c.heightMap[lz * CHUNK_SX + lx] = top;
    }
    // 记录玩家改动（水流等临时方块不写入存档）
    if (record) {
      let mods = this.modsByChunk.get(k);
      if (!mods) {
        mods = new Map();
        this.modsByChunk.set(k, mods);
      }
      mods.set(x + ',' + y + ',' + z, id);
    }
    // 标记需要重新生成网格的区块（含邻接）
    this.dirtyChunks.add(k);
    if (lx === 0) this.dirtyChunks.add(chunkKey(cx - 1, cz));
    if (lx === 15) this.dirtyChunks.add(chunkKey(cx + 1, cz));
    if (lz === 0) this.dirtyChunks.add(chunkKey(cx, cz - 1));
    if (lz === 15) this.dirtyChunks.add(chunkKey(cx, cz + 1));

    // 方块光：光源增减或透明度变化时重算局部光照
    const oldDef = getBlockDef(oldId);
    const newDef = getBlockDef(id);
    const lk = x + ',' + y + ',' + z;
    let lightChanged = false;
    if (oldDef.light > 0) {
      this.lightSources.delete(lk);
      lightChanged = true;
    }
    if (newDef.light > 0) {
      this.lightSources.set(lk, newDef.light);
      lightChanged = true;
    }
    if (oldDef.opaque !== newDef.opaque) lightChanged = true;
    if (lightChanged) this.recomputeLightAroundBlock(x, y, z);
    if (oldId >= BLOCK.WHEAT_0 && oldId <= BLOCK.WHEAT_3) {
      this.crops.delete(x + ',' + y + ',' + z);
    }

    this._scheduleWater(x, y, z);
  }

  // ---------- 水流动 ----------
  _scheduleWater(x, y, z) {
    const around = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    let nearWater = false;
    for (const [dx, dy, dz] of around) {
      if (isWaterLike(this.getBlock(x + dx, y + dy, z + dz))) {
        nearWater = true;
        break;
      }
    }
    if (!nearWater) return;
    for (const [dx, dy, dz] of around) {
      this.waterQueue.add((x + dx) + ',' + (y + dy) + ',' + (z + dz));
    }
  }

  _wq(x, y, z) {
    if (this.waterQueue.size > 4000) return;
    this.waterQueue.add(x + ',' + y + ',' + z);
  }

  tickWater(dt) {
    if (this.waterQueue.size === 0) return;
    this.waterTimer += dt;
    if (this.waterTimer < 0.2) return;
    this.waterTimer = 0;
    const batch = [];
    let n = 0;
    for (const key of this.waterQueue) {
      batch.push(key);
      this.waterQueue.delete(key);
      if (++n >= 80) break;
    }
    for (const key of batch) {
      const p = key.split(',');
      this._updateWaterAt(+p[0], +p[1], +p[2]);
    }
  }

  _levelOf(id) {
    if (id === BLOCK.WATER) return 8;
    if (id >= BLOCK.WATER_FLOW_1 && id <= BLOCK.WATER_FLOW_7) return id - BLOCK.WATER_FLOW_1 + 1;
    return 0;
  }

  _flowId(level) {
    const clamped = Math.max(1, Math.min(7, level));
    return BLOCK.WATER_FLOW_1 + clamped - 1;
  }

  _updateWaterAt(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!isWaterLike(id)) return;
    const level = this._levelOf(id);
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

    const isLava = (bid) => bid === BLOCK.LAVA;
    const setFlow = (nx, ny, nz, lvl) => {
      this.setBlock(nx, ny, nz, this._flowId(lvl), false);
      this._wq(nx, ny, nz);
    };

    // 支撑判定（流动水需要有水源/更强的水/上方水）
    let supported = id === BLOCK.WATER;
    if (!supported) {
      const above = this.getBlock(x, y + 1, z);
      if (isWaterLike(above)) supported = true;
      else {
        for (const [dx, dy, dz] of dirs) {
          const nid = this.getBlock(x + dx, y + dy, z + dz);
          if (isWaterLike(nid) && this._levelOf(nid) > level) {
            supported = true;
            break;
          }
        }
      }
      if (!supported) {
        this.setBlock(x, y, z, BLOCK.AIR, false);
        for (const [dx, dy, dz] of dirs) this._wq(x + dx, y + dy, z + dz);
        this._wq(x, y + 1, z);
        return;
      }
    }

    const outLevel = level >= 7 ? (id === BLOCK.WATER ? 7 : level) : level;
    const spreadLevel = outLevel - (id === BLOCK.WATER ? 0 : 1);

    // 向下流
    const below = this.getBlock(x, y - 1, z);
    if (below === BLOCK.AIR) {
      setFlow(x, y - 1, z, 7);
    } else if (isLava(below)) {
      this.setBlock(x, y - 1, z, BLOCK.COBBLE, false);
      this._wq(x, y - 1, z);
    }

    // 水平扩散
    const horizontal = id === BLOCK.WATER ? 7 : level - 1;
    if (horizontal > 0) {
      for (const [dx, dy, dz] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const nid = this.getBlock(nx, ny, nz);
        if (nid === BLOCK.AIR) {
          setFlow(nx, ny, nz, horizontal);
        } else if (isWaterLike(nid)) {
          const nlevel = this._levelOf(nid);
          if (nid !== BLOCK.WATER && nlevel < horizontal) {
            setFlow(nx, ny, nz, horizontal);
          }
        } else if (isLava(nid)) {
          this.setBlock(nx, ny, nz, BLOCK.COBBLE, false);
          this._wq(nx, ny, nz);
        }
      }
    }
  }

  getSurfaceY(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return CHUNK_H - 1;
    return c.heightMap[(z & 15) * CHUNK_SX + (x & 15)];
  }

  isSolidAt(x, y, z) {
    return isSolidBlock(this.getBlock(x, y, z));
  }

  // ---------- 射线拾取（体素 DDA） ----------
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 6, includeLiquids = false) {
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
    const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
    let tMaxX = dx === 0 ? Infinity : (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX;
    let tMaxY = dy === 0 ? Infinity : (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY;
    let tMaxZ = dz === 0 ? Infinity : (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ;

    let nx = 0, ny = 0, nz = 0;
    let t = 0;

    // 起点就在方块内
    const startId = this.getBlock(x, y, z);
    if (startId !== 0 && (includeLiquids || !isLiquidBlock(startId))) {
      return { x, y, z, nx: -stepX, ny: 0, nz: 0, id: startId, dist: 0 };
    }

    while (t <= maxDist) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) break;
      if (y < 0 || y >= CHUNK_H) {
        if (y < 0) break;
        continue;
      }
      const id = this.getBlock(x, y, z);
      if (id !== 0 && (includeLiquids || !isLiquidBlock(id))) {
        return { x, y, z, nx, ny, nz, id, dist: t };
      }
    }
    return null;
  }

  // ---------- 出生点 ----------
  findSpawn() {
    for (let r = 0; r < 40; r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const x = i * 4;
          const z = j * 4;
          const info = this.columnInfo(x, z);
          if (info.height <= SEA_LEVEL + 2 || info.biome === 'ocean') continue;
          this.ensureChunk(x >> 4, z >> 4);
          const y = this.getSurfaceY(x, z) + 1;
          if (!this.isSpawnClear(x, y, z)) continue;
          this.spawn = { x: x + 0.5, y: y + 0.2, z: z + 0.5 };
          return this.spawn;
        }
      }
    }
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    return this.spawn;
  }

  isSpawnClear(x, y, z) {
    if (!isSolidBlock(this.getBlock(x, y - 1, z))) return false;
    for (let dy = 0; dy < 5; dy++) {
      if (isSolidBlock(this.getBlock(x, y + dy, z))) return false;
    }
    return true;
  }

  // ---------- 存档 ----------
  serializeMods() {
    const out = [];
    for (const mods of this.modsByChunk.values()) {
      for (const [k, id] of mods) {
        const p = k.split(',');
        out.push([+p[0], +p[1], +p[2], id]);
      }
    }
    return out;
  }

  applyMods(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!Array.isArray(item) || item.length < 4) continue;
      const [x, y, z, id] = item;
      const k = chunkKey(x >> 4, z >> 4);
      let mods = this.modsByChunk.get(k);
      if (!mods) {
        mods = new Map();
        this.modsByChunk.set(k, mods);
      }
      mods.set(x + ',' + y + ',' + z, id);
    }
  }
}

function trustBiome(biome) {
  return biome === 'plains' || biome === 'forest' || biome === 'snowy' || biome === 'mountain';
}
