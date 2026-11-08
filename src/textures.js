/* =====================================================================
 * textures.js
 * Procedural, dependency-free Minecraft-style pixel art for Canvas 2D.
 *
 *  - 52 block tiles  -> one 128x128 atlas (8 x 8 grid of 16x16 tiles)
 *  - 10 destroy-stage crack overlays (16x16, transparent)
 *  - 33 item icons (32x32, transparent)
 *
 * Everything is drawn pixel by pixel into RGBA buffers; no images,
 * fonts, emoji, fillText or network access. Output is deterministic:
 * every texture uses its own fixed seed and a small mulberry32 PRNG.
 * ===================================================================== */

export const TILE_PX = 16;
export const ATLAS_COLS = 8;
export const ATLAS_SIZE = TILE_PX * ATLAS_COLS;

export const TILE_NAMES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'cobblestone',
  'sand',
  'sandstone_top',
  'sandstone_side',
  'gravel',
  'oak_log_side',
  'oak_log_top',
  'oak_leaves',
  'oak_planks',
  'glass',
  'water',
  'bedrock',
  'coal_ore',
  'iron_ore',
  'gold_ore',
  'diamond_ore',
  'snow',
  'ice',
  'crafting_table_top',
  'crafting_table_side',
  'crafting_table_front',
  'torch',
  'rose',
  'dandelion',
  'tall_grass',
  'stone_bricks',
  'obsidian',
  'glowstone',
  'lava',
  'wool_white',
  'brick',
  'furnace_front',
  'furnace_side',
  'furnace_top',
  'chest_front',
  'chest_side',
  'chest_top',
  'birch_log_side',
  'birch_log_top',
  'birch_leaves',
  'birch_planks',
  'spruce_log_side',
  'spruce_log_top',
  'spruce_leaves',
  'spruce_planks',
  'cactus_side',
  'cactus_top',
  'clay',
  'bed_top',
  'bed_side',
  'farmland_top',
  'farmland_side',
  'wheat_stage0',
  'wheat_stage1',
  'wheat_stage2',
  'wheat_stage3',
  'tnt_side',
  'tnt_top',
  'tnt_bottom',
  'door',
];

export const ITEM_ICON_NAMES = [
  'stick',
  'coal',
  'iron_ingot',
  'gold_ingot',
  'diamond',
  'apple',
  'wooden_pickaxe',
  'stone_pickaxe',
  'iron_pickaxe',
  'wooden_axe',
  'stone_axe',
  'iron_axe',
  'wooden_shovel',
  'stone_shovel',
  'iron_shovel',
  'wooden_sword',
  'stone_sword',
  'iron_sword',
  'wooden_hoe',
  'stone_hoe',
  'iron_hoe',
  'wheat_seeds',
  'wheat',
  'beef',
  'cooked_beef',
  'porkchop',
  'cooked_porkchop',
  'chicken',
  'cooked_chicken',
  'feather',
  'leather',
  'bone',
  'string',
  'gunpowder',
  'rotten_flesh',
  'arrow',
  'clay_ball',
  'bread',
  'bow',
  'flint',
  'egg',
  'shears',
  'bucket',
  'water_bucket',
  'lava_bucket',
  'fence',
  'emerald',
];

/* =====================================================================
 * 1. Deterministic randomness
 * ===================================================================== */

/** Small, fast, seeded PRNG. Same seed => same sequence, always. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a short string, used to give every texture its own seed. */
function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* =====================================================================
 * 2. Colour helpers (plain [r, g, b] triples)
 * ===================================================================== */

const colorCache = new Map();

/** '#rrggbb' -> [r, g, b]. Parsed once, reused everywhere. */
function C(hex) {
  let c = colorCache.get(hex);
  if (c) return c;
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  c = [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
  colorCache.set(hex, c);
  return c;
}

function shade(c, k) {
  return c.length > 3
    ? [c[0] * k, c[1] * k, c[2] * k, c[3]]
    : [c[0] * k, c[1] * k, c[2] * k];
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function jitter(c, rng, amount) {
  const d = (rng() * 2 - 1) * amount;
  return [c[0] + d, c[1] + d, c[2] + d];
}

/* =====================================================================
 * 3. Pixel buffer primitives
 * ===================================================================== */

function makeBuf(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

/** Write one pixel. Alpha defaults to fully opaque; out-of-bounds is a no-op. */
function setPx(b, x, y, c, a = 255) {
  if (typeof c === 'string') c = C(c);
  x = x | 0;
  y = y | 0;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = (y * b.w + x) * 4;
  const d = b.data;
  d[i] = c[0];
  d[i + 1] = c[1];
  d[i + 2] = c[2];
  d[i + 3] = a;
}

function getPx(b, x, y) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return [0, 0, 0, 0];
  const i = (y * b.w + x) * 4;
  return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]];
}

/** Source-over blend, so translucent highlights keep the base alpha sane. */
function blendPx(b, x, y, c, a) {
  if (typeof c === 'string') c = C(c);
  x = x | 0;
  y = y | 0;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = (y * b.w + x) * 4;
  const d = b.data;
  const sa = a / 255;
  const da = d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  d[i] = (c[0] * sa + d[i] * da * (1 - sa)) / oa;
  d[i + 1] = (c[1] * sa + d[i + 1] * da * (1 - sa)) / oa;
  d[i + 2] = (c[2] * sa + d[i + 2] * da * (1 - sa)) / oa;
  d[i + 3] = oa * 255;
}

/** Opaque draw -> overwrite; translucent draw -> blend. */
function paintPx(b, x, y, c, a) {
  if (a >= 255) setPx(b, x, y, c, 255);
  else blendPx(b, x, y, c, a);
}

function fillSolid(b, c, a = 255) {
  if (typeof c === 'string') c = C(c);
  const d = b.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = a;
  }
}

function fillRect(b, x, y, w, h, c, a = 255) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      paintPx(b, xx, yy, c, a);
    }
  }
}

function hline(b, x0, x1, y, c, a = 255) {
  for (let x = x0; x <= x1; x++) paintPx(b, x, y, c, a);
}

function vline(b, y0, y1, x, c, a = 255) {
  for (let y = y0; y <= y1; y++) paintPx(b, x, y, c, a);
}

/** Fill the whole tile with a weighted palette of colours, pixel by pixel. */
function noiseFill(b, rng, palette) {
  const items = palette.map((entry) =>
    typeof entry === 'string' ? [C(entry), 1] : [C(entry[0]), entry[1]]
  );
  let total = 0;
  for (const item of items) total += item[1];

  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      let r = rng() * total;
      let chosen = items[items.length - 1][0];
      for (const item of items) {
        r -= item[1];
        if (r <= 0) {
          chosen = item[0];
          break;
        }
      }
      setPx(b, x, y, chosen);
    }
  }
}

/** Ragged elliptical blob. The per-pixel threshold makes the edge crunchy. */
function blob(b, rng, cx, cy, r, color, alpha = 255) {
  if (r <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(b.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(b.h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cy) / r;
      const d = dx * dx + dy * dy;
      if (d <= 1 - rng() * 0.4) paintPx(b, x, y, color, alpha);
    }
  }
}

/** Round-capped line of a given width, checked against the segment distance. */
function thickLine(b, x0, y0, x1, y1, w, color, alpha = 255) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-6;
  const r = w / 2;
  const xMin = Math.max(0, Math.floor(Math.min(x0, x1) - r));
  const xMax = Math.min(b.w - 1, Math.ceil(Math.max(x0, x1) + r));
  const yMin = Math.max(0, Math.floor(Math.min(y0, y1) - r));
  const yMax = Math.min(b.h - 1, Math.ceil(Math.max(y0, y1) + r));

  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let t = ((px - x0) * dx + (py - y0) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x0 + t * dx - px;
      const qy = y0 + t * dy - py;
      if (qx * qx + qy * qy <= r * r) paintPx(b, x, y, color, alpha);
    }
  }
}

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Scanline polygon fill (even-odd rule). */
function fillPoly(b, pts, color, alpha = 255) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(b.h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const x1 = pts[i][0];
      const y1p = pts[i][1];
      const x2 = pts[j][0];
      const y2 = pts[j][1];
      if ((y1p <= yc && y2 > yc) || (y2 <= yc && y1p > yc)) {
        xs.push(x1 + ((yc - y1p) * (x2 - x1)) / (y2 - y1p));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k]));
      const xb = Math.min(b.w - 1, Math.round(xs[k + 1]) - 1);
      for (let x = xa; x <= xb; x++) paintPx(b, x, y, color, alpha);
    }
  }
}

/** Semi-regular polygon around a centre, used for lumps (coal, apple...). */
function irregularPoly(cx, cy, rx, ry, sides, rng, jag = 0.2) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const k = 1 - jag + rng() * jag * 2;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

/* =====================================================================
 * 4. Canvas helpers
 * ===================================================================== */

function createCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function canvasFromBuffer(buf) {
  const canvas = createCanvas(buf.w, buf.h);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(buf.w, buf.h);
  image.data.set(buf.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/* =====================================================================
 * 5. Shared texture recipes
 * ===================================================================== */

const DIRT_TONES = [
  ['#79553a', 6],
  ['#6b4a32', 4],
  ['#86603f', 4],
  ['#8f6a47', 2],
  ['#5f4430', 2],
];

const GRASS_TONES = ['#6a9e3a', '#79b04a', '#5f9233', '#72a845', '#85bb52'];

function paintStoneBase(b, rng) {
  noiseFill(b, rng, [
    ['#7d7d7d', 6],
    ['#878787', 4],
    ['#747474', 4],
    ['#8e8e8e', 2],
    ['#6c6c6c', 2],
  ]);
  for (let i = 0; i < 6; i++) {
    blob(
      b,
      rng,
      rng() * 16,
      rng() * 16,
      1 + rng() * 2,
      rng() < 0.5 ? '#6f6f6f' : '#8b8b8b'
    );
  }
  for (let i = 0; i < 5; i++) {
    setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#949494');
  }
}

/**
 * Voronoi stonework: nearest-seed cells, dark mortar on the seams and a
 * one-pixel bevel (light top-left, dark bottom-right) inside each stone.
 */
function paintVoronoi(b, rng, count, tones, mortar, jitterAmt = 9) {
  const seeds = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: rng() * b.w,
      y: rng() * b.h,
      tone: C(tones[i % tones.length]),
      bias: 0.9 + rng() * 0.22,
    });
  }

  const W = b.w;
  const H = b.h;
  const id = new Int16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const dx = x + 0.5 - s.x;
        const dy = y + 0.5 - s.y;
        const d = (dx * dx + dy * dy) * s.bias;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      id[y * W + x] = best;
    }
  }

  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -2 : id[y * W + x]);
  const differs = (a, c) => a !== -2 && c !== -2 && a !== c;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = id[y * W + x];
      setPx(b, x, y, jitter(seeds[cell].tone, rng, jitterAmt));
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = id[y * W + x];
      const edge =
        differs(at(x + 1, y), cell) ||
        differs(at(x - 1, y), cell) ||
        differs(at(x, y + 1), cell) ||
        differs(at(x, y - 1), cell);
      if (edge) {
        setPx(b, x, y, jitter(C(mortar), rng, 6));
      } else if (
        differs(at(x, y - 1), cell) ||
        differs(at(x - 1, y), cell)
      ) {
        setPx(b, x, y, mix(getPx(b, x, y), [230, 230, 230], 0.16));
      } else if (
        differs(at(x, y + 1), cell) ||
        differs(at(x + 1, y), cell)
      ) {
        setPx(b, x, y, mix(getPx(b, x, y), [30, 30, 30], 0.16));
      }
    }
  }
}

/** Horizontal oak boards: 4 rows, dark seams, butt joints and grain. */
function paintPlanks(
  b,
  rng,
  tones = [
    ['#b18b52', 5],
    ['#a8834b', 4],
    ['#bc9659', 3],
    ['#9f7b46', 3],
  ],
  seam = '#6f5230',
  light = '#c8a367'
) {
  noiseFill(b, rng, tones);
  const seamC = C(seam);
  const lightC = C(light);

  for (let p = 0; p < 4; p++) {
    const y0 = p * 4;

    // Alternate boards are a touch darker, like separate planks.
    if (p % 2 === 1) {
      for (let y = y0; y < y0 + 3; y++) {
        for (let x = 0; x < b.w; x++) {
          setPx(b, x, y, shade(getPx(b, x, y), 0.945));
        }
      }
    }

    // Lit top edge of the board.
    for (let x = 0; x < b.w; x++) {
      setPx(b, x, y0, mix(getPx(b, x, y0), lightC, 0.5));
    }

    // Dark seam at the bottom of the board.
    for (let x = 0; x < b.w; x++) {
      setPx(b, x, y0 + 3, rng() < 0.25 ? shade(seamC, 1.15) : seamC);
    }

    // One vertical butt joint per board.
    const jx = 1 + ((rng() * 14) | 0);
    for (let y = y0; y < y0 + 3; y++) setPx(b, jx, y, seamC);

    // Short horizontal grain marks.
    const grain = C('#7d5c33');
    for (let g = 0; g < 4; g++) {
      const gy = y0 + 1 + ((rng() * 2) | 0);
      const gx = (rng() * 13) | 0;
      const gl = 2 + ((rng() * 4) | 0);
      for (let k = 0; k < gl; k++) {
        setPx(b, gx + k, gy, mix(getPx(b, gx + k, gy), grain, 0.45));
      }
    }
  }
}

/** Ore blobs on top of a stone base. */
function paintOre(b, rng, spots, outline, mid, highlight) {
  paintStoneBase(b, rng);
  for (const [sx, sy, r] of spots) {
    blob(b, rng, sx + 0.5, sy + 0.5, r + 0.9, C(outline));
    blob(b, rng, sx + 0.5, sy + 0.5, r, C(mid));
    setPx(b, sx, sy, C(highlight));
    if (r >= 1.5) setPx(b, sx + 1, sy + 1, C(highlight));
  }
}

/** Brick / stone-brick lattice: 3px brick rows separated by 1px mortar. */
function paintBrickPattern(b, rng, tones, mortar) {
  const mortarC = C(mortar);
  fillSolid(b, mortarC);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (y % 4 === 3 || x % 8 === 7) {
        setPx(b, x, y, jitter(mortarC, rng, 6));
      }
    }
  }

  for (let r = 0; r < 4; r++) {
    const y0 = r * 4;
    const seams = r % 2 === 0 ? [7] : [3, 11];
    const spans = [];
    let prev = 0;
    for (const s of seams) {
      spans.push([prev, s]);
      prev = s + 1;
    }
    spans.push([prev, 16]);

    let spanIndex = 0;
    for (const [xa, xb] of spans) {
      const tone = C(tones[(r * 2 + spanIndex) % tones.length]);
      for (let y = y0; y < y0 + 3; y++) {
        for (let x = xa; x < xb; x++) {
          let c = jitter(tone, rng, 9);
          if (y === y0) c = mix(c, [255, 255, 255], 0.12);
          if (y === y0 + 2) c = mix(c, [0, 0, 0], 0.14);
          setPx(b, x, y, c);
        }
      }
      // Vertical mortar on both sides of the brick.
      if (xa > 0) {
        for (let y = y0; y < y0 + 3; y++) {
          setPx(b, xa - 1, y, jitter(mortarC, rng, 5));
        }
      }
      spanIndex++;
    }
  }
}

/* =====================================================================
 * 6. The 35 block tiles
 * ===================================================================== */

const TILE_PAINTERS = {
  grass_top(b, rng) {
    noiseFill(b, rng, [
      ['#6a9e3a', 6],
      ['#79b04a', 5],
      ['#5f9233', 3],
      ['#72a845', 3],
      ['#86bd55', 1],
    ]);
    for (let i = 0; i < 8; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.8 + rng() * 1.6,
        rng() < 0.5 ? '#5c8c30' : '#7fb54e'
      );
    }
    for (let i = 0; i < 7; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#93c765');
    }
  },

  grass_side(b, rng) {
    noiseFill(b, rng, DIRT_TONES);

    for (let x = 0; x < 16; x++) {
      let depth = 4 + ((rng() * 2) | 0); // 4..5 rows of grass
      if (rng() < 0.22) depth += 1; // occasional ragged drip

      for (let y = 0; y < depth; y++) {
        const c = GRASS_TONES[(rng() * GRASS_TONES.length) | 0];
        setPx(b, x, y, c);
      }
      // Dark grass rim just above the dirt.
      setPx(b, x, Math.min(depth - 1, 15), '#4f7a2b');
      // A stray blade hanging below the edge.
      if (rng() < 0.15 && depth < 7) setPx(b, x, depth, '#5a8a33');
    }

    // Pebbles and roots in the exposed dirt.
    for (let i = 0; i < 3; i++) {
      const x = 1 + ((rng() * 14) | 0);
      const y = 7 + ((rng() * 8) | 0);
      setPx(b, x, y, '#8a7a63');
      if (rng() < 0.5) setPx(b, x + 1, y, '#736450');
    }
  },

  dirt(b, rng) {
    noiseFill(b, rng, DIRT_TONES);
    for (let i = 0; i < 5; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.9 + rng() * 1.5,
        rng() < 0.5 ? '#6a4a31' : '#8a6440'
      );
    }
    const stones = [
      [3, 4],
      [11, 7],
      [6, 12],
      [13, 13],
    ];
    for (const [sx, sy] of stones) {
      setPx(b, sx, sy, '#8f8b80');
      setPx(b, sx + 1, sy, '#7a776e');
      setPx(b, sx, sy + 1, '#6b675f');
    }
  },

  stone(b, rng) {
    paintStoneBase(b, rng);
  },

  cobblestone(b, rng) {
    paintVoronoi(
      b,
      rng,
      9,
      ['#8a8a8a', '#7a7a7a', '#949494', '#6f6f6f', '#848484'],
      '#494949',
      9
    );
  },

  sand(b, rng) {
    noiseFill(b, rng, [
      ['#dcd29b', 6],
      ['#e3daa8', 4],
      ['#d3c88f', 3],
      ['#e8dfb4', 2],
      ['#cfc489', 1],
    ]);
    for (let i = 0; i < 7; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#c6b97e');
    }
  },

  sandstone_top(b, rng) {
    noiseFill(b, rng, [
      ['#dfd4a4', 6],
      ['#e6dbb0', 4],
      ['#d8cb98', 3],
      ['#ebe1ba', 2],
    ]);
    for (let i = 0; i < 6; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#f0e7c6');
    }
  },

  sandstone_side(b, rng) {
    noiseFill(b, rng, [
      ['#d9cc97', 6],
      ['#e3d7a6', 4],
      ['#cfc18b', 3],
      ['#eadfb2', 2],
    ]);
    const bands = [
      0.98, 1.05, 1.0, 1.0, 0.95, 1.0, 0.93, 1.02, 1.0, 0.94, 0.98, 1.03, 1.0,
      0.96, 1.05, 0.9,
    ];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const c = getPx(b, x, y);
        const f = bands[y] * (0.98 + rng() * 0.04);
        setPx(b, x, y, [c[0] * f, c[1] * f, c[2] * f]);
      }
    }
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 6, mix(getPx(b, x, 6), [150, 132, 90], 0.5));
      setPx(b, x, 7, mix(getPx(b, x, 7), [255, 248, 220], 0.25));
      setPx(b, x, 11, mix(getPx(b, x, 11), [150, 132, 90], 0.45));
      setPx(b, x, 12, mix(getPx(b, x, 12), [255, 248, 220], 0.2));
    }
  },

  gravel(b, rng) {
    noiseFill(b, rng, [
      ['#7f7a70', 6],
      ['#8d877c', 4],
      ['#6b675f', 4],
      ['#9a948a', 2],
      ['#5d5952', 2],
    ]);
    const spots = [
      [2, 2],
      [7, 1],
      [12, 3],
      [4, 6],
      [10, 7],
      [14, 10],
      [1, 10],
      [6, 12],
      [11, 13],
      [3, 14],
    ];
    for (const [sx, sy] of spots) {
      const r = 1 + rng() * 0.8;
      blob(
        b,
        rng,
        sx + rng(),
        sy + rng(),
        r,
        rng() < 0.5 ? '#948e83' : '#6f6a61'
      );
      setPx(b, sx, sy + 1, '#4c4842');
    }
  },

  oak_log_side(b, rng) {
    const bark = ['#5f4526', '#6b4e2b', '#79592f', '#4e3a1f', '#846238'];
    for (let x = 0; x < 16; x++) {
      const base = C(bark[(rng() * bark.length) | 0]);
      for (let y = 0; y < 16; y++) {
        setPx(b, x, y, jitter(base, rng, 9));
      }
    }
    // Vertical grooves.
    for (let g = 0; g < 5; g++) {
      const x = 1 + ((rng() * 14) | 0);
      const y0 = (rng() * 10) | 0;
      const len = 3 + ((rng() * 7) | 0);
      for (let y = y0; y < Math.min(16, y0 + len); y++) {
        setPx(b, x, y, '#46331b');
      }
    }
    // Short horizontal bark cracks.
    for (let i = 0; i < 4; i++) {
      const y = 1 + ((rng() * 14) | 0);
      const x = 1 + ((rng() * 12) | 0);
      const len = 2 + ((rng() * 3) | 0);
      for (let k = 0; k < len; k++) setPx(b, x + k, y, '#43301a');
    }
    // Knots.
    blob(b, rng, 11, 5, 1.7, '#3f2d18');
    setPx(b, 10, 4, '#8a6a3c');
    blob(b, rng, 4, 11, 1.3, '#3a2a16');
  },

  oak_log_top(b, rng) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        let c;
        if (d > 6.2) {
          c = jitter(C('#5e4425'), rng, 8);
        } else if (d > 5.4) {
          c = jitter(C('#8a6b3a'), rng, 6);
        } else {
          const ring = Math.floor(d + (rng() - 0.5) * 0.3);
          c = jitter(C(ring % 2 === 0 ? '#bd9f66' : '#a8894f'), rng, 6);
        }
        setPx(b, x, y, c);
      }
    }
    // Radial cracks.
    for (const a of [0.4, 2.2, 4.4]) {
      for (let t = 0.6; t < 6.4; t += 0.5) {
        const x = Math.round(7.5 + Math.cos(a) * t);
        const y = Math.round(7.5 + Math.sin(a) * t);
        setPx(b, x, y, '#6e5330');
      }
    }
    // Dark pit at the centre.
    blob(b, rng, 8, 8, 1.1, '#8a6b3a');
  },

  oak_leaves(b, rng) {
    noiseFill(b, rng, [
      ['#4f7a2a', 6],
      ['#5c8c33', 4],
      ['#3f6622', 4],
      ['#6a9b3c', 2],
      ['#376020', 2],
    ]);
    for (let i = 0; i < 9; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.8 + rng() * 1.7,
        rng() < 0.5 ? '#376020' : '#6fa83f'
      );
    }
    // Deep gaps between leaf clusters (a few are see-through).
    for (let i = 0; i < 26; i++) {
      const x = (rng() * 16) | 0;
      const y = (rng() * 16) | 0;
      if (rng() < 0.24) {
        setPx(b, x, y, [0, 0, 0], 0);
      } else {
        setPx(b, x, y, '#2c5019');
      }
    }
    for (let i = 0; i < 5; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#84bb4c');
    }
  },

  oak_planks(b, rng) {
    paintPlanks(b, rng);
  },

  glass(b, rng) {
    // Mostly transparent pane...
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        setPx(b, x, y, [188, 220, 238], 34 + Math.floor(rng() * 14));
      }
    }
    // ...with a bright frame.
    for (let i = 0; i < 16; i++) {
      setPx(b, i, 0, [236, 247, 255], 205);
      setPx(b, 0, i, [236, 247, 255], 200);
      setPx(b, i, 15, [198, 224, 240], 150);
      setPx(b, 15, i, [198, 224, 240], 145);
    }
    for (let i = 1; i < 15; i++) {
      setPx(b, i, 1, [255, 255, 255], 120);
      setPx(b, 1, i, [255, 255, 255], 105);
    }
    // Reflections.
    thickLine(b, 3, 12, 12, 3, 2, [255, 255, 255], 70);
    thickLine(b, 2, 6, 5, 3, 2, [255, 255, 255], 55);
    setPx(b, 3, 3, [255, 255, 255], 160);
    setPx(b, 4, 3, [255, 255, 255], 120);
    setPx(b, 3, 4, [255, 255, 255], 110);
    setPx(b, 12, 12, [255, 255, 255], 60);
  },

  water(b, rng) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        setPx(b, x, y, mix(C('#2c63b6'), C('#3f7ed0'), rng()), 191);
      }
    }
    const waves = [2, 6, 10, 14];
    for (const wy of waves) {
      const start = (rng() * 10) | 0;
      const len = 4 + ((rng() * 6) | 0);
      for (let k = 0; k < len; k++) {
        setPx(b, (start + k) % 16, wy, '#5d9ce8', 191);
      }
      for (let k = 0; k < len; k++) {
        setPx(b, (start + k + 8) % 16, Math.min(15, wy + 1), '#27579f', 191);
      }
    }
  },

  bedrock(b, rng) {
    paintVoronoi(
      b,
      rng,
      7,
      ['#2b2b2b', '#242424', '#3a3a3a', '#1b1b1b', '#454545'],
      '#0c0c0c',
      12
    );
    for (let i = 0; i < 5; i++) {
      thickLine(b, rng() * 16, rng() * 16, rng() * 16, rng() * 16, 1, '#101010');
    }
    for (let i = 0; i < 12; i++) {
      setPx(
        b,
        (rng() * 16) | 0,
        (rng() * 16) | 0,
        rng() < 0.5 ? '#5c5c5c' : '#151515'
      );
    }
  },

  coal_ore(b, rng) {
    paintOre(
      b,
      rng,
      [
        [3, 3, 1.7],
        [10, 2, 1.4],
        [6, 8, 1.9],
        [13, 8, 1.4],
        [2, 12, 1.4],
        [10, 13, 1.7],
      ],
      '#141414',
      '#232323',
      '#3e3e3e'
    );
  },

  iron_ore(b, rng) {
    paintOre(
      b,
      rng,
      [
        [3, 3, 1.6],
        [10, 2, 1.4],
        [6, 8, 1.8],
        [13, 9, 1.4],
        [3, 12, 1.4],
        [10, 13, 1.6],
      ],
      '#6b5236',
      '#c9a878',
      '#e8cfa4'
    );
  },

  gold_ore(b, rng) {
    paintOre(
      b,
      rng,
      [
        [3, 3, 1.5],
        [10, 2, 1.4],
        [6, 8, 1.8],
        [13, 9, 1.3],
        [3, 12, 1.3],
        [10, 13, 1.6],
      ],
      '#8a6a05',
      '#f2cf3d',
      '#ffe873'
    );
  },

  diamond_ore(b, rng) {
    paintOre(
      b,
      rng,
      [
        [3, 3, 1.5],
        [10, 2, 1.4],
        [6, 8, 1.8],
        [13, 8, 1.3],
        [3, 12, 1.3],
        [10, 13, 1.6],
      ],
      '#0d5a5a',
      '#3fd8d4',
      '#a6fbf6'
    );
  },

  snow(b, rng) {
    noiseFill(b, rng, [
      ['#f4f9fb', 6],
      ['#ffffff', 4],
      ['#e6f0f4', 3],
      ['#dce8ee', 1],
    ]);
    for (let i = 0; i < 6; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#ffffff');
    }
    for (let i = 0; i < 4; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#d3e2ea');
    }
  },

  ice(b, rng) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        setPx(
          b,
          x,
          y,
          jitter(C('#93c6e8'), rng, 10),
          198 + ((rng() * 14) | 0)
        );
      }
    }
    blob(b, rng, 4, 4, 3, '#a9d8f2', 170);
    blob(b, rng, 11, 12, 3.2, '#7fb4d8', 160);
    thickLine(b, 2, 5, 7, 9, 1, '#e8f8ff', 220);
    thickLine(b, 7, 9, 5, 14, 1, '#dff2ff', 200);
    thickLine(b, 8, 2, 12, 7, 1, '#eafaff', 210);
    thickLine(b, 12, 7, 15, 11, 1, '#c9e9fb', 185);
    thickLine(b, 9, 12, 13, 15, 1, '#f2fdff', 170);
    setPx(b, 4, 12, '#ffffff', 235);
    setPx(b, 13, 3, '#ffffff', 225);
  },

  crafting_table_top(b, rng) {
    paintPlanks(b, rng);
    // Dark outer frame.
    for (let i = 0; i < 16; i++) {
      setPx(b, i, 0, '#5b4023');
      setPx(b, i, 15, '#5b4023');
      setPx(b, 0, i, '#5b4023');
      setPx(b, 15, i, '#5b4023');
    }
    // Bevel around the work surface.
    for (let i = 2; i < 14; i++) {
      setPx(b, i, 2, '#d8b878');
      setPx(b, 2, i, '#d8b878');
      setPx(b, i, 13, '#8a6539');
      setPx(b, 13, i, '#8a6539');
    }
    // 3x3 grid.
    for (const g of [6, 10]) {
      for (let i = 3; i < 13; i++) {
        setPx(b, g, i, '#6b4c27');
        setPx(b, i, g, '#6b4c27');
      }
      for (let i = 3; i < 13; i++) {
        setPx(b, g + 1, i, mix(getPx(b, g + 1, i), [232, 202, 142], 0.4));
        setPx(b, i, g + 1, mix(getPx(b, i, g + 1), [232, 202, 142], 0.4));
      }
    }
  },

  crafting_table_side(b, rng) {
    paintPlanks(b, rng);
    // Top trim and legs.
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 0, '#d3ae6d');
      setPx(b, x, 1, '#8a6539');
    }
    for (let y = 8; y < 16; y++) {
      setPx(b, 1, y, '#6b4c27');
      setPx(b, 14, y, '#6b4c27');
    }
    // Saw silhouette (upper left).
    fillRect(b, 3, 4, 6, 3, '#c2c2c2');
    fillRect(b, 8, 4, 1, 3, '#8f8f8f');
    for (let x = 3; x < 9; x += 2) setPx(b, x, 7, '#9a9a9a');
    fillRect(b, 1, 4, 2, 3, '#7a552c');
    // Hammer silhouette (upper right).
    fillRect(b, 9, 3, 5, 3, '#a8a8a8');
    fillRect(b, 9, 3, 5, 1, '#cfcfcf');
    fillRect(b, 9, 5, 5, 1, '#7f7f7f');
    fillRect(b, 11, 6, 2, 5, '#8a6136');
    // Shelf shadow.
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 12, mix(getPx(b, x, 12), [60, 40, 20], 0.35));
      setPx(b, x, 13, mix(getPx(b, x, 13), [222, 184, 116], 0.25));
    }
  },

  crafting_table_front(b, rng) {
    paintPlanks(b, rng);
    // Legs at both sides.
    for (let y = 4; y < 16; y++) {
      setPx(b, 0, y, '#6b4c27');
      setPx(b, 1, y, '#8a6539');
      setPx(b, 15, y, '#6b4c27');
      setPx(b, 14, y, '#8a6539');
    }
    // Top rail.
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 0, '#c9a367');
      setPx(b, x, 1, '#d8b878');
      setPx(b, x, 2, '#8a6539');
    }
    // Recessed front panel.
    fillRect(b, 3, 4, 10, 7, '#a9824a');
    for (let i = 4; i <= 11; i++) {
      setPx(b, i, 4, '#5b4023');
      setPx(b, i, 10, '#5b4023');
    }
    for (let i = 5; i <= 9; i++) {
      setPx(b, 3, i, '#5b4023');
      setPx(b, 12, i, '#5b4023');
    }
    // Two small drawers.
    fillRect(b, 5, 6, 3, 2, '#8f6a3a');
    fillRect(b, 8, 6, 3, 2, '#8f6a3a');
    setPx(b, 6, 6, '#c9a367');
    setPx(b, 9, 6, '#c9a367');
    // Handle bar.
    for (let x = 5; x <= 10; x++) setPx(b, x, 12, '#6b4c27');
    for (let x = 5; x <= 10; x++) setPx(b, x, 13, '#c9a367');
  },

  torch(b, rng) {
    // Stick.
    for (let y = 9; y < 16; y++) {
      setPx(b, 7, y, '#6b4a22');
      setPx(b, 8, y, '#8a5f2c');
    }
    setPx(b, 7, 15, '#4e3417');
    // Teardrop flame: dark rim, orange body, hot core.
    const outer = [
      [8, 2],
      [10.5, 4.5],
      [10.5, 7.5],
      [8, 9.5],
      [5.5, 7.5],
      [5.5, 4.5],
    ];
    const mid = [
      [8, 3],
      [9.8, 5],
      [9.8, 7.4],
      [8, 8.8],
      [6.2, 7.4],
      [6.2, 5],
    ];
    fillPoly(b, outer, '#b8460c');
    fillPoly(b, mid, '#f08a1c');
    blob(b, rng, 8, 6.5, 1.9, '#ffc93c');
    setPx(b, 8, 6, '#fff3b0');
    setPx(b, 8, 7, '#fff3b0');
    setPx(b, 7, 6, '#ffe27a');
  },

  rose(b, rng) {
    // Stem and leaves.
    for (let y = 7; y < 16; y++) {
      setPx(b, 7, y, '#3f7a26');
      setPx(b, 8, y, '#4f8f2e');
    }
    thickLine(b, 7, 12, 3.5, 9.5, 2, '#3f7a26');
    thickLine(b, 8, 10.5, 11.5, 8, 2, '#4f8f2e');
    setPx(b, 3, 9, '#2f5a1c');
    setPx(b, 6, 12, '#2f5a1c');
    // Petals.
    blob(b, rng, 8, 5.5, 3.8, '#6b1010');
    blob(b, rng, 8, 5.5, 3.0, '#c22020');
    blob(b, rng, 7.5, 5.0, 2.0, '#e03a2a');
    blob(b, rng, 6.8, 4.4, 1.0, '#f2594a');
    // Dark centre.
    setPx(b, 8, 5, '#3a0d0d');
    setPx(b, 8, 6, '#3a0d0d');
    setPx(b, 9, 6, '#4a1010');
  },

  dandelion(b, rng) {
    for (let y = 8; y < 16; y++) {
      setPx(b, 7, y, '#3f7a26');
      setPx(b, 8, y, '#4f8f2e');
    }
    thickLine(b, 7, 13, 4, 11, 2, '#3f7a26');
    thickLine(b, 8, 12, 11, 10, 2, '#4f8f2e');
    // Yellow flower head.
    blob(b, rng, 8, 5.5, 3.6, '#9a7a12');
    blob(b, rng, 8, 5.5, 2.9, '#e8c01e');
    blob(b, rng, 7.6, 5.0, 1.9, '#f7d94a');
    setPx(b, 7, 4, '#fff0a0');
    setPx(b, 8, 4, '#fff0a0');
    setPx(b, 9, 5, '#ffe27a');
    setPx(b, 6, 6, '#d9a91e');
  },

  tall_grass(b, rng) {
    // Base clump.
    for (let x = 2; x < 14; x++) {
      if (rng() < 0.75) setPx(b, x, 15, '#3f7a26');
      if (rng() < 0.5) setPx(b, x, 14, '#4f8f2e');
    }
    // Individual blades, leaning as they grow.
    for (let i = 0; i < 7; i++) {
      const bx = 1 + i * 2 + ((rng() * 2) | 0);
      const top = 3 + ((rng() * 7) | 0);
      const lean = (rng() * 2 - 1) * 1.8;
      for (let y = 15; y >= top; y--) {
        const t = (15 - y) / Math.max(1, 15 - top);
        const x = Math.max(0, Math.min(15, Math.round(bx + lean * t * t)));
        let c;
        if (y > 12) c = '#3f7a26';
        else c = rng() < 0.5 ? '#5c9432' : '#6ea83c';
        setPx(b, x, y, c);
        if (y > 6 && y < 12 && rng() < 0.12) setPx(b, x + 1, y, '#4f8a2b');
      }
    }
  },

  stone_bricks(b, rng) {
    paintBrickPattern(
      b,
      rng,
      ['#8a8a8a', '#7f7f7f', '#939393', '#868686'],
      '#4e4e4e'
    );
  },

  obsidian(b, rng) {
    noiseFill(b, rng, [
      ['#140a22', 5],
      ['#1b0f30', 5],
      ['#241542', 3],
      ['#0c0616', 3],
      ['#2c1a4e', 1],
    ]);
    for (let i = 0; i < 4; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        1.2 + rng() * 2,
        rng() < 0.5 ? '#1e1136' : '#0d0718'
      );
    }
    const sparks = ['#6b4fae', '#8a6ad0', '#b49ce8', '#4a3380'];
    for (let i = 0; i < 14; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, sparks[(rng() * 4) | 0]);
    }
    for (let i = 0; i < 3; i++) {
      const x = 1 + ((rng() * 13) | 0);
      const y = 1 + ((rng() * 13) | 0);
      setPx(b, x, y, '#a98ce6');
      setPx(b, x + 1, y, '#6b4fae');
      setPx(b, x, y + 1, '#4a3380');
    }
  },

  glowstone(b, rng) {
    noiseFill(b, rng, [
      ['#6f5a22', 5],
      ['#7d672c', 4],
      ['#5d4a1c', 3],
      ['#8a7233', 2],
    ]);
    const cores = [
      [3, 3],
      [10, 4],
      [6, 9],
      [13, 11],
      [2, 12],
      [9, 13],
      [14, 7],
      [5, 6],
    ];
    for (const [cx, cy] of cores) {
      blob(b, rng, cx + rng(), cy + rng(), 1.6 + rng(), '#c9a63c');
      blob(b, rng, cx + rng() * 0.5, cy + rng() * 0.5, 1 + rng() * 0.5, '#ffe27a');
      setPx(b, cx, cy, '#fff6c2');
    }
  },

  lava(b, rng) {
    noiseFill(b, rng, [
      ['#d4500f', 5],
      ['#c1430a', 4],
      ['#e2660f', 3],
      ['#a83605', 2],
      ['#f07a14', 1],
    ]);
    for (let i = 0; i < 5; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        1.2 + rng() * 1.8,
        rng() < 0.5 ? '#ffcd3d' : '#8a2b04'
      );
    }
    for (let i = 0; i < 4; i++) {
      const cx = rng() * 16;
      const cy = rng() * 16;
      blob(b, rng, cx, cy, 1.1, '#ffb62e');
      setPx(b, cx | 0, cy | 0, '#ffe89a');
    }
  },

  wool_white(b, rng) {
    noiseFill(b, rng, [
      ['#eceeee', 5],
      ['#f5f7f7', 4],
      ['#e2e6e6', 3],
      ['#d8dddd', 2],
    ]);
    for (let y = 0; y < 16; y += 2) {
      for (let x = 0; x < 16; x++) {
        setPx(b, x, y, mix(getPx(b, x, y), [222, 228, 228], 0.35));
      }
    }
    for (let i = 0; i < 9; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#d2d8d8');
    }
    for (let i = 0; i < 6; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, '#fbfdfd');
    }
  },

  brick(b, rng) {
    paintBrickPattern(
      b,
      rng,
      ['#a04a3a', '#934434', '#ad5747', '#984738'],
      '#c3baa6'
    );
  },

  /* ------------------------------------------------------------------
   * Appended tiles: furnace, chest, birch, spruce, cactus and clay.
   * Same recipes as above: stone-noise, board and leaf recipes, all
   * deterministic but seeded per tile name by paintTile().
   * ------------------------------------------------------------------ */

  furnace_side(b, rng) {
    noiseFill(b, rng, [
      ['#6b6b6b', 6],
      ['#757575', 4],
      ['#616161', 4],
      ['#7d7d7d', 2],
      ['#565656', 2],
    ]);
    for (let i = 0; i < 6; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.9 + rng() * 1.4,
        C(rng() < 0.5 ? '#5e5e5e' : '#7a7a7a')
      );
    }
    // Raised top edge: lit lip, stone step, dark shadow beneath it.
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 0, jitter(C('#9c9c9c'), rng, 6));
      setPx(b, x, 1, jitter(C('#828282'), rng, 5));
      setPx(b, x, 2, jitter(C('#4f4f4f'), rng, 4));
      setPx(b, x, 15, jitter(C('#4a4a4a'), rng, 4));
    }
    // Side bevel so the face reads as part of a cube.
    for (let y = 3; y < 15; y++) {
      setPx(b, 0, y, mix(getPx(b, 0, y), [205, 205, 205], 0.14));
      setPx(b, 15, y, mix(getPx(b, 15, y), [28, 28, 28], 0.18));
    }
  },

  furnace_front(b, rng) {
    noiseFill(b, rng, [
      ['#6b6b6b', 6],
      ['#757575', 4],
      ['#616161', 4],
      ['#7d7d7d', 2],
      ['#565656', 2],
    ]);
    for (let i = 0; i < 4; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.9 + rng() * 1.3,
        C(rng() < 0.5 ? '#5e5e5e' : '#7a7a7a')
      );
    }
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 0, jitter(C('#9c9c9c'), rng, 6));
      setPx(b, x, 1, jitter(C('#828282'), rng, 5));
      setPx(b, x, 2, jitter(C('#4f4f4f'), rng, 4));
      setPx(b, x, 15, jitter(C('#4a4a4a'), rng, 4));
    }
    // Firebox: black frame, deep grey interior, sooty lower lip.
    fillRect(b, 3, 8, 10, 5, C('#141414'));
    fillRect(b, 4, 9, 8, 3, C('#333333'));
    for (let x = 4; x <= 11; x++) {
      setPx(b, x, 11, mix(getPx(b, x, 11), [10, 10, 10], 0.35));
    }
    for (let x = 3; x <= 12; x++) {
      setPx(b, x, 7, mix(getPx(b, x, 7), [18, 18, 18], 0.3));
    }
    // Two light-grey pixels on the lintel above the opening.
    setPx(b, 7, 6, C('#a8a8a8'));
    setPx(b, 8, 6, C('#a8a8a8'));
    // Side bevel.
    for (let y = 3; y < 15; y++) {
      setPx(b, 0, y, mix(getPx(b, 0, y), [205, 205, 205], 0.14));
      setPx(b, 15, y, mix(getPx(b, 15, y), [28, 28, 28], 0.18));
    }
  },

  furnace_top(b, rng) {
    noiseFill(b, rng, [
      ['#6b6b6b', 6],
      ['#757575', 4],
      ['#616161', 4],
      ['#7d7d7d', 2],
      ['#565656', 2],
    ]);
    for (let i = 0; i < 6; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.8 + rng() * 1.5,
        C(rng() < 0.5 ? '#5e5e5e' : '#7d7d7d')
      );
    }
    // Central round vent sunk into the stone.
    blob(b, rng, 8, 8, 3.2, C('#4d4d4d'));
    blob(b, rng, 8, 8, 2.4, C('#343434'));
    blob(b, rng, 8, 8, 1.5, C('#262626'));
    setPx(b, 7, 7, C('#4a4a4a'));
    setPx(b, 9, 9, C('#1f1f1f'));
    // Bevel: lit north/west rim, shaded south/east rim.
    for (let i = 0; i < 16; i++) {
      setPx(b, i, 0, jitter(C('#909090'), rng, 5));
      setPx(b, 0, i, jitter(C('#909090'), rng, 5));
      setPx(b, i, 15, jitter(C('#4d4d4d'), rng, 4));
      setPx(b, 15, i, jitter(C('#4d4d4d'), rng, 4));
    }
    for (let i = 1; i < 15; i++) {
      setPx(b, i, 1, mix(getPx(b, i, 1), [225, 225, 225], 0.12));
      setPx(b, 1, i, mix(getPx(b, 1, i), [225, 225, 225], 0.12));
      setPx(b, i, 14, mix(getPx(b, i, 14), [20, 20, 20], 0.14));
      setPx(b, 14, i, mix(getPx(b, 14, i), [20, 20, 20], 0.14));
    }
    for (let i = 0; i < 5; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, C('#9a9a9a'));
    }
  },

  chest_side(b, rng) {
    paintPlanks(b, rng);
    // Dark oak frame along the top and bottom of the chest.
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 0, jitter(C('#4a2f14'), rng, 4));
      setPx(b, x, 1, jitter(C('#6b4726'), rng, 5));
      setPx(b, x, 14, jitter(C('#5b3d1e'), rng, 5));
      setPx(b, x, 15, jitter(C('#33200c'), rng, 4));
    }
    for (let i = 0; i < 4; i++) {
      setPx(
        b,
        (rng() * 16) | 0,
        2 + ((rng() * 12) | 0),
        C('#8f6a3a')
      );
    }
  },

  chest_front(b, rng) {
    paintPlanks(b, rng);
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 0, jitter(C('#4a2f14'), rng, 4));
      setPx(b, x, 1, jitter(C('#6b4726'), rng, 5));
      setPx(b, x, 14, jitter(C('#5b3d1e'), rng, 5));
      setPx(b, x, 15, jitter(C('#33200c'), rng, 4));
    }
    // Iron-and-brass latch, roughly 4x4, centred on the lid.
    fillRect(b, 6, 6, 4, 4, C('#4a3418'));
    fillRect(b, 7, 7, 2, 2, C('#d9b45a'));
    setPx(b, 7, 7, C('#f2d888'));
    setPx(b, 8, 8, C('#8a6a1e'));
    // Small cast shadow under the latch.
    for (let x = 6; x <= 9; x++) {
      setPx(b, x, 10, mix(getPx(b, x, 10), [40, 25, 10], 0.4));
    }
  },

  chest_top(b, rng) {
    paintPlanks(b, rng);
    // Lid seam running across the middle of the boards.
    for (let x = 0; x < 16; x++) {
      setPx(b, x, 8, jitter(C('#4a2f14'), rng, 4));
      setPx(b, x, 9, mix(getPx(b, x, 9), [201, 163, 103], 0.2));
    }
    // Central latch straddling the seam.
    fillRect(b, 6, 6, 4, 4, C('#4a3418'));
    fillRect(b, 7, 7, 2, 2, C('#d9b45a'));
    setPx(b, 7, 7, C('#f2d888'));
    setPx(b, 8, 8, C('#8a6a1e'));
    for (let i = 0; i < 3; i++) {
      setPx(b, 2 + ((rng() * 12) | 0), 2 + ((rng() * 4) | 0), C('#8f6a3a'));
    }
  },

  birch_log_side(b, rng) {
    noiseFill(b, rng, [
      ['#d8d3c3', 6],
      ['#e3ddcd', 4],
      ['#cbc5b3', 4],
      ['#bdb7a4', 2],
      ['#eae4d4', 1],
    ]);
    // Short horizontal lenticels are what makes birch read as birch.
    for (let i = 0; i < 10; i++) {
      const y = (rng() * 16) | 0;
      const x = (rng() * 14) | 0;
      const len = 1 + ((rng() * 4) | 0);
      const dark = C(rng() < 0.7 ? '#2f2b22' : '#4a4438');
      for (let k = 0; k < len && x + k < 16; k++) {
        setPx(b, x + k, y, dark);
      }
      if (rng() < 0.45 && x + len < 16) {
        setPx(b, x + len, y, C('#7d7768'));
      }
    }
    // Soft vertical streaks, then one small knot.
    for (let i = 0; i < 3; i++) {
      const x = 1 + ((rng() * 14) | 0);
      const y0 = (rng() * 10) | 0;
      for (let y = y0; y < Math.min(16, y0 + 4); y++) {
        setPx(b, x, y, mix(getPx(b, x, y), [140, 134, 120], 0.3));
      }
    }
    blob(b, rng, 10.5, 6.5, 1.4, C('#c4bfae'));
    setPx(b, 10, 6, C('#6f695b'));
    setPx(b, 11, 7, C('#8a8474'));
  },

  birch_log_top(b, rng) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        let c;
        if (d > 6.1) {
          c = jitter(C('#cfc9b8'), rng, 7);
        } else if (d > 5.3) {
          c = jitter(C('#e6dfcb'), rng, 5);
        } else {
          const ring = Math.floor(d + (rng() - 0.5) * 0.35);
          c = jitter(C(ring % 2 === 0 ? '#e3d9bb' : '#cfc3a0'), rng, 5);
        }
        setPx(b, x, y, c);
      }
    }
    // Thin dark growth rings.
    for (const rr of [2.2, 3.6, 4.8]) {
      for (let a = 0; a < Math.PI * 2; a += 0.11) {
        const x = Math.round(7.5 + Math.cos(a) * rr);
        const y = Math.round(7.5 + Math.sin(a) * rr);
        setPx(b, x, y, mix(getPx(b, x, y), [168, 156, 124], 0.55));
      }
    }
    // Pale heart and a couple of radial checks.
    blob(b, rng, 8, 8, 1.3, C('#efe6ca'));
    for (const a of [0.5, 2.6, 4.7]) {
      for (let t = 1.2; t < 5.2; t += 0.6) {
        const x = Math.round(7.5 + Math.cos(a) * t);
        const y = Math.round(7.5 + Math.sin(a) * t);
        setPx(b, x, y, C('#b9ab86'));
      }
    }
  },

  birch_leaves(b, rng) {
    noiseFill(b, rng, [
      ['#8fb84a', 6],
      ['#9cc655', 4],
      ['#7fa83f', 4],
      ['#a9d063', 2],
      ['#6f973a', 2],
    ]);
    for (let i = 0; i < 9; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.8 + rng() * 1.6,
        C(rng() < 0.5 ? '#6f973a' : '#b3d970')
      );
    }
    // Gaps between leaf clusters; a few are see-through.
    for (let i = 0; i < 24; i++) {
      const x = (rng() * 16) | 0;
      const y = (rng() * 16) | 0;
      if (rng() < 0.22) setPx(b, x, y, [0, 0, 0], 0);
      else setPx(b, x, y, C('#5f852f'));
    }
    for (let i = 0; i < 6; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, C('#c2e07f'));
    }
  },

  birch_planks(b, rng) {
    paintPlanks(
      b,
      rng,
      [
        ['#d7c88f', 5],
        ['#cdbd80', 4],
        ['#e0d29b', 3],
        ['#c4b478', 3],
      ],
      '#9a8a5c',
      '#eadfb4'
    );
    // Pale fibre flecks along the boards.
    for (let i = 0; i < 6; i++) {
      const y = (rng() * 16) | 0;
      const x = (rng() * 14) | 0;
      setPx(b, x, y, C('#f0e7c2'));
      setPx(b, x + 1, y, C('#e2d6a8'));
    }
  },

  spruce_log_side(b, rng) {
    const bark = ['#3f2c1d', '#4a3524', '#33251a', '#563f2b', '#2b1f16'];
    for (let x = 0; x < 16; x++) {
      const base = C(bark[(rng() * bark.length) | 0]);
      for (let y = 0; y < 16; y++) setPx(b, x, y, jitter(base, rng, 7));
    }
    // Deep vertical grooves with a lit ridge on their right.
    for (let g = 0; g < 6; g++) {
      const x = 1 + ((rng() * 14) | 0);
      const y0 = (rng() * 6) | 0;
      const len = 5 + ((rng() * 10) | 0);
      for (let y = y0; y < Math.min(16, y0 + len); y++) {
        setPx(b, x, y, C('#241811'));
        if (x + 1 < 16) {
          setPx(b, x + 1, y, mix(getPx(b, x + 1, y), [122, 92, 62], 0.35));
        }
      }
    }
    // Knots and a couple of bark flecks.
    blob(b, rng, 5, 7, 1.4, C('#2a1d13'));
    blob(b, rng, 11, 12, 1.2, C('#241810'));
    setPx(b, 4, 6, C('#6b4f33'));
    setPx(b, 13, 3, C('#6b4f33'));
  },

  spruce_log_top(b, rng) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        let c;
        if (d > 6.2) {
          c = jitter(C('#392a1c'), rng, 6);
        } else if (d > 5.4) {
          c = jitter(C('#5a4028'), rng, 6);
        } else {
          const ring = Math.floor(d + (rng() - 0.5) * 0.35);
          c = jitter(C(ring % 2 === 0 ? '#7a5a36' : '#63482c'), rng, 5);
        }
        setPx(b, x, y, c);
      }
    }
    for (const rr of [2.4, 3.8, 5.0]) {
      for (let a = 0; a < Math.PI * 2; a += 0.11) {
        const x = Math.round(7.5 + Math.cos(a) * rr);
        const y = Math.round(7.5 + Math.sin(a) * rr);
        setPx(b, x, y, mix(getPx(b, x, y), [42, 30, 18], 0.55));
      }
    }
    blob(b, rng, 8, 8, 1.3, C('#4f3722'));
    setPx(b, 7, 7, C('#3a2818'));
  },

  spruce_leaves(b, rng) {
    noiseFill(b, rng, [
      ['#2f5a44', 6],
      ['#3a6b50', 4],
      ['#26493a', 4],
      ['#447a5c', 2],
      ['#1e3a2d', 3],
    ]);
    for (let i = 0; i < 10; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.8 + rng() * 1.7,
        C(rng() < 0.5 ? '#1e3a2d' : '#4d8a67')
      );
    }
    for (let i = 0; i < 26; i++) {
      const x = (rng() * 16) | 0;
      const y = (rng() * 16) | 0;
      if (rng() < 0.22) setPx(b, x, y, [0, 0, 0], 0);
      else setPx(b, x, y, C('#183026'));
    }
    for (let i = 0; i < 6; i++) {
      setPx(b, (rng() * 16) | 0, (rng() * 16) | 0, C('#5d9673'));
    }
  },

  spruce_planks(b, rng) {
    paintPlanks(
      b,
      rng,
      [
        ['#6b4a2c', 5],
        ['#5f4126', 4],
        ['#775434', 3],
        ['#55391f', 3],
      ],
      '#33210f',
      '#8a6238'
    );
    for (let i = 0; i < 5; i++) {
      const y = (rng() * 16) | 0;
      const x = (rng() * 13) | 0;
      setPx(b, x, y, C('#4a3220'));
      setPx(b, x + 2, y, C('#8a6238'));
    }
  },

  cactus_side(b, rng) {
    noiseFill(b, rng, [
      ['#4c8b3a', 6],
      ['#549a41', 4],
      ['#3f7a30', 4],
      ['#5aa646', 2],
      ['#376b29', 2],
    ]);
    // Three vertical ribs: dark groove plus lit ridge.
    for (const rx of [2, 7, 12]) {
      for (let y = 0; y < 16; y++) {
        setPx(b, rx, y, jitter(C('#316324'), rng, 4));
        setPx(b, rx + 1, y, mix(getPx(b, rx + 1, y), [126, 190, 96], 0.42));
      }
    }
    // White spines in pairs, staggered down the ribs.
    for (let y = 1; y < 16; y += 3) {
      for (const rx of [2, 7, 12]) {
        setPx(b, rx - 1, y, C('#eef4dc'));
        if (y + 1 < 16) setPx(b, rx - 1, y + 1, C('#c6d4a4'));
      }
      if (y + 1 < 16) {
        setPx(b, 5, y + 1, C('#e2eccb'));
        setPx(b, 10, y + 1, C('#e2eccb'));
      }
    }
    // Dark rims keep the block from bleeding into its neighbours.
    for (let y = 0; y < 16; y++) {
      setPx(b, 0, y, mix(getPx(b, 0, y), [24, 56, 18], 0.35));
      setPx(b, 15, y, mix(getPx(b, 15, y), [24, 56, 18], 0.35));
    }
  },

  cactus_top(b, rng) {
    noiseFill(b, rng, [
      ['#4c8b3a', 6],
      ['#549a41', 4],
      ['#3f7a30', 4],
      ['#5aa646', 2],
      ['#376b29', 2],
    ]);
    // Dark outer wall of the trunk.
    for (let i = 0; i < 16; i++) {
      setPx(b, i, 0, mix(getPx(b, i, 0), [26, 60, 20], 0.45));
      setPx(b, i, 15, mix(getPx(b, i, 15), [26, 60, 20], 0.45));
      setPx(b, 0, i, mix(getPx(b, 0, i), [26, 60, 20], 0.45));
      setPx(b, 15, i, mix(getPx(b, 15, i), [26, 60, 20], 0.45));
    }
    // Pale fleshy centre.
    blob(b, rng, 8, 8, 4.4, C('#3f7a30'));
    blob(b, rng, 8, 8, 3.3, C('#7fb864'));
    blob(b, rng, 7.6, 7.6, 1.9, C('#93c978'));
    // Spines and areoles radiating from the centre.
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      for (let t = 4.6; t <= 6.4; t += 0.9) {
        const x = Math.round(7.5 + Math.cos(a) * t);
        const y = Math.round(7.5 + Math.sin(a) * t);
        setPx(b, x, y, C(rng() < 0.5 ? '#eef4dc' : '#c6d4a4'));
      }
    }
    blob(b, rng, 6.5, 6.5, 1.1, C('#a8d78d'), 220);
  },

  clay(b, rng) {
    noiseFill(b, rng, [
      ['#9aa3ab', 6],
      ['#a6afb6', 4],
      ['#8e97a0', 4],
      ['#b2bac0', 2],
      ['#828b94', 3],
    ]);
    for (let i = 0; i < 8; i++) {
      blob(
        b,
        rng,
        rng() * 16,
        rng() * 16,
        0.7 + rng() * 1.5,
        C(rng() < 0.5 ? '#8b949d' : '#a7b0b7')
      );
    }
    for (let i = 0; i < 14; i++) {
      setPx(
        b,
        (rng() * 16) | 0,
        (rng() * 16) | 0,
        C(rng() < 0.5 ? '#7f8891' : '#b3bbc1')
      );
    }
  },
  bed_top(b, rng) {
    noiseFill(b, rng, [
      ['#b8353f', 5],
      ['#a92d36', 3],
      ['#c94b55', 2],
    ]);
    // 白色枕头（头部）
    fillRect(b, 1, 1, 14, 4, C('#ece7de'));
    hline(b, 1, 14, 4, C('#cfc7bb'));
    // 边缘
    hline(b, 0, 15, 0, C('#7a1f26'));
    hline(b, 0, 15, 15, C('#7a1f26'));
    vline(b, 0, 15, 0, C('#7a1f26'));
    vline(b, 0, 15, 15, C('#7a1f26'));
    // 被子褶皱
    for (let i = 0; i < 6; i++) {
      setPx(b, 2 + Math.floor(rng() * 12), 6 + Math.floor(rng() * 8), C('#8f2830'));
    }
  },

  bed_side(b, rng) {
    noiseFill(b, rng, [
      ['#b8353f', 5],
      ['#a92d36', 3],
      ['#c94b55', 2],
    ]);
    // 木床架
    fillRect(b, 0, 10, 16, 6, C('#8a5a2e'));
    for (let x = 0; x < 16; x += 4) vline(b, 10, 15, x, C('#6b4522'));
    hline(b, 0, 15, 10, C('#6b4423'));
    // 白色床沿
    hline(b, 0, 15, 9, C('#e8e2d8'));
  },

  farmland_top(b, rng) {
    noiseFill(b, rng, [
      ['#5a3d25', 6],
      ['#6b4a2e', 4],
      ['#4d3420', 3],
    ]);
    for (let y = 2; y < 16; y += 5) hline(b, 0, 15, y, C('#7a5738'));
    for (let x = 1; x < 16; x += 4) vline(b, 0, 15, x, C('#4a3020'));
  },

  farmland_side(b, rng) {
    noiseFill(b, rng, [
      ['#6a4a2f', 5],
      ['#5a3d25', 4],
      ['#79553a', 3],
    ]);
    // 顶部湿润深色土
    fillRect(b, 0, 0, 16, 3, C('#4c3421'));
    hline(b, 0, 15, 3, C('#3d291a'));
    for (let i = 0; i < 12; i++) {
      setPx(b, (rng() * 16) | 0, 4 + ((rng() * 12) | 0), C('#7d5a3c'));
    }
  },

  wheat_stage0(b, rng) {
    for (let i = 0; i < 5; i++) {
      const x = 2 + ((rng() * 12) | 0);
      vline(b, 11, 14, x, C('#4f8a2f'));
      setPx(b, x, 10, C('#69a83f'));
    }
  },

  wheat_stage1(b, rng) {
    for (let i = 0; i < 6; i++) {
      const x = 2 + ((rng() * 12) | 0);
      vline(b, 8, 14, x, C('#4f8a2f'));
      setPx(b, x, 7, C('#5f9a37'));
      setPx(b, x + 1, 9, C('#6faa47'));
    }
  },

  wheat_stage2(b, rng) {
    for (let i = 0; i < 7; i++) {
      const x = 2 + ((rng() * 12) | 0);
      vline(b, 4, 14, x, C('#5a8a2f'));
      setPx(b, x, 3, C('#6fa33c'));
      setPx(b, x + 1, 6, C('#78a843'));
      setPx(b, x - 1, 8, C('#7cae45'));
    }
  },

  wheat_stage3(b, rng) {
    for (let i = 0; i < 8; i++) {
      const x = 1 + ((rng() * 14) | 0);
      vline(b, 2, 14, x, C('#a08a2e'));
      // 麦穗
      fillRect(b, x - 1, 2, 3, 4, C('#d8b83a'));
      setPx(b, x, 1, C('#efd45c'));
      setPx(b, x + 1, 3, C('#c4a232'));
    }
  },

  tnt_side(b, rng) {
    noiseFill(b, rng, [
      ['#b83a2e', 6],
      ['#a83227', 5],
      ['#c9483a', 3],
    ]);
    fillRect(b, 0, 6, 16, 5, C('#e8e4d8'));
    // TNT 字样
    const ink = C('#232323');
    fillRect(b, 2, 7, 3, 1, ink);
    fillRect(b, 3, 7, 1, 4, ink);
    fillRect(b, 6, 7, 1, 4, ink);
    fillRect(b, 7, 7, 1, 1, ink);
    fillRect(b, 8, 8, 1, 2, ink);
    fillRect(b, 9, 7, 1, 4, ink);
    fillRect(b, 11, 7, 3, 1, ink);
    fillRect(b, 12, 7, 1, 4, ink);
    hline(b, 0, 15, 11, C('#7e2319'));
    hline(b, 0, 15, 12, C('#cf5a48'));
  },

  tnt_top(b, rng) {
    noiseFill(b, rng, [
      ['#b83a2e', 6],
      ['#a83227', 4],
      ['#c9483a', 3],
    ]);
    fillRect(b, 5, 5, 6, 6, C('#e8e4d8'));
    fillRect(b, 6, 6, 4, 4, C('#8a8a8a'));
    fillRect(b, 7, 7, 2, 2, C('#3a3a3a'));
    setPx(b, 8, 4, C('#d8d8d8'));
  },

  tnt_bottom(b, rng) {
    noiseFill(b, rng, [
      ['#8e2a20', 6],
      ['#7a231b', 4],
      ['#9c3227', 3],
    ]);
    fillRect(b, 4, 4, 8, 8, C('#6a1c15'));
    fillRect(b, 6, 6, 4, 4, C('#4a120d'));
  },

  door(b, rng) {
    noiseFill(b, rng, [
      ['#a9743f', 6],
      ['#8a5a2e', 4],
      ['#b9854c', 3],
    ]);
    // 门框
    vline(b, 0, 15, 0, C('#5f3d1d'));
    vline(b, 0, 15, 15, C('#5f3d1d'));
    hline(b, 0, 15, 0, C('#5f3d1d'));
    hline(b, 0, 15, 15, C('#5f3d1d'));
    // 上窗
    fillRect(b, 3, 2, 10, 4, C('#3a2a18'));
    fillRect(b, 4, 3, 3, 2, C('#6a7f9a'));
    fillRect(b, 9, 3, 3, 2, C('#6a7f9a'));
    // 中横档
    fillRect(b, 1, 7, 14, 2, C('#7d5327'));
    // 下门板
    fillRect(b, 3, 10, 10, 4, C('#8a5a2e'));
    hline(b, 3, 12, 11, C('#6b4423'));
    // 门把手
    fillRect(b, 12, 8, 2, 2, C('#3a3a3a'));
    setPx(b, 12, 8, C('#c8c8c8'));
  },

};

function paintTile(name) {
  const painter = TILE_PAINTERS[name];
  if (!painter) throw new Error('No painter for tile: ' + name);
  const buf = makeBuf(TILE_PX, TILE_PX);
  painter(buf, mulberry32(hashString('tile:' + name)));
  return buf;
}

/** Build the 128x128 atlas. Tile i goes to col=i%8, row=floor(i/8). */
export function buildAtlas() {
  const atlas = makeBuf(ATLAS_SIZE, ATLAS_SIZE);
  for (let i = 0; i < TILE_NAMES.length; i++) {
    const tile = paintTile(TILE_NAMES[i]);
    const ox = (i % ATLAS_COLS) * TILE_PX;
    const oy = Math.floor(i / ATLAS_COLS) * TILE_PX;
    // Straight pixel copy: a tile can never spill into its neighbour.
    for (let y = 0; y < TILE_PX; y++) {
      const src = y * TILE_PX * 4;
      const dst = ((oy + y) * ATLAS_SIZE + ox) * 4;
      atlas.data.set(tile.data.subarray(src, src + TILE_PX * 4), dst);
    }
  }
  return canvasFromBuffer(atlas);
}

/* =====================================================================
 * 7. Destroy-stage cracks
 * ===================================================================== */

/**
 * Grow a branching crack network from the centre of a 16x16 tile with a
 * breadth-first random walk. The visit order gives us "how early" each
 * crack pixel appears, which maps cleanly onto stages 1..10.
 */
function crackLayout() {
  const rng = mulberry32(0x5eed51);
  const order = new Int16Array(256).fill(-1);
  const walkers = [];

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng() * 0.8;
    walkers.push({
      x: 7.5 + Math.cos(a) * 1.5,
      y: 7.5 + Math.sin(a) * 1.5,
      a,
      life: 9 + rng() * 10,
    });
  }

  let seq = 0;
  let steps = 0;
  while (walkers.length > 0 && steps < 400) {
    steps++;
    const w = walkers.shift();
    w.x += Math.cos(w.a);
    w.y += Math.sin(w.a);
    w.life -= 1;

    const ix = Math.floor(w.x);
    const iy = Math.floor(w.y);
    if (ix >= 0 && ix < 16 && iy >= 0 && iy < 16) {
      const idx = iy * 16 + ix;
      if (order[idx] < 0) order[idx] = seq++;
    }

    if (w.life > 0 && w.x > 0 && w.x < 15 && w.y > 0 && w.y < 15) {
      walkers.push({
        x: w.x,
        y: w.y,
        a: w.a + (rng() - 0.5) * 0.8,
        life: w.life,
      });
      if (rng() < 0.16 && walkers.length < 8) {
        walkers.push({
          x: w.x,
          y: w.y,
          a: w.a + (rng() < 0.5 ? -1 : 1) * (0.8 + rng() * 0.6),
          life: w.life * 0.6,
        });
      }
    }
  }

  const total = Math.max(1, seq);
  const stage = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (order[i] >= 0) {
      stage[i] = Math.min(10, 1 + Math.floor((order[i] / total) * 10));
    }
  }
  return stage;
}

/** Ten 16x16 overlays: transparent except for the growing cracks. */
export function buildBreakTextures() {
  const layout = crackLayout();
  const out = [];
  for (let stage = 1; stage <= 10; stage++) {
    const buf = makeBuf(TILE_PX, TILE_PX);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const s = layout[y * TILE_PX + x];
        if (s === 0 || s > stage) continue;
        const alpha = 120 + stage * 9;
        setPx(buf, x, y, [17, 13, 11], alpha);

        // Late stages get a slightly wider, softer crack.
        if (stage >= 8) {
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= 16 || ny >= 16) continue;
            const ai = (ny * 16 + nx) * 4 + 3;
            if (buf.data[ai] < 60) setPx(buf, nx, ny, [17, 13, 11], 60);
          }
        }
      }
    }
    out.push(canvasFromBuffer(buf));
  }
  return out;
}

/* =====================================================================
 * 8. Item icon helpers (32x32)
 * ===================================================================== */

const MAT = {
  wood: {
    base: C('#a0703c'),
    light: C('#c2924f'),
    dark: C('#7d5327'),
    line: C('#4a2f14'),
  },
  stone: {
    base: C('#8f8f8f'),
    light: C('#ababab'),
    dark: C('#6d6d6d'),
    line: C('#3f3f3f'),
  },
  iron: {
    base: C('#dcdcdc'),
    light: C('#f4f4f4'),
    dark: C('#a8a8a8'),
    line: C('#5f5f5f'),
  },
};

const MAT_WOOD_DARK = {
  base: C('#7d5327'),
  light: C('#a0703c'),
  dark: C('#4a2f14'),
  line: C('#2e1c0b'),
};

/**
 * Draw a filled polygon with a one-pixel outline and a simple bevel:
 * light on the top/left rim, dark on the bottom/right rim.
 */
function drawShape(b, pts, mat) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }

  const x0 = Math.max(0, Math.floor(minX) - 2);
  const x1 = Math.min(b.w - 1, Math.ceil(maxX) + 2);
  const y0 = Math.max(0, Math.floor(minY) - 2);
  const y1 = Math.min(b.h - 1, Math.ceil(maxY) + 2);
  const W = x1 - x0 + 1;

  const mask = new Uint8Array(W * (y1 - y0 + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      mask[(y - y0) * W + (x - x0)] = pointInPoly(x + 0.5, y + 0.5, pts) ? 1 : 0;
    }
  }

  const at = (x, y) =>
    x < x0 || x > x1 || y < y0 || y > y1
      ? 0
      : mask[(y - y0) * W + (x - x0)];

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (at(x, y)) {
        const up = at(x, y - 1);
        const down = at(x, y + 1);
        const left = at(x - 1, y);
        const right = at(x + 1, y);
        const topLeft = !up || !left;
        const bottomRight = !down || !right;
        let col = mat.base;
        if (topLeft) col = mat.light;
        if (bottomRight) col = mat.dark;
        if (topLeft && bottomRight) col = mat.base;
        setPx(b, x, y, col);
      } else if (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) {
        setPx(b, x, y, mat.line);
      }
    }
  }
}

/** Diagonal bar (handle, stick, guard) with a dark outline and lit ridge. */
function drawBar(b, x0, y0, x1, y1, w, mat) {
  thickLine(b, x0, y0, x1, y1, w + 2, mat.line);
  thickLine(b, x0, y0, x1, y1, w, mat.base);
  thickLine(b, x0 - 0.8, y0 - 0.8, x1 - 0.8, y1 - 0.8, Math.max(1, w - 2.2), mat.light);
}

/** Long tapered blade with a pointed tip, used by swords. */
function bladePoly(x0, y0, x1, y1, w, tip) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const bx = x1 - ux * tip;
  const by = y1 - uy * tip;
  return [
    [x0 + nx * (w / 2), y0 + ny * (w / 2)],
    [bx + nx * (w * 0.42), by + ny * (w * 0.42)],
    [x1, y1],
    [bx - nx * (w * 0.42), by - ny * (w * 0.42)],
    [x0 - nx * (w / 2), y0 - ny * (w / 2)],
  ];
}

/* Head silhouettes, sized for a 32x32 icon. */

const PICK_HEAD = [
  [3, 15],
  [4, 10],
  [8, 6],
  [13, 4],
  [19, 4],
  [24, 6],
  [27, 9],
  [28, 15],
  [24, 12],
  [20, 9],
  [16, 8],
  [12, 9],
  [7, 12],
];

const AXE_HEAD = [
  [15, 5],
  [20, 3],
  [25, 5],
  [28, 9],
  [28, 14],
  [24, 18],
  [19, 20],
  [15, 17],
  [13, 11],
];

const SHOVEL_HEAD = [
  [12, 4],
  [16, 2],
  [20, 4],
  [23, 8],
  [23, 12],
  [19, 17],
  [14, 18],
  [11, 13],
  [10, 8],
];


/** 锄头图标：木柄 + 弯头。 */
function paintHoe(b, mat) {
  thickLine(b, 8, 27, 23, 9, 4, C('#8a5a2e'));
  thickLine(b, 9, 27, 23, 10, 2, C('#a9743f'));
  fillRect(b, 18, 7, 9, 4, C('#6b4a24'));
  fillRect(b, 19, 8, 7, 4, C('#' + ('d8d8d8')));
  setPx(b, 19, 8, C('#ffffff'));
  fillRect(b, 24, 10, 3, 5, C('#8f8f8f'));
  setPx(b, 25, 11, C('#e8e8e8'));
}

function paintTool(b, mat, kind) {
  if (kind === 'sword') {
    // Blade.
    drawShape(b, bladePoly(15.5, 17.5, 26.5, 6.5, 5, 6), mat);
    // Grip.
    drawBar(b, 14.5, 18.5, 10, 23, 3.5, MAT.wood);
    // Pommel.
    drawShape(
      b,
      [
        [7.5, 23.5],
        [10.5, 23.5],
        [10.5, 26.5],
        [7.5, 26.5],
      ],
      MAT_WOOD_DARK
    );
    // Crossguard.
    drawBar(b, 12, 14, 19, 21, 3, mat);
    // Grip wraps.
    setPx(b, 13, 20, MAT_WOOD_DARK.base);
    setPx(b, 12, 21, MAT_WOOD_DARK.base);
    return;
  }

  // The handle runs a little way under the head; the head is drawn on
  // top so the joint is hidden instead of leaving a gap.
  const handle = kind === 'shovel' ? [19, 14, 10, 27] : [19, 10, 9, 27];
  drawBar(b, handle[0], handle[1], handle[2], handle[3], 4, MAT.wood);

  const head =
    kind === 'pickaxe' ? PICK_HEAD : kind === 'axe' ? AXE_HEAD : SHOVEL_HEAD;
  drawShape(b, head, mat);

  if (kind === 'pickaxe') {
    setPx(b, 16, 5, mat.light);
    setPx(b, 12, 7, mat.light);
  } else if (kind === 'axe') {
    setPx(b, 20, 6, mat.light);
    setPx(b, 24, 9, mat.light);
  } else {
    setPx(b, 16, 4, mat.light);
    setPx(b, 19, 6, mat.light);
  }
}

function paintIngot(b, mat) {
  const pts = [
    [9, 10],
    [21, 10],
    [27, 16],
    [22, 23],
    [9, 23],
    [4, 16],
  ];
  drawShape(b, pts, mat);
  // Seam between the two cast halves.
  for (let x = 9; x <= 21; x++) {
    setPx(b, x, 16, mix(mat.base, mat.dark, 0.45));
  }
  setPx(b, 12, 13, mat.light);
  setPx(b, 13, 13, mat.light);
  setPx(b, 16, 12, mat.light);
}

/* =====================================================================
 * 9. The 18 item icons
 * ===================================================================== */

const ICON_PAINTERS = {
  stick(b, rng) {
    drawBar(b, 10, 24, 22, 8, 4, MAT.wood);
    setPx(b, 14, 19, MAT.wood.dark);
    setPx(b, 17, 15, MAT.wood.dark);
    setPx(b, 12, 22, MAT.wood.light);
    setPx(b, 20, 10, MAT.wood.light);
  },

  coal(b, rng) {
    const coalMat = {
      base: C('#262626'),
      light: C('#3d3d3d'),
      dark: C('#0e0e0e'),
      line: C('#000000'),
    };
    drawShape(b, irregularPoly(16, 17, 10, 8, 8, rng, 0.28), coalMat);
    fillPoly(
      b,
      [
        [12, 13],
        [16, 10],
        [19, 14],
        [15, 16],
      ],
      '#3a3a3a'
    );
    fillPoly(
      b,
      [
        [17, 18],
        [21, 16],
        [22, 20],
        [18, 22],
      ],
      '#1a1a1a'
    );
    setPx(b, 12, 12, '#5a5a5a');
    setPx(b, 13, 12, '#4a4a4a');
  },

  iron_ingot(b, rng) {
    paintIngot(b, MAT.iron);
  },

  gold_ingot(b, rng) {
    paintIngot(b, {
      base: C('#f2c93c'),
      light: C('#ffe873'),
      dark: C('#b8912a'),
      line: C('#6e5205'),
    });
  },

  diamond(b, rng) {
    const gem = {
      base: C('#3fd6d4'),
      light: C('#9ff8f2'),
      dark: C('#1a9090'),
      line: C('#083e3e'),
    };
    drawShape(
      b,
      [
        [16, 3],
        [27, 14],
        [16, 28],
        [5, 14],
      ],
      gem
    );
    fillPoly(
      b,
      [
        [16, 6],
        [10, 13],
        [16, 13],
      ],
      '#8af0ea'
    );
    fillPoly(
      b,
      [
        [17, 17],
        [22, 16],
        [16, 24],
      ],
      '#22a8a6'
    );
    setPx(b, 12, 10, '#e8fffd');
    setPx(b, 13, 10, '#cffcf8');
  },

  apple(b, rng) {
    const body = irregularPoly(16, 19.5, 9.5, 8.5, 10, rng, 0.07);
    drawShape(b, body, {
      base: C('#c92b2b'),
      light: C('#e8544a'),
      dark: C('#8d1c1c'),
      line: C('#4c0d0d'),
    });
    // Stem.
    thickLine(b, 16, 11, 17.5, 5.5, 3, C('#4a2f14'));
    thickLine(b, 16.2, 11, 17.6, 6, 1.4, C('#6b4a26'));
    // Leaf.
    drawShape(
      b,
      [
        [18, 9],
        [21, 4],
        [26, 6],
        [23, 11],
        [19, 11],
      ],
      {
        base: C('#4c9a32'),
        light: C('#78c452'),
        dark: C('#2f6b1e'),
        line: C('#1d4413'),
      }
    );
    // Shine.
    blob(b, rng, 12, 15, 2.2, C('#f07a6a'), 190);
    setPx(b, 11, 14, '#ffd9d0');
    setPx(b, 12, 14, '#ffd9d0');
    setPx(b, 11, 15, '#ffd9d0');
  },

  wooden_pickaxe(b, rng) {
    paintTool(b, MAT.wood, 'pickaxe');
  },
  stone_pickaxe(b, rng) {
    paintTool(b, MAT.stone, 'pickaxe');
  },
  iron_pickaxe(b, rng) {
    paintTool(b, MAT.iron, 'pickaxe');
  },
  wooden_axe(b, rng) {
    paintTool(b, MAT.wood, 'axe');
  },
  stone_axe(b, rng) {
    paintTool(b, MAT.stone, 'axe');
  },
  iron_axe(b, rng) {
    paintTool(b, MAT.iron, 'axe');
  },
  wooden_shovel(b, rng) {
    paintTool(b, MAT.wood, 'shovel');
  },
  stone_shovel(b, rng) {
    paintTool(b, MAT.stone, 'shovel');
  },
  iron_shovel(b, rng) {
    paintTool(b, MAT.iron, 'shovel');
  },
  wooden_sword(b, rng) {
    paintTool(b, MAT.wood, 'sword');
  },
  stone_sword(b, rng) {
    paintTool(b, MAT.stone, 'sword');
  },
  iron_sword(b, rng) {
    paintTool(b, MAT.iron, 'sword');
  },

  /* ------------------------------------------------------------------
   * Appended item icons: food, mob drops, arrow, clay and bread.
   * Same language as the tools above: one-pixel dark outline, a lit
   * top-left bevel and chunky readable silhouettes on 32x32.
   * ------------------------------------------------------------------ */

  beef(b, rng) {
    const meat = {
      base: C('#b13a34'),
      light: C('#d15a4a'),
      dark: C('#852623'),
      line: C('#4a1210'),
    };
    drawShape(b, irregularPoly(16, 18, 11, 8, 10, rng, 0.12), meat);
    // White fat marbling across the cut.
    thickLine(b, 10, 15, 16, 13, 2.4, C('#f0cfc4'));
    thickLine(b, 12, 21, 21, 18, 2.2, C('#e8bfb2'));
    thickLine(b, 11, 18, 13, 22, 1.6, C('#dcae9f'));
    thickLine(b, 19, 15, 22, 18, 1.4, C('#e8bfb2'));
    // Wet shine on the upper left.
    setPx(b, 10, 13, C('#f0968a'));
    setPx(b, 11, 13, C('#e88170'));
    setPx(b, 10, 14, C('#e88170'));
    for (let i = 0; i < 6; i++) {
      setPx(b, 9 + ((rng() * 12) | 0), 16 + ((rng() * 7) | 0), C('#7c2320'));
    }
  },

  cooked_beef(b, rng) {
    const meat = {
      base: C('#8a5834'),
      light: C('#a8774a'),
      dark: C('#63391f'),
      line: C('#33200f'),
    };
    drawShape(b, irregularPoly(16, 18, 11, 8, 10, rng, 0.1), meat);
    // Sear stripes from the grill.
    thickLine(b, 9, 16, 15, 13, 2.2, C('#4f2f18'));
    thickLine(b, 13, 21, 22, 18, 2.2, C('#4f2f18'));
    thickLine(b, 18, 14, 23, 17, 1.8, C('#4f2f18'));
    // Juicy highlight.
    setPx(b, 10, 13, C('#d9ab7c'));
    setPx(b, 11, 13, C('#c2946a'));
    setPx(b, 10, 14, C('#c2946a'));
    setPx(b, 11, 15, C('#b2825a'));
  },

  porkchop(b, rng) {
    // Bone first, sticking out of the top-left corner of the chop.
    thickLine(b, 9, 10, 20, 21, 9, C('#8f8878'));
    thickLine(b, 9, 10, 20, 21, 6.5, C('#ece7d6'));
    blob(b, rng, 8.5, 9.5, 4.6, C('#8f8878'));
    blob(b, rng, 8.5, 9.5, 3.5, C('#ece7d6'));
    thickLine(b, 7.5, 8.5, 10, 9, 1.4, C('#ffffff'), 220);
    // Pale pink meat slab covering the lower-right half of the bone.
    const meat = {
      base: C('#e08a9a'),
      light: C('#f2b0bc'),
      dark: C('#c26474'),
      line: C('#7a3040'),
    };
    drawShape(b, irregularPoly(18, 20, 10, 7.5, 9, rng, 0.09), meat);
    // Rind of fat along the top of the chop.
    thickLine(b, 12, 16, 20, 14.5, 1.8, C('#f6dcd8'));
    setPx(b, 15, 15, C('#ffffff'));
    setPx(b, 16, 15, C('#ffe9ec'));
    setPx(b, 16, 17, C('#f7c6cf'));
    setPx(b, 17, 18, C('#f7c6cf'));
  },

  cooked_porkchop(b, rng) {
    thickLine(b, 9, 10, 20, 21, 9, C('#8f8878'));
    thickLine(b, 9, 10, 20, 21, 6.5, C('#e4ddca'));
    blob(b, rng, 8.5, 9.5, 4.6, C('#8f8878'));
    blob(b, rng, 8.5, 9.5, 3.5, C('#e4ddca'));
    thickLine(b, 7.5, 8.5, 10, 9, 1.4, C('#ffffff'), 220);
    const meat = {
      base: C('#c08444'),
      light: C('#ddaa62'),
      dark: C('#96602a'),
      line: C('#4f2f10'),
    };
    drawShape(b, irregularPoly(18, 20, 10, 7.5, 9, rng, 0.09), meat);
    // Grill sear.
    thickLine(b, 12, 18, 20, 16, 1.8, C('#7a4a1c'));
    thickLine(b, 14, 22, 21, 20, 1.6, C('#7a4a1c'));
    // Rind and shine.
    thickLine(b, 12, 16, 20, 14.5, 1.8, C('#e8c07a'));
    setPx(b, 15, 15, C('#ffffff'));
    setPx(b, 16, 15, C('#ffe0a8'));
  },

  chicken(b, rng) {
    const meat = {
      base: C('#e6a294'),
      light: C('#f7cfc4'),
      dark: C('#c07f72'),
      line: C('#6f4038'),
    };
    drawShape(b, irregularPoly(16, 18, 10.5, 8, 9, rng, 0.12), meat);
    // Membrane streaks.
    thickLine(b, 12, 15, 19, 13, 1.6, C('#f8d8ce'));
    thickLine(b, 12, 19, 20, 17, 1.4, C('#f2c4b8'));
    // Skin dimples.
    for (let i = 0; i < 7; i++) {
      setPx(b, 11 + ((rng() * 11) | 0), 15 + ((rng() * 8) | 0), C('#cf9184'));
    }
    setPx(b, 11, 14, C('#ffe3da'));
    setPx(b, 12, 14, C('#ffd6ca'));
    setPx(b, 11, 15, C('#ffd6ca'));
  },

  cooked_chicken(b, rng) {
    const meat = {
      base: C('#c98a3c'),
      light: C('#e8b45a'),
      dark: C('#a06a26'),
      line: C('#5a3a10'),
    };
    drawShape(b, irregularPoly(16, 18, 10.5, 8, 9, rng, 0.11), meat);
    // Crispy roasted patches.
    blob(b, rng, 13, 16, 1.8, C('#b0782e'));
    blob(b, rng, 19, 20, 1.6, C('#b0782e'));
    blob(b, rng, 16, 22, 1.4, C('#a06a26'));
    for (let i = 0; i < 5; i++) {
      setPx(b, 11 + ((rng() * 10) | 0), 14 + ((rng() * 8) | 0), C('#8f5f22'));
    }
    setPx(b, 11, 13, C('#ffe0a0'));
    setPx(b, 12, 13, C('#f2c874'));
    setPx(b, 11, 14, C('#f2c874'));
  },

  feather(b, rng) {
    const vane = {
      base: C('#ececec'),
      light: C('#ffffff'),
      dark: C('#b8b8b8'),
      line: C('#6b6b6b'),
    };
    // Quill axis: bottom-left to top-right.
    const ax = 9;
    const ay = 26;
    const bx = 24;
    const by = 7;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const steps = 10;
    // Fat in the middle, tapering to the quill base and the tip.
    const halfWidth = (t) =>
      5.2 * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (0.55 + 0.45 * t) + 0.6;
    const right = [];
    const left = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const w = halfWidth(t);
      const px = ax + dx * t;
      const py = ay + dy * t;
      right.push([px + nx * w, py + ny * w]);
      left.push([px - nx * w * 0.85, py - ny * w * 0.85]);
    }
    drawShape(b, right.concat(left.reverse()), vane);
    // Barbs running from the quill out to the vane edge.
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const w = halfWidth(t) * 0.72;
      const px = ax + dx * t;
      const py = ay + dy * t;
      thickLine(b, px, py, px + nx * w, py + ny * w, 1, C('#d0d0d0'));
      thickLine(b, px, py, px - nx * w, py - ny * w, 1, C('#d0d0d0'));
    }
    // Quill: dark rim, pale shaft, lit upper edge.
    thickLine(b, ax, ay, bx, by, 3.6, C('#8a8a8a'));
    thickLine(b, ax, ay, bx, by, 2, C('#f2f2f2'));
    thickLine(b, ax - 0.6, ay - 0.6, bx - 0.6, by - 0.6, 1, C('#ffffff'));
    // Downy wisps near the base.
    setPx(b, 10, 24, C('#ffffff'));
    setPx(b, 8, 25, C('#e8e8e8'));
    setPx(b, 11, 22, C('#ffffff'));
  },

  leather(b, rng) {
    const hide = {
      base: C('#8a5a2b'),
      light: C('#a87740'),
      dark: C('#6b4320'),
      line: C('#3a2410'),
    };
    drawShape(b, irregularPoly(16, 17, 11, 8.5, 7, rng, 0.2), hide);
    // Stitch line just inside the border.
    const inner = irregularPoly(16, 17, 8.5, 6.2, 7, rng, 0.12);
    for (let i = 0; i < inner.length; i++) {
      const p = inner[i];
      const q = inner[(i + 1) % inner.length];
      for (let t = 0.15; t < 0.9; t += 0.28) {
        setPx(
          b,
          Math.round(p[0] + (q[0] - p[0]) * t),
          Math.round(p[1] + (q[1] - p[1]) * t),
          C('#d9b57e')
        );
      }
    }
    // Fold crease and a highlight on the upper left.
    thickLine(b, 12, 14, 19, 20, 1.6, C('#6b4320'));
    setPx(b, 11, 12, C('#c9995c'));
    setPx(b, 12, 12, C('#c9995c'));
    setPx(b, 11, 13, C('#bd8b4e'));
    setPx(b, 20, 15, C('#a87740'));
  },

  bone(b, rng) {
    const rim = C('#8f8878');
    const body = C('#ece7d6');
    const shadeC = C('#c9c2ae');
    const lobes = [
      [7.5, 11.5],
      [11.5, 7.5],
      [20.5, 24.5],
      [24.5, 20.5],
    ];
    // Outline pass.
    thickLine(b, 11, 11, 21, 21, 11, rim);
    for (const [lx, ly] of lobes) blob(b, rng, lx, ly, 4.6, rim);
    // Bone body.
    thickLine(b, 11, 11, 21, 21, 6.5, body);
    for (const [lx, ly] of lobes) blob(b, rng, lx, ly, 3.4, body);
    // Knuckle shading: light on the top-left side, shadow below right.
    for (const [lx, ly] of lobes) {
      blob(b, rng, lx - 1.2, ly - 1.2, 1.5, C('#ffffff'), 190);
      blob(b, rng, lx + 1.4, ly + 1.4, 1.3, shadeC);
    }
    // A hairline crack and two chips on the shaft.
    thickLine(b, 14, 14, 17, 17, 1, shadeC);
    setPx(b, 12, 15, shadeC);
    setPx(b, 18, 12, shadeC);
  },

  string(b, rng) {
    // Flat coil: a slowly opening spiral sampled into short segments.
    const pts = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = t * Math.PI * 2 * 2.4 - Math.PI * 0.35;
      const r = 2.4 + t * 8.2;
      pts.push([16 + Math.cos(a) * r * 1.12, 17 + Math.sin(a) * r * 0.86]);
    }
    const end = pts[pts.length - 1];
    // Dark outline first, then the pale thread, so the halo stays outside.
    for (let i = 0; i + 1 < pts.length; i++) {
      thickLine(
        b,
        pts[i][0],
        pts[i][1],
        pts[i + 1][0],
        pts[i + 1][1],
        4.6,
        C('#8a8a8a')
      );
    }
    thickLine(b, end[0], end[1], 23, 28, 4.6, C('#8a8a8a'));
    for (let i = 0; i + 1 < pts.length; i++) {
      thickLine(
        b,
        pts[i][0],
        pts[i][1],
        pts[i + 1][0],
        pts[i + 1][1],
        2.8,
        C('#f0f0f0')
      );
    }
    thickLine(b, end[0], end[1], 23, 28, 2.8, C('#f0f0f0'));
    // Lit core along the strand.
    for (let i = 0; i + 1 < pts.length; i += 2) {
      thickLine(b, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1, C('#ffffff'));
    }
    setPx(b, 17, 15, C('#ffffff'));
    setPx(b, 18, 15, C('#ffffff'));
    setPx(b, 17, 16, C('#ffffff'));
  },

  gunpowder(b, rng) {
    const powder = {
      base: C('#6e6e6e'),
      light: C('#8f8f8f'),
      dark: C('#484848'),
      line: C('#2a2a2a'),
    };
    drawShape(
      b,
      [
        [3, 26],
        [4, 21],
        [7, 16],
        [11, 12],
        [16, 10],
        [21, 12],
        [25, 16],
        [28, 21],
        [29, 26],
      ],
      powder
    );
    // Granular texture, only on pixels that are inside the heap.
    for (let i = 0; i < 30; i++) {
      const x = 7 + ((rng() * 19) | 0);
      const y = 14 + ((rng() * 11) | 0);
      if (getPx(b, x, y)[3] < 200) continue;
      setPx(b, x, y, C(rng() < 0.5 ? '#3f3f3f' : '#9a9a9a'));
    }
    // A few chunkier grains and a lit crest.
    blob(b, rng, 13, 21, 1.8, C('#3f3f3f'));
    blob(b, rng, 19, 22, 1.6, C('#8a8a8a'));
    blob(b, rng, 22, 19, 1.4, C('#4a4a4a'));
    setPx(b, 12, 15, C('#b0b0b0'));
    setPx(b, 13, 15, C('#a0a0a0'));
    setPx(b, 14, 16, C('#b0b0b0'));
  },

  rotten_flesh(b, rng) {
    const rot = {
      base: C('#5f7a3c'),
      light: C('#7f9c52'),
      dark: C('#43592a'),
      line: C('#243a14'),
    };
    drawShape(b, irregularPoly(16, 18, 10.5, 8, 9, rng, 0.22), rot);
    // Rotten pits eaten into the flesh.
    blob(b, rng, 12, 16, 1.8, rot.dark);
    blob(b, rng, 19, 19, 1.6, rot.dark);
    blob(b, rng, 14, 22, 1.4, rot.dark);
    blob(b, rng, 20, 14, 1.2, C('#33491f'));
    // Sickly slime shine.
    setPx(b, 11, 14, C('#a8c47a'));
    setPx(b, 12, 14, C('#96b268'));
    setPx(b, 11, 15, C('#96b268'));
    setPx(b, 13, 15, C('#8aa85e'));
    for (let i = 0; i < 8; i++) {
      setPx(b, 10 + ((rng() * 13) | 0), 14 + ((rng() * 10) | 0), C('#3a5222'));
    }
  },

  arrow(b, rng) {
    const steel = {
      base: C('#a8a8a8'),
      light: C('#d0d0d0'),
      dark: C('#7a7a7a'),
      line: C('#3f3f3f'),
    };
    // Fletching first, so the shaft crosses it cleanly.
    const vanes = [
      [10, 27.5],
      [4, 22],
    ];
    for (const [vx, vy] of vanes) {
      thickLine(b, 9, 23, vx, vy, 6.5, C('#6b6b6b'));
    }
    for (const [vx, vy] of vanes) {
      thickLine(b, 9, 23, vx, vy, 4.6, C('#f2f2f2'));
    }
    for (const [vx, vy] of vanes) {
      thickLine(b, 8.4, 22.4, vx - 0.6, vy - 0.6, 1.6, C('#ffffff'));
    }
    // Wooden shaft.
    thickLine(b, 6, 26, 21, 11, 5, C('#4a2f14'));
    thickLine(b, 6, 26, 21, 11, 3.2, C('#a0703c'));
    thickLine(b, 5.4, 25.4, 20.4, 10.4, 1.2, C('#c2924f'));
    // Grey flint head.
    drawShape(
      b,
      [
        [26.5, 5.5],
        [23.8, 13.8],
        [18.2, 8.2],
      ],
      steel
    );
  },

  clay_ball(b, rng) {
    const clayMat = {
      base: C('#9aa3ab'),
      light: C('#b8c0c7'),
      dark: C('#7b848d'),
      line: C('#454d55'),
    };
    drawShape(b, irregularPoly(16, 17, 9.5, 8.5, 10, rng, 0.08), clayMat);
    // Rolled clay: soft highlight, darker underside, a few flecks.
    setPx(b, 11, 12, C('#d2d8dd'));
    setPx(b, 12, 12, C('#d2d8dd'));
    setPx(b, 11, 13, C('#c6ccd2'));
    setPx(b, 12, 13, C('#c6ccd2'));
    setPx(b, 13, 12, C('#c6ccd2'));
    for (let i = 0; i < 5; i++) {
      setPx(b, 12 + ((rng() * 9) | 0), 16 + ((rng() * 7) | 0), C('#8a939c'));
    }
    setPx(b, 18, 22, C('#7b848d'));
  },

  bread(b, rng) {
    const crust = {
      base: C('#c08a3e'),
      light: C('#e0ad5c'),
      dark: C('#96662a'),
      line: C('#54380f'),
    };
    drawShape(
      b,
      [
        [8, 12],
        [9, 8],
        [13, 6],
        [20, 6],
        [24, 8],
        [25, 12],
        [25, 21],
        [22, 25],
        [10, 25],
        [7, 21],
        [7, 15],
      ],
      crust
    );
    // Slashed top.
    for (let i = 0; i < 3; i++) {
      const x = 9 + i * 5;
      thickLine(b, x, 13, x + 3, 9, 1.8, C('#8a5a24'));
      thickLine(b, x + 1, 13, x + 4, 9, 1, C('#e8bc72'));
    }
    // Toasted bottom crust and a flour dusting up top.
    for (let x = 10; x <= 22; x++) {
      setPx(b, x, 24, mix(getPx(b, x, 24), [90, 58, 18], 0.35));
    }
    setPx(b, 12, 10, C('#f0cd8c'));
    setPx(b, 13, 10, C('#f0cd8c'));
    setPx(b, 12, 11, C('#e8c07a'));
    for (let i = 0; i < 6; i++) {
      setPx(b, 10 + ((rng() * 13) | 0), 10 + ((rng() * 4) | 0), C('#d9a95e'));
    }
  },
  wooden_hoe(b, rng) {
    paintHoe(b, MAT.wood);
  },
  stone_hoe(b, rng) {
    paintHoe(b, MAT.stone);
  },
  iron_hoe(b, rng) {
    paintHoe(b, MAT.iron);
  },
  wheat_seeds(b, rng) {
    for (let i = 0; i < 8; i++) {
      const x = 6 + ((rng() * 20) | 0);
      const y = 12 + ((rng() * 14) | 0);
      fillRect(b, x, y, 3, 2, C('#8aa84a'));
      setPx(b, x, y, C('#a8c468'));
    }
  },
  wheat(b, rng) {
    thickLine(b, 6, 26, 22, 8, 3, C('#c8a636'));
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const x = 6 + (22 - 6) * t;
      const y = 26 + (8 - 26) * t;
      fillRect(b, Math.round(x) - 2, Math.round(y) - 3, 5, 3, C('#e0c24e'));
      setPx(b, Math.round(x), Math.round(y) - 4, C('#f6e27a'));
    }
    fillRect(b, 5, 24, 4, 5, C('#9a7c22'));
  },

  bow(b, rng) {
    const pts = [[21, 4], [15, 7], [10, 13], [9, 20], [11, 27], [16, 30]];
    for (let i = 0; i < pts.length - 1; i++) {
      thickLine(b, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 3, C('#8a5a2e'));
    }
    thickLine(b, 21, 4, 16, 30, 1, C('#efe8d6'));
    fillRect(b, 7, 15, 4, 6, C('#5f3d1d'));
    setPx(b, 14, 7, C('#a9743f'));
  },

  flint(b, rng) {
    fillPoly(b, [[10, 11], [19, 7], [24, 15], [18, 24], [9, 21]], C('#4a4a52'));
    fillPoly(b, [[13, 12], [19, 10], [21, 15], [16, 20]], C('#6a6a72'));
    setPx(b, 15, 13, C('#8a8a92'));
  },

  egg(b, rng) {
    fillPoly(b, [[16, 4], [23, 14], [22, 24], [11, 25], [8, 16]], C('#ddd6c6'));
    fillPoly(b, [[16, 7], [21, 15], [20, 22], [12, 23], [10, 16]], C('#f8f2e4'));
    setPx(b, 14, 13, C('#ffffff'));
  },

  shears(b, rng) {
    thickLine(b, 9, 9, 20, 24, 3, C('#c8c8cc'));
    thickLine(b, 23, 9, 12, 24, 3, C('#a8a8b0'));
    fillRect(b, 8, 22, 6, 7, C('#55555c'));
    fillRect(b, 20, 22, 6, 7, C('#55555c'));
    setPx(b, 9, 23, C('#8a8a92'));
    setPx(b, 21, 23, C('#8a8a92'));
    fillRect(b, 14, 6, 4, 4, C('#6a6a72'));
  },

  bucket(b, rng) {
    fillRect(b, 8, 11, 16, 3, C('#b9bcc4'));
    fillPoly(b, [[8, 14], [24, 14], [21, 27], [11, 27]], C('#a7abb3'));
    fillPoly(b, [[10, 16], [22, 16], [20, 25], [12, 25]], C('#c2c5cc'));
    thickLine(b, 9, 12, 15, 5, 1, C('#8a8d94'));
    thickLine(b, 15, 5, 23, 12, 1, C('#8a8d94'));
  },

  water_bucket(b, rng) {
    fillRect(b, 8, 11, 16, 3, C('#b9bcc4'));
    fillPoly(b, [[8, 14], [24, 14], [21, 27], [11, 27]], C('#a7abb3'));
    fillPoly(b, [[10, 16], [22, 16], [20, 25], [12, 25]], C('#3d6fd6'));
    fillRect(b, 12, 17, 4, 1, C('#7fb0ff'));
    thickLine(b, 9, 12, 15, 5, 1, C('#8a8d94'));
    thickLine(b, 15, 5, 23, 12, 1, C('#8a8d94'));
  },

  lava_bucket(b, rng) {
    fillRect(b, 8, 11, 16, 3, C('#b9bcc4'));
    fillPoly(b, [[8, 14], [24, 14], [21, 27], [11, 27]], C('#a7abb3'));
    fillPoly(b, [[10, 16], [22, 16], [20, 25], [12, 25]], C('#e06a1a'));
    fillRect(b, 12, 18, 3, 1, C('#ffd24a'));
    thickLine(b, 9, 12, 15, 5, 1, C('#8a8d94'));
    thickLine(b, 15, 5, 23, 12, 1, C('#8a8d94'));
  },

  fence(b, rng) {
    // 两根立柱 + 横杆
    fillRect(b, 6, 5, 4, 24, C('#8a5a2e'));
    fillRect(b, 22, 5, 4, 24, C('#8a5a2e'));
    fillRect(b, 5, 9, 22, 3, C('#a9743f'));
    fillRect(b, 5, 19, 22, 3, C('#a9743f'));
    setPx(b, 7, 6, C('#c2924f'));
    setPx(b, 23, 6, C('#c2924f'));
  },

  emerald(b, rng) {
    fillPoly(b, [[16, 4], [24, 12], [20, 26], [10, 24], [7, 13]], C('#1f9a5a'));
    fillPoly(b, [[16, 7], [21, 13], [18, 23], [12, 21], [10, 14]], C('#35c476'));
    fillPoly(b, [[15, 10], [19, 13], [16, 18], [13, 14]], C('#7ef0b0'));
    setPx(b, 15, 9, C('#e8fff0'));
  },

};

/** Build every item icon. 32x32 canvases on a transparent background. */
export function buildItemIcons() {
  const icons = {};
  for (const name of ITEM_ICON_NAMES) {
    const painter = ICON_PAINTERS[name];
    if (!painter) throw new Error('No painter for icon: ' + name);
    const buf = makeBuf(32, 32);
    painter(buf, mulberry32(hashString('icon:' + name)));
    icons[name] = canvasFromBuffer(buf);
  }
  return icons;
}
