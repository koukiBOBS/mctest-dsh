// ============================================================
// inventory.js — 背包数据、物品图标、物品栏 UI、创造物品栏、HUD 图标
// ============================================================

import { getItem, itemMaxStack, getBlockDef, itemDisplay } from './blocks.js';
import { buildItemIcons, TILE_NAMES } from './textures.js';
import { matchRecipe } from './crafting.js';

const ATLAS_COLS = 8;

// ---------------- 像素图标小工具 ----------------
function pixelIcon(rows, palette, scale = 2) {
  const w = rows[0].length;
  const h = rows.length;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL();
}

const HEART_ROWS = [
  '.XX.XX.',
  'XXXXXXX',
  'XXXXXXX',
  '.XXXXX.',
  '..XXX..',
  '...X...',
];
const FOOD_ROWS = [
  '..FFF..',
  '.FFFFF.',
  'FFFFFFB',
  'FFFFFFB',
  '.FFFFB.',
  '..FB...',
  '..B....',
  '..B....',
];

export function makeHudIcons() {
  const heart = (main, shade) =>
    pixelIcon(HEART_ROWS, { X: main }, 2);
  const heartEmpty = pixelIcon(HEART_ROWS, { X: 'rgba(40,25,25,0.75)' }, 2);
  const food = (main, shade) =>
    pixelIcon(FOOD_ROWS, { F: main, B: shade }, 2);
  return {
    heartFull: heart('#e8384f', '#b02035'),
    heartHalf: pixelIcon(
      HEART_ROWS.map((r, i) => r.split('').map((c, j) => (j < 4 ? c : '.')).join('')),
      { X: '#e8384f' },
      2,
    ),
    heartEmpty,
    foodFull: food('#c98a3e', '#efe6d2'),
    foodHalf: pixelIcon(
      FOOD_ROWS.map((r) => r.split('').map((c, j) => (j < 4 ? c : '.')).join('')),
      { F: '#c98a3e', B: '#efe6d2' },
      2,
    ),
    foodEmpty: pixelIcon(FOOD_ROWS, { F: 'rgba(40,30,20,0.75)', B: 'rgba(60,50,40,0.75)' }, 2),
  };
}

// ---------------- 背包数据 ----------------
export class Inventory {
  constructor(opts = {}) {
    this.mode = opts.mode || 'survival';
    this.slots = new Array(36).fill(null); // 0..8 快捷栏，9..35 主背包
    this.hotbarIndex = 0;
    this.craftGrid = new Array(9).fill(null);
    this.craftSize = 2;
    this.atlasCanvas = opts.atlasCanvas || null;
    this.customIcons = opts.customIcons || null;
    this.defaultIcons = null;
    this.onChange = null;
    this._iconCache = new Map();
    this._iconCanvasCache = new Map();
  }

  get held() {
    return this.slots[this.hotbarIndex] || null;
  }

  notify() {
    if (this.onChange) this.onChange();
  }

  selectSlot(i) {
    if (i < 0 || i > 8) return;
    this.hotbarIndex = i;
    this.notify();
  }

  setSlot(i, stack) {
    if (i < 0 || i >= 36) return;
    this.slots[i] = stack;
    if (stack && getItem(stack.id)?.durability && stack.dur === undefined) {
      stack.dur = getItem(stack.id).durability;
    }
  }

  add(id, count = 1) {
    if (!id || count <= 0) return 0;
    const item = getItem(id);
    const max = itemMaxStack(id);
    let left = count;
    if (max > 1) {
      for (let i = 0; i < 36 && left > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < max) {
          const move = Math.min(max - s.count, left);
          s.count += move;
          left -= move;
        }
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const put = Math.min(max, left);
        const stack = { id, count: put };
        if (item && item.durability) stack.dur = item.durability;
        this.slots[i] = stack;
        left -= put;
      }
    }
    if (left !== count) this.notify();
    return left;
  }

  remove(id, count = 1) {
    let left = count;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, left);
        s.count -= take;
        left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    if (left !== count) this.notify();
    return left;
  }

  countOf(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  consumeHeld(n = 1) {
    const s = this.slots[this.hotbarIndex];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.hotbarIndex] = null;
    this.notify();
  }

  damageHeld(n = 1) {
    const s = this.slots[this.hotbarIndex];
    if (!s || s.dur === undefined) return;
    s.dur -= n;
    if (s.dur <= 0) {
      this.slots[this.hotbarIndex] = null;
      this.notify();
      return true;
    }
    this.notify();
    return false;
  }

  // 关闭界面时把合成格里的东西还回背包
  returnCrafting() {
    for (let i = 0; i < 9; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      this.add(s.id, s.count);
      this.craftGrid[i] = null;
    }
    this.notify();
  }

  serialize() {
    return this.slots.map((s) => (s ? { id: s.id, count: s.count, dur: s.dur } : null));
  }

  deserialize(arr) {
    if (!Array.isArray(arr)) return;
    this.slots = new Array(36).fill(null);
    for (let i = 0; i < 36 && i < arr.length; i++) {
      const s = arr[i];
      if (s && getItem(s.id)) {
        const stack = { id: s.id, count: Math.max(1, Math.min(9999, s.count | 0)) };
        if (getItem(s.id).durability) stack.dur = typeof s.dur === 'number' ? s.dur : getItem(s.id).durability;
        this.slots[i] = stack;
      }
    }
    this.notify();
  }

  // ---------------- 图标 ----------------
  getDefaultIcons() {
    if (!this.defaultIcons) this.defaultIcons = buildItemIcons();
    return this.defaultIcons;
  }

  iconCanvas(id) {
    if (this._iconCanvasCache.has(id)) return this._iconCanvasCache.get(id);
    let c = null;
    const item = getItem(id);
    if (item) {
      if (item.block !== undefined && item.block !== null && this.atlasCanvas) {
        const def = getBlockDef(item.block);
        const tile = def.tiles.side || def.tiles.all || 'stone';
        const idx = Math.max(0, TILE_NAMES.indexOf(tile));
        const col = idx % ATLAS_COLS;
        const row = Math.floor(idx / ATLAS_COLS);
        c = document.createElement('canvas');
        c.width = c.height = 32;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.atlasCanvas, col * 16, row * 16, 16, 16, 0, 0, 32, 32);
      } else if (this.customIcons && this.customIcons.has(id)) {
        c = this.customIcons.get(id);
      } else {
        const icons = this.getDefaultIcons();
        c = icons[id] || null;
      }
    }
    this._iconCanvasCache.set(id, c);
    return c;
  }

  iconURL(id) {
    if (this._iconCache.has(id)) return this._iconCache.get(id);
    const c = this.iconCanvas(id);
    const url = c && c.toDataURL ? c.toDataURL() : '';
    this._iconCache.set(id, url);
    return url;
  }
}

// ---------------- 物品栏 UI ----------------
export class InventoryUI {
  constructor(inventory, opts = {}) {
    this.inv = inventory;
    this.sound = opts.sound || null;
    this.onClose = opts.onClose || null;
    this.craftSize = 2;
    this.cursor = null;
    this.isOpen = false;
    this._suppressClick = false;
    this._pressTimer = null;

    this.hotbarEl = document.getElementById('hotbar');
    this.screenEl = document.getElementById('screen-inventory');
    this.bodyEl = document.getElementById('inv-body');
    this.titleEl = document.getElementById('inv-title');
    this.cursorEl = document.getElementById('inv-cursor');

    this.inv.onChange = () => this.refresh();
    this._bind();
    this.renderHotbar();
  }

  _bind() {
    const closeBtn = document.getElementById('inv-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
    if (this.hotbarEl) {
      this.hotbarEl.addEventListener('click', (e) => {
        const slot = e.target.closest('[data-hotbar]');
        if (!slot) return;
        this.inv.selectSlot(+slot.dataset.hotbar);
        this.sound?.play('click', { volume: 0.3 });
      });
    }
    if (this.bodyEl) {
      this.bodyEl.addEventListener('pointerdown', (e) => {
        const slot = e.target.closest('[data-kind]');
        if (!slot) return;
        this._suppressClick = false;
        clearTimeout(this._pressTimer);
        this._pressTimer = setTimeout(() => {
          this._suppressClick = true;
          this._splitSlot(slot.dataset.kind, slot.dataset.index ?? slot.dataset.id);
        }, 460);
      });
      const clear = () => {
        clearTimeout(this._pressTimer);
      };
      this.bodyEl.addEventListener('pointerup', clear);
      this.bodyEl.addEventListener('pointercancel', clear);
      this.bodyEl.addEventListener('pointerleave', clear);
      this.bodyEl.addEventListener('click', (e) => {
        if (this._suppressClick) {
          this._suppressClick = false;
          return;
        }
        const slot = e.target.closest('[data-kind]');
        if (!slot) return;
        this._onSlotClick(slot.dataset.kind, slot.dataset.index ?? slot.dataset.id);
      });
    }
    if (this.cursorEl) {
      this.cursorEl.addEventListener('click', () => this._returnCursor());
    }
  }

  _slotArray(kind) {
    if (kind === 'craft') return this.inv.craftGrid;
    if (kind === 'inv') return this.inv.slots;
    return null;
  }

  _splitSlot(kind, index) {
    const arr = this._slotArray(kind);
    if (!arr) return;
    const i = +index;
    const s = arr[i];
    if (!s || s.count < 2) return;
    const half = Math.floor(s.count / 2);
    if (this.cursor) return;
    this.cursor = { id: s.id, count: half, dur: s.dur };
    s.count -= half;
    this.sound?.play('click', { volume: 0.3 });
    this.refresh();
  }

  _onSlotClick(kind, idOrIndex) {
    if (kind === 'creative') {
      const id = idOrIndex;
      const item = getItem(id);
      if (!item) return;
      const max = itemMaxStack(id);
      const stack = { id, count: max };
      if (item.durability) {
        stack.count = 1;
        stack.dur = item.durability;
      }
      this.inv.setSlot(this.inv.hotbarIndex, stack);
      this.inv.notify();
      this.sound?.play('click', { volume: 0.25 });
      this.refresh();
      return;
    }
    if (kind === 'result') {
      this._takeResult();
      return;
    }
    const arr = this._slotArray(kind);
    if (!arr) return;
    const i = +idOrIndex;
    if (!this.cursor) {
      if (arr[i]) {
        this.cursor = arr[i];
        arr[i] = null;
        this._ensureDur(this.cursor);
        this.sound?.play('click', { volume: 0.25 });
      }
    } else {
      const target = arr[i];
      if (!target) {
        arr[i] = this.cursor;
        this.cursor = null;
      } else if (target.id === this.cursor.id && itemMaxStack(target.id) > 1) {
        const max = itemMaxStack(target.id);
        const move = Math.min(max - target.count, this.cursor.count);
        target.count += move;
        this.cursor.count -= move;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        arr[i] = this.cursor;
        this.cursor = target;
      }
      this.sound?.play('click', { volume: 0.25 });
    }
    this.inv.notify();
    this.refresh();
  }

  _ensureDur(stack) {
    const item = getItem(stack.id);
    if (item && item.durability && stack.dur === undefined) stack.dur = item.durability;
  }

  _takeResult() {
    const { grid, w, h } = this._craftGridInput();
    const res = matchRecipe(grid, w, h);
    if (!res) return;
    // 消耗材料
    for (const idx of this._craftIndices()) {
      const s = this.inv.craftGrid[idx];
      if (s) {
        s.count -= 1;
        if (s.count <= 0) this.inv.craftGrid[idx] = null;
      }
    }
    const left = this.inv.add(res.id, res.count);
    if (left > 0 && this.cursor && this.cursor.id === res.id) {
      this.cursor.count += left;
    }
    this.sound?.play('craft', { volume: 0.5 });
    this.inv.notify();
    this.refresh();
    if (this.onCraft) this.onCraft(res);
  }

  _craftIndices() {
    if (this.craftSize === 2) return [0, 1, 3, 4];
    return [0, 1, 2, 3, 4, 5, 6, 7, 8];
  }

  _craftGridInput() {
    const g = this.inv.craftGrid;
    if (this.craftSize === 2) {
      return { grid: [g[0], g[1], g[3], g[4]], w: 2, h: 2 };
    }
    return { grid: g.slice(0, 9), w: 3, h: 3 };
  }

  _returnCursor() {
    if (!this.cursor) return;
    const left = this.inv.add(this.cursor.id, this.cursor.count);
    this.cursor = left > 0 ? { ...this.cursor, count: left } : null;
    this.inv.notify();
    this.refresh();
  }

  show(craftSize = 2) {
    this.craftSize = craftSize === 3 ? 3 : 2;
    this.isOpen = true;
    this.screenEl.classList.remove('hidden');
    this.titleEl.textContent = this.craftSize === 3 ? '工作台' : '物品栏';
    this._renderBody();
    this.refresh();
  }

  hide() {
    this.isOpen = false;
    if (this.cursor) {
      const left = this.inv.add(this.cursor.id, this.cursor.count);
      if (left > 0) {
        // 背包满则丢弃
      }
      this.cursor = null;
    }
    this.inv.returnCrafting();
    this.screenEl.classList.add('hidden');
    if (this.onClose) this.onClose();
  }

  refresh() {
    this.renderHotbar();
    if (this.isOpen) {
      this._renderBody();
    }
  }

  renderHotbar() {
    if (!this.hotbarEl) return;
    let html = '';
    for (let i = 0; i < 9; i++) {
      const s = this.inv.slots[i];
      html += this._slotHTML({
        kind: 'hotbar-slot',
        attrs: `data-hotbar="${i}"`,
        stack: s,
        selected: i === this.inv.hotbarIndex,
        small: true,
      });
    }
    this.hotbarEl.innerHTML = html;
  }

  _slotHTML({ kind, attrs = '', stack, selected, small }) {
    const cls = ['slot'];
    if (selected) cls.push('selected');
    if (small) cls.push('small');
    let inner = '';
    if (stack && getItem(stack.id)) {
      const url = this.inv.iconURL(stack.id);
      inner += `<img class="icon" src="${url}" alt="">`;
      if (stack.count > 1) inner += `<span class="count">${stack.count}</span>`;
      const item = getItem(stack.id);
      if (item && item.durability && stack.dur !== undefined) {
        const pct = Math.max(0, Math.min(100, (stack.dur / item.durability) * 100));
        inner += `<span class="dur"><i style="width:${pct}%"></i></span>`;
      }
    }
    return `<div class="${cls.join(' ')}" data-kind="${kind}" ${attrs}>${inner}</div>`;
  }

  _renderBody() {
    const creative = this.inv.mode === 'creative';
    if (creative) this._renderCreative();
    else this._renderSurvival();
    this._renderCursor();
  }

  _renderSurvival() {
    const g = this.inv.craftGrid;
    let craftSlots = '';
    if (this.craftSize === 2) {
      const order = [0, 1, 3, 4];
      for (const idx of order) {
        craftSlots += this._slotHTML({ kind: 'craft', attrs: `data-index="${idx}"`, stack: g[idx] });
      }
    } else {
      for (let i = 0; i < 9; i++) {
        craftSlots += this._slotHTML({ kind: 'craft', attrs: `data-index="${i}"`, stack: g[i] });
      }
    }
    const { grid, w, h } = this._craftGridInput();
    const result = matchRecipe(grid, w, h);

    let invSlots = '';
    for (let i = 9; i < 36; i++) {
      invSlots += this._slotHTML({ kind: 'inv', attrs: `data-index="${i}"`, stack: this.inv.slots[i] });
    }
    let hotbarSlots = '';
    for (let i = 0; i < 9; i++) {
      hotbarSlots += this._slotHTML({ kind: 'inv', attrs: `data-index="${i}"`, stack: this.inv.slots[i] });
    }

    this.bodyEl.innerHTML = `
      <div class="inv-craft-area">
        <div class="craft-grid ${this.craftSize === 3 ? 'grid3' : 'grid2'}">${craftSlots}</div>
        <div class="craft-arrow">➜</div>
        <div class="result-wrap">
          ${result
            ? `<div class="slot result" data-kind="result" data-index="0"><img class="icon" src="${this.inv.iconURL(
                result.id,
              )}" alt=""><span class="count">${result.count}</span></div>`
            : '<div class="slot result" data-kind="result" data-index="0"></div>'}
        </div>
      </div>
      <div class="inv-grid">${invSlots}</div>
      <div class="hotbar-row">${hotbarSlots}</div>
      <div class="inv-hint">点击拿起/放下 · 长按分一半 · 2×2 合成在工作台外可用</div>
    `;
  }

  _renderCreative() {
    const ids = [];
    for (const id of ITEMS_FOR_CREATIVE()) ids.push(id);
    let html = '';
    for (const id of ids) {
      const item = getItem(id);
      if (!item) continue;
      const url = this.inv.iconURL(id);
      if (!url) continue;
      html += `<div class="slot creative-slot" data-kind="creative" data-id="${id}" title="${itemDisplay(
        id,
      )}"><img class="icon" src="${url}" alt=""></div>`;
    }
    let hotbarSlots = '';
    for (let i = 0; i < 9; i++) {
      hotbarSlots += this._slotHTML({ kind: 'inv', attrs: `data-index="${i}"`, stack: this.inv.slots[i], small: true });
    }
    this.bodyEl.innerHTML = `
      <div class="creative-title">创造物品栏 · 点击放入快捷栏</div>
      <div class="creative-grid">${html}</div>
      <div class="hotbar-row">${hotbarSlots}</div>
    `;
  }

  _renderCursor() {
    if (!this.cursorEl) return;
    if (!this.cursor) {
      this.cursorEl.classList.add('hidden');
      this.cursorEl.innerHTML = '';
      return;
    }
    this.cursorEl.classList.remove('hidden');
    const url = this.inv.iconURL(this.cursor.id);
    this.cursorEl.innerHTML = `<img class="icon" src="${url}" alt=""><span class="count">${this.cursor.count}</span>`;
  }
}

// 创造模式物品列表（方块在前，材料/工具在后）
let _creativeIds = null;
function ITEMS_FOR_CREATIVE() {
  if (_creativeIds) return _creativeIds;
  const ids = [];
  for (const id of [
    'grass_block', 'dirt', 'stone', 'cobblestone', 'sand', 'sandstone', 'gravel',
    'oak_log', 'oak_leaves', 'oak_planks', 'birch_log', 'birch_leaves', 'birch_planks',
    'spruce_log', 'spruce_leaves', 'spruce_planks',
    'glass', 'water', 'bedrock', 'clay', 'cactus',
    'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'snow', 'ice',
    'crafting_table', 'furnace', 'chest', 'bed', 'torch', 'rose', 'dandelion', 'tall_grass',
    'stone_bricks', 'obsidian', 'glowstone', 'lava', 'wool_white', 'brick',
    'stick', 'coal', 'iron_ingot', 'gold_ingot', 'diamond', 'apple', 'clay_ball',
    'beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'cooked_chicken',
    'feather', 'leather', 'bone', 'string', 'gunpowder', 'rotten_flesh', 'arrow', 'bread',
    'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe',
    'wooden_axe', 'stone_axe', 'iron_axe',
    'wooden_shovel', 'stone_shovel', 'iron_shovel',
    'wooden_sword', 'stone_sword', 'iron_sword',
  ]) ids.push(id);
  _creativeIds = ids;
  return ids;
}
