// ============================================================
// mesher.js — 区块网格构建（面剔除 + AO + 烘焙光照）
// 顶点色 = 面明暗 × AO × 天空光，材质用 MeshBasicMaterial
// 性能：先把区块及相邻一圈拷进填充数组，避免大量 Map 查询
// ============================================================

import * as THREE from 'three';
import { TILE_NAMES } from './textures.js';
import { BLOCK, getBlockDef, isOpaqueBlock } from './blocks.js';
import { CHUNK_SX, CHUNK_SZ, CHUNK_H, blockIndex } from './world.js';

const ATLAS_COLS = 8;
const TILE_MAP = new Map();
TILE_NAMES.forEach((n, i) => TILE_MAP.set(n, i));

const OPAQUE = new Uint8Array(256);
for (let i = 0; i < 256; i++) OPAQUE[i] = isOpaqueBlock(i) ? 1 : 0;

export function tileIndex(name) {
  const i = TILE_MAP.get(name);
  return i === undefined ? 0 : i;
}

function tileUV(name) {
  const i = tileIndex(name);
  const col = i % ATLAS_COLS;
  const row = Math.floor(i / ATLAS_COLS);
  const s = 1 / ATLAS_COLS;
  return { u0: col * s, v0: 1 - (row + 1) * s, u1: (col + 1) * s, v1: 1 - row * s };
}

// 顶点顺序：左下、右下、左上、右上（从外侧看 CCW）
const FACES = [
  {
    dir: [-1, 0, 0], shade: 0.64,
    corners: [
      { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 0], uv: [0, 1] },
      { pos: [0, 1, 1], uv: [1, 1] },
    ],
  },
  {
    dir: [1, 0, 0], shade: 0.64,
    corners: [
      { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 0], uv: [1, 1] },
    ],
  },
  {
    dir: [0, -1, 0], shade: 0.5,
    corners: [
      { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 0] },
      { pos: [0, 0, 1], uv: [0, 1] },
      { pos: [1, 0, 1], uv: [1, 1] },
    ],
  },
  {
    dir: [0, 1, 0], shade: 1.0,
    corners: [
      { pos: [0, 1, 1], uv: [0, 0] },
      { pos: [1, 1, 1], uv: [1, 0] },
      { pos: [0, 1, 0], uv: [0, 1] },
      { pos: [1, 1, 0], uv: [1, 1] },
    ],
  },
  {
    dir: [0, 0, -1], shade: 0.82,
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] },
      { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  {
    dir: [0, 0, 1], shade: 0.82,
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

// 每个面用于 AO 的两个切向轴（0=x,1=y,2=z）
const TANGENTS = [[1, 2], [1, 2], [0, 2], [0, 2], [0, 1], [0, 1]];
const AO_LEVELS = [0.42, 0.6, 0.78, 1.0];

function newBuffer() {
  return { positions: [], lights: [], uvs: [], indices: [], count: 0 };
}

function faceVisible(selfId, nbId) {
  if (nbId === 0) return true;
  if (OPAQUE[nbId]) return false;
  const self = getBlockDef(selfId);
  const nb = getBlockDef(nbId);
  if (self.liquid) return nb.liquid ? false : true;
  if (selfId === nbId) {
    if (self.cross) return false;
    if (selfId === BLOCK.GLASS || selfId === BLOCK.ICE || selfId === BLOCK.LEAVES) return false;
  }
  return true;
}

function columnLight(chunk, lx, lz, y) {
  const surf = chunk.heightMap[lz * CHUNK_SX + lx] || 0;
  if (y >= surf - 1) return 1;
  const depth = surf - y;
  return Math.max(0.4, 1 - depth * 0.043);
}

function pushFace(buf, lx, ly, lz, wxp, wzp, face, tangents, tileName, sky, emissive, liquid, getB, selfId, getLightWorld) {
  const uv = tileUV(tileName);
  const base = buf.count;
  const dir = face.dir;
  const ax = lx + dir[0];
  const ay = ly + dir[1];
  const az = lz + dir[2];
  const aboveId = getB(lx, ly + 1, lz);
  const lowered = liquid && dir[1] === 1 && !(aboveId !== 0 && getBlockDef(aboveId).liquid);
  const [t1, t2] = tangents;
  const blockLight = emissive ? 1 : Math.min(1, getLightWorld(wxp + dir[0], ly + dir[1], wzp + dir[2]) / 15);

  for (let i = 0; i < 4; i++) {
    const c = face.corners[i];
    const px = lx + c.pos[0];
    const py = ly + c.pos[1] + (lowered && c.pos[1] === 1 ? -0.12 : 0);
    const pz = lz + c.pos[2];
    buf.positions.push(px, py, pz);

    const s1 = c.pos[t1] === 1 ? 1 : -1;
    const s2 = c.pos[t2] === 1 ? 1 : -1;
    const o1x = ax + (t1 === 0 ? s1 : 0);
    const o1y = ay + (t1 === 1 ? s1 : 0);
    const o1z = az + (t1 === 2 ? s1 : 0);
    const o2x = ax + (t2 === 0 ? s2 : 0);
    const o2y = ay + (t2 === 1 ? s2 : 0);
    const o2z = az + (t2 === 2 ? s2 : 0);
    const ocx = ax + (t1 === 0 ? s1 : 0) + (t2 === 0 ? s2 : 0);
    const ocy = ay + (t1 === 1 ? s1 : 0) + (t2 === 1 ? s2 : 0);
    const ocz = az + (t1 === 2 ? s1 : 0) + (t2 === 2 ? s2 : 0);

    const a1 = OPAQUE[getB(o1x, o1y, o1z)] ? 1 : 0;
    const a2 = OPAQUE[getB(o2x, o2y, o2z)] ? 1 : 0;
    const ac = OPAQUE[getB(ocx, ocy, ocz)] ? 1 : 0;
    let ao;
    if (a1 && a2) ao = 0;
    else ao = 3 - (a1 + a2 + ac);
    const aoF = AO_LEVELS[ao < 0 ? 0 : ao > 3 ? 3 : ao];

    let shade = emissive ? 0.92 + 0.08 * face.shade : face.shade * aoF;
    if (shade > 1) shade = 1;
    else if (shade < 0.18) shade = 0.18;
    buf.lights.push(blockLight, Math.min(1, Math.max(0, sky)), shade);
    buf.uvs.push(uv.u0 + c.uv[0] * (uv.u1 - uv.u0), uv.v0 + c.uv[1] * (uv.v1 - uv.v0));
  }
  buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  buf.count += 4;
}

function pushCross(buf, lx, ly, lz, wxp, wzp, tileName, light, getLightWorld) {
  const uv = tileUV(tileName);
  const quads = [
    [[0.08, 0, 0.08], [0.92, 0, 0.92], [0.08, 1, 0.08], [0.92, 1, 0.92]],
    [[0.92, 0, 0.08], [0.08, 0, 0.92], [0.92, 1, 0.08], [0.08, 1, 0.92]],
  ];
  const cornerUV = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const sky = Math.max(0.4, Math.min(1, light));
  const blockLight = Math.min(
    1,
    Math.max(getLightWorld(wxp, ly, wzp), getLightWorld(wxp, ly + 1, wzp)) / 15,
  );
  for (const quad of quads) {
    const base = buf.count;
    for (let i = 0; i < 4; i++) {
      const p = quad[i];
      buf.positions.push(lx + p[0], ly + p[1], lz + p[2]);
      buf.lights.push(blockLight, sky, 0.9);
      buf.uvs.push(uv.u0 + cornerUV[i][0] * (uv.u1 - uv.u0), uv.v0 + cornerUV[i][1] * (uv.v1 - uv.v0));
    }
    buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    buf.count += 4;
  }
}

function pushBoxFaces(buf, lx, ly, lz, x0, y0, z0, x1, y1, z1, tileName, light, getLightWorld, wxp, wzp) {
  const uv = tileUV(tileName);
  const cornerUV = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const sky = Math.max(0.4, Math.min(1, light));
  const blockLight = Math.min(1, getLightWorld(wxp, ly, wzp) / 15);
  const faces = [
    { shade: 0.64, pts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z1], [x1, y1, z0]] },
    { shade: 0.64, pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z0], [x0, y1, z1]] },
    { shade: 1.0, pts: [[x0, y1, z1], [x1, y1, z1], [x0, y1, z0], [x1, y1, z0]] },
    { shade: 0.5, pts: [[x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1]] },
    { shade: 0.82, pts: [[x1, y0, z0], [x0, y0, z0], [x1, y1, z0], [x0, y1, z0]] },
    { shade: 0.82, pts: [[x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]] },
  ];
  for (const face of faces) {
    const base = buf.count;
    for (let i = 0; i < 4; i++) {
      const p = face.pts[i];
      buf.positions.push(lx + p[0], ly + p[1], lz + p[2]);
      buf.lights.push(blockLight, sky, face.shade);
      buf.uvs.push(uv.u0 + cornerUV[i][0] * (uv.u1 - uv.u0), uv.v0 + cornerUV[i][1] * (uv.v1 - uv.v0));
    }
    buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    buf.count += 4;
  }
}

function pushFence(buf, lx, ly, lz, tileName, light, getLightWorld, wxp, wzp) {
  // 中心立柱
  pushBoxFaces(buf, lx, ly, lz, 0.4, 0, 0.4, 0.6, 1.5, 0.6, tileName, light, getLightWorld, wxp, wzp);
  // 横向栏杆（X 方向）
  pushBoxFaces(buf, lx, ly, lz, 0, 0.35, 0.44, 1, 0.5, 0.56, tileName, light, getLightWorld, wxp, wzp);
  pushBoxFaces(buf, lx, ly, lz, 0, 0.9, 0.44, 1, 1.05, 0.56, tileName, light, getLightWorld, wxp, wzp);
  // 纵向栏杆（Z 方向）
  pushBoxFaces(buf, lx, ly, lz, 0.44, 0.35, 0, 0.56, 0.5, 1, tileName, light, getLightWorld, wxp, wzp);
  pushBoxFaces(buf, lx, ly, lz, 0.44, 0.9, 0, 0.56, 1.05, 1, tileName, light, getLightWorld, wxp, wzp);
}

function pushDoor(buf, lx, ly, lz, axis, open, tileName, light, getLightWorld, wxp, wzp) {
  const uv = tileUV(tileName);
  const y0 = 0.02;
  const y1 = 0.98;
  let quad;
  if (!open) {
    if (axis === 'x') quad = [[0.06, y0, 0.5], [0.94, y0, 0.5], [0.06, y1, 0.5], [0.94, y1, 0.5]];
    else quad = [[0.5, y0, 0.06], [0.5, y0, 0.94], [0.5, y1, 0.06], [0.5, y1, 0.94]];
  } else if (axis === 'x') {
    quad = [[0.06, y0, 0.06], [0.06, y0, 0.94], [0.06, y1, 0.06], [0.06, y1, 0.94]];
  } else {
    quad = [[0.06, y0, 0.06], [0.94, y0, 0.06], [0.06, y1, 0.06], [0.94, y1, 0.06]];
  }
  const cornerUV = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const sky = Math.max(0.4, Math.min(1, light));
  const blockLight = Math.min(1, getLightWorld(wxp, ly, wzp) / 15);
  const base = buf.count;
  for (let i = 0; i < 4; i++) {
    const p = quad[i];
    buf.positions.push(lx + p[0], ly + p[1], lz + p[2]);
    buf.lights.push(blockLight, sky, 0.95);
    buf.uvs.push(uv.u0 + cornerUV[i][0] * (uv.u1 - uv.u0), uv.v0 + cornerUV[i][1] * (uv.v1 - uv.v0));
  }
  buf.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  buf.count += 4;
}

function toGeometry(buf) {
  if (buf.count === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  g.setAttribute('aLight', new THREE.Float32BufferAttribute(buf.lights, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  g.setIndex(buf.indices);
  g.computeBoundingSphere();
  return g;
}

export function buildChunkGeometry(world, chunk) {
  const opaque = newBuffer();
  const alpha = newBuffer();
  const water = newBuffer();
  const plants = newBuffer();
  const x0 = chunk.cx * CHUNK_SX;
  const z0 = chunk.cz * CHUNK_SZ;
  const maxY = Math.min(CHUNK_H - 1, chunk.maxY + 1);
  const PX = CHUNK_SX + 2;
  const PZ = CHUNK_SZ + 2;
  const PY = maxY + 3;
  const pad = new Uint8Array(PX * PZ * PY);
  const idxOf = (px, py, pz) => ((py + 1) * PZ + (pz + 1)) * PX + (px + 1);

  // 拷贝 18×18×(maxY+3) 邻域（含四周一圈）
  for (let py = -1; py <= maxY + 1; py++) {
    for (let pz = -1; pz <= CHUNK_SZ; pz++) {
      for (let px = -1; px <= CHUNK_SX; px++) {
        pad[idxOf(px, py, pz)] = world.getBlock(x0 + px, py, z0 + pz);
      }
    }
  }

  const getB = (px, py, pz) => {
    if (px < -1 || px > CHUNK_SX || pz < -1 || pz > CHUNK_SZ || py < -1 || py > maxY + 1) return 0;
    return pad[idxOf(px, py, pz)];
  };
  const getLightWorld = (x, y, z) => world.getLight(x, y, z);

  let quads = 0;
  for (let y = 0; y <= maxY; y++) {
    for (let lz = 0; lz < CHUNK_SZ; lz++) {
      for (let lx = 0; lx < CHUNK_SX; lx++) {
        const id = chunk.blocks[blockIndex(lx, y, lz)];
        if (id === 0) continue;
        const def = getBlockDef(id);
        const light = columnLight(chunk, lx, lz, y);

        if (def.cross) {
          pushCross(plants, lx, y, lz, x0 + lx, z0 + lz, def.tiles.all, light, getLightWorld);
          quads += 2;
          continue;
        }

        if (def.model === 'fence') {
          pushFence(plants, lx, y, lz, def.tiles.all, light, getLightWorld, x0 + lx, z0 + lz);
          quads += 6;
          continue;
        }

        if (def.model === 'door') {
          pushDoor(plants, lx, y, lz, def.doorAxis, def.doorOpen, def.tiles.all, light, getLightWorld, x0 + lx, z0 + lz);
          quads += 1;
          continue;
        }

        let target;
        if (def.liquid) target = water;
        else if (id === BLOCK.GLASS || id === BLOCK.ICE) target = alpha;
        else target = opaque;

        for (let fi = 0; fi < 6; fi++) {
          const face = FACES[fi];
          const nb = getB(lx + face.dir[0], y + face.dir[1], lz + face.dir[2]);
          if (!faceVisible(id, nb)) continue;
          let tileName;
          if (face.dir[1] === 1) tileName = def.tiles.top || def.tiles.all;
          else if (face.dir[1] === -1) tileName = def.tiles.bottom || def.tiles.all;
          else tileName = def.tiles.side || def.tiles.all;
          pushFace(
            target, lx, y, lz, x0 + lx, z0 + lz, face, TANGENTS[fi], tileName,
            light, def.emissive, def.liquid, getB, id, getLightWorld,
          );
          quads++;
        }
      }
    }
  }

  return {
    opaque: toGeometry(opaque),
    alpha: toGeometry(alpha),
    water: toGeometry(water),
    plants: toGeometry(plants),
    quads,
  };
}
