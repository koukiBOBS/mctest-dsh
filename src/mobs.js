// ============================================================
// mobs.js — 生物系统：模型 / 生成 / AI / 物理 / 战斗 / 掉落
// ============================================================
// 依赖接口（由 main.js 提供）：
//   game.world, game.scene, game.player, game.sound,
//   game.renderer.dayLight, game.dropItem(), game.explode(), game.toast()
// 生物坐标 (x, y, z) 中 y 为脚底高度。
// ============================================================

import * as THREE from 'three';
import { CHUNK_H, SEA_LEVEL } from './world.js';

const TAU = Math.PI * 2;

const GRAVITY = 26;
const JUMP_V = 7.7;
const ARROW_GRAVITY = 18;
const ARROW_SPEED_DEFAULT = 18;
const ARROW_LIFE = 8;

const SPAWN_INTERVAL = 1.2;
const PASSIVE_LIMIT = 6;
const HOSTILE_LIMIT = 10;
const FAR_DESPAWN = 64;
const DAY_HOSTILE_DESPAWN = 24;
const MELEE_RANGE = 1.6;

const PASSIVE_KINDS = ['pig', 'sheep', 'cow', 'chicken'];
const HOSTILE_KINDS = ['zombie', 'skeleton', 'creeper', 'spider'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function randRange(a, b) {
  return a + Math.random() * (b - a);
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function choose(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

// ---------------- 共享资源（避免每只生物重复创建） ----------------
let _unitBox = null;
const _protoMaterials = new Map();
let _arrowGeo = null;
let _arrowMat = null;

function getUnitBox() {
  if (!_unitBox) _unitBox = new THREE.BoxGeometry(1, 1, 1);
  return _unitBox;
}

function getProtoMaterial(color) {
  let mat = _protoMaterials.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color });
    _protoMaterials.set(color, mat);
  }
  return mat;
}

function getArrowGeometry() {
  if (!_arrowGeo) _arrowGeo = new THREE.BoxGeometry(0.07, 0.07, 0.7);
  return _arrowGeo;
}

function getArrowMaterial() {
  if (!_arrowMat) _arrowMat = new THREE.MeshBasicMaterial({ color: 0xe8e2c8 });
  return _arrowMat;
}

// ============================================================
// 生物定义
// ============================================================
export const MOB_TYPES = {
  // ---------------- 被动 ----------------
  pig: {
    id: 'pig',
    name: '猪',
    hostile: false,
    width: 0.9,
    height: 0.9,
    health: 10,
    speed: 1.0,
    drops: [{ id: 'porkchop', min: 1, max: 2 }],
    colors: { body: 0xf0a7ae, dark: 0xd78e98, leg: 0xe39aa3, snout: 0xc8808a, eye: 0x211a1a },
  },
  sheep: {
    id: 'sheep',
    name: '羊',
    hostile: false,
    width: 0.9,
    height: 1.2,
    health: 8,
    speed: 0.95,
    drops: [{ id: 'wool_white', min: 1, max: 1 }],
    colors: { wool: 0xf1f1e8, face: 0xe3ddcf, leg: 0xcfcabb, dark: 0xb8b2a4, eye: 0x1d1b19 },
  },
  cow: {
    id: 'cow',
    name: '牛',
    hostile: false,
    width: 1.0,
    height: 1.3,
    health: 10,
    speed: 0.9,
    drops: [
      { id: 'beef', min: 1, max: 2 },
      { id: 'leather', min: 0, max: 1 },
    ],
    colors: { body: 0x2f2f2f, white: 0xf1f1ec, snout: 0xd9a3a5, horn: 0xd9d5c5, leg: 0x3a3a3a, eye: 0x111111 },
  },
  chicken: {
    id: 'chicken',
    name: '鸡',
    hostile: false,
    width: 0.5,
    height: 0.7,
    health: 4,
    speed: 1.15,
    drops: [
      { id: 'chicken', min: 1, max: 1 },
      { id: 'feather', min: 0, max: 1 },
    ],
    colors: { body: 0xf4f2e6, wing: 0xe6e2d2, beak: 0xe0a028, comb: 0xc23c2e, leg: 0xd7902a, eye: 0x332a18 },
  },

  // ---------------- 敌对 ----------------
  zombie: {
    id: 'zombie',
    name: '僵尸',
    hostile: true,
    width: 0.6,
    height: 1.9,
    health: 20,
    speed: 1.35,
    damage: 2,
    drops: [{ id: 'rotten_flesh', min: 0, max: 2 }],
    colors: { skin: 0x66984f, shirt: 0x3b6c9e, pants: 0x33417a, hair: 0x2f3d29, eye: 0x142014 },
  },
  skeleton: {
    id: 'skeleton',
    name: '骷髅',
    hostile: true,
    width: 0.6,
    height: 1.9,
    health: 20,
    speed: 1.25,
    damage: 2,
    arrowDamage: 2,
    arrowSpeed: 18,
    drops: [
      { id: 'bone', min: 1, max: 2 },
      { id: 'arrow', min: 0, max: 2 },
    ],
    colors: { bone: 0xd9d9cf, dark: 0xaeaea3, eye: 0x1d1d1d, bow: 0x7a5632 },
  },
  creeper: {
    id: 'creeper',
    name: '苦力怕',
    hostile: true,
    width: 0.6,
    height: 1.7,
    health: 20,
    speed: 1.45,
    damage: 2,
    fuse: 1.5,
    explodePower: 3,
    drops: [{ id: 'gunpowder', min: 1, max: 1 }],
    colors: { body: 0x49b558, dark: 0x2f8a3c, face: 0x143019, leg: 0x3aa04a, eye: 0x143019 },
  },
  spider: {
    id: 'spider',
    name: '蜘蛛',
    hostile: true,
    width: 1.1,
    height: 0.8,
    health: 16,
    speed: 2.6,
    damage: 2,
    drops: [{ id: 'string', min: 1, max: 2 }],
    colors: { body: 0x2b2b33, head: 0x35353f, leg: 0x232329, eye: 0xd83a32 },
  },
};

// ============================================================
// MobManager
// ============================================================
export class MobManager {
  constructor(game, opts = {}) {
    this.game = game || {};
    this.world = this.game.world || null;
    this.scene = this.game.scene || null;
    this.player = this.game.player || null;

    this.maxMobs = Math.max(1, Number.isFinite(opts.maxMobs) ? opts.maxMobs : 20);
    this.dayLength = Math.max(1, Number.isFinite(opts.dayLength) ? opts.dayLength : 600);

    this.mobs = [];
    this.arrows = [];
    this.spawnTimer = 0;
    this.paused = false;
    this.elapsed = 0;

    this.sunElev = 0;
    this.lightLevel = 1;

    // 复用向量/颜色，避免每帧分配
    this._tmpVec = new THREE.Vector3();
    this._arrowForward = new THREE.Vector3(0, 0, 1);

    this._box = getUnitBox();
    this._arrowGeo = getArrowGeometry();
    this._arrowMat = getArrowMaterial();
  }

  // ------------------------------------------------------------
  // 主循环
  // ------------------------------------------------------------
  update(dt) {
    if (this.paused) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    const rawDt = dt;
    dt = Math.min(dt, 0.1);

    // 允许 game.player / game.world 在管理器创建之后再被赋值
    if (this.game.player) this.player = this.game.player;
    if (this.game.world) this.world = this.game.world;

    this.elapsed += dt;
    this._updateSun();
    this._updateLight();
    this._updateSpawning(rawDt);

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      if (!mob || mob.removed) continue;
      this._updateMob(mob, dt);
    }

    this._separateMobs();
    this._updateArrows(dt);
  }

  setPaused(value) {
    this.paused = !!value;
  }

  count() {
    return this.mobs.length;
  }

  clear() {
    const list = this.mobs.slice();
    for (let i = 0; i < list.length; i++) this._removeMob(list[i], false);
    this.mobs.length = 0;

    for (let i = this.arrows.length - 1; i >= 0; i--) {
      this._removeArrow(this.arrows[i]);
    }
    this.arrows.length = 0;
    this.spawnTimer = 0;
  }

  // ------------------------------------------------------------
  // 生成 / 移除
  // ------------------------------------------------------------
  spawn(type, x, y, z) {
    const def = MOB_TYPES[type];
    if (!def) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    if (this.mobs.length >= this.maxMobs) return null;

    const mob = {
      type,
      def,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      width: def.width,
      height: def.height,
      health: def.health,
      maxHealth: def.health,
      onGround: false,
      removed: false,
      hurtTimer: 0,
      jumpCd: 0,
      knockTimer: 0,
      knockVx: 0,
      knockVz: 0,
      walkPhase: Math.random() * TAU,
      swing: 0,
      headYaw: 0,
      yaw: Math.random() * TAU,
      yawTarget: 0,
      ai: {
        angry: false,
        wander: 3 + Math.random() * 5,
        dirX: Math.sin(Math.random() * TAU),
        dirZ: Math.cos(Math.random() * TAU),
        flee: 0,
        fleeX: x,
        fleeZ: z,
        attackCd: Math.random() * 0.4,
        shootCd: 1 + Math.random(),
        strafe: 1,
        strafeTimer: 1.5,
        fuse: 0,
      },
      // 模型运行时数据
      group: null,
      head: null,
      legs: [],
      arms: [],
      mats: [],
      _matCache: new Map(),
    };
    mob.yawTarget = mob.yaw;

    this._buildModel(mob);
    this.mobs.push(mob);
    return mob;
  }

  _removeMob(mob, dropLoot) {
    if (!mob || mob.removed) return;
    mob.removed = true;

    const idx = this.mobs.indexOf(mob);
    if (idx >= 0) this.mobs.splice(idx, 1);

    if (dropLoot) this._dropLoot(mob);

    if (mob.group && mob.group.parent) mob.group.parent.remove(mob.group);
    for (let i = 0; i < mob.mats.length; i++) {
      const entry = mob.mats[i];
      if (entry && entry.mat) entry.mat.dispose();
    }
    mob.mats.length = 0;
    mob._matCache.clear();
    mob.group = null;
    mob.head = null;
    mob.legs.length = 0;
    mob.arms.length = 0;
  }

  _dropLoot(mob) {
    const def = mob.def;
    const dropItem = this.game && this.game.dropItem;
    if (!def || typeof dropItem !== 'function') return;

    const list = def.drops || [];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const n = randInt(d.min, d.max);
      if (n <= 0) continue;
      const ox = mob.x + (Math.random() - 0.5) * 0.5;
      const oy = mob.y + mob.height * 0.45;
      const oz = mob.z + (Math.random() - 0.5) * 0.5;
      dropItem(d.id, ox, oy, oz, n);
    }
  }

  // ------------------------------------------------------------
  // 玩家攻击接口
  // ------------------------------------------------------------
  pick(origin, dir, maxDist) {
    if (!origin || !dir) return null;
    let dx = dir.x;
    let dy = dir.y;
    let dz = dir.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-8) return null;
    dx /= dl;
    dy /= dl;
    dz /= dl;

    let limit = Number.isFinite(maxDist) ? maxDist : 5;
    if (limit <= 0) return null;

    let bestMob = null;
    let bestDist = limit;

    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      if (!mob || mob.removed) continue;

      const half = mob.width * 0.5;
      const minX = mob.x - half;
      const maxX = mob.x + half;
      const minY = mob.y;
      const maxY = mob.y + mob.height;
      const minZ = mob.z - half;
      const maxZ = mob.z + half;

      let tmin = 0;
      let tmax = bestDist;
      let miss = false;

      // X
      if (Math.abs(dx) < 1e-8) {
        if (origin.x < minX || origin.x > maxX) miss = true;
      } else {
        let t1 = (minX - origin.x) / dx;
        let t2 = (maxX - origin.x) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) miss = true;
      }

      // Y
      if (!miss) {
        if (Math.abs(dy) < 1e-8) {
          if (origin.y < minY || origin.y > maxY) miss = true;
        } else {
          let t1 = (minY - origin.y) / dy;
          let t2 = (maxY - origin.y) / dy;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) miss = true;
        }
      }

      // Z
      if (!miss) {
        if (Math.abs(dz) < 1e-8) {
          if (origin.z < minZ || origin.z > maxZ) miss = true;
        } else {
          let t1 = (minZ - origin.z) / dz;
          let t2 = (maxZ - origin.z) / dz;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) miss = true;
        }
      }

      if (!miss && tmin < bestDist) {
        bestDist = tmin;
        bestMob = mob;
      }
    }

    if (!bestMob) return null;
    return { mob: bestMob, dist: bestDist };
  }

  hit(mob, damage, knockX, knockZ) {
    if (!mob || mob.removed) return false;
    const def = mob.def || MOB_TYPES[mob.type];
    if (!def) return false;

    const dmg = Number.isFinite(damage) ? damage : 1;
    mob.health -= dmg;
    mob.hurtTimer = 0.35;

    if (def.hostile) {
      mob.ai.angry = true;
    } else {
      mob.ai.flee = 3;
      mob.ai.fleeX = this.player ? this.player.x : mob.x;
      mob.ai.fleeZ = this.player ? this.player.z : mob.z;
    }

    const kx = Number.isFinite(knockX) ? knockX : 0;
    const kz = Number.isFinite(knockZ) ? knockZ : 0;
    if (kx !== 0 || kz !== 0) {
      mob.knockVx = clamp(kx, -10, 10);
      mob.knockVz = clamp(kz, -10, 10);
      mob.knockTimer = 0.22;
      if (mob.onGround) mob.vy = Math.max(mob.vy, 3.4);
    }

    this._playSound('hurt', 0.55);

    if (mob.health <= 0) {
      mob.health = 0;
      this._removeMob(mob, true);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------
  // 光照 / 昼夜 / 生成
  // ------------------------------------------------------------
  _updateSun() {
    const world = this.world;
    const time = world && Number.isFinite(world.time) ? world.time : this.elapsed;
    const phase = (((time % this.dayLength) + this.dayLength) % this.dayLength) / this.dayLength;
    this.sunElev = Math.sin(phase * TAU);
  }

  _updateLight() {
    let light = this.game && this.game.renderer ? this.game.renderer.dayLight : undefined;
    if (!Number.isFinite(light)) {
      light = 0.35 + 0.65 * Math.max(0, this.sunElev);
    }
    this.lightLevel = clamp(light, 0.35, 1);
  }

  _updateSpawning(dt) {
    this.spawnTimer += dt;
    if (this.spawnTimer < SPAWN_INTERVAL) return;
    this.spawnTimer = 0;

    if (!this.player || this.player.dead) return;
    if (this.mobs.length >= this.maxMobs) return;

    const hostileCount = this._countHostile(true);
    if (this.sunElev > 0.15) {
      if (this._countHostile(false) < PASSIVE_LIMIT) this._trySpawn(false);
      // 白天也会在阴暗洞穴里刷敌对生物
      if (hostileCount < HOSTILE_LIMIT && Math.random() < 0.6) {
        const p = this._findCaveSpawnPoint();
        if (p) this.spawn(choose(HOSTILE_KINDS), p.x, p.y, p.z);
      }
    } else if (this.sunElev < -0.1) {
      if (hostileCount < HOSTILE_LIMIT) {
        // 夜晚：洞穴 + 地表
        if (Math.random() < 0.45) {
          const p = this._findCaveSpawnPoint();
          if (p) this.spawn(choose(HOSTILE_KINDS), p.x, p.y, p.z);
        } else {
          this._trySpawn(true);
        }
      }
    }
  }

  _countHostile(hostile) {
    let n = 0;
    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      if (mob && !mob.removed && !!mob.def.hostile === hostile) n++;
    }
    return n;
  }

  _trySpawn(hostile) {
    const point = this._findSpawnPoint(!hostile);
    if (!point) return false;
    const type = choose(hostile ? HOSTILE_KINDS : PASSIVE_KINDS);
    return !!this.spawn(type, point.x, point.y, point.z);
  }

  _findSpawnPoint(passive) {
    const world = this.world;
    const player = this.player;
    if (!world || !player) return null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = Math.random() * TAU + attempt * 2.399963;
      const dist = passive ? randRange(16, 40) : randRange(12, 32);
      const ix = Math.floor(player.x + Math.sin(angle) * dist);
      const iz = Math.floor(player.z + Math.cos(angle) * dist);

      if (typeof world.isLoaded === 'function' && !world.isLoaded(ix, iz)) continue;
      if (typeof world.getSurfaceY !== 'function') return null;

      const sy = world.getSurfaceY(ix, iz);
      if (!Number.isFinite(sy) || sy < SEA_LEVEL || sy > CHUNK_H - 4) continue;

      const below = world.getBlock(ix, sy, iz);
      if (!below || below === 12 || below === 28) continue; // 空气 / 水 / 岩浆
      if (passive && below !== 1) continue; // 草方块
      if (typeof world.isSolidAt === 'function' && !world.isSolidAt(ix, sy, iz)) continue;

      // 上方两格必须为空气
      if (world.getBlock(ix, sy + 1, iz) !== 0) continue;
      if (world.getBlock(ix, sy + 2, iz) !== 0) continue;

      // 敌对生物需要足够暗（火把附近不刷怪）
      if (!passive && typeof world.getLight === 'function' && world.getLight(ix, sy + 1, iz) >= 8) continue;

      return { x: ix + 0.5, y: sy + 1, z: iz + 0.5 };
    }
    return null;
  }

  _findCaveSpawnPoint() {
    const world = this.world;
    const player = this.player;
    if (!world || !player || typeof world.getBlock !== 'function') return null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * TAU;
      const dist = randRange(8, 26);
      const ix = Math.floor(player.x + Math.sin(angle) * dist);
      const iz = Math.floor(player.z + Math.cos(angle) * dist);
      const iy = Math.floor(player.y + randRange(-14, 10));
      if (iy < 4 || iy > CHUNK_H - 4) continue;
      if (typeof world.isLoaded === 'function' && !world.isLoaded(ix, iz)) continue;
      const floor = world.getBlock(ix, iy - 1, iz);
      if (!floor || floor === 12 || floor === 28) continue;
      if (world.getBlock(ix, iy, iz) !== 0 || world.getBlock(ix, iy + 1, iz) !== 0) continue;
      if (typeof world.getLight === 'function' && world.getLight(ix, iy, iz) >= 8) continue;
      return { x: ix + 0.5, y: iy, z: iz + 0.5 };
    }
    return null;
  }

  // ------------------------------------------------------------
  // 单只生物更新
  // ------------------------------------------------------------
  _updateMob(mob, dt) {
    if (mob.hurtTimer > 0) mob.hurtTimer = Math.max(0, mob.hurtTimer - dt);
    if (mob.jumpCd > 0) mob.jumpCd = Math.max(0, mob.jumpCd - dt);
    if (mob.ai.attackCd > 0) mob.ai.attackCd = Math.max(0, mob.ai.attackCd - dt);
    if (mob.ai.shootCd > 0) mob.ai.shootCd = Math.max(0, mob.ai.shootCd - dt);

    const player = this.player;
    if (player) {
      const dx = player.x - mob.x;
      const dz = player.z - mob.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > FAR_DESPAWN) {
        this._removeMob(mob, false);
        return;
      }
      if (mob.def.hostile && this.sunElev > 0.15 && dist > DAY_HOSTILE_DESPAWN) {
        this._removeMob(mob, false);
        return;
      }
    }

    if (mob.y < -8) {
      this._removeMob(mob, false);
      return;
    }

    this._updateAI(mob, dt);
    if (mob.removed) return;

    // 受击击退优先于 AI 的移动意图，持续很短时间
    if (mob.knockTimer > 0) {
      mob.knockTimer = Math.max(0, mob.knockTimer - dt);
      mob.vx = mob.knockVx;
      mob.vz = mob.knockVz;
    }

    this._applyPhysics(mob, dt);
    if (mob.removed) return;

    this._animateMob(mob, dt);
    this._updateTint(mob);

    // 鸡会定期下蛋
    if (mob.type === 'chicken') {
      if (mob.eggTimer === undefined) mob.eggTimer = 18 + Math.random() * 20;
      mob.eggTimer -= dt;
      if (mob.eggTimer <= 0) {
        mob.eggTimer = 25 + Math.random() * 20;
        if (this.game.dropItem) this.game.dropItem('egg', mob.x, mob.y + 0.4, mob.z, 1);
      }
    }

    // 僵尸 / 骷髅白天在露天会燃烧
    if ((mob.type === 'zombie' || mob.type === 'skeleton') && this.sunElev > 0.35) {
      if (this._isSkyExposed(mob)) {
        mob.burnTimer = (mob.burnTimer || 0) + dt;
        if (mob.burnTimer > 1) {
          mob.burnTimer = 0;
          mob.health -= 1;
          mob.hurtTimer = 0.2;
          if (this.game.sound) this.game.sound.play('hurt', { volume: 0.18 });
          if (mob.health <= 0) {
            this._removeMob(mob, true);
            return;
          }
        }
      }
    } else {
      mob.burnTimer = 0;
    }
  }

  _isSkyExposed(mob) {
    const world = this.world;
    if (!world || typeof world.getSurfaceY !== 'function') return false;
    const x = Math.floor(mob.x);
    const z = Math.floor(mob.z);
    const top = world.getSurfaceY(x, z);
    return mob.y >= top - 1;
  }

  // ------------------------------------------------------------
  // AI
  // ------------------------------------------------------------
  _updateAI(mob, dt) {
    const def = mob.def;
    const ai = mob.ai;
    const player = this.player;

    if (!player) {
      this._stop(mob);
      return;
    }

    const dx = player.x - mob.x;
    const dz = player.z - mob.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const playerUnavailable = !!player.dead || player.mode === 'creative';

    // ---------------- 被动生物 ----------------
    if (!def.hostile) {
      // 手持小麦/种子时动物会靠近
      const pInv = player.inventory;
      const heldItem = pInv && pInv.held ? pInv.held.id : null;
      if ((heldItem === 'wheat' || heldItem === 'wheat_seeds') && dist < 8 && dist > 1.2) {
        this._setMove(mob, dx / dist, dz / dist, def.speed * 0.75);
        this._face(mob, player.x, player.z);
        return;
      }
      if (ai.flee > 0) {
        ai.flee -= dt;
        let fx = mob.x - ai.fleeX;
        let fz = mob.z - ai.fleeZ;
        const fl = Math.sqrt(fx * fx + fz * fz);
        if (fl < 0.001) {
          const a = Math.random() * TAU;
          fx = Math.sin(a);
          fz = Math.cos(a);
        } else {
          fx /= fl;
          fz /= fl;
        }
        this._setMove(mob, fx, fz, def.speed * 1.8);
        return;
      }

      ai.wander -= dt;
      if (ai.wander <= 0) {
        ai.wander = 3 + Math.random() * 5;
        if (Math.random() < 0.25) {
          ai.dirX = 0;
          ai.dirZ = 0;
        } else {
          const a = Math.random() * TAU;
          ai.dirX = Math.sin(a);
          ai.dirZ = Math.cos(a);
        }
      }

      const dl = Math.sqrt(ai.dirX * ai.dirX + ai.dirZ * ai.dirZ);
      if (dl < 0.001) this._stop(mob);
      else this._setMove(mob, ai.dirX / dl, ai.dirZ / dl, def.speed * 0.65);
      return;
    }

    // ---------------- 敌对生物 ----------------
    if (playerUnavailable) {
      if (def.id === 'creeper') ai.fuse = 0;
      this._stop(mob);
      if (dist < 12) this._face(mob, player.x, player.z);
      return;
    }

    const canChase = dist < 16;

    if (def.id === 'creeper') {
      this._face(mob, player.x, player.z);

      if (!canChase && ai.fuse <= 0) {
        this._stop(mob);
        return;
      }

      if (ai.fuse <= 0 && dist < 2.5) {
        ai.fuse = def.fuse || 1.5;
      }

      if (ai.fuse > 0) {
        ai.fuse -= dt;
        this._stop(mob);
        if (ai.fuse <= 0) this._explodeCreeper(mob);
        return;
      }

      if (dist > 1.2) this._setMove(mob, dx / dist, dz / dist, def.speed);
      else this._stop(mob);
      this._face(mob, player.x, player.z);
      return;
    }

    if (def.id === 'skeleton') {
      if (!canChase) {
        this._stop(mob);
        if (dist < 12) this._face(mob, player.x, player.z);
        return;
      }

      ai.strafeTimer -= dt;
      if (ai.strafeTimer <= 0) {
        ai.strafeTimer = 1.5 + Math.random() * 2;
        ai.strafe = Math.random() < 0.5 ? -1 : 1;
      }

      if (dist < 0.0001) {
        this._stop(mob);
      } else if (dist < 6) {
        this._setMove(mob, -dx / dist, -dz / dist, def.speed * 0.9);
      } else if (dist > 10) {
        this._setMove(mob, dx / dist, dz / dist, def.speed);
      } else {
        // 横向绕圈，保持距离
        this._setMove(mob, (dz / dist) * ai.strafe, (-dx / dist) * ai.strafe, def.speed * 0.55);
      }
      this._face(mob, player.x, player.z);

      if (ai.shootCd <= 0 && dist <= 16) {
        this._shootArrow(mob);
        ai.shootCd = 1.6 + Math.random() * 0.6;
      }
      return;
    }

    // 僵尸 / 蜘蛛：近战
    if (canChase) {
      if (dist > 1.15) this._setMove(mob, dx / dist, dz / dist, def.speed);
      else this._stop(mob);
      this._face(mob, player.x, player.z);

      if (dist < MELEE_RANGE && ai.attackCd <= 0) {
        this._melee(mob);
        ai.attackCd = 1.0;
      }
    } else {
      this._stop(mob);
      if (dist < 12) this._face(mob, player.x, player.z);
    }
  }

  _setMove(mob, dirX, dirZ, speed) {
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (len < 0.0001) {
      this._stop(mob);
      return;
    }
    const nx = dirX / len;
    const nz = dirZ / len;
    mob.vx = nx * speed;
    mob.vz = nz * speed;
    mob.yawTarget = Math.atan2(nx, nz);
  }

  _stop(mob) {
    mob.vx = 0;
    mob.vz = 0;
  }

  _face(mob, x, z) {
    const dx = x - mob.x;
    const dz = z - mob.z;
    if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return;
    mob.yawTarget = Math.atan2(dx, dz);
  }

  _melee(mob) {
    const player = this.player;
    if (!player || player.dead || player.mode === 'creative') return;
    if (typeof player.damage !== 'function') return;

    const def = mob.def;
    let reason = '被生物杀死了';
    if (def.id === 'zombie') reason = '被僵尸杀死了';
    else if (def.id === 'spider') reason = '被蜘蛛咬死了';
    else if (def.id === 'creeper') reason = '被苦力怕炸死了';

    player.damage(def.damage || 2, reason);
  }

  _explodeCreeper(mob) {
    const power = (mob.def && mob.def.explodePower) || 3;
    const g = this.game;
    if (g && typeof g.explode === 'function') {
      g.explode(mob.x, mob.y + mob.height * 0.5, mob.z, power);
    } else {
      const player = this.player;
      if (player && !player.dead && player.mode !== 'creative' && typeof player.damage === 'function') {
        const dx = player.x - mob.x;
        const dy = player.y - mob.y;
        const dz = player.z - mob.z;
        if (dx * dx + dy * dy + dz * dz < power * power * 4) {
          player.damage(6, '被苦力怕炸死了');
        }
      }
    }
    this._removeMob(mob, false);
  }

  // ------------------------------------------------------------
  // 箭矢
  // ------------------------------------------------------------
  _shootArrow(mob) {
    const player = this.player;
    if (!player) return;

    const dx = player.x - mob.x;
    const dz = player.z - mob.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    if (horiz < 0.0001) return;

    const sx = mob.x + (dx / horiz) * 0.4;
    const sy = mob.y + mob.height * 0.82;
    const sz = mob.z + (dz / horiz) * 0.4;
    const ty = typeof player.eyeY === 'function' ? player.eyeY() : player.y + 1.62;

    const speed = (mob.def && mob.def.arrowSpeed) || ARROW_SPEED_DEFAULT;
    const flight = horiz / speed;
    // 简单弹道补偿，让箭在重力下仍能命中玩家
    const aimY = (ty - sy) + 0.5 * ARROW_GRAVITY * flight * flight;
    const len = Math.sqrt(dx * dx + aimY * aimY + dz * dz) || 1;

    this._spawnArrow(
      sx,
      sy,
      sz,
      (dx / len) * speed,
      (aimY / len) * speed,
      (dz / len) * speed,
    );
  }

  shootPlayerArrow(origin, dir, charge = 1) {
    if (!origin || !dir) return;
    const speed = 22 + 20 * Math.min(1, charge);
    const dmg = Math.max(1, Math.round(charge * 6));
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
    this._spawnArrow(
      origin.x,
      origin.y,
      origin.z,
      (dir.x / len) * speed,
      (dir.y / len) * speed,
      (dir.z / len) * speed,
      'player',
      dmg,
    );
    if (this.game.sound) this.game.sound.play('bow', { volume: 0.6 });
  }

  _spawnArrow(x, y, z, vx, vy, vz, source = 'skeleton', damage = 2) {
    let mesh = null;
    if (this.scene) {
      mesh = new THREE.Mesh(this._arrowGeo, this._arrowMat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
    }

    const arrow = { x, y, z, vx, vy, vz, life: ARROW_LIFE, mesh, source, damage };
    if (mesh) this._orientArrow(arrow);
    this.arrows.push(arrow);
  }

  _orientArrow(arrow) {
    if (!arrow.mesh) return;
    const v = this._tmpVec.set(arrow.vx, arrow.vy, arrow.vz);
    if (v.lengthSq() < 1e-8) return;
    v.normalize();
    arrow.mesh.quaternion.setFromUnitVectors(this._arrowForward, v);
  }

  _arrowHitsMob(arrow) {
    for (const mob of this.mobs) {
      if (!mob || mob.removed) continue;
      const halfW = mob.width / 2 + 0.25;
      if (Math.abs(arrow.x - mob.x) > halfW || Math.abs(arrow.z - mob.z) > halfW) continue;
      if (arrow.y < mob.y - 0.25 || arrow.y > mob.y + mob.height + 0.25) continue;
      this.hit(mob, arrow.damage || 2, arrow.vx * 0.05, arrow.vz * 0.05);
      return true;
    }
    return false;
  }

  _updateArrows(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i];
      if (!arrow) {
        this.arrows.splice(i, 1);
        continue;
      }

      arrow.life -= dt;
      arrow.vy -= ARROW_GRAVITY * dt;

      let dead = arrow.life <= 0;
      if (!dead) {
        const speed = Math.sqrt(arrow.vx * arrow.vx + arrow.vy * arrow.vy + arrow.vz * arrow.vz);
        const steps = Math.max(1, Math.ceil((speed * dt) / 0.35));
        const sdt = dt / steps;

        for (let s = 0; s < steps; s++) {
          arrow.x += arrow.vx * sdt;
          arrow.y += arrow.vy * sdt;
          arrow.z += arrow.vz * sdt;

          if (arrow.y < -8) { dead = true; break; }
          if (this._pointSolid(arrow.x, arrow.y, arrow.z)) { dead = true; break; }
          if (arrow.source === 'player') {
            if (this._arrowHitsMob(arrow)) { dead = true; break; }
          } else if (this._arrowHitsPlayer(arrow)) {
            dead = true;
            break;
          }
        }
      }

      if (dead) {
        this._removeArrow(arrow);
        this.arrows.splice(i, 1);
        continue;
      }

      if (arrow.mesh) {
        arrow.mesh.position.set(arrow.x, arrow.y, arrow.z);
        this._orientArrow(arrow);
      }
    }
  }

  _arrowHitsPlayer(arrow) {
    const player = this.player;
    if (!player || player.dead) return false;

    const half = 0.33;
    if (arrow.x < player.x - half || arrow.x > player.x + half) return false;
    if (arrow.z < player.z - half || arrow.z > player.z + half) return false;
    if (arrow.y < player.y - 0.05 || arrow.y > player.y + 1.85) return false;

    if (player.mode !== 'creative' && typeof player.damage === 'function') {
      player.damage(2, '被骷髅射死了');
    }
    return true;
  }

  _removeArrow(arrow) {
    if (!arrow) return;
    if (arrow.mesh && arrow.mesh.parent) arrow.mesh.parent.remove(arrow.mesh);
    arrow.mesh = null;
  }

  // ------------------------------------------------------------
  // 物理
  // ------------------------------------------------------------
  _applyPhysics(mob, dt) {
    const world = this.world;
    if (!world) {
      mob.x += mob.vx * dt;
      mob.z += mob.vz * dt;
      mob.y += mob.vy * dt;
      return;
    }

    const w = mob.width;
    const h = mob.height;

    // 水平移动（分轴检测，撞墙尝试跳跃）
    let blocked = false;
    const dx = mob.vx * dt;
    const dz = mob.vz * dt;

    if (dx !== 0) {
      if (!this._collides(mob.x + dx, mob.y, mob.z, w, h)) mob.x += dx;
      else blocked = true;
    }
    if (dz !== 0) {
      if (!this._collides(mob.x, mob.y, mob.z + dz, w, h)) mob.z += dz;
      else blocked = true;
    }

    if (blocked && mob.onGround && mob.jumpCd <= 0) {
      mob.vy = JUMP_V;
      mob.onGround = false;
      mob.jumpCd = 0.7;
    }

    // 重力
    mob.vy -= GRAVITY * dt;
    if (mob.vy < -40) mob.vy = -40;

    const prevY = mob.y;
    const nextY = mob.y + mob.vy * dt;

    if (mob.vy >= 0) {
      if (this._collides(mob.x, nextY, mob.z, w, h)) {
        // 撞到天花板
        mob.vy = 0;
        mob.onGround = false;
      } else {
        mob.y = nextY;
        mob.onGround = false;
      }
    } else {
      if (this._collides(mob.x, nextY, mob.z, w, h)) {
        const top = this._groundTop(mob.x, mob.z, w, prevY, nextY);
        if (top !== null) {
          mob.y = top;
          mob.vy = 0;
          mob.onGround = true;
          mob.jumpCd = Math.max(mob.jumpCd, 0.05);
        } else {
          mob.y = nextY;
          mob.vy = 0;
          mob.onGround = true;
        }
      } else {
        mob.y = nextY;
        mob.onGround = false;
      }
    }

    // 掉出世界
    if (mob.y < -16) mob.y = -16;
  }

  _collides(x, y, z, width, height) {
    const world = this.world;
    if (!world || typeof world.isSolidAt !== 'function') return false;

    const half = width * 0.5 - 1e-4;
    const x0 = Math.floor(x - half);
    const x1 = Math.floor(x + half);
    const z0 = Math.floor(z - half);
    const z1 = Math.floor(z + half);
    const y0 = Math.floor(y + 1e-4);
    const y1 = Math.floor(y + height - 1e-4);

    for (let by = y0; by <= y1; by++) {
      for (let bx = x0; bx <= x1; bx++) {
        for (let bz = z0; bz <= z1; bz++) {
          if (world.isSolidAt(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  _groundTop(x, z, width, fromY, toY) {
    const world = this.world;
    if (!world || typeof world.isSolidAt !== 'function') return null;

    const half = width * 0.5 - 1e-4;
    const x0 = Math.floor(x - half);
    const x1 = Math.floor(x + half);
    const z0 = Math.floor(z - half);
    const z1 = Math.floor(z + half);
    const by0 = Math.floor(toY);
    const by1 = Math.floor(fromY + 0.0001);

    let best = null;
    for (let by = by0; by <= by1; by++) {
      for (let bx = x0; bx <= x1; bx++) {
        for (let bz = z0; bz <= z1; bz++) {
          if (!world.isSolidAt(bx, by, bz)) continue;
          const top = by + 1;
          if (top > toY + 1e-6 && top <= fromY + 1e-3) {
            if (best === null || top > best) best = top;
          }
        }
      }
    }
    return best;
  }

  _pointSolid(x, y, z) {
    const world = this.world;
    if (!world || typeof world.isSolidAt !== 'function') return false;
    return world.isSolidAt(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  _separateMobs() {
    const list = this.mobs;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.removed) continue;

      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b || b.removed) continue;

        const maxH = Math.max(a.height, b.height);
        if (Math.abs(a.y - b.y) > maxH * 0.8) continue;

        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const minDist = (a.width + b.width) * 0.45;
        let d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist) continue;

        if (d2 < 1e-8) {
          const ang = Math.random() * TAU;
          dx = Math.sin(ang);
          dz = Math.cos(ang);
          d2 = 1;
        }

        const d = Math.sqrt(d2);
        const push = (minDist - d) * 0.5;
        const px = (dx / d) * push;
        const pz = (dz / d) * push;

        if (!this._collides(a.x - px, a.y, a.z - pz, a.width, a.height)) {
          a.x -= px;
          a.z -= pz;
        }
        if (!this._collides(b.x + px, b.y, b.z + pz, b.width, b.height)) {
          b.x += px;
          b.z += pz;
        }
      }
    }
  }

  // ------------------------------------------------------------
  // 模型
  // ------------------------------------------------------------
  _materialFor(mob, color) {
    let mat = mob._matCache.get(color);
    if (!mat) {
      mat = getProtoMaterial(color).clone();
      mob._matCache.set(color, mat);
      mob.mats.push({ mat, base: mat.color.clone() });
    }
    return mat;
  }

  _addBox(mob, parent, color, w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(this._box, this._materialFor(mob, color));
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  _addLimb(mob, parent, color, w, h, d, x, y, z, list) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    this._addBox(mob, pivot, color, w, h, d, 0, -h * 0.5, 0);
    if (list) list.push(pivot);
    return pivot;
  }

  _makeHead(mob, parent, color, w, h, d, x, y, z) {
    const head = new THREE.Group();
    head.position.set(x, y, z);
    parent.add(head);
    this._addBox(mob, head, color, w, h, d, 0, 0, 0);
    mob.head = head;
    return head;
  }

  _buildModel(mob) {
    const root = new THREE.Group();
    root.position.set(mob.x, mob.y, mob.z);
    root.rotation.y = mob.yaw;

    const def = mob.def;
    const c = def.colors;

    switch (def.id) {
      case 'pig': this._modelPig(mob, root, c); break;
      case 'sheep': this._modelSheep(mob, root, c); break;
      case 'cow': this._modelCow(mob, root, c); break;
      case 'chicken': this._modelChicken(mob, root, c); break;
      case 'zombie': this._modelZombie(mob, root, c); break;
      case 'skeleton': this._modelSkeleton(mob, root, c); break;
      case 'creeper': this._modelCreeper(mob, root, c); break;
      case 'spider': this._modelSpider(mob, root, c); break;
      default: this._addBox(mob, root, 0xffffff, 0.5, 0.5, 0.5, 0, 0.5, 0); break;
    }

    mob.group = root;
    if (this.scene) this.scene.add(root);
    return root;
  }

  _modelPig(mob, root, c) {
    this._addBox(mob, root, c.body, 0.72, 0.52, 0.86, 0, 0.55, 0);
    const head = this._makeHead(mob, root, c.body, 0.46, 0.42, 0.42, 0, 0.66, 0.55);
    this._addBox(mob, head, c.snout, 0.26, 0.17, 0.14, 0, -0.07, 0.26);
    this._addBox(mob, head, c.eye, 0.06, 0.06, 0.03, -0.14, 0.05, 0.215);
    this._addBox(mob, head, c.eye, 0.06, 0.06, 0.03, 0.14, 0.05, 0.215);
    this._addBox(mob, head, c.dark, 0.12, 0.16, 0.06, -0.18, 0.2, 0.02);
    this._addBox(mob, head, c.dark, 0.12, 0.16, 0.06, 0.18, 0.2, 0.02);

    this._addLimb(mob, root, c.leg, 0.18, 0.32, 0.18, -0.24, 0.32, -0.29, mob.legs);
    this._addLimb(mob, root, c.leg, 0.18, 0.32, 0.18, 0.24, 0.32, -0.29, mob.legs);
    this._addLimb(mob, root, c.leg, 0.18, 0.32, 0.18, -0.24, 0.32, 0.29, mob.legs);
    this._addLimb(mob, root, c.leg, 0.18, 0.32, 0.18, 0.24, 0.32, 0.29, mob.legs);
  }

  _modelSheep(mob, root, c) {
    this._addBox(mob, root, c.wool, 0.78, 0.6, 1.02, 0, 0.62, 0);
    this._addBox(mob, root, c.wool, 0.84, 0.16, 1.08, 0, 0.94, -0.02);

    const head = this._makeHead(mob, root, c.face, 0.42, 0.4, 0.38, 0, 0.88, 0.6);
    this._addBox(mob, head, c.face, 0.3, 0.18, 0.12, 0, -0.1, 0.22);
    this._addBox(mob, head, c.eye, 0.06, 0.06, 0.03, -0.12, 0.06, 0.195);
    this._addBox(mob, head, c.eye, 0.06, 0.06, 0.03, 0.12, 0.06, 0.195);
    this._addBox(mob, head, c.wool, 0.44, 0.16, 0.18, 0, 0.23, -0.02);

    this._addBox(mob, root, c.wool, 0.14, 0.2, 0.14, 0, 0.74, -0.56);

    this._addLimb(mob, root, c.leg, 0.16, 0.36, 0.16, -0.24, 0.36, -0.36, mob.legs);
    this._addLimb(mob, root, c.leg, 0.16, 0.36, 0.16, 0.24, 0.36, -0.36, mob.legs);
    this._addLimb(mob, root, c.leg, 0.16, 0.36, 0.16, -0.24, 0.36, 0.36, mob.legs);
    this._addLimb(mob, root, c.leg, 0.16, 0.36, 0.16, 0.24, 0.36, 0.36, mob.legs);
  }

  _modelCow(mob, root, c) {
    this._addBox(mob, root, c.body, 0.82, 0.64, 1.14, 0, 0.82, 0);
    this._addBox(mob, root, c.white, 0.84, 0.2, 1.16, 0, 0.53, 0);
    this._addBox(mob, root, c.white, 0.24, 0.34, 0.4, -0.3, 0.92, -0.25);

    const head = this._makeHead(mob, root, c.body, 0.46, 0.44, 0.42, 0, 1.0, 0.66);
    this._addBox(mob, head, c.snout, 0.3, 0.16, 0.1, 0, -0.08, 0.24);
    this._addBox(mob, head, c.eye, 0.07, 0.07, 0.03, -0.13, 0.07, 0.215);
    this._addBox(mob, head, c.eye, 0.07, 0.07, 0.03, 0.13, 0.07, 0.215);
    this._addBox(mob, head, c.horn, 0.07, 0.16, 0.07, -0.18, 0.28, 0);
    this._addBox(mob, head, c.horn, 0.07, 0.16, 0.07, 0.18, 0.28, 0);
    this._addBox(mob, head, c.body, 0.12, 0.1, 0.05, -0.27, 0.06, 0);
    this._addBox(mob, head, c.body, 0.12, 0.1, 0.05, 0.27, 0.06, 0);

    this._addLimb(mob, root, c.leg, 0.18, 0.56, 0.18, -0.3, 0.56, -0.4, mob.legs);
    this._addLimb(mob, root, c.leg, 0.18, 0.56, 0.18, 0.3, 0.56, -0.4, mob.legs);
    this._addLimb(mob, root, c.leg, 0.18, 0.56, 0.18, -0.3, 0.56, 0.4, mob.legs);
    this._addLimb(mob, root, c.leg, 0.18, 0.56, 0.18, 0.3, 0.56, 0.4, mob.legs);
  }

  _modelChicken(mob, root, c) {
    this._addBox(mob, root, c.body, 0.34, 0.3, 0.42, 0, 0.33, 0);

    const head = this._makeHead(mob, root, c.body, 0.24, 0.24, 0.22, 0, 0.55, 0.2);
    this._addBox(mob, head, c.beak, 0.12, 0.07, 0.12, 0, -0.02, 0.16);
    this._addBox(mob, head, c.comb, 0.1, 0.08, 0.08, 0, 0.13, -0.02);
    this._addBox(mob, head, c.comb, 0.06, 0.08, 0.05, 0, -0.12, 0.12);
    this._addBox(mob, head, c.eye, 0.05, 0.05, 0.03, -0.09, 0.04, 0.105);
    this._addBox(mob, head, c.eye, 0.05, 0.05, 0.03, 0.09, 0.04, 0.105);

    this._addLimb(mob, root, c.wing, 0.07, 0.2, 0.3, -0.19, 0.42, 0, mob.arms);
    this._addLimb(mob, root, c.wing, 0.07, 0.2, 0.3, 0.19, 0.42, 0, mob.arms);
    this._addLimb(mob, root, c.leg, 0.07, 0.2, 0.07, -0.1, 0.2, 0, mob.legs);
    this._addLimb(mob, root, c.leg, 0.07, 0.2, 0.07, 0.1, 0.2, 0, mob.legs);

    this._addBox(mob, root, c.wing, 0.16, 0.14, 0.16, 0, 0.45, -0.24);
  }

  _modelZombie(mob, root, c) {
    this._addLimb(mob, root, c.pants, 0.21, 0.76, 0.22, -0.14, 0.76, 0, mob.legs);
    this._addLimb(mob, root, c.pants, 0.21, 0.76, 0.22, 0.14, 0.76, 0, mob.legs);

    this._addBox(mob, root, c.shirt, 0.55, 0.74, 0.3, 0, 1.13, 0);
    this._addBox(mob, root, c.pants, 0.56, 0.08, 0.32, 0, 0.79, 0);

    this._addLimb(mob, root, c.skin, 0.18, 0.7, 0.18, -0.365, 1.47, 0, mob.arms);
    this._addLimb(mob, root, c.skin, 0.18, 0.7, 0.18, 0.365, 1.47, 0, mob.arms);

    const head = this._makeHead(mob, root, c.skin, 0.48, 0.48, 0.48, 0, 1.64, 0);
    this._addBox(mob, head, c.hair, 0.5, 0.09, 0.5, 0, 0.28, -0.01);
    this._addBox(mob, head, c.eye, 0.09, 0.09, 0.02, -0.11, 0.03, 0.25);
    this._addBox(mob, head, c.eye, 0.09, 0.09, 0.02, 0.11, 0.03, 0.25);
  }

  _modelSkeleton(mob, root, c) {
    this._addLimb(mob, root, c.bone, 0.13, 0.74, 0.14, -0.11, 0.74, 0, mob.legs);
    this._addLimb(mob, root, c.bone, 0.13, 0.74, 0.14, 0.11, 0.74, 0, mob.legs);

    this._addBox(mob, root, c.bone, 0.36, 0.18, 0.24, 0, 0.82, 0);
    this._addBox(mob, root, c.bone, 0.4, 0.58, 0.24, 0, 1.16, 0);
    this._addBox(mob, root, c.dark, 0.34, 0.05, 0.25, 0, 1.02, 0.01);
    this._addBox(mob, root, c.dark, 0.34, 0.05, 0.25, 0, 1.18, 0.01);
    this._addBox(mob, root, c.dark, 0.34, 0.05, 0.25, 0, 1.34, 0.01);

    this._addLimb(mob, root, c.bone, 0.11, 0.66, 0.11, -0.28, 1.42, 0, mob.arms);
    this._addLimb(mob, root, c.bone, 0.11, 0.66, 0.11, 0.28, 1.42, 0, mob.arms);

    const head = this._makeHead(mob, root, c.bone, 0.46, 0.46, 0.46, 0, 1.66, 0);
    this._addBox(mob, head, c.eye, 0.09, 0.09, 0.02, -0.1, 0.03, 0.24);
    this._addBox(mob, head, c.eye, 0.09, 0.09, 0.02, 0.1, 0.03, 0.24);

    // 弓
    const bow = this._addBox(mob, root, c.bow, 0.05, 0.82, 0.05, 0.4, 1.15, 0.14);
    bow.rotation.z = 0.12;
  }

  _modelCreeper(mob, root, c) {
    this._addLimb(mob, root, c.leg, 0.2, 0.44, 0.2, -0.17, 0.44, -0.16, mob.legs);
    this._addLimb(mob, root, c.leg, 0.2, 0.44, 0.2, 0.17, 0.44, -0.16, mob.legs);
    this._addLimb(mob, root, c.leg, 0.2, 0.44, 0.2, -0.17, 0.44, 0.16, mob.legs);
    this._addLimb(mob, root, c.leg, 0.2, 0.44, 0.2, 0.17, 0.44, 0.16, mob.legs);

    this._addBox(mob, root, c.body, 0.55, 0.86, 0.34, 0, 0.92, 0);

    const head = this._makeHead(mob, root, c.body, 0.5, 0.5, 0.5, 0, 1.44, 0);
    this._addBox(mob, head, c.face, 0.1, 0.1, 0.02, -0.12, 0.05, 0.26);
    this._addBox(mob, head, c.face, 0.1, 0.1, 0.02, 0.12, 0.05, 0.26);
    this._addBox(mob, head, c.face, 0.16, 0.16, 0.02, 0, -0.12, 0.26);
    this._addBox(mob, head, c.face, 0.1, 0.1, 0.02, -0.14, -0.07, 0.26);
    this._addBox(mob, head, c.face, 0.1, 0.1, 0.02, 0.14, -0.07, 0.26);
  }

  _modelSpider(mob, root, c) {
    this._addBox(mob, root, c.body, 0.6, 0.38, 0.7, 0, 0.46, -0.08);
    const head = this._makeHead(mob, root, c.head, 0.44, 0.34, 0.42, 0, 0.44, 0.42);
    this._addBox(mob, head, c.eye, 0.07, 0.07, 0.02, -0.1, 0.03, 0.22);
    this._addBox(mob, head, c.eye, 0.07, 0.07, 0.02, 0.1, 0.03, 0.22);
    this._addBox(mob, head, c.eye, 0.05, 0.05, 0.02, -0.17, 0.06, 0.21);
    this._addBox(mob, head, c.eye, 0.05, 0.05, 0.02, 0.17, 0.06, 0.21);

    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 4; k++) {
        const z = -0.3 + k * 0.2;
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.26, 0.46, z);
        pivot.rotation.z = side > 0 ? -0.42 : 0.42;
        root.add(pivot);
        this._addBox(mob, pivot, c.leg, 0.36, 0.07, 0.07, side * 0.18, 0, 0);
        mob.legs.push(pivot);
      }
    }
  }

  // ------------------------------------------------------------
  // 动画 / 染色
  // ------------------------------------------------------------
  _animateMob(mob, dt) {
    const speed = Math.sqrt(mob.vx * mob.vx + mob.vz * mob.vz);

    mob.walkPhase += dt * (3.5 + speed * 2.5);
    const targetSwing = speed > 0.08 && mob.onGround ? 1 : 0;
    mob.swing += (targetSwing - mob.swing) * Math.min(1, dt * 8);

    const base = Math.sin(mob.walkPhase) * 0.72 * mob.swing;
    for (let i = 0; i < mob.legs.length; i++) {
      mob.legs[i].rotation.x = base * (i % 2 === 0 ? 1 : -1);
    }
    for (let i = 0; i < mob.arms.length; i++) {
      mob.arms[i].rotation.x = -base * (i % 2 === 0 ? 1 : -1);
    }

    const player = this.player;
    let headTarget = 0;
    if (player && !player.dead && mob.def.hostile) {
      const rel = wrapAngle(Math.atan2(player.x - mob.x, player.z - mob.z) - mob.yaw);
      headTarget = clamp(rel, -0.85, 0.85);
    }
    mob.headYaw += (headTarget - mob.headYaw) * Math.min(1, dt * 6);
    if (mob.head) mob.head.rotation.y = mob.headYaw;

    mob.yaw += wrapAngle(mob.yawTarget - mob.yaw) * Math.min(1, dt * 8);
    if (mob.group) {
      mob.group.rotation.y = mob.yaw;
      mob.group.position.set(mob.x, mob.y, mob.z);
    }
  }

  _updateTint(mob) {
    const light = this.lightLevel;
    const hurting = mob.hurtTimer > 0;
    const fuse = mob.ai.fuse > 0;

    for (let i = 0; i < mob.mats.length; i++) {
      const entry = mob.mats[i];
      const mat = entry.mat;
      if (hurting) {
        mat.color.setRGB(light, light * 0.2, light * 0.18);
      } else if (fuse) {
        const flash = light * (0.72 + 0.28 * Math.sin(this.elapsed * 38));
        mat.color.setRGB(flash, flash, flash);
      } else {
        mat.color.copy(entry.base).multiplyScalar(light);
      }
    }
  }

  _playSound(name, volume) {
    const sound = this.game && this.game.sound;
    if (!sound || typeof sound.play !== 'function') return;
    sound.play(name, { volume });
  }
}
