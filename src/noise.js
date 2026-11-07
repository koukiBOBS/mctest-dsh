// ============================================================
// noise.js — 确定性 Perlin 噪声与哈希（世界生成用，无副作用）
// ============================================================

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 整数坐标哈希 → [0,1)
export function hash2i(x, z, seed = 0) {
  let h = (x | 0) * 374761393 + (z | 0) * 668265263 + (seed | 0) * 1442695040;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

export function hash3i(x, y, z, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 1103515245 + (z | 0) * 668265263 + (seed | 0) * 1442695040;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function buildPerm(seed) {
  const rnd = mulberry32((seed | 0) ^ 0x9e3779b9);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 2D Perlin，返回大约 -1..1
export function createNoise2D(seed = 0) {
  const perm = buildPerm(seed);
  const grad2 = (hash, x, y) => {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  return function noise2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[X] + Y;
    const ab = perm[X] + Y + 1;
    const ba = perm[X + 1] + Y;
    const bb = perm[X + 1] + Y + 1;
    const g00 = grad2(perm[perm[aa] & 255], xf, yf);
    const g10 = grad2(perm[perm[ba] & 255], xf - 1, yf);
    const g01 = grad2(perm[perm[ab] & 255], xf, yf - 1);
    const g11 = grad2(perm[perm[bb] & 255], xf - 1, yf - 1);
    return lerp(lerp(g00, g10, u), lerp(g01, g11, u), v);
  };
}

// 3D Perlin，返回大约 -1..1
export function createNoise3D(seed = 0) {
  const perm = buildPerm(seed);
  const grad3 = (hash, x, y, z) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return function noise3(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(perm[AA], xf, yf, zf), grad3(perm[BA], xf - 1, yf, zf), u),
        lerp(grad3(perm[AB], xf, yf - 1, zf), grad3(perm[BB], xf - 1, yf - 1, zf), u),
        v,
      ),
      lerp(
        lerp(grad3(perm[AA + 1], xf, yf, zf - 1), grad3(perm[BA + 1], xf - 1, yf, zf - 1), u),
        lerp(grad3(perm[AB + 1], xf, yf - 1, zf - 1), grad3(perm[BB + 1], xf - 1, yf - 1, zf - 1), u),
        v,
      ),
      w,
    );
  };
}

// 分形叠加
export function fbm2(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
