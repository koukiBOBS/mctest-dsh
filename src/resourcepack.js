/**
 * 本地资源包（Minecraft 风格 PNG 贴图）导入 / 保存 / 读取。
 *
 * - 玩家提供的原版资源包 ZIP 或零散 PNG 只保存在本机 localStorage。
 * - 方块贴图统一重建为 16x16 canvas，物品图标为 32x32 canvas。
 * - 本模块不在顶层访问 document / Image / localStorage，方便被静态检查。
 *
 * 保存结构：
 *   mcweb.resourcepack = {
 *     savedAt: number,
 *     tiles: { [我们的tile名]: dataURL },
 *     icons: { [我们的图标名]: dataURL }
 *   }
 */

import { unzipSync } from '../vendor/fflate.js';

const STORAGE_KEY = 'mcweb.resourcepack';
const MAX_ZIP_BYTES = 30 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024; // 单张 PNG 解压后的上限，防异常压缩包
const TILE_SIZE = 16;
const ICON_SIZE = 32;

/** 我们的 tile 名 -> 资源包里的贴图文件名候选（优先级从高到低，不含目录和 .png）。 */
export const TILE_SOURCES = {
  grass_top: ['grass_block_top', 'grass_top'],
  grass_side: ['grass_block_side', 'grass_side'],
  dirt: ['dirt'],
  stone: ['stone'],
  cobblestone: ['cobblestone'],
  sand: ['sand'],
  sandstone_top: ['sandstone_top'],
  sandstone_side: ['sandstone', 'sandstone_side'],
  gravel: ['gravel'],
  oak_log_side: ['oak_log', 'oak_log_side', 'log_oak'],
  oak_log_top: ['oak_log_top', 'log_oak_top'],
  oak_leaves: ['oak_leaves', 'leaves_oak'],
  oak_planks: ['oak_planks', 'planks_oak'],
  glass: ['glass'],
  water: ['water_still', 'water_flow', 'water'],
  bedrock: ['bedrock'],
  coal_ore: ['coal_ore'],
  iron_ore: ['iron_ore'],
  gold_ore: ['gold_ore'],
  diamond_ore: ['diamond_ore'],
  snow: ['snow'],
  ice: ['ice'],
  crafting_table_top: ['crafting_table_top'],
  crafting_table_side: ['crafting_table_side'],
  crafting_table_front: ['crafting_table_front'],
  torch: ['torch'],
  rose: ['poppy', 'rose'],
  dandelion: ['dandelion'],
  tall_grass: ['short_grass', 'tall_grass', 'grass', 'tallgrass'],
  stone_bricks: ['stone_bricks', 'stonebrick'],
  obsidian: ['obsidian'],
  glowstone: ['glowstone'],
  lava: ['lava_still', 'lava_flow', 'lava'],
  wool_white: ['white_wool', 'wool_colored_white'],
  brick: ['bricks', 'brick'],
};

/** 我们的物品图标名 -> 资源包里的物品贴图文件名候选。 */
export const ITEM_SOURCES = {
  stick: ['stick'],
  coal: ['coal'],
  iron_ingot: ['iron_ingot'],
  gold_ingot: ['gold_ingot'],
  diamond: ['diamond'],
  apple: ['apple', 'golden_apple'],
  wooden_pickaxe: ['wooden_pickaxe'],
  stone_pickaxe: ['stone_pickaxe'],
  iron_pickaxe: ['iron_pickaxe'],
  wooden_axe: ['wooden_axe'],
  stone_axe: ['stone_axe'],
  iron_axe: ['iron_axe'],
  wooden_shovel: ['wooden_shovel'],
  stone_shovel: ['stone_shovel'],
  iron_shovel: ['iron_shovel'],
  wooden_sword: ['wooden_sword'],
  stone_sword: ['stone_sword'],
  iron_sword: ['iron_sword'],
};

let customTiles = new Map();
let customIcons = new Map();
let savedAt = null;
// 是否已经尝试从 localStorage 读取过，避免 import 时把已有存档覆盖掉。
let storageChecked = false;

/* ------------------------------------------------------------------ */
/* 对外状态 API                                                        */
/* ------------------------------------------------------------------ */

export function hasPack() {
  return customTiles.size > 0 || customIcons.size > 0;
}

export function getCustomTiles() {
  return customTiles;
}

export function getCustomIcons() {
  return customIcons;
}

export function packSummary() {
  return {
    tiles: customTiles.size,
    icons: customIcons.size,
    savedAt,
  };
}

/* ------------------------------------------------------------------ */
/* 通用小工具                                                          */
/* ------------------------------------------------------------------ */

function storageAvailable() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (_) {
    return false;
  }
}

function removeStoredPack() {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    /* 忽略清理失败，至少内存仍然可用 */
  }
}

function resetMemory() {
  customTiles = new Map();
  customIcons = new Map();
  savedAt = null;
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/').toLowerCase();
}

function isBlockTexturePath(path) {
  return /(^|\/)textures\/block\//.test(normalizePath(path));
}

function isItemTexturePath(path) {
  return /(^|\/)textures\/item\//.test(normalizePath(path));
}

/** 去掉目录、.png 后缀并转小写，得到用于候选匹配的文件名。 */
function assetBaseName(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return file.replace(/\.png$/i, '').toLowerCase();
}

function pickSource(primary, loose, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const key = candidates[i];
    if (primary.has(key)) return primary.get(key);
    if (loose.has(key)) return loose.get(key);
  }
  return null;
}

function readFileBuffer(file) {
  if (file && typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('当前环境不支持读取文件'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

/* ------------------------------------------------------------------ */
/* Image / Canvas 解码                                                 */
/* ------------------------------------------------------------------ */

function drawToCanvas(image, size) {
  if (typeof document === 'undefined' || !document.createElement) {
    throw new Error('当前环境不支持 Canvas');
  }
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  if (!width || !height) throw new Error('图片尺寸无效');

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布');

  ctx.imageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;

  // 动画贴图（water_still / lava_still 等）是纵向帧条，取最上面的第一帧；
  // 其它情况是正方形贴图，直接整体缩放，保持像素风。
  const sourceSize = Math.min(width, height);
  ctx.drawImage(image, 0, 0, sourceSize, sourceSize, 0, 0, size, size);
  return canvas;
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('当前环境不支持图片解码'));
      return;
    }
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      reject(new Error('当前环境不支持图片解码'));
      return;
    }

    let url;
    try {
      url = URL.createObjectURL(blob);
    } catch (error) {
      reject(error);
      return;
    }

    const image = new Image();
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        /* ignore */
      }
      if (ok) resolve(image);
      else reject(error || new Error('图片解码失败'));
    };

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    try {
      image.src = url;
    } catch (error) {
      finish(false, error);
    }
  });
}

function sourceToCanvas(source, size) {
  return new Promise((resolve, reject) => {
    const BlobCtor = typeof Blob !== 'undefined' ? Blob : null;
    let blob;
    if (BlobCtor && source instanceof BlobCtor) {
      blob = source;
    } else if (source instanceof Uint8Array) {
      if (!BlobCtor) {
        reject(new Error('当前环境不支持二进制图片'));
        return;
      }
      blob = new Blob([source], { type: 'image/png' });
    } else if (source instanceof ArrayBuffer) {
      if (!BlobCtor) {
        reject(new Error('当前环境不支持二进制图片'));
        return;
      }
      blob = new Blob([source], { type: 'image/png' });
    } else {
      reject(new Error('未知的图片数据'));
      return;
    }

    loadImageFromBlob(blob).then(
      (image) => {
        try {
          resolve(drawToCanvas(image, size));
        } catch (error) {
          reject(error);
        }
      },
      reject,
    );
  });
}

function dataUrlToCanvas(url, size) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    let image;
    try {
      image = new Image();
    } catch (_) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (!ok) {
        resolve(null);
        return;
      }
      try {
        resolve(drawToCanvas(image, size));
      } catch (_) {
        resolve(null);
      }
    };

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    try {
      image.src = url;
    } catch (_) {
      finish(false);
    }
  });
}

/* ------------------------------------------------------------------ */
/* 文件来源收集                                                        */
/* ------------------------------------------------------------------ */

async function collectSources(files, errors) {
  const block = new Map(); // 文件名 -> Uint8Array
  const item = new Map(); // 文件名 -> Uint8Array
  const loose = new Map(); // 文件名 -> File

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file || typeof file.name !== 'string') {
      errors.push('存在无法识别的文件');
      continue;
    }

    const name = file.name;
    const lower = name.toLowerCase();
    const mime = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    const size = typeof file.size === 'number' ? file.size : 0;
    const isZip = lower.endsWith('.zip') || mime === 'application/zip' || mime === 'application/x-zip-compressed';
    const isPng = lower.endsWith('.png') || mime === 'image/png';

    if (isZip) {
      if (size === 0) {
        errors.push(`${name} 是空文件`);
        continue;
      }
      if (size > MAX_ZIP_BYTES) {
        errors.push(`${name} 超过 30MB，已跳过`);
        continue;
      }

      let buffer;
      try {
        buffer = await readFileBuffer(file);
      } catch (_) {
        errors.push(`${name} 读取失败`);
        continue;
      }

      let unzipped;
      try {
        // filter 让 fflate 只解压需要的 block/item PNG，避免大型资源包占用过多内存。
        unzipped = unzipSync(new Uint8Array(buffer), {
          filter: (entry) => {
            const entryPath = normalizePath(entry && entry.name);
            if (!entryPath.endsWith('.png')) return false;
            if (!isBlockTexturePath(entryPath) && !isItemTexturePath(entryPath)) return false;
            return !(entry && typeof entry.originalSize === 'number' && entry.originalSize > MAX_ENTRY_BYTES);
          },
        });
      } catch (_) {
        errors.push(`${name} 不是有效的 ZIP 文件`);
        continue;
      }

      for (const entryPath of Object.keys(unzipped || {})) {
        const entryData = unzipped[entryPath];
        const path = normalizePath(entryPath);
        if (!path.endsWith('.png')) continue;
        if (!entryData || typeof entryData.length !== 'number' || entryData.length === 0) continue;
        if (entryData.length > MAX_ENTRY_BYTES) continue;

        let target = null;
        if (isBlockTexturePath(path)) target = block;
        else if (isItemTexturePath(path)) target = item;
        if (!target) continue;

        const base = assetBaseName(path);
        if (!base) continue;
        // 同名条目只保留 zip 中先出现的那个。
        if (!target.has(base)) target.set(base, entryData);
      }
    } else if (isPng) {
      if (size === 0) {
        errors.push(`${name} 是空文件`);
        continue;
      }
      const base = assetBaseName(lower);
      if (!base) continue;
      if (!loose.has(base)) loose.set(base, file);
    } else {
      errors.push(`${name} 不是 .zip 或 .png 文件`);
    }
  }

  return { block, item, loose };
}

async function buildFromSources(sources, errors) {
  const tiles = new Map();
  const icons = new Map();

  for (const [tileName, candidates] of Object.entries(TILE_SOURCES)) {
    const source = pickSource(sources.block, sources.loose, candidates);
    if (!source) continue;
    try {
      const canvas = await sourceToCanvas(source, TILE_SIZE);
      tiles.set(tileName, canvas);
    } catch (_) {
      errors.push(`${tileName} 贴图解码失败`);
    }
  }

  for (const [iconName, candidates] of Object.entries(ITEM_SOURCES)) {
    const source = pickSource(sources.item, sources.loose, candidates);
    if (!source) continue;
    try {
      const canvas = await sourceToCanvas(source, ICON_SIZE);
      icons.set(iconName, canvas);
    } catch (_) {
      errors.push(`${iconName} 图标解码失败`);
    }
  }

  return { tiles, icons };
}

/* ------------------------------------------------------------------ */
/* 保存 / 读取                                                         */
/* ------------------------------------------------------------------ */

function isQuotaError(error) {
  if (!error) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014
  );
}

function serializeCanvasMap(map) {
  const result = {};
  for (const [name, canvas] of map) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      if (typeof dataUrl === 'string' && dataUrl) result[name] = dataUrl;
    } catch (_) {
      /* 单张序列化失败就不保存它 */
    }
  }
  return result;
}

function saveCurrentPack() {
  if (!storageAvailable()) {
    throw new Error('当前环境不支持 localStorage，资源包无法保存');
  }

  const data = {
    savedAt: Date.now(),
    tiles: serializeCanvasMap(customTiles),
    icons: serializeCanvasMap(customIcons),
  };

  let json;
  try {
    json = JSON.stringify(data);
  } catch (_) {
    throw new Error('资源包序列化失败');
  }

  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch (error) {
    if (isQuotaError(error)) {
      throw new Error('保存失败：本地存储空间不足');
    }
    const message = error && error.message ? error.message : '未知错误';
    throw new Error(`保存失败：${message}`);
  }

  savedAt = data.savedAt;
}

/**
 * 从 localStorage 读取并解码上次保存的资源包。
 * 应用启动时 await 一次；损坏 / 无法解码的数据会被清理。
 */
export async function loadSavedPack() {
  storageChecked = true;
  if (!storageAvailable()) return;
  // 没有 DOM 解码能力时不要动存档，避免把数据误判为损坏而清掉。
  if (typeof document === 'undefined' || typeof Image === 'undefined') return;

  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return;
  }
  if (!raw) return;

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    removeStoredPack();
    resetMemory();
    return;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    removeStoredPack();
    resetMemory();
    return;
  }

  const rawTiles = data.tiles && typeof data.tiles === 'object' && !Array.isArray(data.tiles) ? data.tiles : null;
  const rawIcons = data.icons && typeof data.icons === 'object' && !Array.isArray(data.icons) ? data.icons : null;
  if (!rawTiles && !rawIcons) {
    removeStoredPack();
    resetMemory();
    return;
  }

  const tiles = new Map();
  if (rawTiles) {
    for (const name of Object.keys(rawTiles)) {
      if (!Object.prototype.hasOwnProperty.call(TILE_SOURCES, name)) continue;
      const url = rawTiles[name];
      if (typeof url !== 'string' || !/^data:image\//i.test(url)) continue;
      let canvas = null;
      try {
        canvas = await dataUrlToCanvas(url, TILE_SIZE);
      } catch (_) {
        canvas = null;
      }
      if (canvas) tiles.set(name, canvas);
    }
  }

  const icons = new Map();
  if (rawIcons) {
    for (const name of Object.keys(rawIcons)) {
      if (!Object.prototype.hasOwnProperty.call(ITEM_SOURCES, name)) continue;
      const url = rawIcons[name];
      if (typeof url !== 'string' || !/^data:image\//i.test(url)) continue;
      let canvas = null;
      try {
        canvas = await dataUrlToCanvas(url, ICON_SIZE);
      } catch (_) {
        canvas = null;
      }
      if (canvas) icons.set(name, canvas);
    }
  }

  if (tiles.size === 0 && icons.size === 0) {
    removeStoredPack();
    resetMemory();
    return;
  }

  customTiles = tiles;
  customIcons = icons;
  savedAt =
    typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : null;
}

/**
 * 导入 FileList / File[]（.zip 或 .png 可混合）。
 * 返回本次成功导入的我们这边使用的名字列表。
 */
export async function importFromFiles(fileList) {
  const report = { ok: false, tiles: [], icons: [] };

  let files;
  try {
    if (fileList && typeof fileList.name === 'string' && typeof fileList.size === 'number') {
      files = [fileList]; // 容错：调用方只传了单个 File
    } else {
      files = Array.from(fileList || []);
    }
  } catch (_) {
    report.error = '无法读取文件列表';
    return report;
  }

  if (files.length === 0) {
    report.error = '没有选择任何文件';
    return report;
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    report.error = '当前环境不支持导入资源包';
    return report;
  }

  // 正常启动流程会先 await loadSavedPack()；这里再兜底一次，避免覆盖旧存档。
  if (!storageChecked) {
    try {
      await loadSavedPack();
    } catch (_) {
      /* 读取旧存档失败不阻塞新导入 */
    }
  }

  const errors = [];
  let sources;
  try {
    sources = await collectSources(files, errors);
  } catch (_) {
    report.error = '资源包解析失败';
    return report;
  }

  let built;
  try {
    built = await buildFromSources(sources, errors);
  } catch (_) {
    report.error = '资源包贴图处理失败';
    return report;
  }

  const tileNames = Array.from(built.tiles.keys());
  const iconNames = Array.from(built.icons.keys());

  if (tileNames.length === 0 && iconNames.length === 0) {
    if (sources.block.size > 0 || sources.item.size > 0 || sources.loose.size > 0) {
      report.error = '找到了 PNG，但没有匹配到需要的贴图或解码失败';
    } else if (errors.length > 0) {
      report.error = errors.slice(0, 3).join('；');
    } else {
      report.error = '未在文件中找到可用的方块或物品贴图';
    }
    return report;
  }

  // 合并进现有资源包：方便先导入方块包、再补充零散物品图标。
  for (const [name, canvas] of built.tiles) customTiles.set(name, canvas);
  for (const [name, canvas] of built.icons) customIcons.set(name, canvas);

  try {
    saveCurrentPack();
  } catch (error) {
    // 贴图已经在内存中可用，但没能写入本机存储。
    report.tiles = tileNames;
    report.icons = iconNames;
    report.error = error && error.message ? error.message : '资源包保存失败';
    return report;
  }

  report.ok = true;
  report.tiles = tileNames;
  report.icons = iconNames;
  return report;
}

/** 清除本地保存并清空内存中的自定义贴图。 */
export function clearPack() {
  storageChecked = true;
  removeStoredPack();
  resetMemory();
}
