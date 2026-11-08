// ============================================================
// weather.js — 天气系统（雨 / 雪 / 雷暴、粒子、闪电、环境音）
// ============================================================

import * as THREE from 'three';
import { BLOCK } from './blocks.js';

const RAIN_COUNT = 650;
const SNOW_COUNT = 650;
const RAIN_RADIUS = 18;

export class WeatherManager {
  constructor(game) {
    this.game = game; // { scene, world, player, sound, renderer }
    this.scene = game.scene;
    this.type = 'clear';
    this.timer = 150 + Math.random() * 180;
    this.flash = 0;
    this.thunderTimer = 8 + Math.random() * 12;
    this.fires = [];
    this.fireDamageTimer = 0;
    this.rainDensity = 1;

    this._buildRain();
    this._buildSnow();
  }

  _buildRain() {
    const positions = new Float32Array(RAIN_COUNT * 2 * 3);
    this.rainDrops = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainDrops.push({
        x: (Math.random() - 0.5) * RAIN_RADIUS * 2,
        y: Math.random() * 24,
        z: (Math.random() - 0.5) * RAIN_RADIUS * 2,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xa9c8e8,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      fog: false,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  _buildSnow() {
    const positions = new Float32Array(SNOW_COUNT * 3);
    this.snowFlakes = [];
    for (let i = 0; i < SNOW_COUNT; i++) {
      this.snowFlakes.push({
        x: (Math.random() - 0.5) * RAIN_RADIUS * 2,
        y: Math.random() * 24,
        z: (Math.random() - 0.5) * RAIN_RADIUS * 2,
        phase: Math.random() * Math.PI * 2,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.11,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.scene.add(this.snow);
  }

  get isRaining() {
    return this.type === 'rain' || this.type === 'thunder';
  }

  setType(type) {
    const next = ['clear', 'rain', 'thunder', 'snow'].includes(type) ? type : 'clear';
    this.type = next;
    this.timer = 90 + Math.random() * 200;
    this.thunderTimer = 3 + Math.random() * 8;
    this._applyAudio();
    const names = { clear: '晴朗', rain: '下雨', thunder: '雷暴', snow: '下雪' };
    this.game.chat?.log('天气：' + (names[next] || next));
  }

  _applyAudio() {
    const sound = this.game.sound;
    if (!sound) return;
    try {
      if (this.type === 'rain' || this.type === 'thunder') sound.startRain(this.type === 'thunder' ? 0.09 : 0.06);
      else sound.stopRain();
    } catch (e) {
      // ignore
    }
  }

  setDensity(density) {
    this.rainDensity = Math.max(0.15, Math.min(1, density));
  }

  _strikeNear(player, world) {
    if (!player || !world) return;
    if (player.x >= 100000) return; // 下界没有雷暴
    const angle = Math.random() * Math.PI * 2;
    const dist = 4 + Math.random() * 16;
    const x = Math.floor(player.x + Math.sin(angle) * dist);
    const z = Math.floor(player.z + Math.cos(angle) * dist);
    if (typeof world.isLoaded === 'function' && !world.isLoaded(x, z)) return;
    const top = world.getSurfaceY(x, z);
    if (!Number.isFinite(top)) return;
    const ground = world.getBlock(x, top, z);
    if (!ground || ground === BLOCK.WATER || ground === BLOCK.LAVA) return;
    if (world.getBlock(x, top + 1, z) !== 0) return;
    const flammable = new Set([
      BLOCK.GRASS, BLOCK.PLANKS, BLOCK.LOG, BLOCK.BIRCH_LOG, BLOCK.SPRUCE_LOG,
      BLOCK.LEAVES, BLOCK.BIRCH_LEAVES, BLOCK.SPRUCE_LEAVES, BLOCK.BIRCH_PLANKS, BLOCK.SPRUCE_PLANKS,
    ]);
    if (flammable.has(ground)) {
      world.setBlock(x, top + 1, z, BLOCK.FIRE);
      this.fires.push({ x, y: top + 1, z, t: 8 + Math.random() * 8 });
    }
    // 闪电点燃附近 TNT
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (world.getBlock(x + dx, top + 1 + dy, z + dz) === BLOCK.TNT) {
            this.game.igniteTNT?.(x + dx, top + 1 + dy, z + dz);
          }
        }
      }
    }
    if (Math.hypot(player.x - x, player.z - z) < 4) {
      player.damage(5, '被闪电劈死了');
    }
    if (this.game.mobs && this.game.mobs.mobs) {
      for (const mob of this.game.mobs.mobs) {
        if (!mob || mob.removed) continue;
        if (Math.hypot(mob.x - x, mob.z - z) < 3.5) {
          this.game.mobs.hit(mob, 6, 0, 0);
        }
      }
    }
    this.game.chat?.log('⚡ 闪电击中了地面！');
  }

  update(dt) {
    const player = this.game.player;
    const world = this.game.world;
    if (!player || !world) return;

    this.timer -= dt;
    if (this.timer <= 0) {
      const r = Math.random();
      if (this.type === 'clear') {
        this.setType(r < 0.12 ? 'thunder' : r < 0.45 ? 'rain' : 'clear');
      } else {
        this.setType('clear');
      }
    }

    const info = world.columnInfo(Math.floor(player.x), Math.floor(player.z));
    const snowy = info.biome === 'snowy' || (info.biome === 'mountain' && player.y > 82);
    const showSnow = this.type === 'snow' || (snowy && this.isRaining);
    const showRain = this.isRaining && !snowy;

    if (this.rain) this.rain.visible = showRain;
    if (this.snow) this.snow.visible = showSnow;

    if (showRain) this._updateRain(dt, player);
    if (showSnow) this._updateSnow(dt, player);

    // 雷暴：闪电 + 雷声
    if (this.type === 'thunder') {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.thunderTimer = 7 + Math.random() * 14;
        this.flash = 1;
        this.game.sound?.play('thunder', { volume: 0.7 });
        this._strikeNear(player, world);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);

    // 火焰寿命与伤害
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (f.t <= 0) {
        if (world.getBlock(f.x, f.y, f.z) === BLOCK.FIRE) world.setBlock(f.x, f.y, f.z, 0);
        this.fires.splice(i, 1);
      }
    }
    const px = Math.floor(player.x);
    const pz = Math.floor(player.z);
    const py = Math.floor(player.y + 0.1);
    if (world.getBlock(px, py, pz) === BLOCK.FIRE || world.getBlock(px, py + 1, pz) === BLOCK.FIRE) {
      this.fireDamageTimer += dt;
      if (this.fireDamageTimer >= 1) {
        this.fireDamageTimer = 0;
        player.damage(1, '被烧死了');
      }
    } else {
      this.fireDamageTimer = 0;
    }

    if (this.game.renderer) {
      this.game.renderer.weatherFactor = this.isRaining || this.type === 'snow' ? 1 : 0;
      this.game.renderer.flashFactor = this.flash;
    }
    const overlay = document.getElementById('lightning-overlay');
    if (overlay) overlay.style.opacity = String(Math.min(0.6, this.flash * 0.6));
  }

  _updateRain(dt, player) {
    const arr = this.rain.geometry.attributes.position.array;
    const cx = player.x;
    const cy = player.y;
    const cz = player.z;
    const rainCount = Math.max(60, Math.floor(RAIN_COUNT * this.rainDensity));
    this.rain.geometry.setDrawRange(0, rainCount * 2);
    for (let i = 0; i < rainCount; i++) {
      const d = this.rainDrops[i];
      d.y -= 26 * dt;
      if (d.y < -8) {
        d.y = 20 + Math.random() * 6;
        d.x = (Math.random() - 0.5) * RAIN_RADIUS * 2;
        d.z = (Math.random() - 0.5) * RAIN_RADIUS * 2;
      }
      const x = cx + d.x;
      const y = cy + d.y;
      const z = cz + d.z;
      const o = i * 6;
      arr[o] = x;
      arr[o + 1] = y;
      arr[o + 2] = z;
      arr[o + 3] = x;
      arr[o + 4] = y + 0.65;
      arr[o + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  _updateSnow(dt, player) {
    const arr = this.snow.geometry.attributes.position.array;
    const t = performance.now() * 0.001;
    const snowCount = Math.max(40, Math.floor(SNOW_COUNT * this.rainDensity));
    this.snow.geometry.setDrawRange(0, snowCount);
    for (let i = 0; i < snowCount; i++) {
      const f = this.snowFlakes[i];
      f.y -= 2.2 * dt;
      f.x += Math.sin(t * 0.8 + f.phase) * 0.35 * dt;
      if (f.y < -6) {
        f.y = 18 + Math.random() * 8;
        f.x = (Math.random() - 0.5) * RAIN_RADIUS * 2;
        f.z = (Math.random() - 0.5) * RAIN_RADIUS * 2;
      }
      const o = i * 3;
      arr[o] = player.x + f.x;
      arr[o + 1] = player.y + f.y;
      arr[o + 2] = player.z + f.z;
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
  }

  serialize() {
    return { type: this.type, timer: this.timer };
  }

  load(data) {
    if (!data || typeof data.type !== 'string') return;
    this.setType(data.type);
    if (typeof data.timer === 'number') this.timer = data.timer;
  }

  clear() {
    this.type = 'clear';
    this.flash = 0;
    if (this.rain) this.rain.visible = false;
    if (this.snow) this.snow.visible = false;
    this.game.sound?.stopRain();
    const overlay = document.getElementById('lightning-overlay');
    if (overlay) overlay.style.opacity = '0';
  }
}
