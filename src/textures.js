/* =====================================================================
 * textures.js
 * Procedural, dependency-free Minecraft-style pixel art for Canvas 2D.
 *
 *  - 35 block tiles  -> one 128x128 atlas (8 x 8 grid of 16x16 tiles)
 *  - 10 destroy-stage crack overlays (16x16, transparent)
 *  - 18 item icons (32x32, transparent)
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
