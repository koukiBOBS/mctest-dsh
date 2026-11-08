// ============================================================
// achievements.js — 成就系统（原版 advancements 风格提示）
// ============================================================

export const ACHIEVEMENTS = [
  { id: 'wood', name: '木头！', desc: '破坏一个原木方块' },
  { id: 'workbench', name: '工作台', desc: '合成一个工作台' },
  { id: 'pickaxe', name: '要去挖矿了', desc: '合成一把镐子' },
  { id: 'stone', name: '石器时代', desc: '挖到圆石' },
  { id: 'iron', name: '铁器时代', desc: '获得铁锭' },
  { id: 'diamond', name: '钻石！', desc: '挖到钻石矿石' },
  { id: 'hunter', name: '怪物猎人', desc: '击杀一只敌对生物' },
  { id: 'farmer', name: '农夫', desc: '收获成熟的小麦' },
  { id: 'bed', name: '安眠', desc: '合成一张床' },
  { id: 'sleep', name: '好好睡一觉', desc: '在床上睡到天亮' },
  { id: 'cook', name: '烧烤时间', desc: '在熔炉里烤熟食物' },
  { id: 'village', name: '村庄探险家', desc: '发现一个村庄' },
  { id: 'dungeon', name: '深入地牢', desc: '发现一个地牢' },
  { id: 'mineshaft', name: '废弃矿井', desc: '发现一处废弃矿洞' },
  { id: 'rain', name: '雨天', desc: '经历一次下雨' },
  { id: 'temple', name: '沙漠宝藏', desc: '发现一座沙漠神殿' },
  { id: 'igloo', name: '冰原小屋', desc: '发现一座雪屋' },
  { id: 'stronghold', name: '要塞探险家', desc: '发现一座地下要塞' },
  { id: 'trade', name: '讨价还价', desc: '和村民完成一次交易' },
  { id: 'enchant', name: '附魔大师', desc: '在附魔台为物品附魔一次' },
  { id: 'brew', name: '魔药学家', desc: '在酿造台酿造一瓶药水' },
  { id: 'nether', name: '下界之旅', desc: '穿过下界传送门进入下界' },
  { id: 'end', name: '末地之旅', desc: '穿过末地传送门进入末地' },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export class Achievements {
  constructor(game) {
    this.game = game; // { sound, chat, onUnlock? }
    this.unlocked = new Set();
    this.queue = [];
    this.current = null;
    this.timer = 0;
    this.el = typeof document !== 'undefined' ? document.getElementById('achievement-popup') : null;
  }

  has(id) {
    return this.unlocked.has(id);
  }

  unlock(id) {
    if (this.unlocked.has(id)) return false;
    const def = BY_ID.get(id);
    if (!def) return false;
    this.unlocked.add(id);
    this.queue.push(def);
    this.game.sound?.play('craft', { volume: 0.45 });
    this.game.chat?.log('🏆 成就达成：' + def.name);
    if (this.game.onAchievementUnlocked) this.game.onAchievementUnlocked(id);
    if (!this.current) this._next();
    return true;
  }

  _next() {
    const def = this.queue.shift();
    if (!def || !this.el) {
      this.current = null;
      return;
    }
    this.current = def;
    this.timer = 4.5;
    this.el.innerHTML = `<div class="ach-title">🏆 成就达成</div><div class="ach-name">${def.name}</div><div class="ach-desc">${def.desc}</div>`;
    this.el.classList.remove('hidden');
    requestAnimationFrame(() => this.el.classList.add('show'));
  }

  update(dt) {
    if (!this.current) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.el) {
        this.el.classList.remove('show');
        setTimeout(() => {
          if (!this.current) this.el.classList.add('hidden');
        }, 260);
      }
      this.current = null;
      if (this.queue.length) setTimeout(() => this._next(), 300);
    }
  }

  onEvent(type, data = {}) {
    switch (type) {
      case 'mine': {
        const name = data.name || '';
        if (name === 'oak_log' || name === 'birch_log' || name === 'spruce_log') this.unlock('wood');
        if (name === 'stone') this.unlock('stone');
        if (name === 'diamond_ore') this.unlock('diamond');
        if (name === 'iron_ore') this.unlock('iron');
        break;
      }
      case 'place': {
        const name = data.name || '';
        if (name === 'oak_log' || name === 'birch_log' || name === 'spruce_log') this.unlock('wood');
        break;
      }
      case 'craft': {
        const id = data.id || '';
        if (id === 'crafting_table') this.unlock('workbench');
        if (id === 'bed') this.unlock('bed');
        if (id.endsWith('_pickaxe')) this.unlock('pickaxe');
        break;
      }
      case 'kill':
        if (data.hostile) this.unlock('hunter');
        break;
      case 'harvest':
        this.unlock('farmer');
        break;
      case 'sleep':
        this.unlock('sleep');
        break;
      case 'smelt': {
        const id = data.id || '';
        if (id === 'iron_ingot') this.unlock('iron');
        if (id.startsWith('cooked_')) this.unlock('cook');
        break;
      }
      case 'brew':
        this.unlock('brew');
        break;
      case 'enchant':
        this.unlock('enchant');
        break;
      case 'trade':
        this.unlock('trade');
        break;
      case 'rain':
        this.unlock('rain');
        break;
      case 'discover':
        if (data.kind === 'village') this.unlock('village');
        else if (data.kind === 'dungeon') this.unlock('dungeon');
        else if (data.kind === 'mineshaft') this.unlock('mineshaft');
        else if (data.kind === 'temple') this.unlock('temple');
        else if (data.kind === 'igloo') this.unlock('igloo');
        else if (data.kind === 'stronghold') this.unlock('stronghold');
        else if (data.kind === 'nether') this.unlock('nether');
        else if (data.kind === 'end') this.unlock('end');
        break;
      default:
        break;
    }
  }

  serialize() {
    return [...this.unlocked];
  }

  load(list) {
    if (!Array.isArray(list)) return;
    for (const id of list) if (BY_ID.has(id)) this.unlocked.add(id);
  }
}
