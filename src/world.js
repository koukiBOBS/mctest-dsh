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
} from './blocks.js';

export const CHUNK_SX = 16;
export const CHUNK_SZ = 16;
export const CHUNK_H = 128;
export const SEA_LEVEL = 62;
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
    return c;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz)) || null;
  }

  generateChunk(cx, cz) {
    const chunk = new Chunk(cx, cz);
    const x0 = cx * CHUNK_SX;
    const z0 = cz * CHUNK_SZ;

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
              if (biome === 'ocean') id = hash3i(wx, 1, wz, this.seed + 9) < 0.4 ? BLOCK.GRAVEL : BLOCK.SAND;
              else if (biome === 'beach' || biome === 'desert') id = BLOCK.SAND;
              else if (biome === 'snowy') id = BLOCK.SNOW;
              else if (biome === 'mountain' && h > 88) id = BLOCK.SNOW;
              else id = BLOCK.GRASS;
            } else if (y >= h - 3) {
              if (biome === 'desert') id = y >= h - 1 ? BLOCK.SAND : BLOCK.SANDSTONE;
              else if (biome === 'beach' || biome === 'ocean') id = BLOCK.SAND;
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
          chunk.set(+p[0] - x0, +p[1], +p[2] - z0, id);
          if (id !== 0) chunk.maxY = Math.max(chunk.maxY, +p[1]);
        }
      }
      return chunk;
    }
    for (let gz = z0 - 2; gz <= z0 + CHUNK_SZ + 1; gz++) {
      for (let gx = x0 - 2; gx <= x0 + CHUNK_SX + 1; gx++) {
        if (this.treeAt(gx, gz)) this.placeTree(chunk, gx, gz);
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

    // 4) 应用玩家改动
    const mods = this.modsByChunk.get(chunkKey(cx, cz));
    if (mods) {
      for (const [k, id] of mods) {
        const p = k.split(',');
        const wx = +p[0];
        const wy = +p[1];
        const wz = +p[2];
        chunk.set(wx - x0, wy, wz - z0, id);
        if (id !== 0) chunk.maxY = Math.max(chunk.maxY, wy);
      }
    }
    return chunk;
  }

  treeAt(gx, gz) {
    const info = this.columnInfo(gx, gz);
    if (info.height <= SEA_LEVEL + 1) return false;
    let density = 0;
    switch (info.biome) {
      case 'forest': density = 0.028; break;
      case 'plains': density = 0.004; break;
      case 'snowy': density = 0.012; break;
      case 'mountain': density = 0.006; break;
      default: return false;
    }
    return hash2i(gx, gz, this.seed + 21) < density;
  }

  placeTree(chunk, gx, gz) {
    const info = this.columnInfo(gx, gz);
    const baseY = info.height + 1;
    const trunkH = 4 + Math.floor(hash2i(gx, gz, this.seed + 22) * 3);
    const topY = baseY + trunkH - 1;
    const x0 = chunk.cx * CHUNK_SX;
    const z0 = chunk.cz * CHUNK_SZ;

    const put = (wx, wy, wz, id, onlyAir) => {
      const lx = wx - x0;
      const lz = wz - z0;
      if (lx < 0 || lx >= CHUNK_SX || lz < 0 || lz >= CHUNK_SZ || wy < 0 || wy >= CHUNK_H) return;
      if (wy >= baseY - 1 && onlyAir) {
        const cur = chunk.get(lx, wy, lz);
        if (cur !== BLOCK.AIR && cur !== BLOCK.TALL_GRASS && cur !== BLOCK.LEAVES) return;
      }
      chunk.set(lx, wy, lz, id);
      chunk.maxY = Math.max(chunk.maxY, wy);
    };

    for (let y = baseY; y <= topY; y++) put(gx, y, gz, BLOCK.LOG, false);

    for (let dy = trunkH - 2; dy <= trunkH + 1; dy++) {
      const radius = dy >= trunkH ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy <= trunkH - 1) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius) {
            if (hash2i(gx + dx, gz + dz, this.seed + dy) < 0.45) continue;
          }
          put(gx + dx, baseY + dy, gz + dz, BLOCK.LEAVES, true);
        }
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

  setBlock(x, y, z, id) {
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
    // 记录玩家改动
    let mods = this.modsByChunk.get(k);
    if (!mods) {
      mods = new Map();
      this.modsByChunk.set(k, mods);
    }
    mods.set(x + ',' + y + ',' + z, id);
    // 标记需要重新生成网格的区块（含邻接）
    this.dirtyChunks.add(k);
    if (lx === 0) this.dirtyChunks.add(chunkKey(cx - 1, cz));
    if (lx === 15) this.dirtyChunks.add(chunkKey(cx + 1, cz));
    if (lz === 0) this.dirtyChunks.add(chunkKey(cx, cz - 1));
    if (lz === 15) this.dirtyChunks.add(chunkKey(cx, cz + 1));
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
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 6) {
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
    if (startId !== 0 && !isLiquidBlock(startId)) {
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
      if (id !== 0 && !isLiquidBlock(id)) {
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
