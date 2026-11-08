// ============================================================
// items.js — 地面掉落实体（掉落物、拾取、上下浮动）
// ============================================================

import * as THREE from 'three';

const PICKUP_RADIUS = 1.25;
const PICKUP_DELAY = 0.45;

export class ItemEntityManager {
  constructor(game) {
    this.game = game; // { scene, world, player, inventory, sound }
    this.entities = [];
    this.maxEntities = 220;
    this._textureCache = new Map();
  }

  _texture(id) {
    const cached = this._textureCache.get(id);
    if (cached) return cached;
    let canvas = null;
    try {
      canvas = this.game.inventory.iconCanvas(id);
    } catch (e) {
      canvas = null;
    }
    if (!canvas) return null;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    this._textureCache.set(id, tex);
    return tex;
  }

  spawn(id, x, y, z, count = 1, opts = {}) {
    if (!id || count <= 0) return null;
    const tex = this._texture(id);
    if (!tex) return null;
    if (!opts.noMerge) {
      for (const other of this.entities) {
        if (other.id !== id) continue;
        const dx = other.x - x;
        const dy = other.y - y;
        const dz = other.z - z;
        if (dx * dx + dy * dy + dz * dz < 2.25) {
          other.count += count;
          return other;
        }
      }
    }
    if (this.entities.length >= this.maxEntities) {
      this._remove(0);
    }
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.34, 0.34, 1);
    sprite.position.set(x, y, z);
    this.game.scene.add(sprite);
    const e = {
      id,
      count,
      x,
      y,
      z,
      vx: opts.vx !== undefined ? opts.vx : (Math.random() - 0.5) * 1.8,
      vy: opts.vy !== undefined ? opts.vy : 2.0 + Math.random() * 1.4,
      vz: opts.vz !== undefined ? opts.vz : (Math.random() - 0.5) * 1.8,
      age: 0,
      pickupDelay: opts.pickupDelay !== undefined ? opts.pickupDelay : PICKUP_DELAY,
      sprite,
    };
    this.entities.push(e);
    return e;
  }

  update(dt) {
    const game = this.game;
    const player = game.player;
    const world = game.world;
    const inventory = game.inventory;
    if (!player || !inventory) return;

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.age += dt;
      e.pickupDelay -= dt;

      // 物理：重力 + 简单落地
      e.vy -= 18 * dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
      const groundY = Math.floor(e.y - 0.12);
      if (world.isSolidAt(Math.floor(e.x), groundY, Math.floor(e.z))) {
        e.y = groundY + 1 + 0.12;
        e.vy = 0;
        e.vx *= 0.6;
        e.vz *= 0.6;
      }
      if (e.vy === 0) {
        const damp = Math.max(0, 1 - dt * 5);
        e.vx *= damp;
        e.vz *= damp;
      }

      // 浮动 + 轻微摆动
      const bob = 0.05 + Math.sin(e.age * 2.6 + e.x * 1.7 + e.z) * 0.035;
      e.sprite.position.set(e.x, e.y + bob, e.z);
      e.sprite.material.rotation = Math.sin(e.age * 1.8 + e.z) * 0.18;

      // 拾取
      if (e.pickupDelay <= 0) {
        const dx = player.x - e.x;
        const dy = player.y + 0.9 - e.y;
        const dz = player.z - e.z;
        if (dx * dx + dy * dy + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
          const left = inventory.add(e.id, e.count);
          if (left < e.count) {
            game.sound?.play('pop', { volume: 0.32 });
            e.count = left;
            if (left <= 0) {
              this._remove(i);
              continue;
            }
          }
        }
      }

      // 超时消失
      if (e.age > 300) this._remove(i);
    }
  }

  _remove(index) {
    const e = this.entities[index];
    if (!e) return;
    this.game.scene.remove(e.sprite);
    if (e.sprite.material) e.sprite.material.dispose();
    this.entities.splice(index, 1);
  }

  clear() {
    for (let i = this.entities.length - 1; i >= 0; i--) this._remove(i);
  }

  get count() {
    return this.entities.length;
  }
}
