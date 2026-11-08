// ============================================================
// main.js — 游戏入口：界面状态机、输入、循环、存档、资源包
// ============================================================

import * as THREE from 'three';
import { World, BIOME_NAMES, CHUNK_H, NETHER_ORIGIN, NETHER_DEST, NETHER_FORTRESS, END_ORIGIN, END_DEST, END_SHIP } from './world.js';
import { Renderer } from './render.js';
import { Player } from './player.js';
import { Inventory, InventoryUI, makeHudIcons } from './inventory.js';
import { SoundEngine } from './sound.js';
import { ItemEntityManager } from './items.js';
import { MobManager } from './mobs.js';
import { BLOCK, getBlockDef, itemDisplay, getItem, isWaterLike } from './blocks.js';
import * as RP from './resourcepack.js';
import { ChatUI } from './chat.js';
import { ContainerManager, ContainerUI } from './containers.js';
import { WeatherManager } from './weather.js';
import { Achievements, ACHIEVEMENTS } from './achievements.js';
import { PlayerModel } from './player-model.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const SAVE_KEY = 'mcweb.save.v1';
const SETTINGS_KEY = 'mcweb.settings.v1';
const DAY_LENGTH = 600;

const state = {
  running: false,
  loading: false,
  loadingDone: false,
  paused: false,
  world: null,
  renderer: null,
  player: null,
  inventory: null,
  invUI: null,
  sound: null,
  hudIcons: null,
  items: null,
  mobs: null,
  chat: null,
  containers: null,
  containerUI: null,
  weather: null,
  achievements: null,
  discoverTimer: 0,
  tradeOpen: false,
  tradeMob: null,
  enchantOpen: false,
  brewOpen: false,
  signEditing: null,
  fishing: null,
  nameMob: null,
  enchantTable: null,
  lecternOpen: false,
  campfireTimers: [],
  beaconOpen: false,
  achievementsOpen: false,
  stats: { blocks: 0, mobs: 0, deaths: 0, playTime: 0 },
  inNether: false,
  inEnd: false,
  endReturn: null,
  portalCooldown: 0,
  portalTimer: 0,
  netherReturn: null,
  villagerTimer: 0,
  playerModel: null,
  thirdPerson: false,
  qualityScale: 1,
  qualityTimer: 0,
  baseDistance: 3,
  adaptiveDistance: 3,
  isTouch: false,
  settings: { sens: 1, distance: 3, volume: 0.7, mute: false, debug: false },
  overlayReturn: 'title',
  lastTime: 0,
  fps: 0,
  fpsFrames: 0,
  fpsClock: 0,
  saveClock: 0,
  toastTimer: 0,
  lastSpace: 0,
  loadingTip: 0,
};

// ---------------- 小工具 ----------------
function showScreen(name) {
  for (const id of ['title', 'loading', 'pause', 'settings', 'help', 'inventory', 'death']) {
    const el = $('screen-' + id);
    if (el) el.classList.toggle('hidden', id !== name);
  }
}

function isPortalFrameAt(x0, y0, z0, axis) {
  const w = state.world;
  if (!w) return false;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      const x = axis === 'x' ? x0 + i : x0;
      const z = axis === 'x' ? z0 : z0 + i;
      const id = w.getBlock(x, y0 + j, z);
      const border = i === 0 || i === 3 || j === 0 || j === 4;
      if (border ? id !== BLOCK.OBSIDIAN : id !== BLOCK.AIR) return false;
    }
  }
  return true;
}

function tryLightPortal(cx, cy, cz) {
  const w = state.world;
  if (!w) return false;
  for (const axis of ['x', 'z']) {
    for (let ox = -3; ox <= 0; ox++) {
      for (let oy = -4; oy <= 0; oy++) {
        const x0 = axis === 'x' ? cx + ox : cx;
        const z0 = axis === 'z' ? cz + ox : cz;
        const y0 = cy + oy;
        if (!isPortalFrameAt(x0, y0, z0, axis)) continue;
        for (let i = 1; i < 3; i++) {
          for (let j = 1; j < 4; j++) {
            const x = axis === 'x' ? x0 + i : x0;
            const z = axis === 'x' ? z0 : z0 + i;
            w.setBlock(x, y0 + j, z, BLOCK.NETHER_PORTAL);
          }
        }
        state.sound?.play('open', { volume: 0.6, pitch: 0.6 });
        showToast('下界传送门已激活');
        return true;
      }
    }
  }
  return false;
}

function buildNetherArrival() {
  const w = state.world;
  const x = NETHER_DEST.x;
  const z = NETHER_DEST.z;
  const y = 41;
  for (let cx = (x >> 4) - 1; cx <= (x >> 4) + 1; cx++) {
    for (let cz = (z >> 4) - 1; cz <= (z >> 4) + 1; cz++) w.ensureChunk(cx, cz);
  }
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      w.setBlock(x + dx, y - 1, z + dz, BLOCK.OBSIDIAN);
      for (let dy = 0; dy <= 4; dy++) w.setBlock(x + dx, y + dy, z + dz, 0);
    }
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      const border = i === 0 || i === 3 || j === 0 || j === 4;
      w.setBlock(x - 2 + i, y + j, z, border ? BLOCK.OBSIDIAN : BLOCK.NETHER_PORTAL);
    }
  }
  return { x: x + 0.5, y, z: z + 2.5 };
}

function enterNether() {
  const p = state.player;
  if (!p) return;
  state.netherReturn = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
  const dest = buildNetherArrival();
  p.setPosition(dest.x, dest.y, dest.z);
  p.yaw = 0;
  p.pitch = 0;
  state.inNether = true;
  state.portalCooldown = 3;
  state.renderer?.setNether(true);
  state.renderer?.setEnd(false);
  state.achievements?.onEvent('discover', { kind: 'nether' });
  state.chat?.log('你穿过传送门，进入了下界');
  if (state.weather) {
    try { state.weather.clear(); } catch (e) { /* ignore */ }
  }
  updateHUD();
  saveGame();
}

function exitNether() {
  const p = state.player;
  if (!p) return;
  const r = state.netherReturn;
  if (r) {
    p.setPosition(r.x, r.y + 0.2, r.z);
    if (typeof r.yaw === 'number') p.yaw = r.yaw;
  } else {
    p.setPosition(p.spawn.x, p.spawn.y + 0.5, p.spawn.z);
  }
  state.inNether = false;
  state.portalCooldown = 3;
  state.renderer?.setNether(false);
  state.chat?.log('你回到了主世界');
  updateHUD();
  saveGame();
}

function buildEndArrival() {
  const w = state.world;
  const x = END_DEST.x;
  const z = END_DEST.z;
  const y = 60;
  for (let cx = (x >> 4) - 1; cx <= (x >> 4) + 1; cx++) {
    for (let cz = (z >> 4) - 1; cz <= (z >> 4) + 1; cz++) w.ensureChunk(cx, cz);
  }
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      w.setBlock(x + dx, y, z + dz, BLOCK.END_STONE);
      for (let dy = 1; dy <= 5; dy++) w.setBlock(x + dx, y + dy, z + dz, 0);
    }
  }
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      w.setBlock(x + dx, y + 1, z + 2 + dz, edge ? BLOCK.END_PORTAL_FRAME : BLOCK.END_PORTAL);
    }
  }
  return { x: x + 0.5, y: y + 1, z: z - 2.5 };
}

function enterEnd() {
  const p = state.player;
  if (!p) return;
  state.endReturn = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
  const dest = buildEndArrival();
  p.setPosition(dest.x, dest.y, dest.z);
  p.yaw = Math.PI;
  p.pitch = 0;
  state.inEnd = true;
  state.portalCooldown = 3;
  state.renderer?.setEnd(true);
  if (state.mobs && !state.mobs.mobs.some((m) => m.type === 'ender_dragon')) {
    const dragon = state.mobs.spawn('ender_dragon', dest.x, dest.y + 7, dest.z + 4);
    if (dragon) {
      state.chat?.log('末地中央盘踞着末影龙……');
    }
  }
  state.achievements?.onEvent('discover', { kind: 'end' });
  state.chat?.log('你穿过末地传送门，进入了末地');
  if (state.weather) {
    try { state.weather.clear(); } catch (e) { /* ignore */ }
  }
  updateHUD();
  saveGame();
}

function exitEnd() {
  const p = state.player;
  if (!p) return;
  const r = state.endReturn;
  if (r) {
    p.setPosition(r.x, r.y + 0.2, r.z);
    if (typeof r.yaw === 'number') p.yaw = r.yaw;
  } else {
    p.setPosition(p.spawn.x, p.spawn.y + 0.5, p.spawn.z);
  }
  state.inEnd = false;
  state.portalCooldown = 3;
  state.renderer?.setEnd(false);
  state.chat?.log('你回到了主世界');
  updateHUD();
  saveGame();
}

function checkPortal() {
  if (!state.running || state.paused || state.loading || state.portalCooldown > 0) return;
  const p = state.player;
  const w = state.world;
  if (!p || !w || p.dead) return;
  const bx = Math.floor(p.x);
  const bz = Math.floor(p.z);
  const feet = Math.floor(p.y + 0.1);
  const head = Math.floor(p.y + 1.5);
  const endPortal = w.getBlock(bx, feet, bz) === BLOCK.END_PORTAL || w.getBlock(bx, head, bz) === BLOCK.END_PORTAL;
  if (endPortal) {
    if (state.inEnd) exitEnd();
    else enterEnd();
    return;
  }
  if (w.getBlock(bx, feet, bz) === BLOCK.NETHER_PORTAL || w.getBlock(bx, head, bz) === BLOCK.NETHER_PORTAL) {
    if (state.inNether) exitNether();
    else enterNether();
  }
}

const PROFESSIONS = {
  farmer: {
    name: '农民',
    trades: [
      { cost: { id: 'wheat', count: 8 }, result: { id: 'emerald', count: 1 } },
      { cost: { id: 'emerald', count: 1 }, result: { id: 'bread', count: 4 } },
      { cost: { id: 'emerald', count: 3 }, result: { id: 'diamond', count: 1 } },
      { cost: { id: 'coal', count: 12 }, result: { id: 'emerald', count: 1 } },
    ],
    extras: [
      { cost: { id: 'emerald', count: 2 }, result: { id: 'apple', count: 8 } },
      { cost: { id: 'emerald', count: 5 }, result: { id: 'diamond', count: 2 } },
    ],
  },
  librarian: {
    name: '图书管理员',
    trades: [
      { cost: { id: 'emerald', count: 1 }, result: { id: 'book', count: 2 } },
      { cost: { id: 'emerald', count: 2 }, result: { id: 'bookshelf', count: 1 } },
      { cost: { id: 'emerald', count: 4 }, result: { id: 'diamond', count: 1 } },
      { cost: { id: 'book', count: 4 }, result: { id: 'emerald', count: 1 } },
    ],
    extras: [
      { cost: { id: 'book', count: 2 }, result: { id: 'emerald', count: 2 } },
      { cost: { id: 'emerald', count: 6 }, result: { id: 'name_tag', count: 1 } },
    ],
  },
  blacksmith: {
    name: '铁匠',
    trades: [
      { cost: { id: 'coal', count: 12 }, result: { id: 'emerald', count: 1 } },
      { cost: { id: 'emerald', count: 1 }, result: { id: 'iron_ingot', count: 3 } },
      { cost: { id: 'emerald', count: 4 }, result: { id: 'diamond', count: 1 } },
      { cost: { id: 'iron_ingot', count: 6 }, result: { id: 'emerald', count: 1 } },
    ],
    extras: [
      { cost: { id: 'emerald', count: 3 }, result: { id: 'iron_pickaxe', count: 1 } },
      { cost: { id: 'emerald', count: 8 }, result: { id: 'diamond_pickaxe', count: 1 } },
    ],
  },
};

function currentTrades() {
  const prof = state.tradeMob && state.tradeMob.profession;
  const data = PROFESSIONS[prof] || PROFESSIONS.farmer;
  const level = state.tradeMob && state.tradeMob.tradeLevel ? state.tradeMob.tradeLevel : 1;
  const extras = (data.extras || []).slice(0, Math.max(0, level - 1));
  return data.trades.concat(extras);
}

function tradeTitle() {
  const mob = state.tradeMob;
  const prof = mob && mob.profession;
  const data = PROFESSIONS[prof];
  const level = mob && mob.tradeLevel ? mob.tradeLevel : 1;
  return (data ? data.name : '村民') + ' Lv.' + level + ' 交易';
}

const BREWS = [
  { id: 'potion_healing', name: '治疗药水', ingredient: 'rose', desc: '恢复 6 点生命' },
  { id: 'potion_strength', name: '力量药水', ingredient: 'beef', desc: '20 秒攻击 +3' },
  { id: 'potion_speed', name: '迅捷药水', ingredient: 'feather', desc: '20 秒移速 +35%' },
  { id: 'potion_fire_resist', name: '抗火药水', ingredient: 'coal', desc: '30 秒免疫火焰/岩浆' },
  { id: 'potion_night_vision', name: '夜视药水', ingredient: 'gold_ingot', desc: '60 秒夜视' },
  { id: 'potion_jump', name: '跳跃药水', ingredient: 'apple', desc: '30 秒跳跃力 +35%' },
  { id: 'potion_regen', name: '再生药水', ingredient: 'nether_wart', desc: '12 秒缓慢回血' },
];

const LECTERN_PAGES = [
  '很久以前，这片土地由巨龙守护。\n勇者们穿过黑曜石之门，在末地打败了它。',
  '传说远古城市的地下埋藏着会发光的幽匿，\n它们能听见最轻的脚步声。',
  '村民之间流传着一句话：\n“别在雷雨天站在山顶上。”',
  '一位矿工写道：\n“向下挖到第十层时，我听见了岩浆的呼吸。”',
];

function useCampfire(hit) {
  const p = state.player;
  if (!p) return;
  const cooked = {
    beef: 'cooked_beef',
    porkchop: 'cooked_porkchop',
    chicken: 'cooked_chicken',
    cod: 'cooked_cod',
  };
  const held = p.inventory && p.inventory.held;
  if (held && cooked[held.id]) {
    const out = cooked[held.id];
    if (p.mode === 'survival') p.inventory.consumeHeld(1);
    state.campfireTimers.push({ t: 5, out, x: hit.x + 0.5, y: hit.y + 0.6, z: hit.z + 0.5 });
    state.chat?.log('食物放上了营火……');
    state.sound?.play('pop', { volume: 0.3 });
    state.onInventoryChange?.();
    return;
  }
  showToast('营火噼啪作响（拿着生肉/鱼右键可烤）');
  state.sound?.play('pop', { volume: 0.2 });
}

function ringBell(hit) {
  state.sound?.play('open', { volume: 0.7, pitch: 0.35 });
  state.chat?.log('🔔 钟声响起，村民们四散躲避！');
  if (state.mobs && state.mobs.mobs) {
    for (const mob of state.mobs.mobs) {
      if (!mob || mob.type !== 'villager' || mob.removed) continue;
      if (Math.hypot(mob.x - hit.x, mob.z - hit.z) > 24) continue;
      mob.ai.flee = 6;
      mob.ai.fleeX = hit.x;
      mob.ai.fleeZ = hit.z;
    }
  }
}

function openLectern() {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (state.lecternOpen) return;
  state.lecternOpen = true;
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-lectern').classList.remove('hidden');
  const el = $('lectern-text');
  if (el) el.textContent = LECTERN_PAGES[Math.floor(Math.random() * LECTERN_PAGES.length)];
}

function closeLectern() {
  if (!state.lecternOpen) return;
  state.lecternOpen = false;
  state.paused = false;
  $('screen-lectern').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
}

function openAchievements() {
  if (!state.running || state.loading || !state.player) return;
  if (state.achievementsOpen) return;
  state.achievementsOpen = true;
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-achievements').classList.remove('hidden');
  const ach = state.achievements;
  const list = $('achievement-list');
  const done = ACHIEVEMENTS.filter((a) => ach && ach.has(a.id)).length;
  $('achievement-progress').textContent = '已完成 ' + done + ' / ' + ACHIEVEMENTS.length;
  if (list) {
    list.innerHTML = ACHIEVEMENTS.map((a) => {
      const unlocked = ach && ach.has(a.id);
      return '<div class="ach-item ' + (unlocked ? 'done' : '') + '">'
        + '<span class="ach-icon">' + (unlocked ? '🏆' : '🔒') + '</span>'
        + '<div><div class="ach-name">' + a.name + '</div><div class="ach-desc">' + a.desc + '</div></div>'
        + '</div>';
    }).join('');
  }
  const st = state.stats || { blocks: 0, mobs: 0, deaths: 0, playTime: 0 };
  const mins = Math.floor(st.playTime / 60);
  const secs = Math.floor(st.playTime % 60);
  $('stats-box').textContent = '挖掘方块：' + st.blocks + '　击杀生物：' + st.mobs
    + '　死亡次数：' + st.deaths + '　游戏时间：' + mins + ' 分 ' + secs + ' 秒';
}

function closeAchievements() {
  if (!state.achievementsOpen) return;
  state.achievementsOpen = false;
  state.paused = false;
  $('screen-achievements').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
}

function openBeacon() {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (state.beaconOpen) return;
  state.beaconOpen = true;
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-beacon').classList.remove('hidden');
}

function closeBeacon() {
  if (!state.beaconOpen) return;
  state.beaconOpen = false;
  state.paused = false;
  $('screen-beacon').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
}

function applyBeaconEffect(effect) {
  const p = state.player;
  if (!p) return;
  const names = { speed: '速度', strength: '力量', regen: '再生', haste: '急迫' };
  if (effect === 'speed') p.speedTimer = 120;
  else if (effect === 'strength') p.strengthTimer = 120;
  else if (effect === 'regen') p.regenTimer = 60;
  else if (effect === 'haste') p.hasteTimer = 120;
  state.chat?.log('信标光芒闪耀：获得「' + (names[effect] || effect) + '」效果！');
  state.achievements?.onEvent('beacon', {});
  state.sound?.play('craft', { volume: 0.6 });
  closeBeacon();
  updateHUD();
}

function trySummonWither(x, y, z) {
  const w = state.world;
  if (!w) return false;
  const S = BLOCK.SOUL_SAND;
  const K = BLOCK.WITHER_SKULL;
  const skulls = [[x - 1, y, z], [x, y, z], [x + 1, y, z]];
  const sands = [[x - 1, y - 1, z], [x, y - 1, z], [x + 1, y - 1, z], [x, y - 1, z - 1]];
  for (const [sx, sy, sz] of skulls) if (w.getBlock(sx, sy, sz) !== K) return false;
  for (const [sx, sy, sz] of sands) if (w.getBlock(sx, sy, sz) !== S) return false;
  for (const [sx, sy, sz] of skulls) w.setBlock(sx, sy, sz, 0);
  for (const [sx, sy, sz] of sands) w.setBlock(sx, sy, sz, 0);
  const wither = state.mobs?.spawn('wither', x + 0.5, y - 1, z + 0.5);
  if (wither) {
    state.chat?.log('凋灵被召唤了！');
    state.sound?.play('thunder', { volume: 0.5 });
    return true;
  }
  return false;
}

function trySummonGolem(x, y, z) {
  const w = state.world;
  if (!w) return false;
  const B = BLOCK.IRON_BLOCK;
  if (w.getBlock(x, y - 1, z) !== B) return false;
  if (w.getBlock(x, y - 2, z) !== B) return false;
  if (w.getBlock(x - 1, y - 2, z) !== B) return false;
  if (w.getBlock(x + 1, y - 2, z) !== B) return false;
  w.setBlock(x, y, z, 0);
  w.setBlock(x, y - 1, z, 0);
  w.setBlock(x, y - 2, z, 0);
  w.setBlock(x - 1, y - 2, z, 0);
  w.setBlock(x + 1, y - 2, z, 0);
  const golem = state.mobs?.spawn('iron_golem', x + 0.5, y - 1, z + 0.5);
  if (golem) {
    state.chat?.log('铁傀儡被召唤了！');
    state.achievements?.onEvent('golem', {});
    state.sound?.play('pop', { volume: 0.5 });
    return true;
  }
  return false;
}

function ensureVillageDefense() {
  const p = state.player;
  const w = state.world;
  const mobs = state.mobs;
  if (!p || !w || !mobs) return;
  let villager = null;
  for (const m of mobs.mobs) {
    if (m.type === 'villager' && !m.removed) {
      villager = m;
      break;
    }
  }
  if (!villager) return;
  let hostileNear = false;
  for (const m of mobs.mobs) {
    if (!m || m.removed || !m.def || !m.def.hostile) continue;
    if (Math.hypot(m.x - villager.x, m.z - villager.z) < 24) {
      hostileNear = true;
      break;
    }
  }
  if (!hostileNear) return;
  if (mobs.mobs.some((m) => m.type === 'iron_golem' && !m.removed)) return;
  const x = Math.floor(villager.x + (Math.random() - 0.5) * 8);
  const z = Math.floor(villager.z + (Math.random() - 0.5) * 8);
  const y = w.getSurfaceY(x, z) + 1;
  const golem = mobs.spawn('iron_golem', x + 0.5, y, z + 0.5);
  if (golem) state.chat?.log('村庄陷入危险，铁傀儡苏醒了！');
}

function launchFirework() {
  const p = state.player;
  if (!p || !state.inventory) return;
  if (state.inventory.countOf('firework_rocket') <= 0) return;
  state.inventory.remove('firework_rocket', 1);
  const dir = p.forwardVector();
  const x = p.x + dir.x * 3;
  const z = p.z + dir.z * 3;
  const y = p.y + 7;
  if (state.renderer) {
    const colors = [BLOCK.WOOL, BLOCK.GLOWSTONE, BLOCK.BRICK, BLOCK.LEAVES];
    for (let i = 0; i < 8; i++) {
      state.renderer.spawnBreakParticles(
        x + (Math.random() - 0.5) * 3,
        y + (Math.random() - 0.5) * 2,
        z + (Math.random() - 0.5) * 3,
        colors[i % colors.length],
      );
    }
  }
  state.sound?.play('thunder', { volume: 0.25 });
  state.chat?.log('🎆 烟花绽放！');
  updateHUD();
}

function startFishing() {
  const p = state.player;
  const w = state.world;
  if (!p || !w || state.fishing) return;
  const held = p.inventory && p.inventory.held;
  if (!held || held.id !== 'fishing_rod') return;
  const dir = p.forwardVector();
  const hit = w.raycast(p.x, p.eyeY(), p.z, dir.x, dir.y, dir.z, 24, true);
  if (!hit || !isWaterLike(hit.id)) {
    showToast('需要对着水面抛竿');
    return;
  }
  state.fishing = { timer: 2.5 + Math.random() * 4 };
  showToast('抛竿了…');
  state.sound?.play('splash', { volume: 0.35 });
}

function finishFishing() {
  state.fishing = null;
  const inv = state.inventory;
  if (!inv) return;
  const roll = Math.random();
  let id;
  let count = 1;
  if (roll < 0.7) {
    id = 'cod';
    count = 1 + Math.floor(Math.random() * 3);
  } else if (roll < 0.9) {
    id = ['stick', 'leather', 'bone', 'string'][Math.floor(Math.random() * 4)];
  } else {
    id = ['emerald', 'diamond', 'iron_ingot'][Math.floor(Math.random() * 3)];
  }
  inv.add(id, count);
  inv.damageHeld(1);
  state.sound?.play('splash', { volume: 0.6 });
  state.chat?.log('🎣 钓到了：' + itemDisplay(id) + ' ×' + count);
  showToast('钓到了！');
  state.achievements?.onEvent('fish', {});
  state.player?.addXp?.(2);
  updateHUD();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function openNameTagEditor(mob) {
  if (!state.running || state.loading || state.paused || !state.player || !mob) return;
  state.nameMob = mob;
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-name').classList.remove('hidden');
  const input = $('name-input');
  if (input) {
    input.value = mob.customName || '';
    setTimeout(() => input.focus(), 80);
  }
}

function closeNameTagEditor(save) {
  const mob = state.nameMob;
  if (!mob) return;
  if (save) {
    const input = $('name-input');
    const text = input ? input.value.trim() : '';
    if (text) {
      mob.customName = text.slice(0, 32);
      if (state.player.mode === 'survival') state.player.inventory.consumeHeld(1);
      state.chat?.log('已将该生物命名为：' + mob.customName);
    }
  }
  state.nameMob = null;
  state.paused = false;
  $('screen-name').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
  saveGame();
}

function renderMobLabels() {
  const box = $('mob-labels');
  const p = state.player;
  const camera = state.renderer && state.renderer.camera;
  if (!box || !p || !camera) return;
  if (!state.mobs || !state.mobs.mobs) {
    box.innerHTML = '';
    return;
  }
  const out = [];
  for (const mob of state.mobs.mobs) {
    if (!mob || mob.removed || !mob.customName) continue;
    const dist = Math.hypot(mob.x - p.x, mob.z - p.z);
    if (dist > 24) continue;
    const v = new THREE.Vector3(mob.x, mob.y + mob.height + 0.4, mob.z).project(camera);
    if (v.z > 1 || v.z < -1) continue;
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    out.push(`<div class="mob-label" style="left:${sx.toFixed(1)}px;top:${sy.toFixed(1)}px">${escapeHtml(mob.customName)}</div>`);
  }
  box.innerHTML = out.join('');
}

function openSignEditor(x, y, z) {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  state.signEditing = { x, y, z };
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-sign').classList.remove('hidden');
  const input = $('sign-input');
  if (input) {
    input.value = state.world ? state.world.getSign(x, y, z) : '';
    setTimeout(() => input.focus(), 80);
  }
}

function closeSignEditor(save) {
  if (!state.signEditing) return;
  const pos = state.signEditing;
  state.signEditing = null;
  if (save && state.world) {
    const text = $('sign-input') ? $('sign-input').value : '';
    state.world.setSign(pos.x, pos.y, pos.z, text);
    showToast(text ? '告示牌已保存' : '告示牌已清空');
  }
  state.paused = false;
  $('screen-sign').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
  saveGame();
}

function openBrew() {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (state.brewOpen) return;
  state.brewOpen = true;
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-brew').classList.remove('hidden');
  renderBrewOffers();
}

function closeBrew() {
  if (!state.brewOpen) return;
  state.brewOpen = false;
  state.paused = false;
  $('screen-brew').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
}

function renderBrewOffers() {
  const heldBox = $('brew-held');
  const box = $('brew-offers');
  if (!heldBox || !box || !state.inventory) return;
  const bottles = state.inventory.countOf('water_bottle');
  heldBox.textContent = `水瓶 ×${bottles} · 点击下方材料开始酿造`;
  box.innerHTML = BREWS.map((b, i) => {
    const ing = state.inventory.iconURL(b.ingredient);
    const out = state.inventory.iconURL(b.id);
    const ingCount = state.inventory.countOf(b.ingredient);
    return `<button class="trade-offer" data-brew="${i}">`
      + `<img src="${ing}" alt=""><span>×1</span>`
      + `<span class="trade-arrow">→</span>`
      + `<img src="${out}" alt=""><span>×1</span>`
      + `<span class="enchant-desc">${b.name} · ${b.desc}（材料 ${ingCount}）</span>`
      + `</button>`;
  }).join('');
}

function doBrew(index) {
  const brew = BREWS[index];
  if (!brew || !state.inventory) return;
  if (state.inventory.countOf('water_bottle') < 1) {
    showToast('需要 1 个水瓶');
    return;
  }
  if (state.inventory.countOf(brew.ingredient) < 1) {
    showToast('材料不足：需要 ' + itemDisplay(brew.ingredient));
    return;
  }
  state.inventory.remove('water_bottle', 1);
  state.inventory.remove(brew.ingredient, 1);
  state.inventory.add(brew.id, 1);
  state.sound?.play('craft', { volume: 0.55 });
  state.achievements?.onEvent('brew', {});
  showToast('酿造完成：' + brew.name);
  updateHUD();
  renderBrewOffers();
}

const ENCHANTS = [
  { id: 'efficiency', name: '效率', desc: '挖掘速度 +35%/级', cost: 3, kind: 'tool' },
  { id: 'sharpness', name: '锋利', desc: '攻击伤害 +1/级', cost: 5, kind: 'weapon' },
  { id: 'unbreaking', name: '耐久', desc: '耐久消耗概率减免', cost: 2, kind: 'tool' },
  { id: 'protection', name: '保护', desc: '受到伤害 -3%/级', cost: 4, kind: 'armor' },
  { id: 'fortune', name: '时运', desc: '矿石额外掉落', cost: 6, kind: 'pickaxe' },
];

const ENCHANT_NAMES = { efficiency: '效率', sharpness: '锋利', unbreaking: '耐久', protection: '保护', fortune: '时运' };

function enchantName(enchant) {
  return (ENCHANT_NAMES[enchant.id] || enchant.id) + ' ' + (['', 'I', 'II', 'III'][enchant.level] || enchant.level);
}

function shelfBonus() {
  const pos = state.enchantTable;
  const w = state.world;
  if (!pos || !w) return 0;
  let shelves = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (w.getBlock(pos.x + dx, pos.y + dy, pos.z + dz) === BLOCK.BOOKSHELF) shelves++;
      }
    }
  }
  return Math.min(3, Math.floor(shelves / 2));
}

function openEnchant(x, y, z) {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (state.enchantOpen) return;
  state.enchantTable = (typeof x === 'number') ? { x, y, z } : null;
  state.enchantOpen = true;
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-enchant').classList.remove('hidden');
  renderEnchantOffers();
}

function closeEnchant() {
  if (!state.enchantOpen) return;
  state.enchantOpen = false;
  state.enchantTable = null;
  state.paused = false;
  $('screen-enchant').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
}

function renderEnchantOffers() {
  const heldBox = $('enchant-held');
  const box = $('enchant-offers');
  if (!heldBox || !box) return;
  const h = state.inventory && state.inventory.held;
  const item = h ? getItem(h.id) : null;
  const tool = item && item.tool;
  const bonus = shelfBonus();
  heldBox.textContent = h
    ? `手持：${itemDisplay(h.id)}${h.enchant ? '（' + enchantName(h.enchant) + '）' : ''} · 经验等级 ${state.player ? state.player.xpLevel : 0}${bonus > 0 ? ' · 书架加成 -' + bonus : ''}`
    : '请手持工具或武器';
  box.innerHTML = ENCHANTS.map((e, i) => {
    let compatible;
    if (e.kind === 'weapon') compatible = !!tool && (tool.type === 'sword' || tool.type === 'axe');
    else if (e.kind === 'pickaxe') compatible = !!tool && tool.type === 'pickaxe';
    else if (e.kind === 'armor') compatible = !!(item && item.armor);
    else compatible = !!tool && tool.type !== 'sword';
    const current = h && h.enchant && h.enchant.id === e.id ? h.enchant.level : 0;
    const cost = Math.max(1, e.cost + current * 2 - bonus);
    const maxed = current >= 3;
    return `<button class="trade-offer" data-enchant="${i}" ${compatible && !maxed ? '' : 'disabled'}>`
      + `<span class="enchant-name">${e.name} ${maxed ? 'MAX' : ['I', 'II', 'III'][current]}</span>`
      + `<span class="enchant-desc">${e.desc}</span>`
      + `<span class="enchant-cost">${maxed ? '已满级' : cost + ' 级'}</span>`
      + `</button>`;
  }).join('');
}

function applyEnchant(index) {
  const offer = ENCHANTS[index];
  const h = state.inventory && state.inventory.held;
  if (!offer || !h) return;
  const item = getItem(h.id);
  if (!item) {
    showToast('请手持工具/武器/盔甲');
    return;
  }
  const tool = item.tool;
  let compatible;
  if (offer.kind === 'weapon') compatible = !!tool && (tool.type === 'sword' || tool.type === 'axe');
  else if (offer.kind === 'pickaxe') compatible = !!tool && tool.type === 'pickaxe';
  else if (offer.kind === 'armor') compatible = !!item.armor;
  else compatible = !!tool && tool.type !== 'sword';
  if (!compatible) {
    showToast('该附魔不适用于这件物品');
    return;
  }
  const current = h.enchant && h.enchant.id === offer.id ? h.enchant.level : 0;
  if (current >= 3) {
    showToast('该附魔已经满级');
    return;
  }
  const cost = Math.max(1, offer.cost + current * 2 - shelfBonus());
  if (!state.player || state.player.xpLevel < cost) {
    showToast('经验等级不足：需要 ' + cost + ' 级');
    return;
  }
  state.player.xpLevel -= cost;
  h.enchant = { id: offer.id, level: current + 1 };
  state.sound?.play('craft', { volume: 0.6 });
  state.achievements?.onEvent('enchant', {});
  showToast('附魔成功：' + offer.name + ' ' + ['I', 'II', 'III'][current]);
  updateHUD();
  renderEnchantOffers();
}

function renderTradeOffers() {
  const box = $('trade-offers');
  if (!box || !state.inventory) return;
  box.innerHTML = currentTrades().map((t, i) => {
    const a = state.inventory.iconURL(t.cost.id);
    const b = state.inventory.iconURL(t.result.id);
    return `<button class="trade-offer" data-index="${i}">`
      + `<img src="${a}" alt=""><span>×${t.cost.count}</span>`
      + `<span class="trade-arrow">→</span>`
      + `<img src="${b}" alt=""><span>×${t.result.count}</span>`
      + `</button>`;
  }).join('');
}

function openTrade(mob) {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (state.tradeOpen) return;
  state.tradeOpen = true;
  state.tradeMob = mob || null;
  const titleEl = $('trade-title');
  if (titleEl) titleEl.textContent = tradeTitle();
  state.paused = true;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  $('screen-trade').classList.remove('hidden');
  renderTradeOffers();
}

function closeTrade() {
  if (!state.tradeOpen) return;
  state.tradeOpen = false;
  state.tradeMob = null;
  state.paused = false;
  $('screen-trade').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
}

function doTrade(index) {
  const offer = currentTrades()[index];
  if (!offer || !state.inventory) return;
  if (state.inventory.countOf(offer.cost.id) < offer.cost.count) {
    showToast('材料不够：还需要 ' + offer.cost.count + ' 个' + itemDisplay(offer.cost.id));
    return;
  }
  state.inventory.remove(offer.cost.id, offer.cost.count);
  state.inventory.add(offer.result.id, offer.result.count);
  state.sound?.play('craft', { volume: 0.5 });
  state.achievements?.onEvent('trade', {});
  const trader = state.tradeMob;
  if (trader && trader.profession) {
    trader.tradeCount = (trader.tradeCount || 0) + 1;
    if (trader.tradeCount % 3 === 0 && (trader.tradeLevel || 1) < 3) {
      trader.tradeLevel = (trader.tradeLevel || 1) + 1;
      state.chat?.log('📈 村民升级到 Lv.' + trader.tradeLevel + '，解锁了新的交易！');
    }
    const titleEl = $('trade-title');
    if (titleEl) titleEl.textContent = tradeTitle();
  }
  showToast('交易完成：' + itemDisplay(offer.result.id) + ' ×' + offer.result.count);
  updateHUD();
  renderTradeOffers();
}

function showToast(msg, ms = 1900) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 220);
  }, ms);
}

function hideTouch(hide) {
  const el = $('touch');
  if (!el) return;
  if (!state.isTouch) {
    el.classList.add('hidden');
    return;
  }
  el.classList.toggle('hidden', hide);
}

function releasePointerLock() {
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch (e) {
    // ignore
  }
}

function requestLock() {
  if (state.isTouch) return;
  try {
    if (!document.pointerLockElement && canvas.requestPointerLock) {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {
    // ignore
  }
}

function tryFullscreen() {
  if (!state.isTouch) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      const r = document.documentElement.requestFullscreen();
      if (r && r.catch) r.catch(() => {});
    }
  } catch (e) {
    // ignore
  }
}

function activeGame() {
  return (
    state.running &&
    !state.loading &&
    !state.paused &&
    state.player &&
    !state.player.dead &&
    !(state.invUI && state.invUI.isOpen) &&
    !(state.containerUI && state.containerUI.isOpen)
  );
}

function resetControls() {
  if (!state.player) return;
  const c = state.player.controls;
  c.forward = c.back = c.left = c.right = c.jump = c.sneak = c.sprint = false;
  state.player.breakHeld = false;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (e) {
    // ignore
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') Object.assign(state.settings, s);
  } catch (e) {
    // ignore
  }
  state.settings.distance = Math.max(2, Math.min(5, state.settings.distance | 0 || 3));
}

function syncSettingsUI() {
  $('set-sens').value = String(state.settings.sens);
  $('set-distance').value = String(state.settings.distance);
  $('set-volume').value = String(state.settings.volume);
  $('set-mute').checked = !!state.settings.mute;
  $('set-debug').checked = !!state.settings.debug;
}

function applyRuntimeSettings() {
  if (state.player) state.player.lookSensitivity = 0.0024 * state.settings.sens;
  if (state.renderer) state.renderer.setRenderDistance(state.settings.distance);
  if (state.world) state.world.renderDistance = state.settings.distance;
  state.baseDistance = state.settings.distance;
  state.adaptiveDistance = state.settings.distance;
  if (state.sound) {
    state.sound.setMasterVolume(state.settings.volume);
    state.sound.setMuted(!!state.settings.mute);
  }
  $('debug').classList.toggle('hidden', !state.settings.debug);
  saveSettings();
}

// ---------------- 存档 ----------------
function saveGame() {
  if (!state.running || !state.world || !state.player || !state.inventory) return false;
  try {
    const data = {
      version: 1,
      seed: state.world.seed,
      mode: state.player.mode,
      time: state.world.time,
      mods: state.world.serializeMods(),
      player: state.player.saveState(),
      inventory: state.inventory.serialize(),
      containers: state.containers ? state.containers.serialize() : null,
      weather: state.weather ? state.weather.serialize() : null,
      achievements: state.achievements ? state.achievements.serialize() : [],
      stats: state.stats || null,
      crops: state.world ? state.world.serializeCrops() : [],
      signs: state.world ? state.world.serializeSigns() : [],
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    showToast('存档失败：本地存储空间不足');
    return false;
  }
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.seed !== 'number') return null;
    return data;
  } catch (e) {
    return null;
  }
}

function refreshContinueButton() {
  const btn = $('btn-continue');
  if (!btn) return;
  btn.classList.toggle('hidden', !readSave());
}

// ---------------- 开始 / 停止 ----------------
const LOADING_TIPS = [
  '提示：长按树干可以徒手砍木头，然后按 E 打开物品栏合成工作台。',
  '提示：工作台需要 4 块木板；镐子需要 3 块材料 + 2 根木棍。',
  '提示：手机左上角可以导入原版资源包，贴上 Mojang 原版贴图。',
  '提示：夜晚会变暗，火把可以照亮洞穴（挖煤矿做火把）。',
  '提示：创造模式可以双击空格 / 点 ✈ 开启飞行。',
  '提示：按 F3 可以看坐标、生物群系和朝向。',
];

function startGame(opts = {}) {
  const save = opts.save || null;
  const mode = save ? save.mode : opts.mode === 'creative' ? 'creative' : 'survival';
  const seed = save ? save.seed : typeof opts.seed === 'number' ? opts.seed : (Math.random() * 2 ** 31) | 0;

  stopGame(false);
  state.loading = true;
  state.loadingDone = false;
  state.paused = false;
  state._elytraChecked = false;
  showScreen('loading');
  $('hud').classList.add('hidden');
  hideTouch(true);
  $('progress-bar').style.width = '0%';
  state.loadingTip = Math.floor(Math.random() * LOADING_TIPS.length);
  $('loading-tip').textContent = LOADING_TIPS[state.loadingTip];

  const world = new World(seed, state.settings.distance, { noPlants: state.noPlants });
  state.world = world;
  if (save && save.mods) world.applyMods(save.mods);
  world.time = save && typeof save.time === 'number' ? save.time : 150;
  if (!save && typeof state.startTime === 'number' && isFinite(state.startTime)) {
    world.time = ((state.startTime % 600) + 600) % 600;
  }
  const spawn = world.findSpawn();

  const inventory = new Inventory({ mode });
  state.inventory = inventory;

  const renderer = new Renderer(canvas, world, {
    renderDistance: state.settings.distance,
    customTiles: RP.hasPack() ? RP.getCustomTiles() : null,
  });
  state.renderer = renderer;
  inventory.atlasCanvas = renderer.atlasCanvas;
  if (RP.hasPack()) inventory.customIcons = RP.getCustomIcons();

  const game = {
    world,
    renderer,
    scene: renderer.scene,
    inventory,
    sound: state.sound,
    mode,
    toast: (m) => showToast(m),
    onHealthChange: () => updateHUD(),
    onInventoryChange: () => {
      state.invUI?.refresh();
      updateHUD();
    },
    onDeath: (reason) => showDeath(reason),
    openCraftingTable: () => openInventory(3),
  };

  const player = new Player(game);
  state.player = player;

  const items = new ItemEntityManager({
    scene: renderer.scene,
    world,
    player,
    inventory,
    sound: state.sound,
  });
  state.items = items;
  game.items = items;
  game.dropItem = (id, x, y, z, count = 1) => items.spawn(id, x, y, z, count);
  game.explode = (x, y, z, power = 3) => explode(x, y, z, power);
  game.igniteTNT = (x, y, z) => igniteTNT(x, y, z);
  game.openTrade = (mob) => openTrade(mob);
  game.openEnchant = () => openEnchant();
  game.openBrew = () => openBrew();
  game.openSignEditor = (x, y, z) => openSignEditor(x, y, z);
  game.openNameTag = (mob) => openNameTagEditor(mob);
  game.startFishing = () => startFishing();
  game.launchFirework = () => launchFirework();
  game.useCampfire = (hit) => useCampfire(hit);
  game.trySummonGolem = (x, y, z) => trySummonGolem(x, y, z);
  game.trySummonWither = (x, y, z) => trySummonWither(x, y, z);
  game.openBeacon = () => openBeacon();
  game.onBlockMined = () => { state.stats.blocks += 1; };
  game.onMobKilled = () => { state.stats.mobs += 1; };
  game.onPlayerDeath = () => { state.stats.deaths += 1; };
  game.ringBell = (hit) => ringBell(hit);
  game.openLectern = (hit) => openLectern(hit);
  game.lightPortal = (x, y, z) => tryLightPortal(x, y, z);

  const mobs = new MobManager(game, {
    maxMobs: state.isTouch ? 14 : 24,
    dayLength: 600,
  });
  state.mobs = mobs;
  game.mobs = mobs;

  const containers = new ContainerManager({
    world,
    scene: renderer.scene,
    items,
    sound: state.sound,
    dropItem: game.dropItem,
  });
  state.containers = containers;
  game.containers = containers;
  const containerUI = new ContainerUI(containers, inventory, {
    sound: state.sound,
    onClose: () => {
      if (!state.running || state.paused) return;
      $('hud').classList.remove('hidden');
      if (state.isTouch) hideTouch(false);
    },
  });
  state.containerUI = containerUI;
  game.containerUI = containerUI;
  game.onContainerChange = () => containerUI.refreshIfOpen();
  game.openContainer = (hit) => openContainer(hit);
  game.sleepInBed = (hit) => sleepInBed(hit);
  if (save && save.containers) containers.load(save.containers);
  if (save && save.crops) world.loadCrops(save.crops);
  if (save && save.signs) world.loadSigns(save.signs);
  state.invUI = new InventoryUI(inventory, {
    sound: state.sound,
    onClose: onInventoryClosed,
  });
  state.chat = new ChatUI(game);
  game.invUI = state.invUI;
  game.chat = state.chat;
  game.onChatClose = () => {
    if (state.isTouch) hideTouch(false);
  };
  state.chat.log('欢迎来到 Minecraft Web！输入 /help 查看命令，T 键打开聊天。');

  const achievements = new Achievements(game);
  state.achievements = achievements;
  game.achievements = achievements;
  if (save && save.achievements) achievements.load(save.achievements);
  state.stats = save && save.stats
    ? { blocks: save.stats.blocks | 0, mobs: save.stats.mobs | 0, deaths: save.stats.deaths | 0, playTime: save.stats.playTime || 0 }
    : { blocks: 0, mobs: 0, deaths: 0, playTime: 0 };

  const playerModel = new PlayerModel(renderer.scene);
  state.playerModel = playerModel;
  renderer.setThirdPerson(state.thirdPerson);
  playerModel.setVisible(state.thirdPerson);

  const weather = new WeatherManager({
    scene: renderer.scene,
    world,
    player,
    sound: state.sound,
    renderer,
    chat: state.chat,
  });
  state.weather = weather;
  weather.setDensity(state.qualityScale);
  if (state.lightningDemo) {
    weather.setType('thunder');
    weather.thunderTimer = 0.5;
    state.lightningDemo = false;
  }
  game.weather = weather;
  if (save && save.weather) weather.load(save.weather);
  else if (state.weatherDemo && ['clear', 'rain', 'thunder', 'snow'].includes(state.weatherDemo)) {
    weather.setType(state.weatherDemo);
  }
  if (state.weatherDemo) weather.timer = 600;
  state.invUI.onCraft = (res) => {
    showToast('合成：' + itemDisplay(res.id));
    state.achievements?.onEvent('craft', { id: res.id });
  };

  if (save) {
    if (save.inventory) inventory.deserialize(save.inventory);
    player.loadState(save.player);
    if (save.player && save.player.spawn) player.spawn = { ...save.player.spawn };
    if (player.x >= NETHER_ORIGIN && player.x < END_ORIGIN) {
      state.inNether = true;
      renderer.setNether(true);
    }
    if (player.x >= END_ORIGIN) {
      state.inEnd = true;
      renderer.setEnd(true);
    }
    else player.spawn = { ...spawn };
    if (!save.player || typeof save.player.x !== 'number') {
      player.setPosition(spawn.x, spawn.y + 0.4, spawn.z);
    }
  } else {
    player.spawn = { ...spawn };
    player.setPosition(spawn.x, spawn.y + 0.4, spawn.z);
    if (mode === 'creative') {
      const starter = ['grass_block', 'dirt', 'stone', 'cobblestone', 'oak_planks', 'oak_log', 'glass', 'torch', 'crafting_table'];
      for (let i = 0; i < starter.length; i++) {
        inventory.setSlot(i, { id: starter[i], count: 64 });
      }
    }
  }

  inventory.mode = mode;
  if (!save && mode === 'survival' && state.giveStarter) {
    inventory.add('oak_log', 24);
    inventory.add('stick', 8);
    inventory.add('coal', 8);
    inventory.add('iron_ingot', 4);
  }
  if (!save && typeof state.startPitch === 'number' && isFinite(state.startPitch)) player.pitch = state.startPitch;
  if (!save && typeof state.startYaw === 'number' && isFinite(state.startYaw)) player.yaw = state.startYaw;
  player.lookSensitivity = 0.0024 * state.settings.sens;
  if (typeof state.startQuality === 'number') {
    state.qualityScale = state.startQuality;
    renderer.setQualityScale(state.startQuality);
  }
  if (state.startThirdPerson) {
    state.thirdPerson = true;
    renderer.setThirdPerson(true);
    playerModel.setVisible(true);
  }
  state.running = true;
  state.loading = true;
  state.loadingDone = false;
  state.lastTime = performance.now();
  state.saveClock = 0;
  state.fpsClock = 0;
  state.fpsFrames = 0;
  resetControls();
  updateHUD();
  $('btn-fly').classList.toggle('hidden', mode !== 'creative');

  try {
    state.sound.unlock().then(() => state.sound.startAmbience());
  } catch (e) {
    // ignore
  }
  updateDebug();
}

function stopGame(toTitle = true) {
  state.running = false;
  state.loading = false;
  state.loadingDone = false;
  state.paused = false;
  if (state.invUI) {
    state.invUI.isOpen = false;
    state.invUI = null;
  }
  if (state.renderer) {
    try {
      state.renderer.dispose();
    } catch (e) {
      // ignore
    }
    state.renderer = null;
  }
  if (state.weather) {
    try { state.weather.clear(); } catch (e) { /* ignore */ }
    state.weather = null;
  }
  state.achievements = null;
  if (state.playerModel) {
    try { state.playerModel.group.parent && state.playerModel.group.parent.remove(state.playerModel.group); } catch (e) { /* ignore */ }
    state.playerModel = null;
  }
  state.thirdPerson = false;
  if (state.containerUI) {
    state.containerUI.isOpen = false;
    state.containerUI = null;
  }
  if (state.containers) {
    state.containers.clear();
    state.containers = null;
  }
  if (state.chat) {
    state.chat.close();
    state.chat = null;
  }
  if (state.mobs) {
    try { state.mobs.clear(); } catch (e) { /* ignore */ }
    state.mobs = null;
  }
  if (state.items) {
    try { state.items.clear(); } catch (e) { /* ignore */ }
    state.items = null;
  }
  state.world = null;
  state.player = null;
  state.inventory = null;
  resetControls();
  $('hud').classList.add('hidden');
  hideTouch(true);
  releasePointerLock();
  try {
    state.sound?.stopAmbience();
  } catch (e) {
    // ignore
  }
  if (toTitle !== false) {
    showScreen('title');
    refreshContinueButton();
    onResize();
  }
}

// ---------------- 加载完成 ----------------
function updateLoading() {
  if (!state.renderer) return;
  const p = state.renderer.getLoadProgress();
  $('progress-bar').style.width = Math.round(p * 100) + '%';
  if (!state.loadingDone && p >= 0.8) {
    state.loadingDone = true;
    setTimeout(() => {
      if (!state.running || !state.loading) return;
      state.loading = false;
      showScreen('none');
      $('hud').classList.remove('hidden');
      if (state.isTouch) hideTouch(false);
      updateHUD();
      showToast(state.isTouch ? '左下摇杆移动，拖动屏幕转视角，⛏ 长按挖掘' : '点击画面锁定鼠标 · WASD 移动 · 左键挖掘 · 右键放置', 2600);
      if (state.openInvAfterLoad) {
        setTimeout(() => {
          if (state.running) openInventory(2);
        }, 500);
        state.openInvAfterLoad = false;
      }
      if (state.spawnDemoItems && state.items && state.player) {
        setTimeout(() => {
          const p = state.player;
          const f = p.forwardVector();
          const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
          const list = [
            ['oak_log', 3, -1.6],
            ['diamond', 2, 0],
            ['beef', 1, 1.6],
            ['clay_ball', 4, 3.2],
            ['birch_planks', 8, 4.8],
          ];
          for (const [id, n, sd] of list) {
            const x = p.x + f.x * 2.6 + right.x * sd;
            const z = p.z + f.z * 2.6 + right.z * sd;
            const gy = state.world.getSurfaceY(Math.floor(x), Math.floor(z));
            state.items.spawn(id, x, gy + 0.7, z, n);
          }
          state.chat?.log('演示掉落物已生成');
        }, 500);
        state.spawnDemoItems = false;
      }
      if (state.bedDemo && state.player) {
        state.bedDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 2.5);
            const z = Math.floor(p.z + f.z * 2.5);
            const gy = state.world.getSurfaceY(x, z);
            state.world.setBlock(x, gy + 1, z, BLOCK.BED);
            state.chat?.log('已放置测试床');
            sleepInBed({ x, y: gy + 1, z, id: BLOCK.BED });
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 700);
      }
      if (state.shieldDemo && state.player) {
        state.shieldDemo = false;
        setTimeout(() => {
          try {
            state.inventory.setSlot(0, { id: 'shield', count: 1 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            state.player.blockingTimer = 3;
            state.player.blockCd = 6;
            state.achievements?.onEvent('shield', {});
            state.chat?.log('演示：举起盾牌（3 秒内受到伤害 -70%）');
            updateHUD();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.achievementsDemo && state.player) {
        state.achievementsDemo = false;
        setTimeout(() => {
          try {
            state.stats.blocks = 128;
            state.stats.mobs = 9;
            state.stats.deaths = 1;
            state.stats.playTime = 754;
            state.achievements?.unlock('wood');
            state.achievements?.unlock('stone');
            state.achievements?.unlock('iron');
            openAchievements();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.mushroomDemo && state.player) {
        state.mushroomDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            let found = null;
            for (let r = 32; r <= 5200 && !found; r += 32) {
              for (let a = 0; a < 16 && !found; a++) {
                const ang = (a / 16) * Math.PI * 2;
                const x = Math.floor(p.x + Math.cos(ang) * r);
                const z = Math.floor(p.z + Math.sin(ang) * r);
                if (state.world.columnInfo(x, z).biome === 'mushroom_fields') found = { x, z };
              }
            }
            if (found) {
              let tx = (found.x >> 6) * 64 + 32;
              let tz = (found.z >> 6) * 64 + 32;
              if (state.world.columnInfo(tx, tz).biome !== 'mushroom_fields') {
                tx = found.x;
                tz = found.z;
              }
              const y = state.world.getSurfaceY(tx, tz);
              p.setPosition(tx + 0.5, y + 1.2, tz + 0.5);
              state.mobs?.spawn('mooshroom', tx + 0.5, y + 1, tz + 5.5);
              state.chat?.log('演示：已到达蘑菇岛（哞菇在附近）');
            } else {
              state.chat?.log('演示：附近没有找到蘑菇岛');
            }
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.pandaDemo && state.player) {
        state.pandaDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            let found = null;
            for (let r = 32; r <= 2400 && !found; r += 32) {
              for (let a = 0; a < 16 && !found; a++) {
                const ang = (a / 16) * Math.PI * 2;
                const x = Math.floor(p.x + Math.cos(ang) * r);
                const z = Math.floor(p.z + Math.sin(ang) * r);
                if (state.world.columnInfo(x, z).biome === 'bamboo_jungle') found = { x, z };
              }
            }
            if (found) {
              const y = state.world.getSurfaceY(found.x, found.z);
              p.setPosition(found.x + 0.5, y + 1.2, found.z + 0.5);
              const panda = state.mobs?.spawn('panda', found.x + 0.5, y + 1, found.z + 4.5);
              if (panda) state.chat?.log('演示：一只熊猫出现在竹林里');
            } else {
              state.chat?.log('演示：附近没有找到竹林');
            }
            state.inventory.add('bamboo', 8);
            state.onInventoryChange?.();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.biomeDemo && state.player) {
        const targetBiome = state.biomeDemo;
        state.biomeDemo = null;
        setTimeout(() => {
          try {
            const p = state.player;
            let found = null;
            for (let r = 32; r <= 2200 && !found; r += 32) {
              for (let a = 0; a < 16 && !found; a++) {
                const ang = (a / 16) * Math.PI * 2;
                const x = Math.floor(p.x + Math.cos(ang) * r);
                const z = Math.floor(p.z + Math.sin(ang) * r);
                if (state.world.columnInfo(x, z).biome === targetBiome) found = { x, z };
              }
            }
            if (found) {
              const y = state.world.getSurfaceY(found.x, found.z);
              p.setPosition(found.x + 0.5, y + 1.2, found.z + 0.5);
              state.chat?.log('演示：已到达 ' + (BIOME_NAMES[targetBiome] || targetBiome));
            } else {
              state.chat?.log('演示：附近没有找到目标群系');
            }
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.beaconDemo && state.player) {
        state.beaconDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 4);
            const z = Math.floor(p.z + f.z * 4);
            const gy = state.world.getSurfaceY(x, z);
            state.world.setBlock(x, gy + 1, z, BLOCK.BEACON);
            state.inventory.add('nether_star', 2);
            state.onInventoryChange?.();
            openBeacon();
            setTimeout(() => applyBeaconEffect('speed'), 1800);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.witherBossDemo && state.player) {
        state.witherBossDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 6);
            const z = Math.floor(p.z + f.z * 6);
            const gy = state.world.getSurfaceY(x, z) + 1;
            for (const [dx, dz] of [[-1, 0], [0, 0], [1, 0], [0, -1]]) {
              state.world.setBlock(x + dx, gy - 1, z + dz, BLOCK.SOUL_SAND);
            }
            for (const dx of [-1, 0, 1]) state.world.setBlock(x + dx, gy, z, BLOCK.WITHER_SKULL);
            trySummonWither(x, gy, z);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.fortressDemo && state.player) {
        state.fortressDemo = false;
        setTimeout(() => {
          try {
            enterNether();
            setTimeout(() => {
              const f = NETHER_FORTRESS;
              state.player.setPosition(f.x + 0.5, f.y + 1.2, f.z + 0.5);
              state.player.yaw = 0;
              state.player.pitch = 0;
              state.chat?.log('演示：已到达下界要塞（桥上有烈焰人）');
            }, 700);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.golemDemo && state.player) {
        state.golemDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 5);
            const z = Math.floor(p.z + f.z * 5);
            const gy = state.world.getSurfaceY(x, z) + 1;
            state.world.setBlock(x, gy, z, BLOCK.IRON_BLOCK);
            state.world.setBlock(x, gy + 1, z, BLOCK.IRON_BLOCK);
            state.world.setBlock(x - 1, gy, z, BLOCK.IRON_BLOCK);
            state.world.setBlock(x + 1, gy, z, BLOCK.IRON_BLOCK);
            state.world.setBlock(x, gy + 2, z, BLOCK.PUMPKIN);
            trySummonGolem(x, gy + 2, z);
            state.inventory.setSlot(0, { id: 'iron_block', count: 16 });
            state.inventory.setSlot(1, { id: 'pumpkin', count: 4 });
            state.inventory.notify();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.elytraDemo && state.player) {
        state.elytraDemo = false;
        setTimeout(() => {
          try {
            state.inventory.armor[1] = { id: 'elytra', count: 1 };
            state.inventory.notify();
            state.inventory.setSlot(0, { id: 'diamond_sword', count: 1, durability: 1561 });
            state.inventory.selectSlot(0);
            state.chat?.log('演示：已装备鞘翅（空中按跳跃可滑翔）');
            updateHUD();
            openInventory(2);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.shipDemo && state.player) {
        state.shipDemo = false;
        setTimeout(() => {
          try {
            enterEnd();
            setTimeout(() => {
              state.player.setPosition(END_SHIP.x + 0.5, END_SHIP.y + 1.2, END_SHIP.z + 3.5);
              state.player.yaw = 0;
              state.player.pitch = 0;
              state.chat?.log('演示：已到达末地船（宝箱里有鞘翅）');
            }, 700);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.potionDemo && state.player) {
        state.potionDemo = false;
        setTimeout(() => {
          try {
            state.inventory.setSlot(0, { id: 'potion_night_vision', count: 1 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            state.player.secondaryAction();
            state.chat?.log('演示：喝下夜视药水（60 秒）');
            updateHUD();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.endCityDemo && state.player) {
        state.endCityDemo = false;
        setTimeout(() => {
          try {
            enterEnd();
            const city = state.world.findNearestEndCity();
            setTimeout(() => {
              const p = state.player;
              p.setPosition(city.x + 0.5, city.y + 1.2, city.z + 6);
              p.yaw = 0;
              p.pitch = 0.08;
              state.chat?.log('演示：已到达末地城（塔内有宝箱与潜影贝）');
            }, 700);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.campfireDemo && state.player) {
        state.campfireDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const bx = Math.floor(p.x + f.x * 5);
            const bz = Math.floor(p.z + f.z * 5);
            const gy = state.world.getSurfaceY(bx, bz);
            state.world.setBlock(bx, gy + 1, bz, BLOCK.CAMPFIRE);
            state.world.setBlock(bx + Math.round(right.x * 2), gy + 1, bz + Math.round(right.z * 2), BLOCK.LECTERN);
            state.world.setBlock(bx - Math.round(right.x * 2), gy + 1, bz - Math.round(right.z * 2), BLOCK.BELL);
            state.inventory.add('beef', 4);
            state.inventory.setSlot(0, { id: 'beef', count: 4 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            state.onInventoryChange?.();
            state.chat?.log('演示：营火、讲台和钟已放置（拿生肉右键营火可烤）');
            setTimeout(() => useCampfire({ x: bx, y: gy + 1, z: bz }), 900);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.nameTagDemo && state.player) {
        state.nameTagDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const tx = p.x + f.x * 4;
            const tz = p.z + f.z * 4;
            const ty = state.world.getSurfaceY(Math.floor(tx), Math.floor(tz));
            const cow = state.mobs?.spawn('cow', tx, ty + 1, tz);
            if (cow) cow.customName = '牛牛';
            state.inventory.add('name_tag', 4);
            state.onInventoryChange?.();
            state.chat?.log('演示：给牛命名为「牛牛」');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.breedDemo && state.player) {
        state.breedDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const tx = p.x + f.x * 4;
            const tz = p.z + f.z * 4;
            const ty = state.world.getSurfaceY(Math.floor(tx), Math.floor(tz));
            const cow1 = state.mobs?.spawn('cow', tx - right.x * 1.5, ty + 1, tz - right.z * 1.5);
            const cow2 = state.mobs?.spawn('cow', tx + right.x * 1.5, ty + 1, tz + right.z * 1.5);
            state.inventory.add('wheat', 8);
            state.onInventoryChange?.();
            if (cow1) state.mobs.feed(cow1, 'wheat');
            if (cow2) {
              state.mobs.feed(cow2, 'wheat');
              state.chat?.log('演示：两只牛生出了一只幼崽');
            }
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.fireworkDemo && state.player) {
        state.fireworkDemo = false;
        setTimeout(() => {
          try {
            state.inventory.add('firework_rocket', 8);
            state.inventory.setSlot(1, { id: 'firework_rocket', count: 8 });
            state.inventory.selectSlot(1);
            state.inventory.notify();
            launchFirework();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.fishDemo && state.player) {
        state.fishDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 3);
            const z = Math.floor(p.z + f.z * 3);
            const gy = state.world.getSurfaceY(x, z);
            state.world.setBlock(x, gy + 1, z, BLOCK.WATER);
            state.inventory.setSlot(0, { id: 'fishing_rod', count: 1, durability: 64 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            p.pitch = -0.5;
            setTimeout(() => startFishing(), 600);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.signDemo && state.player) {
        state.signDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 4);
            const z = Math.floor(p.z + f.z * 4);
            const gy = state.world.getSurfaceY(x, z);
            state.world.setBlock(x, gy + 1, z, BLOCK.SIGN);
            state.world.setSign(x, gy + 1, z, 'Minecraft Web\n右键可以编辑告示牌');
            state.inventory.setSlot(0, { id: 'sign', count: 8 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            state.chat?.log('演示：已放置告示牌（右键可编辑）');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.dragonDemo && state.player) {
        state.dragonDemo = false;
        setTimeout(() => {
          try {
            enterEnd();
            state.player.pitch = 0.35;
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.endDemo && state.player) {
        state.endDemo = false;
        setTimeout(() => {
          try {
            enterEnd();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.fireDemo && state.player) {
        state.fireDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 4);
            const z = Math.floor(p.z + f.z * 4);
            const gy = state.world.getSurfaceY(x, z);
            state.world.setBlock(x, gy + 1, z, BLOCK.FIRE);
            state.chat?.log('演示：已放置火焰（闪电也会点燃）');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.netherDemo && state.player) {
        state.netherDemo = false;
        setTimeout(() => {
          try {
            enterNether();
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.armorDemo && state.player) {
        state.armorDemo = false;
        setTimeout(() => {
          try {
            state.inventory.armor = [
              { id: 'diamond_helmet', count: 1 },
              { id: 'diamond_chestplate', count: 1 },
              { id: 'diamond_leggings', count: 1 },
              { id: 'diamond_boots', count: 1 },
            ];
            state.inventory.setSlot(0, { id: 'diamond_sword', count: 1, durability: 1561 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            state.chat?.log('演示：已穿戴全套钻石盔甲（防御 20，减伤 80%）');
            openInventory(2);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.brewDemo && state.player) {
        state.brewDemo = false;
        setTimeout(() => {
          try {
            state.inventory.add('water_bottle', 4);
            state.inventory.add('rose', 8);
            state.inventory.add('beef', 8);
            state.inventory.add('feather', 8);
            state.onInventoryChange?.();
            openBrew();
            setTimeout(() => {
              doBrew(0);
              setTimeout(() => {
                closeBrew();
                state.inventory.setSlot(0, { id: 'potion_speed', count: 1 });
                state.inventory.selectSlot(0);
                state.inventory.notify();
                state.player.secondaryAction();
                updateHUD();
              }, 900);
            }, 1500);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.enchantDemo && state.player) {
        state.enchantDemo = false;
        setTimeout(() => {
          try {
            state.player.xpLevel = 12;
            state.inventory.setSlot(0, { id: 'iron_pickaxe', count: 1, durability: 250 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            updateHUD();
            openEnchant();
            setTimeout(() => applyEnchant(0), 1500);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 900);
      }
      if (state.tradeDemo && state.player) {
        state.tradeDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const tx = p.x + f.x * 3;
            const tz = p.z + f.z * 3;
            const ty = state.world.getSurfaceY(Math.floor(tx), Math.floor(tz));
            const villager = state.mobs?.spawn('villager', tx, ty + 1, tz);
            state.inventory.add('wheat', 32);
            state.inventory.add('emerald', 8);
            state.inventory.add('coal', 32);
            state.onInventoryChange?.();
            openTrade(villager);
            let n = 0;
            const timer = setInterval(() => {
              doTrade(0);
              n += 1;
              if (n >= 4) clearInterval(timer);
            }, 700);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 1000);
      }
      if (state.fenceDemo && state.player) {
        state.fenceDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const bx = Math.floor(p.x + f.x * 5);
            const bz = Math.floor(p.z + f.z * 5);
            for (let i = -2; i <= 2; i++) {
              const x = bx + Math.round(right.x * i);
              const z = bz + Math.round(right.z * i);
              const gy = state.world.getSurfaceY(x, z);
              state.world.setBlock(x, gy + 1, z, BLOCK.FENCE);
            }
            state.inventory.setSlot(0, { id: 'fence', count: 16 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            state.chat?.log('演示：已放置 5 格栅栏（高度 1.5 格，跳不过去）');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.doorDemo && state.player) {
        state.doorDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const bx = Math.floor(p.x + f.x * 6);
            const bz = Math.floor(p.z + f.z * 6);
            const gy = state.world.getSurfaceY(bx, bz);
            state.world.setBlock(bx, gy + 1, bz, BLOCK.DOOR_X);
            state.world.setBlock(bx + 2, gy + 1, bz, BLOCK.DOOR_X_OPEN);
            state.world.setBlock(bx + 4, gy + 1, bz, BLOCK.DOOR_Z);
            state.world.setBlock(bx + 4, gy + 1, bz - 2, BLOCK.DOOR_Z_OPEN);
            state.inventory.setSlot(0, { id: 'door', count: 16 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            state.chat?.log('演示：已放置关闭/打开的门（右键门可开合）');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.tntDemo && state.player) {
        state.tntDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const bx = Math.floor(p.x + f.x * 5);
            const bz = Math.floor(p.z + f.z * 5);
            const gy0 = state.world.getSurfaceY(bx, bz);
            for (let i = -1; i <= 1; i++) {
              const x = bx + Math.round(right.x * i * 2);
              const z = bz + Math.round(right.z * i * 2);
              const gy = (x === bx && z === bz) ? gy0 : state.world.getSurfaceY(x, z);
              state.world.setBlock(x, gy + 1, z, BLOCK.TNT);
            }
            igniteTNT(bx, gy0 + 1, bz);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.shearDemo && state.player) {
        state.shearDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            state.inventory.setSlot(0, { id: 'shears', count: 1, durability: 238 });
            state.inventory.setSlot(1, { id: 'bucket', count: 1 });
            state.inventory.setSlot(2, { id: 'water_bucket', count: 1 });
            state.inventory.setSlot(3, { id: 'lava_bucket', count: 1 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            const f = p.forwardVector();
            const tx = p.x + f.x * 3;
            const tz = p.z + f.z * 3;
            const ty = state.world.getSurfaceY(Math.floor(tx), Math.floor(tz));
            const sheep = state.mobs?.spawn('sheep', tx, ty + 1, tz);
            const n = state.mobs?.shearSheep(sheep) || 0;
            for (let i = 0; i < n; i++) state.items?.spawn('wool_white', tx, ty + 1.4, tz, 1);
            state.chat?.log(`演示：剪下 ${n} 个白色羊毛（60–120 秒后重新长毛）`);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.bowDemo && state.player) {
        state.bowDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            state.inventory.setSlot(0, { id: 'bow', count: 1 });
            state.inventory.setSlot(1, { id: 'arrow', count: 16 });
            state.inventory.selectSlot(0);
            state.inventory.notify();
            const f = p.forwardVector();
            const t = state.world.getSurfaceY(Math.floor(p.x + f.x * 6), Math.floor(p.z + f.z * 6));
            state.mobs?.spawn('pig', p.x + f.x * 6, t + 1, p.z + f.z * 6);
            p.startBowCharge();
            setTimeout(() => {
              p.bowCharge = 1;
              p.releaseBow();
              state.chat?.log('演示：已射出一箭');
            }, 1200);
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 800);
      }
      if (state.achDemo) {
        state.achDemo = false;
        const list = ['wood', 'workbench', 'pickaxe', 'stone', 'iron'];
        let ai = 0;
        setTimeout(() => {
          const timer = setInterval(() => {
            if (ai >= list.length) {
              clearInterval(timer);
              return;
            }
            state.achievements?.unlock(list[ai++]);
          }, 2500);
        }, 800);
      }
      if (state.waterDemo && state.player) {
        state.waterDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            const x = Math.floor(p.x + f.x * 3);
            const z = Math.floor(p.z + f.z * 3);
            const gy = state.world.getSurfaceY(x, z);
            state.world.setBlock(x, gy + 1, z, BLOCK.WATER);
            const lx = x + 3;
            state.world.setBlock(lx, gy + 1, z, BLOCK.LAVA);
            state.chat?.log('已放置水源与岩浆（水会流动并生成圆石）');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 700);
      }
      if (state.farmDemo && state.player) {
        state.farmDemo = false;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
            for (let i = 0; i < 4; i++) {
              const x = Math.floor(p.x + f.x * 3 + right.x * (i - 1.5));
              const z = Math.floor(p.z + f.z * 3 + right.z * (i - 1.5));
              const gy = state.world.getSurfaceY(x, z);
              state.world.setBlock(x, gy, z, BLOCK.FARMLAND);
              state.world.setBlock(x, gy + 1, z, BLOCK.WHEAT_0 + i);
              if (i >= 1) state.world.setBlock(x, gy + 2, z, 0);
            }
            state.chat?.log('已生成测试农田（4 个生长阶段）');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 700);
      }
      if (state.tpVillage || state.tpDungeon || state.tpMineshaft || state.tpTemple || state.tpIgloo || state.tpStronghold || state.tpMansion || state.tpMonument || state.tpRuin || state.tpCity || state.tpTrial) {
        setTimeout(() => {
          try {
            const p = state.player;
            let target = null;
            if (state.tpVillage) {
              const v = state.world.findNearestVillage(p.x, p.z);
              if (v) target = { x: v.centerX + 3.5, y: v.floorY + 2.2, z: v.centerZ + 3.5, label: `村庄 ${v.centerX}, ${v.floorY}, ${v.centerZ}` };
            }
            if (state.tpDungeon) {
              const d = state.world.findNearestDungeon(p.x, p.z);
              if (d) target = { x: d.x + 0.5, y: d.y + 0.2, z: d.z + 0.5, label: `地牢 ${d.x}, ${d.y}, ${d.z}` };
            }
            if (state.tpMineshaft) {
              const m = state.world.findNearestMineshaft(p.x, p.z);
              if (m) target = { x: m.centerX + 0.5, y: m.y + 0.2, z: m.centerZ + 0.5, label: `矿洞 ${m.centerX}, ${m.y}, ${m.centerZ}` };
            }
            if (state.tpTemple) {
              const m = state.world.findNearestTemple(p.x, p.z);
              if (m) {
                const tz = m.centerZ + 18;
                const gy = state.world.getSurfaceY(m.centerX, tz);
                target = { x: m.centerX + 0.5, y: gy + 1.3, z: tz + 0.5, label: `沙漠神殿 ${m.centerX}, ${m.floorY}, ${m.centerZ}` };
              }
            }
            if (state.tpTrial) {
              const m = state.world.findNearestTrialChamber(p.x, p.z);
              if (m) target = { x: m.centerX + 0.5, y: m.y + 1.2, z: m.centerZ + 5.5, label: `试炼密室 ${m.centerX}, ${m.y}, ${m.centerZ}` };
            }
            if (state.tpCity) {
              const m = state.world.findNearestAncientCity(p.x, p.z);
              if (m) target = { x: m.centerX + 0.5, y: m.y + 1.2, z: m.centerZ + 5.5, label: `远古城市 ${m.centerX}, ${m.y}, ${m.centerZ}` };
            }
            if (state.tpMonument) {
              const m = state.world.findNearestMonument(p.x, p.z);
              if (m) target = { x: m.centerX + 0.5, y: 68, z: m.centerZ + 16.5, label: `海底遗迹 ${m.centerX}, ${m.floorY}, ${m.centerZ}` };
            }
            if (state.tpRuin) {
              const m = state.world.findNearestRuinedPortal(p.x, p.z);
              if (m) {
                const tz = m.centerZ + 10;
                const gy = state.world.getSurfaceY(m.centerX, tz);
                target = { x: m.centerX + 0.5, y: gy + 1.3, z: tz + 0.5, label: `废弃传送门 ${m.centerX}, ${m.floorY}, ${m.centerZ}` };
              }
            }
            if (state.tpMansion) {
              const m = state.world.findNearestMansion(p.x, p.z);
              if (m) {
                const tz = m.centerZ + 18;
                const gy = state.world.getSurfaceY(m.centerX, tz);
                target = { x: m.centerX + 0.5, y: gy + 1.3, z: tz + 0.5, label: `林地府邸 ${m.centerX}, ${m.floorY}, ${m.centerZ}` };
              }
            }
            if (state.tpStronghold) {
              const m = state.world.findNearestStronghold(p.x, p.z);
              if (m) target = { x: m.centerX + 0.5, y: m.y + 1.2, z: m.centerZ + 5.5, label: `地下要塞 ${m.centerX}, ${m.y}, ${m.centerZ}` };
            }
            if (state.tpIgloo) {
              const m = state.world.findNearestIgloo(p.x, p.z);
              if (m) {
                const tz = m.centerZ + 12;
                const gy = state.world.getSurfaceY(m.centerX, tz);
                target = { x: m.centerX + 0.5, y: gy + 1.3, z: tz + 0.5, label: `雪屋 ${m.centerX}, ${m.floorY}, ${m.centerZ}` };
              }
            }
            if (target) {
              state.world.ensureChunk(Math.floor(target.x) >> 4, Math.floor(target.z) >> 4);
              p.setPosition(target.x, target.y, target.z);
              p.pitch = -0.12;
              state.chat?.log('已传送到 ' + target.label);
            } else {
              state.chat?.log('附近没有找到目标结构');
            }
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
          state.tpVillage = false;
          state.tpDungeon = false;
          state.tpMineshaft = false;
          state.tpTemple = false;
          state.tpIgloo = false;
          state.tpStronghold = false;
          state.tpMansion = false;
          state.tpMonument = false;
          state.tpRuin = false;
          state.tpCity = false;
          state.tpTrial = false;
        }, 900);
      }
      if (state.spawnTorches && state.player) {
        setTimeout(() => {
          const p = state.player;
          const spots = [
            [3, 0], [0, 3], [-3, 0], [0, -3],
            [6, 6], [-6, 6], [6, -6], [-6, -6],
          ];
          for (const [dx, dz] of spots) {
            const x = Math.floor(p.x) + dx;
            const z = Math.floor(p.z) + dz;
            const gy = state.world.getSurfaceY(x, z);
            state.world.setBlock(x, gy + 1, z, BLOCK.TORCH);
          }
          state.chat?.log('已放置测试火把');
        }, 600);
        state.spawnTorches = false;
      }
      if (state.guiDemo && state.player) {
        const guiType = state.guiDemo;
        state.guiDemo = null;
        setTimeout(() => {
          try {
            const p = state.player;
            const f = p.forwardVector();
            const x = Math.floor(p.x + f.x * 2.5);
            const z = Math.floor(p.z + f.z * 2.5);
            const gy = state.world.getSurfaceY(x, z);
            const y = gy + 1;
            const blockId = guiType === 'chest' ? BLOCK.CHEST : BLOCK.FURNACE;
            state.world.setBlock(x, y, z, blockId);
            if (guiType === 'chest') {
              const c = state.containers.ensureChest(x + ',' + y + ',' + z);
              c.slots[0] = { id: 'oak_log', count: 12 };
              c.slots[1] = { id: 'iron_ingot', count: 8 };
              c.slots[2] = { id: 'apple', count: 5 };
              c.slots[4] = { id: 'diamond', count: 2 };
            } else {
              const st = state.containers.ensureFurnace(x + ',' + y + ',' + z);
              st.input = { id: 'iron_ore', count: 5 };
              st.fuel = { id: 'coal', count: 3 };
            }
            openContainer({ x, y, z, id: blockId });
            state.chat?.log(guiType === 'chest' ? '已生成测试箱子' : '已生成测试熔炉（铁矿 + 煤炭）');
          } catch (e) {
            showError(e && e.stack ? e.stack : String(e));
          }
        }, 700);
      }
      if (state.spawnDemoMobs && state.mobs && state.player) {
        setTimeout(() => {
          const p = state.player;
          const f = p.forwardVector();
          const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
          const list = [
            ['zombie', 4.5, 0],
            ['pig', 3.5, 2.2],
            ['cow', 3.0, -2.2],
            ['creeper', 6.0, 1.5],
            ['sheep', 5.0, -1.5],
          ];
          let spawned = 0;
          for (const [type, fw, sd] of list) {
            const x = p.x + f.x * fw + right.x * sd;
            const z = p.z + f.z * fw + right.z * sd;
            const gy = state.world.getSurfaceY(Math.floor(x), Math.floor(z));
            const m = state.mobs.spawn(type, x, gy + 1.05, z);
            if (m) spawned++;
          }
          state.chat?.log('演示生物已生成 ' + spawned + ' 只，当前总数 ' + state.mobs.count());
        }, 700);
        state.spawnDemoMobs = false;
      }
    }, 320);
  }
}

// ---------------- HUD ----------------
function updateHUD() {
  const p = state.player;
  const icons = state.hudIcons;
  if (!p || !icons) return;
  let healthHTML = '';
  let hungerHTML = '';
  for (let i = 0; i < 10; i++) {
    const hv = p.health - i * 2;
    healthHTML += `<img class="stat-icon" src="${
      hv >= 2 ? icons.heartFull : hv >= 1 ? icons.heartHalf : icons.heartEmpty
    }" alt="">`;
    const fv = p.hunger - i * 2;
    hungerHTML += `<img class="stat-icon" src="${
      fv >= 2 ? icons.foodFull : fv >= 1 ? icons.foodHalf : icons.foodEmpty
    }" alt="">`;
  }
  $('health-row').innerHTML = healthHTML;
  $('hunger-row').innerHTML = hungerHTML;
  const held = state.inventory && state.inventory.held;
  $('held-name').textContent = held
    ? itemDisplay(held.id) + (held.count > 1 ? ' ×' + held.count : '') + (held.enchant ? ' · ' + enchantName(held.enchant) : '')
    : '';
  updateHandItem();
  const xpFill = $('xp-fill');
  const xpLevelEl = $('xp-level');
  if (xpFill && state.player) {
    const need = state.player.xpNeeded ? state.player.xpNeeded() : 7;
    xpFill.style.width = Math.round(Math.min(1, state.player.xp / Math.max(1, need)) * 100) + '%';
  }
  if (xpLevelEl && state.player) xpLevelEl.textContent = String(state.player.xpLevel);
  state.invUI?.renderHotbar();
}

function updateHandItem() {
  const el = $('hand-item');
  const img = $('hand-item-img');
  if (!el || !img) return;
  const held = state.inventory && state.inventory.held;
  if (!held || state.thirdPerson || !state.running) {
    el.classList.add('hidden');
    return;
  }
  const url = state.inventory.iconURL(held.id);
  if (!url) {
    el.classList.add('hidden');
    return;
  }
  img.src = url;
  el.classList.remove('hidden');
}

function swingHand() {
  const el = $('hand-item');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.remove('swing');
  void el.offsetWidth;
  el.classList.add('swing');
}

function yawDirectionName() {
  const yaw = state.player.yaw;
  const idx = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  return ['北 (-Z)', '西 (-X)', '南 (+Z)', '东 (+X)'][idx];
}

function updateDebug() {
  const debugEl = $('debug');
  if (!debugEl) return;
  debugEl.classList.toggle('hidden', !state.settings.debug);
  if (!state.settings.debug || !state.player || !state.world) return;
  const p = state.player;
  const w = state.world;
  const biome = BIOME_NAMES[w.columnInfo(Math.floor(p.x), Math.floor(p.z)).biome] || '未知';
  const t = ((w.time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
  const hours = Math.floor((t / DAY_LENGTH) * 24);
  const minutes = Math.floor(((t / DAY_LENGTH) * 24 - hours) * 60);
  const target = p.target ? getBlockDef(p.target.id).display : '—';
  let mobInfo = '';
  if (state.mobs && state.mobs.mobs && state.mobs.mobs.length) {
    const m0 = state.mobs.mobs[0];
    mobInfo = `   最近 ${m0.type} ${m0.x.toFixed(1)},${m0.y.toFixed(1)},${m0.z.toFixed(1)}`;
  }
  debugEl.textContent =
    `FPS ${state.fps.toFixed(0)}   XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
    `区块 ${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)}   生物群系 ${biome}   朝向 ${yawDirectionName()}\n` +
    `模式 ${p.mode === 'creative' ? '创造' : '生存'}${p.flying ? '·飞行' : ''}   时间 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}   生物 ${state.mobs ? state.mobs.count() : 0}   画质 ${Math.round(state.qualityScale * 100)}%   视距 ${state.renderer ? state.renderer.renderDistance : '-'}   注视 ${target}${mobInfo}`;
}

// ---------------- 界面操作 ----------------
function openInventory(size = 2) {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (state.invUI && state.invUI.isOpen) return;
  if (state.containerUI && state.containerUI.isOpen) return;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  state.invUI.show(size);
}

function onInventoryClosed() {
  if (!state.running || state.paused) return;
  $('hud').classList.remove('hidden');
  if (state.isTouch) hideTouch(false);
}

function openContainer(hit) {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (!state.containers || !state.containerUI) return;
  if (state.invUI && state.invUI.isOpen) return;
  const open = state.containers.open(hit);
  if (!open) return;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('hud').classList.add('hidden');
  state.containerUI.show(open.key, open.type);
}

function ensureVillagers() {
  const p = state.player;
  const w = state.world;
  const mobs = state.mobs;
  if (!p || !w || !mobs || p.dead) return;
  let villagers = 0;
  for (const mob of mobs.mobs) if (mob.type === 'villager') villagers++;
  if (villagers >= 4) return;
  const vcx = Math.floor(p.x / 128);
  const vcz = Math.floor(p.z / 128);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const v = w.getVillage(vcx + dx, vcz + dz);
      if (!v) continue;
      if (Math.hypot(v.centerX - p.x, v.centerZ - p.z) > 48) continue;
      for (let attempt = 0; attempt < 6; attempt++) {
        const x = v.centerX + Math.round((Math.random() - 0.5) * 16);
        const z = v.centerZ + Math.round((Math.random() - 0.5) * 16);
        if (!w.isLoaded(x, z)) continue;
        const y = w.getSurfaceY(x, z) + 1;
        if (w.getBlock(x, y, z) !== 0 || w.getBlock(x, y + 1, z) !== 0) continue;
        if (mobs.spawn('villager', x + 0.5, y, z + 0.5)) return;
      }
    }
  }
}

function checkDiscoveries() {
  const p = state.player;
  const w = state.world;
  const ach = state.achievements;
  if (!p || !w || !ach) return;
  try {
    // 村庄：当前及相邻 128 区块
    const vcx = Math.floor(p.x / 128);
    const vcz = Math.floor(p.z / 128);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const v = w.getVillage(vcx + dx, vcz + dz);
        if (v && Math.hypot(v.centerX - p.x, v.centerZ - p.z) < 34) {
          ach.onEvent('discover', { kind: 'village' });
          break;
        }
      }
    }
    // 地牢：已生成的地牢记录
    for (const d of w.dungeons.values()) {
      if (Math.hypot(d.x - p.x, d.z - p.z) < 24 && Math.abs(d.y - p.y) < 20) {
        ach.onEvent('discover', { kind: 'dungeon' });
        break;
      }
    }
    // 沙漠神殿 / 雪屋
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getDesertTemple(vcx + dx, vcz + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 32) {
          ach.onEvent('discover', { kind: 'temple' });
          break;
        }
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getIgloo(vcx + dx, vcz + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 28) {
          ach.onEvent('discover', { kind: 'igloo' });
          break;
        }
      }
    }
    // 蘑菇岛
    if (w.columnInfo && w.columnInfo(Math.floor(p.x), Math.floor(p.z)).biome === 'mushroom_fields') {
      ach.onEvent('discover', { kind: 'mushroom_fields' });
    }
    // 下界要塞
    if (state.inNether) {
      const f = NETHER_FORTRESS;
      if (Math.hypot(f.x - p.x, f.z - p.z) < 30) {
        ach.onEvent('discover', { kind: 'nether_fortress' });
      }
    }
    // 末地城
    if (state.inEnd && w.endCities.size > 0) {
      const city = w.endCities.get('fixed');
      if (city && Math.hypot(city.x - p.x, city.z - p.z) < 30) {
        ach.onEvent('discover', { kind: 'end_city' });
      }
    }
    // 试炼密室
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getTrialChamber(Math.floor(p.x / 384) + dx, Math.floor(p.z / 384) + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 30) {
          ach.onEvent('discover', { kind: 'trial' });
          break;
        }
      }
    }
    // 远古城市
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getAncientCity(Math.floor(p.x / 512) + dx, Math.floor(p.z / 512) + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 30) {
          ach.onEvent('discover', { kind: 'ancient_city' });
          break;
        }
      }
    }
    // 海底遗迹
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getMonument(Math.floor(p.x / 512) + dx, Math.floor(p.z / 512) + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 34) {
          ach.onEvent('discover', { kind: 'monument' });
          break;
        }
      }
    }
    // 林地府邸
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getMansion(Math.floor(p.x / 384) + dx, Math.floor(p.z / 384) + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 30) {
          ach.onEvent('discover', { kind: 'mansion' });
          break;
        }
      }
    }
    // 地下要塞
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getStronghold(Math.floor(p.x / 512) + dx, Math.floor(p.z / 512) + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 42 && Math.abs(m.y - p.y) < 24) {
          ach.onEvent('discover', { kind: 'stronghold' });
          break;
        }
      }
    }
    // 矿洞：当前及相邻 128 区块
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = w.getMineshaft(vcx + dx, vcz + dz);
        if (m && Math.hypot(m.centerX - p.x, m.centerZ - p.z) < 36 && Math.abs(m.y - p.y) < 22) {
          ach.onEvent('discover', { kind: 'mineshaft' });
          break;
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

function spawnDungeonMobs() {
  const p = state.player;
  const w = state.world;
  const m = state.mobs;
  if (!p || !w || !m || p.dead || p.mode === 'creative') return;
  if (m.count() >= 18) return;
  for (const d of w.dungeons.values()) {
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist > 26) continue;
    if (!w.isLoaded(d.x, d.z)) continue;
    const type = ['zombie', 'skeleton', 'spider'][Math.floor(Math.random() * 3)];
    const x = d.x + (Math.random() - 0.5) * 6;
    const z = d.z + (Math.random() - 0.5) * 6;
    if (m.spawn(type, x, d.y, z)) state.chat?.log('地牢里出现了' + ({ zombie: '僵尸', skeleton: '骷髅', spider: '蜘蛛' }[type] || type));
  }
}

function sleepInBed(hit) {
  const w = state.world;
  const p = state.player;
  if (!w || !p || !hit) return;
  if (state.inNether || state.inEnd) {
    w.setBlock(hit.x, hit.y, hit.z, 0);
    explode(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 5);
    p.damage(8, '床爆炸了');
    state.chat?.log('床在非主世界爆炸了！');
    return;
  }
  const t = (((w.time % 600) + 600) % 600) / 600;
  const sunElev = Math.sin(t * Math.PI * 2);
  if (sunElev > 0.05) {
    showToast('只能在晚上睡觉');
    state.chat?.log('现在还不是晚上，睡不着。');
    return;
  }
  p.spawn = { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 };
  w.time = 60;
  p.health = Math.min(20, p.health + 4);
  p.hunger = Math.min(20, p.hunger + 2);
  state.achievements?.onEvent('sleep', {});
  state.chat?.log('你睡了一觉，天亮了。出生点已设置到床边。');
  showToast('睡了一觉，天亮了');
  state.sound?.play('open', { volume: 0.4 });
  updateHUD();
}

function toggleThirdPerson() {
  if (!state.running || !state.player) return;
  state.thirdPerson = !state.thirdPerson;
  state.renderer?.setThirdPerson(state.thirdPerson);
  state.playerModel?.setVisible(state.thirdPerson);
  updateHandItem();
  showToast(state.thirdPerson ? '第三人称视角（F5 切换）' : '第一人称视角（F5 切换）');
}

function setPaused(paused) {
  if (!state.running) return;
  state.paused = paused;
  if (paused) {
    resetControls();
    releasePointerLock();
    hideTouch(true);
    showScreen('pause');
  } else {
    showScreen('none');
    if (state.isTouch) hideTouch(false);
  }
}

function showDeath(reason) {
  state.player.breakHeld = false;
  resetControls();
  releasePointerLock();
  hideTouch(true);
  $('death-reason').textContent = reason || '';
  showScreen('death');
}

function openSettings() {
  state.overlayReturn = !state.running ? 'title' : state.paused ? 'pause' : 'game';
  syncSettingsUI();
  hideTouch(true);
  showScreen('settings');
}

function closeSettings() {
  if (state.overlayReturn === 'pause') showScreen('pause');
  else if (state.overlayReturn === 'game') {
    showScreen('none');
    if (state.isTouch) hideTouch(false);
  } else {
    showScreen('title');
  }
}

function openHelp() {
  state.overlayReturn = !state.running ? 'title' : state.paused ? 'pause' : 'game';
  hideTouch(true);
  showScreen('help');
}

function closeHelp() {
  if (state.overlayReturn === 'pause') showScreen('pause');
  else if (state.overlayReturn === 'game') {
    showScreen('none');
    if (state.isTouch) hideTouch(false);
  } else {
    showScreen('title');
  }
}

function handleEscape() {
  if (!state.running) {
    if (!$('screen-settings').classList.contains('hidden')) closeSettings();
    else if (!$('screen-help').classList.contains('hidden')) closeHelp();
    return;
  }
  if (state.achievementsOpen) {
    closeAchievements();
    return;
  }
  if (state.beaconOpen) {
    closeBeacon();
    return;
  }
  if (state.lecternOpen) {
    closeLectern();
    return;
  }
  if (state.nameMob) {
    closeNameTagEditor(true);
    return;
  }
  if (state.signEditing) {
    closeSignEditor(true);
    return;
  }
  if (state.brewOpen) {
    closeBrew();
    return;
  }
  if (state.enchantOpen) {
    closeEnchant();
    return;
  }
  if (state.tradeOpen) {
    closeTrade();
    return;
  }
  if (state.containerUI && state.containerUI.isOpen) {
    state.containerUI.hide();
    return;
  }
  if (state.invUI && state.invUI.isOpen) {
    state.invUI.hide();
    return;
  }
  if (!$('screen-help').classList.contains('hidden')) {
    closeHelp();
    return;
  }
  if (!$('screen-settings').classList.contains('hidden')) {
    closeSettings();
    return;
  }
  if (state.player && state.player.dead) return;
  setPaused(!state.paused);
}

// ---------------- 输入 ----------------
function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    state.sound?.unlock();
    if (e.code === 'F3') {
      e.preventDefault();
      state.settings.debug = !state.settings.debug;
      $('set-debug').checked = state.settings.debug;
      debugVisibility();
      saveSettings();
      return;
    }
    if (state.chat && state.chat.isOpen) {
      if (e.code === 'Escape') {
        e.preventDefault();
        state.chat.close();
      }
      return;
    }
    if (e.code === 'F5') {
      e.preventDefault();
      toggleThirdPerson();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      handleEscape();
      return;
    }
    if (!state.running || !state.player) return;
    if (state.player.dead) return;
    if (state.loading || state.paused || state.player.dead) return;
    if (state.invUI && state.invUI.isOpen) return;
    const c = state.player.controls;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        c.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        c.back = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        c.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        c.right = true;
        break;
      case 'Space':
        e.preventDefault();
        c.jump = true;
        handleJumpPress();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        c.sneak = true;
        break;
      case 'ControlLeft':
      case 'ControlRight':
        c.sprint = true;
        break;
      case 'KeyE':
        openInventory(2);
        break;
      case 'KeyT':
        if (state.chat) {
          resetControls();
          releasePointerLock();
          hideTouch(true);
          state.chat.show('');
        }
        break;
      case 'Slash':
        if (state.chat) {
          resetControls();
          releasePointerLock();
          hideTouch(true);
          state.chat.show('/');
        }
        break;
      case 'KeyF':
        if (state.player.mode === 'creative') {
          state.player.toggleFlying();
          showToast(state.player.flying ? '飞行开启' : '飞行关闭');
        }
        break;
      default:
        if (e.code.startsWith('Digit')) {
          const n = +e.code.slice(5);
          if (n >= 1 && n <= 9) {
            state.inventory.selectSlot(n - 1);
            state.sound?.play('click', { volume: 0.2 });
            updateHUD();
          }
        }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!state.player) return;
    const c = state.player.controls;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        c.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        c.back = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        c.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        c.right = false;
        break;
      case 'Space':
        c.jump = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        c.sneak = false;
        break;
      case 'ControlLeft':
      case 'ControlRight':
        c.sprint = false;
        break;
      default:
        break;
    }
  });
}

function handleJumpPress() {
  const now = performance.now();
  if (state.player && state.player.mode === 'creative' && now - state.lastSpace < 330) {
    state.player.toggleFlying();
    showToast(state.player.flying ? '飞行开启' : '飞行关闭');
  }
  state.lastSpace = now;
}

function debugVisibility() {
  $('debug').classList.toggle('hidden', !state.settings.debug);
  if (state.settings.debug) updateDebug();
}

function bindMouse() {
  canvas.addEventListener('mousedown', (e) => {
    state.sound?.unlock();
    if (!activeGame()) return;
    if (e.button === 0) {
      state.player.breakHeld = true;
      state.player.primaryAction();
      swingHand();
      requestLock();
    } else if (e.button === 2) {
      state.player.secondaryAction();
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (!state.player) return;
    if (e.button === 2) state.player.releaseBow?.();
    else state.player.breakHeld = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!activeGame()) return;
    if (state.isTouch) return;
    if (document.pointerLockElement !== canvas) return;
    state.player.handleLook(e.movementX, e.movementY);
  });
  canvas.addEventListener('click', () => {
    if (activeGame() && !state.isTouch) requestLock();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!activeGame() || !state.inventory) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const idx = (state.inventory.hotbarIndex + dir + 9) % 9;
      state.inventory.selectSlot(idx);
      state.sound?.play('click', { volume: 0.15 });
      updateHUD();
    },
    { passive: false },
  );
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) {
      // 用户按 Esc 时浏览器会先退出指针锁定，这里交给键盘 Esc 处理
    }
  });
}

function bindTouchLook() {
  let look = null;
  canvas.addEventListener('pointerdown', (e) => {
    state.sound?.unlock();
    if (e.pointerType !== 'touch' || !activeGame()) return;
    tryFullscreen();
    look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!look || e.pointerId !== look.id || !activeGame()) return;
    const dx = e.clientX - look.x;
    const dy = e.clientY - look.y;
    look.x = e.clientX;
    look.y = e.clientY;
    state.player.handleLook(dx * 1.7, dy * 1.7);
  });
  const end = (e) => {
    if (look && e.pointerId === look.id) look = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
}

function bindJoystick() {
  const joy = $('joystick');
  const knob = $('joystick-knob');
  let active = null;
  let cx = 0;
  let cy = 0;
  let radius = 1;

  const move = (e) => {
    if (!state.player) return;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    const max = radius * 0.72;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / max;
    const ny = dy / max;
    const c = state.player.controls;
    c.left = nx < -0.32;
    c.right = nx > 0.32;
    c.forward = ny < -0.32;
    c.back = ny > 0.32;
  };

  joy.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.sound?.unlock();
    if (!activeGame()) return;
    active = e.pointerId;
    const r = joy.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    radius = r.width / 2;
    try {
      joy.setPointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }
    move(e);
  });
  joy.addEventListener('pointermove', (e) => {
    if (active !== e.pointerId) return;
    e.preventDefault();
    move(e);
  });
  const end = () => {
    active = null;
    knob.style.transform = '';
    if (state.player) {
      const c = state.player.controls;
      c.forward = c.back = c.left = c.right = false;
    }
  };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
}

function bindHold(el, onDown, onUp) {
  if (!el) return;
  const down = (e) => {
    e.preventDefault();
    state.sound?.unlock();
    if (!activeGame()) return;
    el.classList.add('pressed');
    onDown(e);
  };
  const up = (e) => {
    if (e) e.preventDefault();
    el.classList.remove('pressed');
    if (onUp) onUp(e);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}

function bindTouchControls() {
  bindHold(
    $('btn-break'),
    () => {
      if (!state.player) return;
      state.player.breakHeld = true;
      if (state.player.mode === 'creative') state.player.primaryAction();
    },
    () => {
      if (state.player) state.player.breakHeld = false;
    },
  );
  bindHold(
    $('btn-jump'),
    () => {
      if (state.player) state.player.controls.jump = true;
    },
    () => {
      if (state.player) state.player.controls.jump = false;
    },
  );
  bindHold(
    $('btn-sprint'),
    () => {
      if (state.player) state.player.controls.sprint = true;
    },
    () => {
      if (state.player) state.player.controls.sprint = false;
    },
  );
  const place = $('btn-place');
  if (place) {
    place.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.sound?.unlock();
      if (!activeGame()) return;
      state.player.secondaryAction();
      swingHand();
    });
  }
  const fly = $('btn-fly');
  if (fly) {
    fly.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!activeGame() || !state.player || state.player.mode !== 'creative') return;
      state.player.toggleFlying();
      showToast(state.player.flying ? '飞行开启' : '飞行关闭');
    });
  }
}

// ---------------- 设置 / 资源包 ----------------
function bindSettings() {
  $('set-sens').addEventListener('input', (e) => {
    state.settings.sens = +e.target.value;
    if (state.player) state.player.lookSensitivity = 0.0024 * state.settings.sens;
    saveSettings();
  });
  $('set-distance').addEventListener('change', (e) => {
    state.settings.distance = +e.target.value;
    applyRuntimeSettings();
    showToast('视距已设为 ' + state.settings.distance + ' 区块');
  });
  $('set-volume').addEventListener('input', (e) => {
    state.settings.volume = +e.target.value;
    state.sound?.setMasterVolume(state.settings.volume);
    saveSettings();
  });
  $('set-mute').addEventListener('change', (e) => {
    state.settings.mute = e.target.checked;
    state.sound?.setMuted(state.settings.mute);
    saveSettings();
  });
  $('set-debug').addEventListener('change', (e) => {
    state.settings.debug = e.target.checked;
    debugVisibility();
    saveSettings();
  });

  $('btn-import-pack').addEventListener('click', () => $('pack-input').click());
  $('btn-clear-pack').addEventListener('click', () => {
    RP.clearPack();
    $('pack-status').textContent = '已清除，点「应用并刷新」后恢复程序化贴图';
    $('btn-reload').classList.remove('hidden');
  });
  $('btn-reload').addEventListener('click', () => location.reload());
  $('pack-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    $('pack-status').textContent = '正在解析资源包…';
    try {
      const report = await RP.importFromFiles(files);
      if (report && report.ok) {
        $('pack-status').textContent = `导入成功：${report.tiles.length} 个方块贴图 / ${
          report.icons.length
        } 个物品图标。点「应用并刷新」后生效。`;
        $('btn-reload').classList.remove('hidden');
      } else {
        $('pack-status').textContent = '导入失败：' + ((report && report.error) || '未知错误');
      }
    } catch (err) {
      $('pack-status').textContent = '导入失败：' + (err && err.message ? err.message : err);
    }
    e.target.value = '';
  });
}

function updatePackStatus() {
  const el = $('pack-status');
  if (!el) return;
  const sum = RP.packSummary();
  if (sum && (sum.tiles > 0 || sum.icons > 0)) {
    el.textContent = `已保存：${sum.tiles} 个方块贴图 / ${sum.icons} 个物品图标${
      sum.savedAt ? '（' + new Date(sum.savedAt).toLocaleString() + '）' : ''
    }`;
    $('btn-reload').classList.remove('hidden');
  } else {
    el.textContent = '未导入（使用程序化像素贴图）';
  }
}

// ---------------- 苦力怕爆炸 ----------------
function scheduleTNT(x, y, z, delay) {
  state.tntTimers = state.tntTimers || [];
  state.tntTimers.push({ x, y, z, t: delay });
}

function igniteTNT(x, y, z) {
  const world = state.world;
  if (!world || world.getBlock(x, y, z) !== BLOCK.TNT) return false;
  scheduleTNT(x, y, z, 2.6);
  state.sound?.play('click', { volume: 0.5 });
  state.chat?.log('TNT 已点燃！');
  return true;
}

function explode(cx, cy, cz, power = 3) {
  const world = state.world;
  if (!world) return;
  const r = Math.ceil(power);
  const chain = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > power) continue;
        const x = Math.floor(cx) + dx;
        const y = Math.floor(cy) + dy;
        const z = Math.floor(cz) + dz;
        const id = world.getBlock(x, y, z);
        if (!id) continue;
        const def = getBlockDef(id);
        if (!isFinite(def.hardness)) continue;
        if (id === BLOCK.TNT) {
          chain.push({ x, y, z });
          continue;
        }
        if (Math.random() < 1 - dist / (power + 0.4)) world.setBlock(x, y, z, 0);
      }
    }
  }
  if (state.renderer) {
    for (let i = 0; i < 8; i++) {
      state.renderer.spawnBreakParticles(
        cx + (Math.random() - 0.5) * 2, cy + (Math.random() - 0.5) * 2, cz + (Math.random() - 0.5) * 2,
        BLOCK.STONE,
      );
    }
  }
  for (const t of chain) {
    if (world.getBlock(t.x, t.y, t.z) === BLOCK.TNT) scheduleTNT(t.x, t.y, t.z, 0.25 + Math.random() * 0.9);
  }
  state.sound?.play('break_glass', { volume: 0.9 });
  const p = state.player;
  if (p && !p.dead && p.mode !== 'creative') {
    const dx = p.x - cx;
    const dy = p.y + 0.9 - cy;
    const dz = p.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < power) p.damage(Math.max(1, Math.round(9 - dist * 2)), '被苦力怕炸死了');
  }
}

// ---------------- 主循环 ----------------
function loop(now) {
  requestAnimationFrame(loop);
  if (!state.running) return;
  const dt = Math.min(0.06, Math.max(0.0001, (now - state.lastTime) / 1000));
  state.lastTime = now;

  if (state.world) {
    if (activeGame()) {
      state.player.update(dt);
      state.playerModel?.update(dt, state.player, state.renderer ? state.renderer.dayLight : 1);
      state.mobs?.update(dt);
      if (state.portalCooldown > 0) state.portalCooldown = Math.max(0, state.portalCooldown - dt);
      state.portalTimer += dt;
      if (state.portalTimer > 0.25) {
        state.portalTimer = 0;
        checkPortal();
      }
      state.villagerTimer += dt;
      if (state.villagerTimer > 6) {
        state.villagerTimer = 0;
        ensureVillagers();
      }
      state.golemTimer = (state.golemTimer || 0) + dt;
      if (state.golemTimer > 8) {
        state.golemTimer = 0;
        ensureVillageDefense();
      }
      state.blazeTimer = (state.blazeTimer || 0) + dt;
      if (state.blazeTimer > 8) {
        state.blazeTimer = 0;
        if (state.inNether && state.player && state.mobs && state.mobs.count() < 10) {
          const f = NETHER_FORTRESS;
          if (Math.hypot(f.x - state.player.x, f.z - state.player.z) < 30) {
            const isWither = Math.random() < 0.4;
            state.mobs.spawn(isWither ? 'wither_skeleton' : 'blaze', f.x + (Math.random() - 0.5) * 10, f.y + 1, f.z + (Math.random() - 0.5) * 4);
            state.chat?.log(isWither ? '凋灵骷髅出现了！' : '烈焰人出现了！');
          }
        }
      }
      state.shulkerTimer = (state.shulkerTimer || 0) + dt;
      if (state.shulkerTimer > 8) {
        state.shulkerTimer = 0;
        const p = state.player;
        const city = state.world.endCities.get('fixed');
        if (p && city && state.mobs && state.mobs.count() < 10) {
          if (Math.hypot(city.x - p.x, city.z - p.z) < 30) {
            state.mobs.spawn('shulker', city.x + (Math.random() - 0.5) * 6, city.y + 2, city.z + (Math.random() - 0.5) * 6);
            state.chat?.log('潜影贝出现了！');
          }
        }
      }
      state.trialTimer = (state.trialTimer || 0) + dt;
      if (state.trialTimer > 6) {
        state.trialTimer = 0;
        const p = state.player;
        const w = state.world;
        if (p && w && state.mobs && state.mobs.count() < 12) {
          for (const s of w.trialSpawners.values()) {
            if (Math.hypot(s.x - p.x, s.z - p.z) > 24) continue;
            if (w.getBlock(s.x, s.y, s.z) !== BLOCK.TRIAL_SPAWNER) continue;
            const type = Math.random() < 0.5 ? 'zombie' : 'skeleton';
            state.mobs.spawn(type, s.x + (Math.random() - 0.5) * 4, s.y, s.z + (Math.random() - 0.5) * 4);
            state.chat?.log('试炼刷怪笼激活了！');
            break;
          }
        }
      }
      state.dungeonSpawnTimer = (state.dungeonSpawnTimer || 0) + dt;
      if (state.dungeonSpawnTimer > 6) {
        state.dungeonSpawnTimer = 0;
        spawnDungeonMobs();
      }
      state.items?.update(dt);
      state.weather?.update(dt);
      state.qualityTimer += dt;
      if (state.qualityTimer > 6) {
        state.qualityTimer = 0;
        if (state.renderer && state.renderer.setQualityScale) {
          if (state.fps > 0 && state.fps < 38 && state.qualityScale > 0.55) {
            state.qualityScale = Math.max(0.55, state.qualityScale - 0.15);
            state.renderer.setQualityScale(state.qualityScale);
            state.weather?.setDensity(state.qualityScale);
            showToast('性能不足：已自动降低渲染分辨率');
          } else if (state.fps > 56 && state.qualityScale < 1) {
            state.qualityScale = Math.min(1, state.qualityScale + 0.05);
            state.renderer.setQualityScale(state.qualityScale);
            state.weather?.setDensity(state.qualityScale);
          }
          if (state.fps > 0 && state.fps < 35 && state.adaptiveDistance > 2) {
            state.adaptiveDistance -= 1;
            state.renderer.setRenderDistance(state.adaptiveDistance);
            state.world.renderDistance = state.adaptiveDistance;
            showToast('性能不足：视距降低到 ' + state.adaptiveDistance);
          } else if (state.fps > 56 && state.adaptiveDistance < state.baseDistance) {
            state.adaptiveDistance += 1;
            state.renderer.setRenderDistance(state.adaptiveDistance);
            state.world.renderDistance = state.adaptiveDistance;
          }
        }
      }
      state.world.time += dt;
      state.world.updateCrops(dt);
      state.world.tickWater(dt);
      if (state.campfireTimers.length) {
        for (let i = state.campfireTimers.length - 1; i >= 0; i--) {
          const item = state.campfireTimers[i];
          item.t -= dt;
          if (item.t > 0) continue;
          state.campfireTimers.splice(i, 1);
          if (state.items) state.items.spawn(item.out, item.x, item.y, item.z, 1);
          state.chat?.log('🍖 烤好了：' + itemDisplay(item.out));
          state.sound?.play('pop', { volume: 0.4 });
        }
      }
      if (state.fishing) {
        state.fishing.timer -= dt;
        if (state.fishing.timer <= 0) finishFishing();
      }
      if (state.tntTimers && state.tntTimers.length) {
        for (let i = state.tntTimers.length - 1; i >= 0; i--) {
          const timer = state.tntTimers[i];
          timer.t -= dt;
          if (timer.t > 0) continue;
          state.tntTimers.splice(i, 1);
          if (state.world.getBlock(timer.x, timer.y, timer.z) !== BLOCK.TNT) continue;
          state.world.setBlock(timer.x, timer.y, timer.z, 0);
          explode(timer.x + 0.5, timer.y + 0.5, timer.z + 0.5, 4);
        }
      }
      state.achievements?.update(dt);
      if (state.weather && state.weather.isRaining) state.achievements?.onEvent('rain', {});
      state.discoverTimer += dt;
      if (state.discoverTimer > 2) {
        state.discoverTimer = 0;
        checkDiscoveries();
        const armor = state.inventory && state.inventory.armor;
        if (armor && armor.length === 4 && armor.every(Boolean)) {
          state.achievements?.onEvent('armor', { full: true });
        }
        if (state.mobs && state.mobs.mobs) {
          for (const m of state.mobs.mobs) {
            if (m.type === 'panda' && !m.removed && Math.hypot(m.x - state.player.x, m.z - state.player.z) < 16) {
              state.achievements?.onEvent('panda', {});
              break;
            }
          }
        }
      }
      if (state.stats) state.stats.playTime += dt;
      state.saveClock += dt;
      if (state.saveClock > 30) {
        state.saveClock = 0;
        saveGame();
      }
    }
    state.renderer.render(state.player, dt);
  }

  if (!state.paused && !state.loading) {
    state.containers?.tick(dt);
    state.containerUI?.update(dt);
  }

  const effEl = $('effect-timer');
  if (effEl) {
    const eff = [];
    if (state.player) {
      if (state.player.strengthTimer > 0) eff.push('力量 ' + Math.ceil(state.player.strengthTimer) + 's');
      if (state.player.speedTimer > 0) eff.push('迅捷 ' + Math.ceil(state.player.speedTimer) + 's');
      if (state.player.fireResistTimer > 0) eff.push('抗火 ' + Math.ceil(state.player.fireResistTimer) + 's');
      if (state.player.nightVisionTimer > 0) eff.push('夜视 ' + Math.ceil(state.player.nightVisionTimer) + 's');
      if (state.player.jumpBoostTimer > 0) eff.push('跳跃 ' + Math.ceil(state.player.jumpBoostTimer) + 's');
      if (state.player.regenTimer > 0) eff.push('再生 ' + Math.ceil(state.player.regenTimer) + 's');
      if (state.player.witherTimer > 0) eff.push('凋零 ' + Math.ceil(state.player.witherTimer) + 's');
      if (state.player.hasteTimer > 0) eff.push('急迫 ' + Math.ceil(state.player.hasteTimer) + 's');
      if (state.player.blockingTimer > 0) eff.push('格挡 ' + Math.ceil(state.player.blockingTimer) + 's');
    }
    if (eff.length) {
      effEl.textContent = eff.join(' · ');
      effEl.classList.remove('hidden');
    } else {
      effEl.classList.add('hidden');
    }
  }
  const signLabel = $('sign-label');
  if (signLabel) {
    const target = state.player && state.player.target;
    const signText = target && target.id === BLOCK.SIGN && state.world ? state.world.getSign(target.x, target.y, target.z) : '';
    if (signText) {
      signLabel.textContent = signText;
      signLabel.classList.remove('hidden');
    } else {
      signLabel.classList.add('hidden');
    }
  }
  state.labelClock = (state.labelClock || 0) + 0.016;
  if (state.labelClock > 0.2) {
    state.labelClock = 0;
    renderMobLabels();
  }
  if (state.renderer && state.player) {
    state.renderer.setNightVision(state.player.nightVisionTimer > 0);
  }
  const bossBar = $('boss-bar');
  if (bossBar) {
    const list = state.mobs && state.mobs.mobs ? state.mobs.mobs : [];
    const boss = list.find((m) => !m.removed && (m.type === 'ender_dragon' || m.type === 'wither'));
    if (boss && state.running) {
      bossBar.classList.remove('hidden');
      const name = $('boss-name');
      if (name) name.textContent = boss.type === 'wither' ? '凋灵' : '末影龙';
      const fill = $('boss-fill');
      if (fill) fill.style.width = Math.round(Math.max(0, boss.health / boss.maxHealth) * 100) + '%';
    } else {
      bossBar.classList.add('hidden');
    }
  }
  const bowBar = $('bow-charge');
  if (bowBar) {
    if (state.player && state.player.chargingBow && !state.thirdPerson) {
      bowBar.classList.remove('hidden');
      if (bowBar.firstElementChild) bowBar.firstElementChild.style.width = Math.round(Math.min(1, state.player.bowCharge) * 100) + '%';
    } else {
      bowBar.classList.add('hidden');
    }
  }

  if (state.running && !state.loading && state.inventory && state.inventory.armor && state.inventory.armor.length === 4 && state.inventory.armor.every(Boolean)) {
    state.achievements?.onEvent('armor', { full: true });
  }
  if (state.running && !state.loading && state.inventory && !state._elytraChecked) {
    const hasElytra = (state.inventory.armor || []).some((s) => s && s.id === 'elytra')
      || (state.inventory.slots || []).some((s) => s && s.id === 'elytra');
    if (hasElytra) {
      state._elytraChecked = true;
      state.achievements?.onEvent('elytra', {});
    }
  }

  if (state.loading) updateLoading();

  if (state.player) {
    $('hurt-overlay').style.opacity = String(Math.min(0.7, state.player.hurtFlash * 1.5));
    $('water-overlay').style.opacity = state.player.eyeInWater ? '1' : '0';
  }

  state.fpsFrames++;
  state.fpsClock += dt;
  if (state.fpsClock >= 0.4) {
    state.fps = state.fpsFrames / state.fpsClock;
    state.fpsFrames = 0;
    state.fpsClock = 0;
    if (state.settings.debug) updateDebug();
  }
}

// ---------------- 界面绑定 ----------------
function bindUI() {
  $('btn-new-survival').addEventListener('click', () => {
    startGame({ mode: 'survival' });
  });
  $('btn-new-creative').addEventListener('click', () => {
    startGame({ mode: 'creative' });
  });
  $('btn-continue').addEventListener('click', () => {
    const save = readSave();
    if (!save) {
      showToast('没有找到存档');
      refreshContinueButton();
      return;
    }
    startGame({ save });
  });
  $('btn-title-settings').addEventListener('click', openSettings);
  $('btn-help').addEventListener('click', openHelp);
  $('btn-settings-close').addEventListener('click', closeSettings);
  $('btn-help-close').addEventListener('click', closeHelp);
  $('btn-pause-settings').addEventListener('click', openSettings);
  $('btn-pause-help').addEventListener('click', openHelp);
  $('btn-resume').addEventListener('click', () => setPaused(false));
  $('btn-save-quit').addEventListener('click', () => {
    saveGame();
    stopGame(true);
  });
  $('btn-respawn').addEventListener('click', () => {
    if (!state.player) return;
    state.player.respawn();
    showScreen('none');
    $('hud').classList.remove('hidden');
    if (state.isTouch) hideTouch(false);
    updateHUD();
  });
  $('btn-death-quit').addEventListener('click', () => {
    saveGame();
    stopGame(true);
  });
  $('btn-hud-chat').addEventListener('click', () => {
    if (!state.running || state.loading || state.paused || state.player?.dead) return;
    resetControls();
    releasePointerLock();
    hideTouch(true);
    state.chat?.show('');
  });
  $('btn-hud-view').addEventListener('click', toggleThirdPerson);
  $('btn-hud-inv').addEventListener('click', () => openInventory(2));
  $('btn-hud-menu').addEventListener('click', () => setPaused(true));
  $('trade-close').addEventListener('click', closeTrade);
  $('enchant-close').addEventListener('click', closeEnchant);
  $('brew-close').addEventListener('click', closeBrew);
  $('sign-close').addEventListener('click', () => closeSignEditor(false));
  $('lectern-close').addEventListener('click', closeLectern);
  $('beacon-close').addEventListener('click', closeBeacon);
  $('achievements-close').addEventListener('click', closeAchievements);
  $('btn-pause-achievements').addEventListener('click', openAchievements);
  $('beacon-offers').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-beacon]');
    if (!btn) return;
    applyBeaconEffect(btn.dataset.beacon);
  });
  $('name-close').addEventListener('click', () => closeNameTagEditor(false));
  $('name-save').addEventListener('click', () => closeNameTagEditor(true));
  $('sign-save').addEventListener('click', () => closeSignEditor(true));
  $('brew-offers').addEventListener('click', (e) => {
    const btn = e.target.closest('.trade-offer');
    if (!btn || btn.disabled) return;
    const index = Number(btn.dataset.brew);
    if (Number.isFinite(index)) doBrew(index);
  });
  $('enchant-offers').addEventListener('click', (e) => {
    const btn = e.target.closest('.trade-offer');
    if (!btn || btn.disabled) return;
    const index = Number(btn.dataset.enchant);
    if (Number.isFinite(index)) applyEnchant(index);
  });
  $('trade-offers').addEventListener('click', (e) => {
    const btn = e.target.closest('.trade-offer');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (Number.isFinite(index)) doTrade(index);
  });

  bindKeyboard();
  bindMouse();
  bindTouchLook();
  bindJoystick();
  bindTouchControls();
  bindSettings();

  document.addEventListener('pointerdown', () => {
    state.sound?.unlock();
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.running) {
        saveGame();
        if (!state.loading && !state.player?.dead) setPaused(true);
      }
    }
  });
  window.addEventListener('pagehide', () => {
    if (state.running) saveGame();
  });
}

function onResize() {
  if (state.renderer) state.renderer.resize();
  const portrait = window.innerHeight > window.innerWidth;
  $('rotate-hint').classList.toggle('hidden', !(state.isTouch && portrait && state.running));
}

function installErrorHandlers() {
  window.addEventListener('error', (e) => {
    if (e && e.message) showError(e.message + (e.filename ? '\n' + e.filename + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    showError(r && r.stack ? r.stack : String(r));
  });
}

function showError(msg) {
  const overlay = $('error-overlay');
  const text = $('error-text');
  if (!overlay || !text) {
    console.error(msg);
    return;
  }
  text.textContent = String(msg).slice(0, 5000);
  overlay.classList.remove('hidden');
  console.error(msg);
}

// ---------------- 启动 ----------------
function boot() {
  state.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (state.isTouch) document.body.classList.add('touch');
  loadSettings();
  if (!localStorage.getItem(SETTINGS_KEY) && state.isTouch) state.settings.distance = 2;
  syncSettingsUI();
  state.sound = new SoundEngine();
  state.sound.setMasterVolume(state.settings.volume);
  state.sound.setMuted(!!state.settings.mute);
  state.hudIcons = makeHudIcons();
  installErrorHandlers();
  bindUI();
  updatePackStatus();
  RP.loadSavedPack()
    .then(() => updatePackStatus())
    .catch(() => {});
  refreshContinueButton();
  showScreen('title');
  onResize();
  requestAnimationFrame(loop);
  window.__mc = state;
  window.__mcBooted = true;
  updateDebug();

  const params = new URLSearchParams(location.search);
  if (params.get('noplants') === '1') state.noPlants = true;
  if (params.get('openinv') === '1') state.openInvAfterLoad = true;
  if (params.get('mobs') === '1') state.spawnDemoMobs = true;
  if (params.get('items') === '1') state.spawnDemoItems = true;
  if (params.get('gui') === 'chest' || params.get('gui') === 'furnace') state.guiDemo = params.get('gui');
  if (params.get('torches') === '1') state.spawnTorches = true;
  if (params.get('weather')) state.weatherDemo = params.get('weather');
  if (params.get('village') === '1') state.tpVillage = true;
  if (params.get('dungeon') === '1') state.tpDungeon = true;
  if (params.get('thirdperson') === '1') state.startThirdPerson = true;
  if (params.get('quality')) {
    const q = Number(params.get('quality'));
    if (isFinite(q)) state.startQuality = Math.max(0.5, Math.min(1, q));
  }
  if (params.get('bed') === '1') state.bedDemo = true;
  if (params.get('farm') === '1') state.farmDemo = true;
  if (params.get('mineshaft') === '1') state.tpMineshaft = true;
  if (params.get('water') === '1') state.waterDemo = true;
  if (params.get('temple') === '1') state.tpTemple = true;
  if (params.get('bowdemo') === '1') state.bowDemo = true;
  if (params.get('sheardemo') === '1') state.shearDemo = true;
  if (params.get('tntdemo') === '1') state.tntDemo = true;
  if (params.get('doordemo') === '1') state.doorDemo = true;
  if (params.get('fencedemo') === '1') state.fenceDemo = true;
  if (params.get('stronghold') === '1') state.tpStronghold = true;
  if (params.get('trade') === '1') state.tradeDemo = true;
  if (params.get('enchant') === '1') state.enchantDemo = true;
  if (params.get('brew') === '1') state.brewDemo = true;
  if (params.get('armor') === '1') state.armorDemo = true;
  if (params.get('nether') === '1') state.netherDemo = true;
  if (params.get('fire') === '1') state.fireDemo = true;
  if (params.get('lightning') === '1') state.lightningDemo = true;
  if (params.get('end') === '1') state.endDemo = true;
  if (params.get('dragon') === '1') state.dragonDemo = true;
  if (params.get('mansion') === '1') state.tpMansion = true;
  if (params.get('monument') === '1') state.tpMonument = true;
  if (params.get('sign') === '1') state.signDemo = true;
  if (params.get('fish') === '1') state.fishDemo = true;
  if (params.get('breed') === '1') state.breedDemo = true;
  if (params.get('nametag') === '1') state.nameTagDemo = true;
  if (params.get('city') === '1') state.tpCity = true;
  if (params.get('trial') === '1') state.tpTrial = true;
  if (params.get('campfire') === '1') state.campfireDemo = true;
  if (params.get('endcity') === '1') state.endCityDemo = true;
  if (params.get('potion') === '1') state.potionDemo = true;
  if (params.get('elytra') === '1') state.elytraDemo = true;
  if (params.get('ship') === '1') state.shipDemo = true;
  if (params.get('golem') === '1') state.golemDemo = true;
  if (params.get('fortress') === '1') state.fortressDemo = true;
  if (params.get('witherboss') === '1') state.witherBossDemo = true;
  if (params.get('beacon') === '1') state.beaconDemo = true;
  if (params.get('biome')) state.biomeDemo = params.get('biome');
  if (params.get('panda') === '1') state.pandaDemo = true;
  if (params.get('mushroom') === '1') state.mushroomDemo = true;
  if (params.get('achievements') === '1') state.achievementsDemo = true;
  if (params.get('shield') === '1') state.shieldDemo = true;
  if (params.get('firework') === '1') state.fireworkDemo = true;
  if (params.get('ruin') === '1') state.tpRuin = true;
  if (params.get('igloo') === '1') state.tpIgloo = true;
  if (params.get('achdemo') === '1') state.achDemo = true;
  if (params.get('time') !== null) {
    const tv = params.get('time');
    state.startTime = tv === 'day' ? 60 : tv === 'noon' ? 150 : tv === 'night' ? 450 : Number(tv);
  }
  if (params.get('give') === '1') state.giveStarter = true;
  if (params.get('pitch') !== null) state.startPitch = Number(params.get('pitch'));
  if (params.get('yaw') !== null) state.startYaw = Number(params.get('yaw'));
  if (params.get('debug')) {
    state.settings.debug = true;
    $('set-debug').checked = true;
  }
  if (params.get('distance')) {
    const d = Math.max(2, Math.min(5, Number(params.get('distance')) | 0));
    state.settings.distance = d;
    syncSettingsUI();
  }
  if (params.get('autostart')) {
    const seed = params.get('seed') ? Number(params.get('seed')) : undefined;
    const mode = params.get('mode') === 'creative' ? 'creative' : 'survival';
    setTimeout(() => startGame({ seed, mode }), 300);
  }
}

boot();
