// ============================================================
// containers.js — 箱子 / 熔炉（存储、冶炼、界面）
// ============================================================

import { getItem, itemMaxStack, itemDisplay, getBlockDef } from './blocks.js';

export const SMELT_TIME = 10; // 秒/个

const SMELT_RECIPES = new Map(
  Object.entries({
    iron_ore: 'iron_ingot',
    gold_ore: 'gold_ingot',
    sand: 'glass',
    cobblestone: 'stone',
    beef: 'cooked_beef',
    porkchop: 'cooked_porkchop',
    chicken: 'cooked_chicken',
    clay_ball: 'brick',
  }),
);

const FUEL_VALUES = new Map(
  Object.entries({
    coal: 80,
    oak_planks: 15,
    birch_planks: 15,
    spruce_planks: 15,
    oak_log: 15,
    birch_log: 15,
    spruce_log: 15,
    stick: 5,
    crafting_table: 15,
    chest: 15,
  }),
);

function stack(id, count = 1) {
  const item = getItem(id);
  if (!item) return null;
  const s = { id, count };
  if (item.durability) s.dur = item.durability;
  return s;
}

function copyStack(s) {
  return s ? { ...s } : null;
}

export class ContainerManager {
  constructor(game) {
    this.game = game; // { world, items, sound, dropItem, onContainerChange }
    this.chests = new Map();
    this.furnaces = new Map();
  }

  ensureChest(key) {
    let s = this.chests.get(key);
    if (!s) {
      s = { type: 'chest', slots: new Array(27).fill(null) };
      this.chests.set(key, s);
      // 地牢等结构生成的箱子带战利品
      try {
        const world = this.game && this.game.world;
        const loot = world && world.takeStructureLoot ? world.takeStructureLoot(key) : null;
        if (loot && loot.length) {
          for (let i = 0; i < loot.length && i < 27; i++) {
            const item = loot[i];
            if (!item || !getItem(item.id)) continue;
            const st = stack(item.id, Math.max(1, item.count | 0));
            if (st) s.slots[i * 2 % 27] = st;
          }
        }
      } catch (e) {
        // ignore
      }
    }
    return s;
  }

  ensureFurnace(key) {
    let s = this.furnaces.get(key);
    if (!s) {
      s = { type: 'furnace', input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
      this.furnaces.set(key, s);
    }
    return s;
  }

  get(type, key) {
    return type === 'chest' ? this.chests.get(key) : this.furnaces.get(key);
  }

  open(hit) {
    if (!hit) return null;
    const def = getBlockDef(hit.id);
    const key = hit.x + ',' + hit.y + ',' + hit.z;
    if (def.name === 'chest') return { type: 'chest', key, state: this.ensureChest(key) };
    if (def.name === 'furnace') return { type: 'furnace', key, state: this.ensureFurnace(key) };
    return null;
  }

  // ---------- 冶炼 ----------
  tick(dt) {
    const changed = { value: false };
    for (const furnace of this.furnaces.values()) {
      this._tickFurnace(furnace, dt, changed);
    }
    if (changed.value && this.game.onContainerChange) this.game.onContainerChange();
  }

  _canSmelt(f) {
    if (!f.input) return false;
    const out = SMELT_RECIPES.get(f.input.id);
    if (!out) return false;
    if (!f.output) return true;
    if (f.output.id !== out) return false;
    return f.output.count < itemMaxStack(out);
  }

  _tickFurnace(f, dt, changed) {
    const can = this._canSmelt(f);
    if (f.burn <= 0 && can && f.fuel && FUEL_VALUES.get(f.fuel.id)) {
      const burn = FUEL_VALUES.get(f.fuel.id);
      f.fuel.count -= 1;
      if (f.fuel.count <= 0) f.fuel = null;
      f.burn = burn;
      f.burnMax = burn;
      changed.value = true;
    }
    if (f.burn > 0) {
      f.burn = Math.max(0, f.burn - dt);
      f.burnMax = Math.max(f.burnMax, 0.001);
    }
    if (f.burn > 0 && can) {
      f.cook += dt;
      if (f.cook >= SMELT_TIME) {
        f.cook = 0;
        const outId = SMELT_RECIPES.get(f.input.id);
        f.input.count -= 1;
        if (f.input.count <= 0) f.input = null;
        if (f.output) f.output.count += 1;
        else f.output = stack(outId, 1);
        if (this.game.achievements) this.game.achievements.onEvent('smelt', { id: outId });
        changed.value = true;
      }
    } else {
      f.cook = Math.max(0, f.cook - dt * 2);
    }
  }

  // ---------- 破坏方块时掉出内容物 ----------
  dropAndRemove(hit) {
    const key = hit.x + ',' + hit.y + ',' + hit.z;
    const drop = this.game.dropItem;
    const dropStack = (s) => {
      if (!s || !s.count) return;
      if (typeof drop === 'function') drop(s.id, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, s.count);
    };
    const chest = this.chests.get(key);
    if (chest) {
      for (const s of chest.slots) dropStack(s);
      this.chests.delete(key);
      return true;
    }
    const furnace = this.furnaces.get(key);
    if (furnace) {
      dropStack(furnace.input);
      dropStack(furnace.fuel);
      dropStack(furnace.output);
      this.furnaces.delete(key);
      return true;
    }
    return false;
  }

  // ---------- 存档 ----------
  serialize() {
    return {
      chests: [...this.chests.entries()].map(([k, s]) => ({ k, slots: s.slots })),
      furnaces: [...this.furnaces.entries()].map(([k, f]) => ({
        k,
        input: f.input,
        fuel: f.fuel,
        output: f.output,
        burn: f.burn,
        burnMax: f.burnMax,
        cook: f.cook,
      })),
    };
  }

  load(data) {
    this.clear();
    if (!data) return;
    if (Array.isArray(data.chests)) {
      for (const entry of data.chests) {
        if (!entry || typeof entry.k !== 'string') continue;
        const slots = new Array(27).fill(null);
        if (Array.isArray(entry.slots)) {
          for (let i = 0; i < 27 && i < entry.slots.length; i++) {
            const s = entry.slots[i];
            if (s && getItem(s.id)) slots[i] = stack(s.id, Math.max(1, s.count | 0));
          }
        }
        this.chests.set(entry.k, { type: 'chest', slots });
      }
    }
    if (Array.isArray(data.furnaces)) {
      for (const entry of data.furnaces) {
        if (!entry || typeof entry.k !== 'string') continue;
        const f = this.ensureFurnace(entry.k);
        if (entry.input && getItem(entry.input.id)) f.input = stack(entry.input.id, Math.max(1, entry.input.count | 0));
        if (entry.fuel && getItem(entry.fuel.id)) f.fuel = stack(entry.fuel.id, Math.max(1, entry.fuel.count | 0));
        if (entry.output && getItem(entry.output.id)) f.output = stack(entry.output.id, Math.max(1, entry.output.count | 0));
        f.burn = Math.max(0, Number(entry.burn) || 0);
        f.burnMax = Math.max(0, Number(entry.burnMax) || 0);
        f.cook = Math.max(0, Number(entry.cook) || 0);
      }
    }
  }

  clear() {
    this.chests.clear();
    this.furnaces.clear();
  }
}

// ============================================================
// ContainerUI — 箱子/熔炉界面
// ============================================================
export class ContainerUI {
  constructor(manager, inventory, opts = {}) {
    this.manager = manager;
    this.inv = inventory;
    this.sound = opts.sound || null;
    this.onClose = opts.onClose || null;
    this.type = null;
    this.key = null;
    this.cursor = null;
    this.isOpen = false;
    this._refreshTimer = 0;

    this.root = document.getElementById('screen-container');
    this.titleEl = document.getElementById('container-title');
    this.bodyEl = document.getElementById('container-body');
    this.cursorEl = document.getElementById('container-cursor');
    this.closeBtn = document.getElementById('container-close');

    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.hide());
    if (this.bodyEl) {
      this.bodyEl.addEventListener('click', (e) => {
        const slot = e.target.closest('[data-kind]');
        if (!slot) return;
        this._onSlotClick(slot.dataset.kind, slot.dataset.index ?? slot.dataset.slot);
      });
    }
    if (this.cursorEl) {
      this.cursorEl.addEventListener('click', () => this._returnCursor());
    }
  }

  get state() {
    return this.manager.get(this.type, this.key);
  }

  show(key, type) {
    this.key = key;
    this.type = type;
    this.cursor = null;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.titleEl.textContent = type === 'chest' ? '箱子' : '熔炉';
    this.refresh();
  }

  hide() {
    if (!this.isOpen) return;
    if (this.cursor) {
      const left = this.inv.add(this.cursor.id, this.cursor.count);
      this.cursor = left > 0 ? { ...this.cursor, count: left } : null;
    }
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.type = null;
    this.key = null;
    if (this.onClose) this.onClose();
  }

  update(dt) {
    if (!this.isOpen) return;
    this._refreshTimer += dt;
    if (this._refreshTimer >= 0.25) {
      this._refreshTimer = 0;
      if (this.type === 'furnace') this.refresh();
    }
  }

  refreshIfOpen() {
    if (this.isOpen) this.refresh();
  }

  // ---------- 数据访问 ----------
  _getStack(kind, index) {
    if (kind === 'inv') return this.inv.slots[+index] || null;
    if (kind === 'chest') return (this.state && this.state.slots[+index]) || null;
    if (kind === 'furnace') {
      const state = this.state;
      if (!state) return null;
      if (index === 'input') return state.input;
      if (index === 'fuel') return state.fuel;
      if (index === 'output') return state.output;
    }
    return null;
  }

  _setStack(kind, index, s) {
    if (kind === 'inv') this.inv.slots[+index] = s;
    else if (kind === 'chest') this.state.slots[+index] = s;
    else if (kind === 'furnace') {
      const state = this.state;
      if (!state) return;
      if (index === 'input') state.input = s;
      else if (index === 'fuel') state.fuel = s;
      else if (index === 'output') state.output = s;
    }
  }

  _onSlotClick(kind, index) {
    if (kind === 'output') {
      this._takeOutput();
      return;
    }
    const current = this._getStack(kind, index);
    if (!this.cursor) {
      if (current) {
        this.cursor = current;
        this._setStack(kind, index, null);
        this.sound?.play('click', { volume: 0.25 });
      }
    } else {
      if (!current) {
        this._setStack(kind, index, this.cursor);
        this.cursor = null;
      } else if (current.id === this.cursor.id && itemMaxStack(current.id) > 1) {
        const max = itemMaxStack(current.id);
        const move = Math.min(max - current.count, this.cursor.count);
        current.count += move;
        this.cursor.count -= move;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        this._setStack(kind, index, this.cursor);
        this.cursor = current;
      }
      this.sound?.play('click', { volume: 0.25 });
    }
    this.inv.notify();
    this.refresh();
  }

  _takeOutput() {
    const state = this.state;
    if (!state || !state.output) return;
    const out = state.output;
    if (this.cursor) {
      if (this.cursor.id === out.id && itemMaxStack(out.id) > 1 && this.cursor.count + out.count <= itemMaxStack(out.id)) {
        this.cursor.count += out.count;
        state.output = null;
      }
      return;
    }
    this.cursor = out;
    state.output = null;
    this.sound?.play('pop', { volume: 0.3 });
    this.refresh();
  }

  _returnCursor() {
    if (!this.cursor) return;
    const left = this.inv.add(this.cursor.id, this.cursor.count);
    this.cursor = left > 0 ? { ...this.cursor, count: left } : null;
    this.inv.notify();
    this.refresh();
  }

  // ---------- 渲染 ----------
  _slotHTML(kind, index, s, extraClass = '') {
    const cls = ['slot'];
    if (extraClass) cls.push(extraClass);
    let inner = '';
    if (s && getItem(s.id)) {
      const url = this.inv.iconURL(s.id);
      inner += `<img class="icon" src="${url}" alt="">`;
      if (s.count > 1) inner += `<span class="count">${s.count}</span>`;
      const item = getItem(s.id);
      if (item && item.durability && s.dur !== undefined) {
        const pct = Math.max(0, Math.min(100, (s.dur / item.durability) * 100));
        inner += `<span class="dur"><i style="width:${pct}%"></i></span>`;
      }
    }
    return `<div class="${cls.join(' ')}" data-kind="${kind}" data-index="${index}">${inner}</div>`;
  }

  _playerInventoryHTML() {
    let inv = '';
    for (let i = 9; i < 36; i++) inv += this._slotHTML('inv', i, this.inv.slots[i]);
    let hot = '';
    for (let i = 0; i < 9; i++) hot += this._slotHTML('inv', i, this.inv.slots[i]);
    return `<div class="inv-grid">${inv}</div><div class="hotbar-row">${hot}</div>`;
  }

  refresh() {
    if (!this.isOpen || !this.bodyEl) return;
    if (this.type === 'chest') this._renderChest();
    else this._renderFurnace();
    this._renderCursor();
  }

  _renderChest() {
    const state = this.state;
    let slots = '';
    for (let i = 0; i < 27; i++) slots += this._slotHTML('chest', i, state ? state.slots[i] : null);
    this.bodyEl.innerHTML = `<div class="container-grid">${slots}</div>${this._playerInventoryHTML()}`;
  }

  _renderFurnace() {
    const state = this.state;
    const burnPct = state && state.burnMax > 0 ? Math.round((state.burn / state.burnMax) * 100) : 0;
    const cookPct = Math.round(((state && state.cook) || 0) / SMELT_TIME * 100);
    this.bodyEl.innerHTML = `
      <div class="furnace-area">
        <div class="furnace-column">
          ${this._slotHTML('furnace', 'input', state ? state.input : null, 'furnace-slot')}
          <div class="flame ${burnPct > 0 ? 'lit' : ''}"><i style="height:${burnPct}%"></i></div>
          ${this._slotHTML('furnace', 'fuel', state ? state.fuel : null, 'furnace-slot')}
        </div>
        <div class="furnace-progress">
          <div class="furnace-arrow"><i style="width:${cookPct}%"></i></div>
          <div class="furnace-hint">冶炼 10 秒/个</div>
        </div>
        ${this._slotHTML('furnace', 'output', state ? state.output : null, 'furnace-slot result')}
      </div>
      <div class="inv-hint">燃料：煤炭 80 秒 · 木板/原木 15 秒 · 木棍 5 秒</div>
      ${this._playerInventoryHTML()}
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
