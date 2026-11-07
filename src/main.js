// ============================================================
// main.js — 游戏入口：界面状态机、输入、循环、存档、资源包
// ============================================================

import { World, BIOME_NAMES, CHUNK_H } from './world.js';
import { Renderer } from './render.js';
import { Player } from './player.js';
import { Inventory, InventoryUI, makeHudIcons } from './inventory.js';
import { SoundEngine } from './sound.js';
import { BLOCK, getBlockDef, itemDisplay } from './blocks.js';
import * as RP from './resourcepack.js';

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
    !(state.invUI && state.invUI.isOpen)
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
  state.invUI = new InventoryUI(inventory, {
    sound: state.sound,
    onClose: onInventoryClosed,
  });
  state.invUI.onCraft = (res) => showToast('合成：' + itemDisplay(res.id));

  if (save) {
    if (save.inventory) inventory.deserialize(save.inventory);
    player.loadState(save.player);
    if (save.player && save.player.spawn) player.spawn = { ...save.player.spawn };
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
  if (!save && typeof state.startPitch === 'number' && isFinite(state.startPitch)) player.pitch = state.startPitch;
  if (!save && typeof state.startYaw === 'number' && isFinite(state.startYaw)) player.yaw = state.startYaw;
  player.lookSensitivity = 0.0024 * state.settings.sens;
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
  $('held-name').textContent = held ? itemDisplay(held.id) + (held.count > 1 ? ' ×' + held.count : '') : '';
  state.invUI?.renderHotbar();
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
  debugEl.textContent =
    `FPS ${state.fps.toFixed(0)}   XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
    `区块 ${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)}   生物群系 ${biome}   朝向 ${yawDirectionName()}\n` +
    `模式 ${p.mode === 'creative' ? '创造' : '生存'}${p.flying ? '·飞行' : ''}   时间 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}   注视 ${target}`;
}

// ---------------- 界面操作 ----------------
function openInventory(size = 2) {
  if (!state.running || state.loading || state.paused || !state.player || state.player.dead) return;
  if (state.invUI && state.invUI.isOpen) return;
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
    if (e.code === 'Escape') {
      e.preventDefault();
      handleEscape();
      return;
    }
    if (!state.running || !state.player) return;
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
      requestLock();
    } else if (e.button === 2) {
      state.player.secondaryAction();
    }
  });
  window.addEventListener('mouseup', () => {
    if (state.player) state.player.breakHeld = false;
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
      if (state.player.mode === 'creative' && state.player.target) {
        state.player.breakBlock(state.player.target);
      }
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

// ---------------- 主循环 ----------------
function loop(now) {
  requestAnimationFrame(loop);
  if (!state.running) return;
  const dt = Math.min(0.06, Math.max(0.0001, (now - state.lastTime) / 1000));
  state.lastTime = now;

  if (state.world) {
    if (activeGame()) {
      state.player.update(dt);
      state.world.time += dt;
      state.saveClock += dt;
      if (state.saveClock > 30) {
        state.saveClock = 0;
        saveGame();
      }
    }
    state.renderer.render(state.player, dt);
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
  $('btn-hud-inv').addEventListener('click', () => openInventory(2));
  $('btn-hud-menu').addEventListener('click', () => setPaused(true));

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
