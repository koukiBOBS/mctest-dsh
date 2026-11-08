// ============================================================
// render.js — three.js 场景、天空、区块网格、粒子、选中框
// ============================================================

import * as THREE from 'three';
import { buildAtlas, buildBreakTextures, TILE_NAMES } from './textures.js';
import { buildChunkGeometry } from './mesher.js';
import { CHUNK_SX, CHUNK_SZ, CHUNK_H, chunkKey } from './world.js';
import { BLOCK, getBlockDef } from './blocks.js';


// ---------------- 区块自定义着色器：方块光 + 天空光 ----------------
const CHUNK_VERT = `
attribute vec3 aLight;
varying vec3 vLight;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vLight = aLight;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CHUNK_FRAG = `
uniform sampler2D uMap;
uniform float uDayLight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uCamPos;
uniform float uOpacity;
uniform float uAlphaTest;
varying vec3 vLight;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < uAlphaTest) discard;
  float block = clamp(vLight.x, 0.0, 1.0);
  float sky = clamp(vLight.y, 0.0, 1.0) * uDayLight;
  float shade = clamp(vLight.z, 0.0, 1.0);
  float lum = max(block, sky) * shade;
  lum = max(lum, 0.02);
  vec3 tint = mix(vec3(1.0), vec3(1.22, 0.9, 0.6), block * 0.55);
  vec3 col = tex.rgb * lum * tint;
  float dist = length(vWorldPos - uCamPos);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, tex.a * uOpacity);
}
`;

const ATLAS_COLS = 8;
const MAX_PARTICLES = 320;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function makeCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = 987654321;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const grid = 8;
  const cell = size / grid;
  const vals = new Float32Array((grid + 1) * (grid + 1));
  for (let i = 0; i < vals.length; i++) vals[i] = rnd();
  const val = (gx, gy) => vals[gy * (grid + 1) + gx];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / cell;
      const fy = y / cell;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const n00 = val(x0, y0);
      const n10 = val(x0 + 1, y0);
      const n01 = val(x0, y0 + 1);
      const n11 = val(x0 + 1, y0 + 1);
      const n = (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
      let a = 0;
      if (n > 0.52) a = Math.min(1, (n - 0.52) * 6);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 190);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}

function makeGlowSprite(inner, outer, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2 - 1);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class Renderer {
  constructor(canvas, world, opts = {}) {
    this.canvas = canvas;
    this.world = world;
    this.renderDistance = opts.renderDistance || 3;
    this.fov = opts.fov || 75;
    this.dayLength = opts.dayLength || 600;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.35 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.qualityScale = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.08, 700);
    this.camera.rotation.order = 'YXZ';

    this.atlasCanvas = buildAtlas();
    if (opts.customTiles && opts.customTiles.size) {
      const actx = this.atlasCanvas.getContext('2d');
      actx.imageSmoothingEnabled = false;
      for (const [name, cnv] of opts.customTiles) {
        const idx = TILE_NAMES.indexOf(name);
        if (idx < 0 || !cnv) continue;
        const col = idx % ATLAS_COLS;
        const row = Math.floor(idx / ATLAS_COLS);
        actx.clearRect(col * 16, row * 16, 16, 16);
        actx.drawImage(cnv, col * 16, row * 16, 16, 16);
      }
    }
    // 贴图颜色已由 textures.js 正确生成，无需再整体提亮

    this.atlasTexture = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlasTexture.magFilter = THREE.NearestFilter;
    this.atlasTexture.minFilter = THREE.NearestFilter;
    this.atlasTexture.generateMipmaps = false;
    this.atlasTexture.colorSpace = THREE.NoColorSpace;

    this.matOpaque = this._makeChunkMaterial({ alphaTest: 0.5 });
    this.matAlpha = this._makeChunkMaterial({ transparent: true, alphaTest: 0.04, depthWrite: true });
    this.matWater = this._makeChunkMaterial({
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
      alphaTest: 0.01,
    });
    this.matPlants = this._makeChunkMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
    this.chunkMaterials = [this.matOpaque, this.matAlpha, this.matWater, this.matPlants];

    this.scene.fog = new THREE.Fog(0x9ecfff, 30, 70);

    this.chunkRoot = new THREE.Group();
    this.scene.add(this.chunkRoot);
    this.meshEntries = new Map();
    this._offsetsCache = new Map();
    this._lastPlayer = { x: 0, z: 0 };
    this.quads = 0;
    this.underwater = false;
    this.thirdPerson = false;
    this.weatherFactor = 0;
    this.nether = false;
    this.end = false;
    this.nightVision = false;
    this.flashFactor = 0;
    this.dayLight = 1;
    this._tileColorCache = new Map();

    this._initSky();
    this._initParticles();
    this._initTargets();
    this.resize();
  }

  // ---------- 初始化 ----------
  _initSky() {
    this.skyGroup = new THREE.Group();
    this.scene.add(this.skyGroup);

    this.skyUniforms = {
      topColor: { value: new THREE.Color(0x4f8fe0) },
      bottomColor: { value: new THREE.Color(0xcfe8ff) },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader:
        'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vDir; void main(){ float h = clamp(vDir.y, 0.0, 1.0); gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.6)), 1.0); }',
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), skyMat);
    this.skyGroup.add(this.skyMesh);

    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowSprite('#fffdf0', 'rgba(255,225,140,0.75)'),
        fog: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.sunSprite.scale.set(80, 80, 1);
    this.skyGroup.add(this.sunSprite);

    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowSprite('#e8f2ff', 'rgba(150,180,230,0.55)'),
        fog: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.moonSprite.scale.set(56, 56, 1);
    this.skyGroup.add(this.moonSprite);

    const starCount = 700;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 470;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * s * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(th) * s * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.skyGroup.add(this.stars);

    this.cloudTex = makeCloudTexture();
    this.cloudMat = new THREE.MeshBasicMaterial({
      map: this.cloudTex,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 112;
    this.scene.add(this.clouds);

    this._colors = {
      dayTop: new THREE.Color(0x4f8fe0),
      dayBot: new THREE.Color(0xcfe8ff),
      nightTop: new THREE.Color(0x02030c),
      nightBot: new THREE.Color(0x0b1233),
      sunsetTop: new THREE.Color(0x3c3a6e),
      sunsetBot: new THREE.Color(0xff9a52),
      waterFog: new THREE.Color(0x1a4f8a),
      lavaFog: new THREE.Color(0x7a2a10),
      rainTop: new THREE.Color(0x4a5560),
      rainBot: new THREE.Color(0x8a97a3),
      white: new THREE.Color(0xffffff),
    };
    this._tmpTop = new THREE.Color();
    this._tmpBot = new THREE.Color();
  }

  _initParticles() {
    this.particleCount = 0;
    this.particles = [];
    this.particlePos = new Float32Array(MAX_PARTICLES * 3);
    this.particleCol = new Float32Array(MAX_PARTICLES * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.particleCol, 3));
    geo.setDrawRange(0, 0);
    this.particleGeo = geo;
    this.particleMat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
    });
    this.particlePoints = new THREE.Points(geo, this.particleMat);
    this.particlePoints.frustumCulled = false;
    this.scene.add(this.particlePoints);
  }

  _initTargets() {
    const boxGeo = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.breakTextures = buildBreakTextures().map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      return t;
    });
    this.breakMat = new THREE.MeshBasicMaterial({
      map: this.breakTextures[0],
      transparent: true,
      alphaTest: 0.1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.breakMesh = new THREE.Mesh(new THREE.BoxGeometry(1.008, 1.008, 1.008), this.breakMat);
    this.breakMesh.visible = false;
    this.scene.add(this.breakMesh);
  }

  _makeChunkMaterial(opts = {}) {
    const uniforms = {
      uMap: { value: this.atlasTexture },
      uDayLight: { value: 1 },
      uFogColor: { value: new THREE.Color(0x9ecfff) },
      uFogNear: { value: 30 },
      uFogFar: { value: 80 },
      uCamPos: { value: new THREE.Vector3() },
      uOpacity: { value: opts.opacity !== undefined ? opts.opacity : 1 },
      uAlphaTest: { value: opts.alphaTest !== undefined ? opts.alphaTest : 0.01 },
    };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: CHUNK_VERT,
      fragmentShader: CHUNK_FRAG,
      transparent: !!opts.transparent,
      depthWrite: opts.depthWrite !== false,
      side: opts.side !== undefined ? opts.side : THREE.FrontSide,
    });
  }

  setNether(on) {
    this.nether = !!on;
  }

  setEnd(on) {
    this.end = !!on;
  }

  setNightVision(on) {
    this.nightVision = !!on;
  }

  // 动态画质：降低/恢复渲染分辨率（用于低帧率设备）
  setQualityScale(scale) {
    this.qualityScale = Math.max(0.5, Math.min(1, scale));
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const base = Math.min(window.devicePixelRatio || 1, coarse ? 1.35 : 2);
    this.renderer.setPixelRatio(base * this.qualityScale);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  // ---------- 尺寸 ----------
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setRenderDistance(r) {
    this.renderDistance = r;
    this._offsetsCache.clear();
  }

  // ---------- 区块流式加载 ----------
  _getOffsets(r) {
    if (this._offsetsCache.has(r)) return this._offsetsCache.get(r);
    const out = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) out.push([dx, dz]);
    }
    out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
    this._offsetsCache.set(r, out);
    return out;
  }

  updateChunks(px, pz) {
    const r = this.renderDistance;
    const pcx = Math.floor(px / CHUNK_SX);
    const pcz = Math.floor(pz / CHUNK_SZ);
    const offsets = this._getOffsets(r);

    // 1) 生成区块：先视野内，再往外补一圈，保证边缘区块也能正常网格化
    let gen = 3;
    for (let i = 0; i < offsets.length && gen > 0; i++) {
      const cx = pcx + offsets[i][0];
      const cz = pcz + offsets[i][1];
      if (!this.world.chunks.has(chunkKey(cx, cz))) {
        this.world.ensureChunk(cx, cz);
        gen--;
      }
    }
    if (gen > 0) {
      for (let dx = -r - 1; dx <= r + 1 && gen > 0; dx++) {
        for (let dz = -r - 1; dz <= r + 1 && gen > 0; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r + 1) continue;
          const cx = pcx + dx;
          const cz = pcz + dz;
          if (!this.world.chunks.has(chunkKey(cx, cz))) {
            this.world.ensureChunk(cx, cz);
            gen--;
          }
        }
      }
    }

    // 2) 构建/重建网格（每帧最多 4 个）
    let budget = 4;
    for (const k of this.world.dirtyChunks) {
      if (budget <= 0) break;
      const comma = k.indexOf(',');
      const cx = +k.slice(0, comma);
      const cz = +k.slice(comma + 1);
      if (Math.abs(cx - pcx) > r + 1 || Math.abs(cz - pcz) > r + 1) {
        this.world.dirtyChunks.delete(k);
        continue;
      }
      if (!this.world.chunks.has(k)) {
        this.world.dirtyChunks.delete(k);
        continue;
      }
      if (
        !this.world.chunks.has(chunkKey(cx - 1, cz)) ||
        !this.world.chunks.has(chunkKey(cx + 1, cz)) ||
        !this.world.chunks.has(chunkKey(cx, cz - 1)) ||
        !this.world.chunks.has(chunkKey(cx, cz + 1))
      ) {
        continue;
      }
      this.world.dirtyChunks.delete(k);
      this._buildMesh(cx, cz);
      budget--;
    }

    // 3) 卸载视野外的网格
    for (const k of [...this.meshEntries.keys()]) {
      const comma = k.indexOf(',');
      const cx = +k.slice(0, comma);
      const cz = +k.slice(comma + 1);
      if (Math.abs(cx - pcx) > r + 1 || Math.abs(cz - pcz) > r + 1) this._disposeEntry(k);
    }

    // 4) 丢弃更远的区块数据（保存的修改不受影响）
    for (const k of [...this.world.chunks.keys()]) {
      if (this.meshEntries.has(k)) continue;
      const comma = k.indexOf(',');
      const cx = +k.slice(0, comma);
      const cz = +k.slice(comma + 1);
      if (Math.abs(cx - pcx) > r + 2 || Math.abs(cz - pcz) > r + 2) {
        this.world.chunks.delete(k);
        this.world.dirtyChunks.delete(k);
      }
    }
  }

  _buildMesh(cx, cz) {
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk) return;
    const geoms = buildChunkGeometry(this.world, chunk);
    const key = chunkKey(cx, cz);
    let entry = this.meshEntries.get(key);
    if (!entry) {
      entry = { group: new THREE.Group(), meshes: {} };
      entry.group.position.set(cx * CHUNK_SX, 0, cz * CHUNK_SZ);
      this.chunkRoot.add(entry.group);
      this.meshEntries.set(key, entry);
    }
    this.quads += geoms.quads;
    const layers = [
      ['opaque', this.matOpaque],
      ['alpha', this.matAlpha],
      ['water', this.matWater],
      ['plants', this.matPlants],
    ];
    for (const [name, mat] of layers) {
      const old = entry.meshes[name];
      if (old) {
        entry.group.remove(old);
        old.geometry.dispose();
        delete entry.meshes[name];
      }
      const geom = geoms[name];
      if (geom) {
        const mesh = new THREE.Mesh(geom, mat);
        entry.group.add(mesh);
        entry.meshes[name] = mesh;
      }
    }
  }

  _disposeEntry(key) {
    const entry = this.meshEntries.get(key);
    if (!entry) return;
    this.chunkRoot.remove(entry.group);
    for (const mesh of Object.values(entry.meshes)) mesh.geometry.dispose();
    this.meshEntries.delete(key);
  }

  getLoadProgress() {
    const r = this.renderDistance;
    const total = Math.max(1, (2 * r - 1) ** 2);
    let count = 0;
    const pcx = Math.floor(this._lastPlayer.x / CHUNK_SX);
    const pcz = Math.floor(this._lastPlayer.z / CHUNK_SZ);
    for (const entry of this.meshEntries.values()) {
      const cx = Math.round(entry.group.position.x / CHUNK_SX);
      const cz = Math.round(entry.group.position.z / CHUNK_SZ);
      if (Math.abs(cx - pcx) <= r - 1 && Math.abs(cz - pcz) <= r - 1) count++;
    }
    return Math.min(1, count / total);
  }

  // ---------- 相机 / 天空 ----------
  setThirdPerson(value) {
    this.thirdPerson = !!value;
  }

  updateCamera(player) {
    if (this.thirdPerson) {
      const f = player.forwardVector();
      const ex = player.x;
      const ey = player.eyeY();
      const ez = player.z;
      let dist = 3.6;
      const hit = this.world.raycast(ex, ey, ez, -f.x, -f.y, -f.z, 4.2);
      if (hit && hit.dist > 0.3) dist = Math.max(1.1, hit.dist - 0.35);
      this.camera.position.set(ex - f.x * dist, ey - f.y * dist + 0.35, ez - f.z * dist);
      this.camera.lookAt(ex, ey, ez);
    } else {
      this.camera.position.set(player.x, player.eyeY(), player.z);
      this.camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      if (player.hurtFlash > 0) {
        const k = player.hurtFlash * 0.07;
        this.camera.position.x += (Math.random() - 0.5) * k;
        this.camera.position.y += (Math.random() - 0.5) * k;
      }
    }
  }

  _updateSky(dt, player) {
    const t = (((this.world.time % this.dayLength) + this.dayLength) % this.dayLength) / this.dayLength;
    const angle = t * Math.PI * 2;
    const sunElev = Math.sin(angle);
    const dayF = clamp(sunElev, 0, 1);
    const nightF = clamp(-sunElev, 0, 1);
    const sunsetF = clamp(1 - Math.abs(sunElev) * 5, 0, 1);
    const C = this._colors;

    const top = this._tmpTop.copy(C.nightTop).lerp(C.dayTop, dayF).lerp(C.sunsetTop, sunsetF * 0.75);
    const bot = this._tmpBot.copy(C.nightBot).lerp(C.dayBot, dayF).lerp(C.sunsetBot, sunsetF * 0.75);

    const eyeBlock = this.world.getBlock(
      Math.floor(player.x),
      Math.floor(player.eyeY()),
      Math.floor(player.z),
    );
    const under = eyeBlock === BLOCK.WATER || eyeBlock === BLOCK.LAVA;
    this.underwater = under;
    this.skyGroup.visible = !under && !this.nether && !this.end;

    const rain = under ? 0 : clamp(this.weatherFactor || 0, 0, 1);
    const flash = clamp(this.flashFactor || 0, 0, 1);
    if (rain > 0) {
      top.lerp(C.rainTop, rain * 0.8);
      bot.lerp(C.rainBot, rain * 0.8);
    }
    if (flash > 0) {
      top.lerp(C.white, flash * 0.4);
      bot.lerp(C.white, flash * 0.4);
    }
    if (this.nether) {
      top.setHex(0x2a0d0d);
      bot.setHex(0x4a1610);
    } else if (this.end) {
      top.setHex(0x08030f);
      bot.setHex(0x160b2a);
    }
    this.skyUniforms.topColor.value.copy(top);
    this.skyUniforms.bottomColor.value.copy(bot);

    if (under) {
      const fogColor = eyeBlock === BLOCK.LAVA ? C.lavaFog : C.waterFog;
      this.scene.fog.color.copy(fogColor);
      this.scene.fog.near = 0.5;
      this.scene.fog.far = 18;
      this.scene.background = fogColor;
    } else {
      this.scene.fog.color.copy(bot);
      this.scene.fog.near = this.renderDistance * 16 * 0.62 * (1 - 0.45 * rain);
      this.scene.fog.far = this.renderDistance * 16 * 1.15 * (1 - 0.35 * rain) + 10;
      this.scene.background = null;
      if (this.nether) {
        this.scene.fog.color.setHex(0x3a1410);
        this.scene.fog.near = 5;
        this.scene.fog.far = 46;
      } else if (this.end) {
        this.scene.fog.color.setHex(0x120a22);
        this.scene.fog.near = 6;
        this.scene.fog.far = 54;
      }
    }

    let lightMul = Math.min(1, (0.3 + 0.7 * dayF) * (1 - 0.42 * rain) + flash * 0.3);
    if (this.nightVision) lightMul = Math.max(lightMul, 0.9);
    this.dayLight = lightMul;
    for (const mat of this.chunkMaterials) {
      const u = mat.uniforms;
      u.uDayLight.value = lightMul;
      u.uFogColor.value.copy(this.scene.fog.color);
      u.uFogNear.value = this.scene.fog.near;
      u.uFogFar.value = this.scene.fog.far;
      u.uCamPos.value.copy(this.camera.position);
    }
    this.particleMat.color.setScalar(lightMul);

    this.skyGroup.position.copy(this.camera.position);
    this.sunSprite.position.set(Math.cos(angle) * 380, Math.sin(angle) * 380, -120);
    this.moonSprite.position.set(-Math.cos(angle) * 380, -Math.sin(angle) * 380, -120);
    this.sunSprite.visible = !this.nether && !this.end && sunElev > -0.12;
    this.moonSprite.visible = !this.nether && !this.end && sunElev < 0.12;
    this.starMat.opacity = clamp(nightF * 1.3, 0, 1);
    this.stars.rotation.y += dt * 0.003;

    this.clouds.position.x = player.x;
    this.clouds.position.z = player.z;
    this.cloudTex.offset.x += dt * 0.004;
    this.cloudTex.offset.y += dt * 0.0012;
    this.cloudMat.opacity = Math.min(1, (0.25 + 0.6 * dayF) * (1 + 0.45 * rain) * 0.9);
    this.clouds.visible = !this.nether && !this.end;
    this.cloudMat.color.setScalar((0.75 + 0.25 * dayF) * (1 - 0.35 * rain));
    this.clouds.visible = !under;
  }

  // ---------- 粒子 ----------
  spawnBreakParticles(x, y, z, blockId) {
    const col = this.blockColor(blockId);
    const n = Math.max(3, Math.round(10 * (this.qualityScale || 1)));
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const p = {
        x: x + 0.15 + Math.random() * 0.7,
        y: y + 0.15 + Math.random() * 0.7,
        z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 3.2,
        vy: 1.5 + Math.random() * 2.6,
        vz: (Math.random() - 0.5) * 3.2,
        life: 0.55 + Math.random() * 0.7,
        maxLife: 1.25,
        r: col.r,
        g: col.g,
        b: col.b,
      };
      this.particles.push(p);
    }
  }

  _updateParticles(dt) {
    const arr = this.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        arr.splice(i, 1);
        continue;
      }
      p.vy -= 20 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0) p.life = 0;
    }
    this.particleCount = Math.min(arr.length, MAX_PARTICLES);
    for (let i = 0; i < this.particleCount; i++) {
      const p = arr[i];
      this.particlePos[i * 3] = p.x;
      this.particlePos[i * 3 + 1] = p.y;
      this.particlePos[i * 3 + 2] = p.z;
      this.particleCol[i * 3] = p.r;
      this.particleCol[i * 3 + 1] = p.g;
      this.particleCol[i * 3 + 2] = p.b;
    }
    this.particleGeo.setDrawRange(0, this.particleCount);
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;
  }

  blockColor(blockId) {
    const cached = this._tileColorCache.get(blockId);
    if (cached) return cached;
    const def = getBlockDef(blockId);
    const tile = def.tiles.side || def.tiles.all || 'stone';
    const idx = TILE_NAMES.indexOf(tile);
    const px = (idx % ATLAS_COLS) * 16;
    const py = Math.floor(idx / ATLAS_COLS) * 16;
    let r = 0.5;
    let g = 0.5;
    let b = 0.5;
    try {
      const data = this.atlasCanvas.getContext('2d').getImageData(px, py, 16, 16).data;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 40) {
          rr += data[i];
          gg += data[i + 1];
          bb += data[i + 2];
          n++;
        }
      }
      if (n > 0) {
        const c = new THREE.Color();
        c.setRGB(rr / n / 255, gg / n / 255, bb / n / 255, THREE.SRGBColorSpace);
        r = c.r;
        g = c.g;
        b = c.b;
      }
    } catch (e) {
      // 忽略取色失败
    }
    const out = { r, g, b };
    this._tileColorCache.set(blockId, out);
    return out;
  }

  // ---------- 选中框 / 破坏进度 ----------
  setHighlight(hit) {
    if (!hit) {
      this.highlight.visible = false;
      return;
    }
    this.highlight.visible = true;
    this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }

  setBreakOverlay(hit, progress) {
    if (!hit || progress <= 0) {
      this.breakMesh.visible = false;
      return;
    }
    const stage = Math.min(9, Math.max(0, Math.floor(progress * 10)));
    this.breakMesh.visible = true;
    this.breakMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    if (this.breakMat.map !== this.breakTextures[stage]) {
      this.breakMat.map = this.breakTextures[stage];
      this.breakMat.needsUpdate = true;
    }
  }

  // ---------- 每帧 ----------
  render(player, dt) {
    this._lastPlayer = player;
    const targetFov = player.sprinting ? (player.flying ? 88 : 82) : this.fov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
    this.updateCamera(player);
    this.updateChunks(player.x, player.z);
    this._updateSky(dt, player);
    this._updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const k of [...this.meshEntries.keys()]) this._disposeEntry(k);
    this.renderer.dispose();
  }
}
