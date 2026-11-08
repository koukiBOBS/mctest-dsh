// ============================================================
// chat.js — 聊天栏与 Java 版风格命令
// ============================================================

import { ITEMS, getItem, itemDisplay, getBlockDef } from './blocks.js';

const MAX_LINES = 60;

export class ChatUI {
  constructor(game) {
    this.game = game; // { player, world, inventory, renderer, items, mobs, toast, invUI }
    this.open = false;
    this.lines = [];
    this.history = [];
    this.historyIndex = -1;

    this.root = document.getElementById('chat');
    if (this.root) this.root.classList.remove('hidden');
    this.logEl = document.getElementById('chat-log');
    this.formEl = document.getElementById('chat-form');
    this.inputEl = document.getElementById('chat-input');

    if (this.formEl) {
      this.formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = this.inputEl.value;
        this.inputEl.value = '';
        this.close();
        this.execute(text);
      });
    }
    if (this.inputEl) {
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.history.length) {
            this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
            this.inputEl.value = this.history[this.history.length - 1 - this.historyIndex];
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.historyIndex = Math.max(-1, this.historyIndex - 1);
          if (this.historyIndex < 0) this.inputEl.value = '';
          else this.inputEl.value = this.history[this.history.length - 1 - this.historyIndex];
        }
      });
    }
  }

  get isOpen() {
    return this.open;
  }

  show(text = '') {
    if (!this.root) return;
    this.open = true;
    this.root.classList.remove('hidden');
    this.root.classList.add('active');
    this.inputEl.value = text;
    this.historyIndex = -1;
    setTimeout(() => {
      try {
        this.inputEl.focus();
      } catch (e) {
        // ignore
      }
    }, 0);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    if (this.root) {
      this.root.classList.remove('active');
    }
    try {
      this.inputEl.blur();
    } catch (e) {
      // ignore
    }
    this.game.onChatClose?.();
  }

  log(text, color = '') {
    if (!text) return;
    this.lines.push({ text: String(text), color });
    while (this.lines.length > MAX_LINES) this.lines.shift();
    if (this.logEl) {
      const div = document.createElement('div');
      div.className = 'chat-line' + (color ? ' ' + color : '');
      div.textContent = String(text);
      this.logEl.appendChild(div);
      while (this.logEl.children.length > MAX_LINES) this.logEl.removeChild(this.logEl.firstChild);
      this.logEl.scrollTop = this.logEl.scrollHeight;
      // 淡出旧消息
      clearTimeout(this._fadeTimer);
      this._fadeTimer = setTimeout(() => {
        if (this.logEl) this.logEl.classList.add('faded');
      }, 9000);
    }
    if (this.logEl) this.logEl.classList.remove('faded');
  }

  execute(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    this.history.push(text);
    if (this.history.length > 60) this.history.shift();
    if (!text.startsWith('/')) {
      this.log('<玩家> ' + text);
      return;
    }
    const parts = text.slice(1).split(/\s+/).filter(Boolean);
    const cmd = (parts.shift() || '').toLowerCase();
    const p = this.game.player;
    const w = this.game.world;
    try {
      switch (cmd) {
        case 'help':
          this.log('命令：/gamemode <survival|creative> · /give <物品> [数量] · /time set <day|night|noon|midnight>');
          this.log('/tp · /weather · /locate · /achievements · /summon · /give · /gamemode · /seed · /spawn · /kill · /clear');
          break;
        case 'gamemode': {
          const m = (parts[0] || '').toLowerCase();
          const mode = m === 'creative' || m === '1' || m === 'c' ? 'creative' : 'survival';
          p.mode = mode;
          this.game.inventory.mode = mode;
          p.flying = false;
          this.game.invUI?.refresh();
          this.log('游戏模式已切换为：' + (mode === 'creative' ? '创造' : '生存'));
          break;
        }
        case 'give': {
          const id = parts[0] || '';
          const count = Math.max(1, Math.min(9999, Number(parts[1]) || 1));
          if (!ITEMS[id]) {
            this.log('未知物品：' + id, 'err');
            break;
          }
          const left = this.game.inventory.add(id, count);
          this.log('已给予 ' + itemDisplay(id) + ' ×' + (count - left) + (left > 0 ? '（背包已满）' : ''));
          break;
        }
        case 'time': {
          const arg = (parts[0] || '').toLowerCase();
          const value = (parts[1] || arg).toLowerCase();
          let t = w.time;
          if (value === 'day') t = 60;
          else if (value === 'noon') t = 150;
          else if (value === 'night') t = 420;
          else if (value === 'midnight') t = 450;
          else t = Number(value);
          if (isNaN(t)) {
            this.log('用法：/time set <day|noon|night|midnight|数字>', 'err');
            break;
          }
          w.time = ((t % 600) + 600) % 600;
          this.log('时间已设置：' + Math.floor((w.time / 600) * 24) + ' 点');
          break;
        }
        case 'tp': {
          const x = Number(parts[0]);
          const y = Number(parts[1]);
          const z = Number(parts[2]);
          if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
            this.log('用法：/tp <x> <y> <z>', 'err');
            break;
          }
          p.setPosition(x, y, z);
          w.ensureChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
          this.log('已传送到 ' + x + ' ' + y + ' ' + z);
          break;
        }
        case 'seed':
          this.log('世界种子：' + w.seed);
          break;
        case 'spawn':
          p.setPosition(p.spawn.x, p.spawn.y + 0.5, p.spawn.z);
          this.log('已回到出生点');
          break;
        case 'kill':
          p.damage(100, '被 /kill 杀死了');
          break;
        case 'clear':
          for (let i = 0; i < 36; i++) this.game.inventory.slots[i] = null;
          this.game.inventory.notify();
          this.log('背包已清空');
          break;
        case 'achievements': {
          const ach = this.game.achievements;
          if (!ach) {
            this.log('成就系统尚未加载', 'err');
            break;
          }
          const total = 33;
          this.log(`成就进度：${ach.unlocked.size}/${total}`);
          const names = [...ach.unlocked].join(', ') || '（还没有解锁任何成就）';
          this.log(names);
          break;
        }
        case 'locate': {
          const what = (parts[0] || '').toLowerCase();
          if (what === 'village') {
            const v = this.game.world.findNearestVillage(p.x, p.z);
            if (!v) this.log('附近没有找到村庄', 'err');
            else this.log(`最近的村庄：${v.centerX}, ${v.floorY}, ${v.centerZ}（约 ${Math.round(Math.hypot(v.centerX - p.x, v.centerZ - p.z))} 格）`);
          } else if (what === 'endcity') {
            const m = this.game.world.findNearestEndCity();
            if (!m) this.log('没有找到末地城', 'err');
            else this.log(`末地城：${m.x}, ${m.y}, ${m.z}（需在末地中）`);
          } else if (what === 'trial') {
            const m = this.game.world.findNearestTrialChamber(p.x, p.z);
            if (!m) this.log('附近没有找到试炼密室', 'err');
            else this.log(`最近的试炼密室：${m.centerX}, ${m.y}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'city') {
            const m = this.game.world.findNearestAncientCity(p.x, p.z);
            if (!m) this.log('附近没有找到远古城市', 'err');
            else this.log(`最近的远古城市：${m.centerX}, ${m.y}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'monument') {
            const m = this.game.world.findNearestMonument(p.x, p.z);
            if (!m) this.log('附近没有找到海底遗迹', 'err');
            else this.log(`最近的海底遗迹：${m.centerX}, ${m.floorY}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'ruin') {
            const m = this.game.world.findNearestRuinedPortal(p.x, p.z);
            if (!m) this.log('附近没有找到废弃传送门', 'err');
            else this.log(`最近的废弃传送门：${m.centerX}, ${m.floorY}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'mansion') {
            const m = this.game.world.findNearestMansion(p.x, p.z);
            if (!m) this.log('附近没有找到林地府邸', 'err');
            else this.log(`最近的林地府邸：${m.centerX}, ${m.floorY}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'stronghold') {
            const m = this.game.world.findNearestStronghold(p.x, p.z);
            if (!m) this.log('附近没有找到地下要塞', 'err');
            else this.log(`最近的地下要塞：${m.centerX}, ${m.y}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'temple') {
            const m = this.game.world.findNearestTemple(p.x, p.z);
            if (!m) this.log('附近没有找到沙漠神殿', 'err');
            else this.log(`最近的沙漠神殿：${m.centerX}, ${m.floorY}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'igloo') {
            const m = this.game.world.findNearestIgloo(p.x, p.z);
            if (!m) this.log('附近没有找到雪屋', 'err');
            else this.log(`最近的雪屋：${m.centerX}, ${m.floorY}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'mineshaft') {
            const m = this.game.world.findNearestMineshaft(p.x, p.z);
            if (!m) this.log('附近没有找到矿洞', 'err');
            else this.log(`最近的矿洞：${m.centerX}, ${m.y}, ${m.centerZ}（约 ${Math.round(Math.hypot(m.centerX - p.x, m.centerZ - p.z))} 格）`);
          } else if (what === 'dungeon') {
            const d = this.game.world.findNearestDungeon(p.x, p.z);
            if (!d) this.log('附近没有找到地牢', 'err');
            else this.log(`最近的地牢：${d.x}, ${d.y}, ${d.z}（约 ${Math.round(Math.hypot(d.x - p.x, d.z - p.z))} 格）`);
          } else {
            this.log('用法：/locate village|dungeon|mineshaft|temple|igloo|stronghold|mansion|monument|ruin|city|trial|endcity', 'err');
          }
          break;
        }
        case 'weather': {
          const t = (parts[0] || '').toLowerCase();
          if (!this.game.weather) {
            this.log('天气系统尚未加载', 'err');
            break;
          }
          if (!['clear', 'rain', 'thunder', 'snow'].includes(t)) {
            this.log('用法：/weather clear|rain|thunder|snow', 'err');
            break;
          }
          this.game.weather.setType(t);
          break;
        }
        case 'summon': {
          const type = (parts[0] || '').toLowerCase();
          if (!this.game.mobs) {
            this.log('生物系统尚未加载', 'err');
            break;
          }
          const count = Math.max(1, Math.min(10, Number(parts[1]) || 1));
          const dir = this.game.player.forwardVector();
          let n = 0;
          for (let i = 0; i < count; i++) {
            const m = this.game.mobs.spawn(type, p.x + dir.x * 3 + (Math.random() - 0.5), p.y + 1, p.z + dir.z * 3 + (Math.random() - 0.5));
            if (m) n++;
          }
          this.log(n > 0 ? '已生成 ' + n + ' 只 ' + type : '未知生物：' + type, n > 0 ? '' : 'err');
          break;
        }
        default:
          this.log('未知命令：/' + cmd + '（输入 /help 查看帮助）', 'err');
      }
    } catch (err) {
      this.log('命令执行出错：' + (err && err.message ? err.message : err), 'err');
    }
  }
}
