// ============================================================
// player.js — 玩家物理、碰撞、挖掘/放置、生命与饥饿、存档
// ============================================================

import {
  BLOCK,
  getBlockDef,
  isSolidBlock,
  breakTimeSeconds,
  breakDrop,
  breakSoundName,
  placeSoundName,
  stepSoundName,
  toolOf,
  getItem,
  itemDisplay,
} from './blocks.js';
import { CHUNK_H } from './world.js';

const PLAYER_W = 0.6;
const PLAYER_H = 1.8;
const EYE_H = 1.62;
const EPS = 1e-4;
const GRAVITY = 28;
const JUMP_V = 8.6;

export class Player {
  constructor(game) {
    this.game = game; // { world, renderer, inventory, sound, mode, toast, callbacks... }
    this.world = game.world;
    this.inventory = game.inventory;
    this.mode = game.mode || 'survival';

    this.x = 0.5;
    this.y = 80;
    this.z = 0.5;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = 0;
    this.pitch = 0;

    this.onGround = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.inWater = false;
    this.inLava = false;
    this.eyeInWater = false;
    this.dead = false;
    this.deathMessage = '';

    this.health = 20;
    this.hunger = 20;
    this.fallDistance = 0;
    this.hurtFlash = 0;

    this.target = null;
    this.mobTarget = null;
    this.attackCooldown = 0;
    this.breakTarget = null;
    this.breakProgress = 0;
    this.breakHeld = false;
    this.breakCooldown = 0;
    this.reach = 5.2;

    this.lookSensitivity = 0.0024;
    this.controls = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
    this.stepTimer = 0;
    this.hungerTimer = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.lavaTimer = 0;
    this.bob = 0;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
  }

  eyeY() {
    return this.y + EYE_H;
  }

  setPosition(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
  }

  setControls(c) {
    Object.assign(this.controls, c);
  }

  handleLook(dx, dy) {
    if (this.dead) return;
    const s = this.lookSensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.02;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  forwardVector() {
    const cp = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp,
    };
  }

  toggleFlying() {
    if (this.mode !== 'creative') return false;
    this.flying = !this.flying;
    if (this.flying) this.vy = 0;
    return true;
  }

  // ---------------- 主更新 ----------------
  update(dt) {
    if (this.dead) return;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this._updateEnvironment();
    this._updatePhysics(dt);
    this._updateVitals(dt);
    this._updateTargeting();
    this._updateMobTarget();
    this._updateBreaking(dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.breakHeld && this.mobTarget && this.attackCooldown <= 0) this.attackAction();
    this._updateFootsteps(dt);

    const r = this.game.renderer;
    if (r) {
      r.setHighlight(this.mobTarget ? null : this.target);
      r.setBreakOverlay(this.mobTarget ? null : this.breakTarget, this.breakProgress);
    }
  }

  _updateEnvironment() {
    const fx = Math.floor(this.x);
    const fy = Math.floor(this.y + 0.4);
    const fz = Math.floor(this.z);
    const feet = this.world.getBlock(fx, fy, fz);
    this.inWater = feet === BLOCK.WATER;
    this.inLava = feet === BLOCK.LAVA;
    this.eyeInWater = this.world.getBlock(fx, Math.floor(this.eyeY()), fz) === BLOCK.WATER;
  }

  _updatePhysics(dt) {
    if (this.flying) {
      this._updateFly(dt);
      return;
    }

    const c = this.controls;
    const sneak = c.sneak && !this.flying;
    this.sneaking = sneak;
    this.sprinting = c.sprint && c.forward && !sneak && !this.inWater;

    let speed = this.sneaking ? 1.5 : this.sprinting ? 5.9 : 4.3;
    if (this.inWater) speed *= 0.65;
    if (this.inLava) speed *= 0.45;

    let f = (c.forward ? 1 : 0) - (c.back ? 1 : 0);
    let r = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    const len = Math.hypot(f, r);
    if (len > 0) {
      f /= len;
      r /= len;
    }
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const wishX = -sinY * f + cosY * r;
    const wishZ = -cosY * f - sinY * r;

    const accel = this.onGround ? 22 : 7;
    const blend = Math.min(1, accel * dt);
    this.vx += (wishX * speed - this.vx) * blend;
    this.vz += (wishZ * speed - this.vz) * blend;

    if (this.inWater) {
      this.vy -= 6 * dt;
      if (this.vy < -3) this.vy = -3;
      if (c.jump) this.vy = 3.4;
    } else if (this.inLava) {
      this.vy -= 5 * dt;
      if (this.vy < -2) this.vy = -2;
      if (c.jump) this.vy = 2.2;
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -60) this.vy = -60;
      if (c.jump && this.onGround) {
        this.vy = JUMP_V;
        this.onGround = false;
        this.game.sound?.play('jump', { volume: 0.18 });
      }
    }

    this.onGround = false;
    this.x += this.vx * dt;
    this._collide('x');
    this.z += this.vz * dt;
    this._collide('z');
    this.y += this.vy * dt;
    this._collide('y');

    if (this.y < -8) {
      this.setPosition(this.spawn.x, this.spawn.y + 4, this.spawn.z);
      this.health = 20;
      this.game.onHealthChange?.();
    }

    // 摔落伤害
    if (!this.onGround && !this.inWater && !this.inLava) {
      if (this.vy < 0) this.fallDistance += -this.vy * dt;
    }
    if (this.onGround) {
      if (this.fallDistance > 3.4) {
        const dmg = Math.round(this.fallDistance - 3);
        if (dmg > 0) this.damage(dmg, '摔死了');
        this.game.sound?.play('land', { volume: 0.4 });
      }
      this.fallDistance = 0;
      this.bob += Math.hypot(this.vx, this.vz) * dt;
    }
  }

  _updateFly(dt) {
    const c = this.controls;
    const speed = c.sprint ? 18 : 10;
    let f = (c.forward ? 1 : 0) - (c.back ? 1 : 0);
    let r = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    const len = Math.hypot(f, r);
    if (len > 0) {
      f /= len;
      r /= len;
    }
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const wishX = -sinY * f + cosY * r;
    const wishZ = -cosY * f - sinY * r;
    const blend = Math.min(1, 12 * dt);
    this.vx += (wishX * speed - this.vx) * blend;
    this.vz += (wishZ * speed - this.vz) * blend;
    this.vy = 0;
    if (c.jump) this.vy = 8;
    else if (c.sneak) this.vy = -8;

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += this.vy * dt;
    if (this.y < 0) this.y = 0;
    if (this.y > CHUNK_H - 2) this.y = CHUNK_H - 2;
    this.fallDistance = 0;
    this.onGround = false;
  }

  _collide(axis) {
    const minX = this.x - PLAYER_W / 2;
    const maxX = this.x + PLAYER_W / 2;
    const minY = this.y;
    const maxY = this.y + PLAYER_H;
    const minZ = this.z - PLAYER_W / 2;
    const maxZ = this.z + PLAYER_W / 2;
    const bx0 = Math.floor(minX);
    const bx1 = Math.floor(maxX);
    const by0 = Math.floor(minY);
    const by1 = Math.floor(maxY);
    const bz0 = Math.floor(minZ);
    const bz1 = Math.floor(maxZ);

    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        for (let bz = bz0; bz <= bz1; bz++) {
          if (!isSolidBlock(this.world.getBlock(bx, by, bz))) continue;
          if (maxX <= bx || minX >= bx + 1) continue;
          if (maxY <= by || minY >= by + 1) continue;
          if (maxZ <= bz || minZ >= bz + 1) continue;

          if (axis === 'x') {
            if (this.vx > 0) this.x = bx - PLAYER_W / 2 - EPS;
            else if (this.vx < 0) this.x = bx + 1 + PLAYER_W / 2 + EPS;
            this.vx = 0;
          } else if (axis === 'z') {
            if (this.vz > 0) this.z = bz - PLAYER_W / 2 - EPS;
            else if (this.vz < 0) this.z = bz + 1 + PLAYER_W / 2 + EPS;
            this.vz = 0;
          } else {
            if (this.vy > 0) {
              this.y = by - PLAYER_H - EPS;
            } else {
              this.y = by + 1 + EPS;
              this.onGround = true;
            }
            this.vy = 0;
          }
          return;
        }
      }
    }
  }

  _updateVitals(dt) {
    if (this.mode !== 'survival') return;
    const moving = Math.abs(this.vx) > 0.5 || Math.abs(this.vz) > 0.5;

    this.hungerTimer += dt;
    if (this.hungerTimer > (this.sprinting ? 4 : 16)) {
      this.hungerTimer = 0;
      if (moving || this.sprinting) this.hunger = Math.max(0, this.hunger - 0.5);
      this.game.onHealthChange?.();
    }

    if (this.hunger >= 18 && this.health < 20) {
      this.regenTimer += dt;
      if (this.regenTimer > 3.5) {
        this.regenTimer = 0;
        this.health = Math.min(20, this.health + 1);
        this.hunger = Math.max(0, this.hunger - 0.5);
        this.game.onHealthChange?.();
      }
    } else {
      this.regenTimer = 0;
    }

    if (this.hunger <= 0 && this.health > 1) {
      this.starveTimer += dt;
      if (this.starveTimer > 4) {
        this.starveTimer = 0;
        this.damage(1, '饿死了');
      }
    }

    if (this.inLava) {
      this.lavaTimer += dt;
      if (this.lavaTimer > 1) {
        this.lavaTimer = 0;
        this.damage(4, '被岩浆烧死了');
      }
    } else {
      this.lavaTimer = 0;
    }
  }

  _updateTargeting() {
    const dir = this.forwardVector();
    this.target = this.world.raycast(this.x, this.eyeY(), this.z, dir.x, dir.y, dir.z, this.reach);
  }

  _updateMobTarget() {
    this.mobTarget = null;
    if (!this.game.mobs) return;
    const dir = this.forwardVector();
    const hit = this.game.mobs.pick({ x: this.x, y: this.eyeY(), z: this.z }, dir, this.reach);
    if (hit) this.mobTarget = hit.mob;
  }

  _attackDamage() {
    const held = this.inventory.held;
    const item = held ? getItem(held.id) : null;
    if (item && item.tool) {
      const t = item.tool;
      if (t.type === 'sword') return [0, 4, 5, 6][t.tier] || 1;
      if (t.type === 'axe') return [0, 3, 4, 5][t.tier] || 2;
      return [0, 2, 3, 4][t.tier] || 1;
    }
    return 1;
  }

  attackAction() {
    if (this.dead || this.attackCooldown > 0) return false;
    if (!this.mobTarget || !this.game.mobs) return false;
    this.attackCooldown = 0.45;
    const dir = this.forwardVector();
    const dmg = this._attackDamage();
    const mob = this.mobTarget;
    const died = this.game.mobs.hit(mob, dmg, dir.x * 0.9, dir.z * 0.9);
    if (died) {
      this.game.sound?.play('pop', { volume: 0.35 });
      this.game.achievements?.onEvent('kill', { hostile: !!(mob.def && mob.def.hostile) });
    }
    const held = this.inventory.held;
    if (held) this.inventory.damageHeld(1);
    return true;
  }

  primaryAction() {
    if (this.attackAction()) return;
    if (this.mode === 'creative' && this.target) this.breakBlock(this.target);
  }

  _dropItem(id, count, x, y, z) {
    if (!id || count <= 0) return;
    if (this.game.dropItem) this.game.dropItem(id, x, y, z, count);
    else this.inventory.add(id, count);
  }

  _updateBreaking(dt) {
    if (this.mobTarget) {
      this.breakProgress = 0;
      this.breakTarget = null;
      return;
    }
    if (this.dead || !this.breakHeld) {
      this.breakProgress = 0;
      this.breakTarget = null;
      this.breakCooldown = 0;
      return;
    }
    if (!this.target) {
      this.breakProgress = 0;
      this.breakTarget = null;
      return;
    }
    const def = getBlockDef(this.target.id);
    if (!isFinite(def.hardness)) {
      this.breakProgress = 0;
      this.breakTarget = null;
      return;
    }

    if (this.mode === 'creative') {
      this.breakCooldown -= dt;
      if (this.breakCooldown <= 0) {
        this.breakCooldown = 0.16;
        this.breakBlock(this.target);
      }
      return;
    }

    const heldId = this.inventory.held ? this.inventory.held.id : null;
    const same =
      this.breakTarget &&
      this.breakTarget.x === this.target.x &&
      this.breakTarget.y === this.target.y &&
      this.breakTarget.z === this.target.z;
    if (!same) {
      this.breakTarget = { ...this.target };
      this.breakProgress = 0;
    }
    const total = breakTimeSeconds(this.target.id, heldId);
    this.breakProgress += dt / Math.max(0.05, total);
    if (Math.random() < dt * 6) {
      this.game.renderer?.spawnBreakParticles(this.target.x, this.target.y, this.target.z, this.target.id);
    }
    if (this.breakProgress >= 1) {
      const hit = this.target;
      this.breakProgress = 0;
      this.breakTarget = null;
      this.breakBlock(hit);
    }
  }

  breakBlock(hit) {
    if (!hit) return;
    const def = getBlockDef(hit.id);
    if (def.id === BLOCK.BEDROCK && this.mode !== 'creative') return;
    const heldId = this.inventory.held ? this.inventory.held.id : null;
    const tool = toolOf(heldId);

    if (this.mode === 'survival') {
      const drop = breakDrop(hit.id, heldId);
      if (drop) this._dropItem(drop.id, drop.count, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      if (hit.id === BLOCK.LEAVES && Math.random() < 0.06) {
        this._dropItem('apple', 1, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      }
      if (hit.id === BLOCK.TALL_GRASS && Math.random() < 0.3) {
        this._dropItem('wheat_seeds', 1, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      }
      if (hit.id === BLOCK.WHEAT_3 && Math.random() < 0.6) {
        this._dropItem('wheat_seeds', 1, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      }
      if (tool && def.tool === tool.type) this.inventory.damageHeld(1);
    }

    this.game.containers?.dropAndRemove(hit);
    this.world.setBlock(hit.x, hit.y, hit.z, 0);
    this.game.renderer?.spawnBreakParticles(hit.x, hit.y, hit.z, hit.id);
    this.game.sound?.play(breakSoundName(hit.id), { volume: 0.55 });
    this.game.achievements?.onEvent('mine', { id: hit.id, name: def.name });
    if (hit.id === BLOCK.WHEAT_3) this.game.achievements?.onEvent('harvest', {});
    this.game.onInventoryChange?.();
  }

  _updateFootsteps(dt) {
    if (!this.onGround) return;
    const moving = Math.hypot(this.vx, this.vz);
    if (moving < 0.6) return;
    this.stepTimer += moving * dt;
    if (this.stepTimer > 2.4) {
      this.stepTimer = 0;
      const below = this.world.getBlock(
        Math.floor(this.x),
        Math.floor(this.y - 0.2),
        Math.floor(this.z),
      );
      if (below) this.game.sound?.play(stepSoundName(below), { volume: 0.22 });
    }
  }

  _useHoe() {
    const hit = this.target;
    if (!hit) return false;
    const def = getBlockDef(hit.id);
    if (def.name !== 'grass_block' && def.name !== 'dirt') return false;
    if (this.world.getBlock(hit.x, hit.y + 1, hit.z) !== 0) return false;
    this.world.setBlock(hit.x, hit.y, hit.z, BLOCK.FARMLAND);
    this.game.sound?.play('place_grass', { volume: 0.4 });
    this.inventory.damageHeld(1);
    return true;
  }

  _intersectsBlock(bx, by, bz) {
    const minX = this.x - PLAYER_W / 2;
    const maxX = this.x + PLAYER_W / 2;
    const minY = this.y;
    const maxY = this.y + PLAYER_H;
    const minZ = this.z - PLAYER_W / 2;
    const maxZ = this.z + PLAYER_W / 2;
    return !(maxX <= bx || minX >= bx + 1 || maxY <= by || minY >= by + 1 || maxZ <= bz || minZ >= bz + 1);
  }

  secondaryAction() {
    if (this.dead) return;
    const held = this.inventory.held;
    const heldItem = held ? getItem(held.id) : null;
    if (heldItem && heldItem.tool && heldItem.tool.type === 'hoe') {
      if (this._useHoe()) return;
    }
    if (this.target) {
      const def = getBlockDef(this.target.id);
      if (def.name === 'crafting_table') {
        this.game.openCraftingTable?.();
        return;
      }
      if (def.name === 'furnace' || def.name === 'chest') {
        this.game.openContainer?.(this.target);
        return;
      }
      if (def.name === 'bed') {
        this.game.sleepInBed?.(this.target);
        return;
      }
    }
    this.tryPlace();
  }

  tryPlace() {
    if (this.dead || !this.target) return;
    const held = this.inventory.held;
    if (!held) return;
    const item = getItem(held.id);
    if (!item) return;
    if (item.food) {
      this.eat();
      return;
    }
    if (held.id === 'wheat_seeds') {
      const below = getBlockDef(this.target.id);
      if (below.name !== 'farmland') return;
      const px = this.target.x;
      const py = this.target.y + 1;
      const pz = this.target.z;
      if (this.world.getBlock(px, py, pz) !== 0) return;
      this.world.setBlock(px, py, pz, BLOCK.WHEAT_0);
      this.world.plantCrop(px, py, pz, this.world.time + 20 + Math.random() * 20);
      if (this.mode === 'survival') this.inventory.consumeHeld(1);
      this.game.sound?.play('place_grass', { volume: 0.35 });
      this.game.onInventoryChange?.();
      return;
    }
    if (item.block == null) return;

    let px = this.target.x + this.target.nx;
    let py = this.target.y + this.target.ny;
    let pz = this.target.z + this.target.nz;

    const hitDef = getBlockDef(this.target.id);
    if (hitDef.cross) {
      px = this.target.x;
      py = this.target.y;
      pz = this.target.z;
    }

    if (py < 0 || py >= CHUNK_H) return;
    const existing = this.world.getBlock(px, py, pz);
    const existingDef = getBlockDef(existing);
    if (!(existing === 0 || existingDef.cross)) return;

    if (this._intersectsBlock(px, py, pz)) return;
    const placeDef = getBlockDef(item.block);
    if (placeDef.needsSupport && !isSolidBlock(this.world.getBlock(px, py - 1, pz))) return;

    this.world.setBlock(px, py, pz, item.block);
    if (this.mode === 'survival') this.inventory.consumeHeld(1);
    this.game.achievements?.onEvent('place', { name: placeDef.name });
    this.game.sound?.play(placeSoundName(item.block), { volume: 0.5 });
    this.game.onInventoryChange?.();
  }

  eat() {
    const held = this.inventory.held;
    if (!held) return false;
    const item = getItem(held.id);
    if (!item || !item.food) return false;
    if (this.hunger >= 20 && this.health >= 20) return false;
    this.hunger = Math.min(20, this.hunger + item.food * 2);
    this.health = Math.min(20, this.health + 2);
    this.inventory.consumeHeld(1);
    this.game.sound?.play('pop', { volume: 0.5 });
    this.game.onInventoryChange?.();
    this.game.onHealthChange?.();
    return true;
  }

  damage(amount, reason) {
    if (this.dead || this.mode === 'creative') return;
    this.health -= amount;
    this.hurtFlash = 0.45;
    this.game.sound?.play('hurt', { volume: 0.5 });
    this.game.onHealthChange?.();
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathMessage = reason || '死了';
      this.game.onDeath?.(this.deathMessage);
    }
  }

  respawn() {
    this.dead = false;
    this.health = 20;
    this.hunger = 20;
    this.fallDistance = 0;
    this.hurtFlash = 0;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.setPosition(this.spawn.x, this.spawn.y + 0.5, this.spawn.z);
    this.game.onHealthChange?.();
  }

  saveState() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      hunger: this.hunger,
      mode: this.mode,
      flying: this.flying,
      spawn: { ...this.spawn },
    };
  }

  loadState(s) {
    if (!s) return;
    if (typeof s.x === 'number') this.x = s.x;
    if (typeof s.y === 'number') this.y = s.y;
    if (typeof s.z === 'number') this.z = s.z;
    if (typeof s.yaw === 'number') this.yaw = s.yaw;
    if (typeof s.pitch === 'number') this.pitch = s.pitch;
    if (typeof s.health === 'number') this.health = s.health;
    if (typeof s.hunger === 'number') this.hunger = s.hunger;
    if (s.mode === 'creative' || s.mode === 'survival') this.mode = s.mode;
    this.flying = !!s.flying && this.mode === 'creative';
    if (s.spawn) this.spawn = { ...s.spawn };
  }
}
