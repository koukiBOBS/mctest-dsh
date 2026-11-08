/**
 * sound.js — Minecraft 风格的程序化音效引擎（纯 WebAudio，无任何外部资源）。
 *
 * 所有音色都由「白噪声缓冲 + 振荡器 + biquad 滤波 + gain 包络」实时合成，
 * 不引用音频文件、网络资源或第三方库，可在手机 Chrome 上工作。
 *
 * 用法：
 *   const sfx = new SoundEngine();
 *   // 在用户手势（click / touchstart / keydown）里：
 *   await sfx.unlock();
 *   sfx.play('break_stone', { volume: 0.9, pitch: 1.1, pan: -0.3 });
 *
 * 注意：构造时不创建 AudioContext；未 unlock 时 play() 静默返回。
 */

const MIN = 0.0001; // 指数包络不能到 0，用极小值近似静音
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class SoundEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this._ctx = null;
    this._master = null;
    this._limiter = null;
    /** @type {AudioBuffer|null} 白噪声缓冲，首次 unlock 时创建一次并复用 */
    this._noiseBuf = null;

    this._muted = false;
    this._volume = 0.7;

    // 环境音
    this._amb = null; // { src, hp, lp, amp, lfo, lfo2, lfoDepth, lpDepth }
    this._ambWanted = false;
    this._rain = null;
    this._rainWanted = 0;

    this._disposed = false;
    this._unlocking = null;
  }

  /** AudioContext 是否已经创建并处于 running（已 unlock）。 */
  get ready() {
    return !!(this._ctx && this._ctx.state === 'running');
  }

  get muted() {
    return this._muted;
  }

  get masterVolume() {
    return this._volume;
  }

  /**
   * 首次用户手势里调用：创建（惰性）/恢复 AudioContext。幂等，可并发调用。
   * @returns {Promise<boolean>}
   */
  async unlock() {
    if (this._disposed) return false;
    if (this.ready) return true;
    if (this._unlocking) return this._unlocking;

    this._unlocking = (async () => {
      try {
        if (!this._ctx) this._initContext();
        const ctx = this._ctx;
        if (!ctx) return false;
        if (ctx.state !== 'running') {
          // Android Chrome 上必须在用户手势的调用栈里 resume()
          await ctx.resume();
        }
        if (this._ctx && this._ctx.state === 'running') {
          // 若 unlock 前就调用过 startAmbience()，这里补启动
          if (this._ambWanted) this._startAmbience();
          if (this._rainWanted) this._startRain();
          return true;
        }
      } catch (e) {
        /* 静默失败，下次手势再试 */
      }
      return this.ready;
    })();

    try {
      return await this._unlocking;
    } finally {
      this._unlocking = null;
    }
  }

  /**
   * 播放一个音效。未 unlock、已静音或出错时静默返回。
   * @param {string} name
   * @param {{volume?: number, pitch?: number, pan?: number}} [opts]
   */
  play(name, opts = {}) {
    if (this._disposed || this._muted) return;
    const ctx = this._ctx;
    if (!ctx || ctx.state !== 'running') return;

    try {
      const o = opts || {};
      const volume = clamp(Number(o.volume) || 0, 0, 2);
      if (volume <= 0) return;
      // 每个音高在给定 pitch 上 ±5% 随机微调，避免重复音机械
      const pitch = clamp((Number(o.pitch) || 1) * rnd(0.95, 1.05), 0.2, 5);
      const pan = clamp(Number(o.pan) || 0, -1, 1);
      const t = ctx.currentTime + 0.005;

      switch (name) {
        case 'break_stone': this._breakStone(t, volume, pitch, pan); break;
        case 'break_wood': this._breakWood(t, volume, pitch, pan); break;
        case 'break_grass': this._breakGrass(t, volume, pitch, pan); break;
        case 'break_sand': this._breakSand(t, volume, pitch, pan); break;
        case 'break_glass': this._breakGlass(t, volume, pitch, pan); break;

        case 'place_stone': this._placeStone(t, volume, pitch, pan); break;
        case 'place_wood': this._placeWood(t, volume, pitch, pan); break;
        case 'place_grass': this._placeGrass(t, volume, pitch, pan); break;
        case 'place_sand': this._placeSand(t, volume, pitch, pan); break;
        case 'place_glass': this._placeGlass(t, volume, pitch, pan); break;

        case 'step_stone': this._stepStone(t, volume, pitch, pan); break;
        case 'step_wood': this._stepWood(t, volume, pitch, pan); break;
        case 'step_grass': this._stepGrass(t, volume, pitch, pan); break;
        case 'step_sand': this._stepSand(t, volume, pitch, pan); break;

        case 'splash': this._splash(t, volume, pitch, pan); break;
        case 'swim': this._swim(t, volume, pitch, pan); break;
        case 'jump': this._jump(t, volume, pitch, pan); break;
        case 'land': this._land(t, volume, pitch, pan); break;
        case 'hurt': this._hurt(t, volume, pitch, pan); break;
        case 'thunder': this._thunder(t, volume, pitch, pan); break;
        case 'click': this._click(t, volume, pitch, pan); break;
        case 'craft': this._craft(t, volume, pitch, pan); break;
        case 'pop': this._pop(t, volume, pitch, pan); break;
        case 'open': this._open(t, volume, pitch, pan); break;
        case 'close': this._close(t, volume, pitch, pan); break;

        default: this._click(t, volume, pitch, pan); break; // 未知名字回退成 click
      }
    } catch (e) {
      /* 任何音频错误都静默 */
    }
  }

  /** 静音开关：不影响已排队的音效；环境音会平滑降到 0。 */
  setMuted(muted) {
    this._muted = !!muted;
    if (this._amb && this._ctx) {
      try {
        const now = this._ctx.currentTime;
        const amp = this._amb.amp.gain;
        amp.cancelScheduledValues(now);
        amp.setTargetAtTime(this._muted ? MIN : 0.03, now, 0.08);
      } catch (e) { /* ignore */ }
    }
  }

  /** 主音量 0..1，默认 0.7。 */
  setMasterVolume(v) {
    const n = Number(v);
    this._volume = clamp(Number.isFinite(n) ? n : 0.7, 0, 1);
    if (this._master && this._ctx) {
      try {
        this._master.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.02);
      } catch (e) { /* ignore */ }
    }
  }

  /** 循环雨声，音量 0~1。可重复调用。 */
  startRain(volume = 0.07) {
    if (this._disposed) return;
    this._rainWanted = clamp(Number(volume) || 0.07, 0, 0.5);
    if (this.ready) this._startRain();
  }

  /** 停止雨声，0.8s 淡出。 */
  stopRain() {
    this._rainWanted = 0;
    const rain = this._rain;
    if (!rain || !this._ctx) return;
    this._rain = null;
    try {
      const ctx = this._ctx;
      const now = ctx.currentTime;
      const g = rain.amp.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, MIN), now);
      g.exponentialRampToValueAtTime(MIN, now + 0.8);
      const end = now + 0.85;
      try { rain.src.stop(end); } catch (e) { /* ignore */ }
      try { rain.lfo.stop(end); } catch (e) { /* ignore */ }
      rain.src.onended = () => {
        for (const n of [rain.src, rain.hp, rain.lp, rain.amp, rain.lfo, rain.lfoDepth]) {
          try { n.disconnect(); } catch (e) { /* ignore */ }
        }
      };
    } catch (e) { /* ignore */ }
  }

  _startRain() {
    if (this._rain || !this.ready || !this._noiseBuf || this._disposed) return;
    try {
      const ctx = this._ctx;
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5600;
      const amp = ctx.createGain();
      amp.gain.value = MIN;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.018;
      lfo.connect(lfoDepth);
      lfoDepth.connect(amp.gain);
      src.connect(hp);
      hp.connect(lp);
      lp.connect(amp);
      amp.connect(this._master);
      src.start();
      lfo.start();
      const now = ctx.currentTime;
      amp.gain.setValueAtTime(MIN, now);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.012, this._rainWanted), now + 1.2);
      this._rain = { src, hp, lp, amp, lfo, lfoDepth };
    } catch (e) { /* ignore */ }
  }

  /** 轻柔的风声/空气声床，循环播放，音量约 0.03。可重复调用。 */
  startAmbience() {
    if (this._disposed) return;
    this._ambWanted = true;
    if (this.ready) this._startAmbience();
  }

  /** 停止环境音，0.6s 淡出。可重复调用。 */
  stopAmbience() {
    this._ambWanted = false;
    const amb = this._amb;
    if (!amb || !this._ctx) return;
    this._amb = null;
    try {
      const ctx = this._ctx;
      const now = ctx.currentTime;
      const g = amb.amp.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, MIN), now);
      g.exponentialRampToValueAtTime(MIN, now + 0.6);
      const end = now + 0.65;
      try { amb.src.stop(end); } catch (e) { /* ignore */ }
      try { amb.lfo.stop(end); } catch (e) { /* ignore */ }
      try { amb.lfo2.stop(end); } catch (e) { /* ignore */ }
      amb.src.onended = () => {
        for (const n of [amb.src, amb.hp, amb.lp, amb.amp, amb.lfo, amb.lfo2, amb.lfoDepth, amb.lpDepth]) {
          try { n.disconnect(); } catch (e) { /* ignore */ }
        }
      };
    } catch (e) { /* ignore */ }
  }

  /** 关闭 AudioContext 并解绑。dispose 后引擎不可再用，需要新建实例。 */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._ambWanted = false;

    const amb = this._amb;
    this._amb = null;
    const ctx = this._ctx;
    this._ctx = null;
    this._master = null;
    this._limiter = null;
    this._noiseBuf = null;
    this._unlocking = null;

    if (amb) {
      try { amb.src.onended = null; } catch (e) { /* ignore */ }
      try { amb.src.stop(); } catch (e) { /* ignore */ }
      try { amb.lfo.stop(); } catch (e) { /* ignore */ }
      try { amb.lfo2.stop(); } catch (e) { /* ignore */ }
    }
    if (ctx) {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------- 基础设施

  _initContext() {
    const AC = typeof globalThis !== 'undefined'
      ? (globalThis.AudioContext || globalThis.webkitAudioContext)
      : null;
    if (!AC) return;

    const ctx = new AC();
    this._ctx = ctx;

    // master 音量 -> limiter -> 输出
    const master = ctx.createGain();
    master.gain.value = this._volume;

    let limiter = null;
    try {
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 3;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      master.connect(limiter);
      limiter.connect(ctx.destination);
    } catch (e) {
      limiter = null;
      master.connect(ctx.destination);
    }

    this._master = master;
    this._limiter = limiter;
    this._noiseBuf = this._makeNoise(ctx, 2);

    // 创建后若已要求环境音（比如 unlock 中调用）也由 unlock 处理
  }

  /** 一次性生成并缓存白噪声缓冲。 */
  _makeNoise(ctx, seconds) {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 每次发声一个独立输出：StereoPanner（不支持时退化为 Gain）-> master。 */
  _out(pan) {
    const ctx = this._ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      try { p.pan.value = pan; } catch (e) { /* ignore */ }
      p.connect(this._master);
      return p;
    }
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(this._master);
    return g;
  }

  /**
   * 打击类 gain 包络：静音 -> attack 到峰值 -> (可选 hold) -> 指数衰减回静音。
   * @returns {{gain: GainNode, end: number}} end 为绝对结束时间
   */
  _env(t, peak, attack, decay, hold = 0) {
    const ctx = this._ctx;
    const g = ctx.createGain();
    const a = Math.max(0.0015, attack || 0.003);
    const d = Math.max(0.02, decay || 0.1);
    const p = Math.max(MIN, peak || MIN);
    const t1 = t + a;
    const end = t1 + Math.max(0, hold) + d;

    g.gain.setValueAtTime(MIN, t);
    g.gain.exponentialRampToValueAtTime(p, t1);
    if (hold > 0) g.gain.setValueAtTime(p, t1 + hold);
    g.gain.exponentialRampToValueAtTime(MIN, end);

    return { gain: g, end };
  }

  /** 断开一小组节点（在 source 的 onended 里调用，自动清理，不泄漏）。 */
  _retire(src, chain) {
    src.onended = () => {
      for (let i = 0; i < chain.length; i++) {
        try { chain[i].disconnect(); } catch (e) { /* ignore */ }
      }
    };
  }

  /**
   * 噪声爆发。
   * @param {number} t 起始时间
   * @param {object} o { dur, peak, attack, type, freq, q, freqEnd }
   * @param {number} pan
   */
  _noise(t, o, pan) {
    const ctx = this._ctx;
    const buf = this._noiseBuf;
    if (!buf) return;

    const dur = Math.max(0.01, o.dur || 0.12);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 随机取一段，避免每次听起来完全一样
    const span = Math.max(0, buf.duration - dur - 0.05);
    const off = span > 0 ? Math.random() * span : 0;

    const f = ctx.createBiquadFilter();
    try { f.type = o.type || 'lowpass'; } catch (e) { f.type = 'lowpass'; }
    f.frequency.setValueAtTime(clamp(o.freq || 1000, 20, 18000), t);
    f.Q.value = o.q == null ? 1 : o.q;
    if (o.freqEnd) {
      f.frequency.exponentialRampToValueAtTime(clamp(o.freqEnd, 20, 18000), t + dur);
    }

    const env = this._env(t, (o.peak || 0.2), o.attack == null ? 0.003 : o.attack, dur);
    const out = this._out(pan);

    src.connect(f);
    f.connect(env.gain);
    env.gain.connect(out);

    try {
      src.start(t, off);
      src.stop(t + dur + 0.03);
    } catch (e) { /* ignore */ }

    this._retire(src, [src, f, env.gain, out]);
  }

  /**
   * 振荡器音。
   * @param {number} t 起始时间
   * @param {object} o { type, f0, f1, dur, peak, attack, hold, lowpass, lowpassQ }
   * @param {number} pan
   */
  _tone(t, o, pan) {
    const ctx = this._ctx;
    const dur = Math.max(0.02, o.dur || 0.15);
    const osc = ctx.createOscillator();
    try { osc.type = o.type || 'sine'; } catch (e) { osc.type = 'sine'; }

    osc.frequency.setValueAtTime(clamp(o.f0 || 440, 20, 12000), t);
    if (o.f1) {
      osc.frequency.exponentialRampToValueAtTime(clamp(o.f1, 20, 12000), t + dur);
    }
    if (o.detune) osc.detune.value = o.detune;

    const env = this._env(t, (o.peak == null ? 0.2 : o.peak), o.attack == null ? 0.004 : o.attack,
      dur, o.hold || 0);
    const out = this._out(pan);
    const chain = [osc, env.gain, out];

    let tail = osc;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = clamp(o.lowpass, 40, 18000);
      f.Q.value = o.lowpassQ == null ? 0.7 : o.lowpassQ;
      osc.connect(f);
      tail = f;
      chain.push(f);
    }
    tail.connect(env.gain);
    env.gain.connect(out);

    try {
      osc.start(t);
      osc.stop(env.end + 0.03);
    } catch (e) { /* ignore */ }

    this._retire(osc, chain);
  }

  // ---------------------------------------------------------------- 破碎音

  _breakStone(t, v, p, pan) {
    this._noise(t, { dur: 0.18, peak: 0.48 * v, attack: 0.002, type: 'lowpass', freq: 1600 * p, q: 0.9, freqEnd: 520 * p }, pan);
    this._tone(t, { type: 'triangle', f0: 115 * p, f1: 60 * p, dur: 0.13, peak: 0.28 * v, lowpass: 900 }, pan);
  }

  _breakWood(t, v, p, pan) {
    this._noise(t, { dur: 0.15, peak: 0.42 * v, attack: 0.002, type: 'bandpass', freq: 780 * p, q: 1.6, freqEnd: 340 * p }, pan);
    this._tone(t, { type: 'triangle', f0: 230 * p, f1: 135 * p, dur: 0.11, peak: 0.22 * v, lowpass: 1200 }, pan);
  }

  _breakGrass(t, v, p, pan) {
    this._noise(t, { dur: 0.14, peak: 0.24 * v, attack: 0.003, type: 'highpass', freq: 2400 * p, q: 0.7 }, pan);
    this._noise(t + 0.01, { dur: 0.1, peak: 0.15 * v, type: 'bandpass', freq: 4200 * p, q: 2, freqEnd: 2600 * p }, pan);
  }

  _breakSand(t, v, p, pan) {
    this._noise(t, { dur: 0.2, peak: 0.32 * v, attack: 0.004, type: 'lowpass', freq: 1500 * p, q: 0.6, freqEnd: 480 * p }, pan);
    this._noise(t + 0.01, { dur: 0.12, peak: 0.1 * v, type: 'bandpass', freq: 3000 * p, q: 1.5 }, pan);
  }

  _breakGlass(t, v, p, pan) {
    // 高频脆响
    this._noise(t, { dur: 0.07, peak: 0.28 * v, attack: 0.001, type: 'highpass', freq: 4800 * p, q: 0.8 }, pan);
    // 玻璃碎片余韵：几段高频短音错开落点
    for (let i = 0; i < 3; i++) {
      const f = rnd(2800, 5200) * p;
      this._tone(t + rnd(0, 0.12), {
        type: 'sine',
        f0: f,
        f1: f * rnd(0.9, 0.98),
        dur: rnd(0.26, 0.48),
        peak: 0.055 * v,
        attack: 0.001,
      }, pan);
    }
  }

  // ---------------------------------------------------------------- 放置音
  // 每个音都比破碎更短、更闷、音量略低（约 0.5x）

  _placeStone(t, v, p, pan) {
    this._noise(t, { dur: 0.055, peak: 0.2 * v, attack: 0.002, type: 'lowpass', freq: 950 * p, q: 0.8, freqEnd: 420 * p }, pan);
    this._tone(t, { type: 'triangle', f0: 150 * p, f1: 95 * p, dur: 0.07, peak: 0.26 * v, lowpass: 800 }, pan);
  }

  _placeWood(t, v, p, pan) {
    this._noise(t, { dur: 0.05, peak: 0.18 * v, attack: 0.002, type: 'bandpass', freq: 520 * p, q: 1.2 }, pan);
    this._tone(t, { type: 'triangle', f0: 205 * p, f1: 145 * p, dur: 0.06, peak: 0.2 * v, lowpass: 900 }, pan);
  }

  _placeGrass(t, v, p, pan) {
    this._noise(t, { dur: 0.045, peak: 0.11 * v, attack: 0.002, type: 'highpass', freq: 1900 * p, q: 0.7 }, pan);
    this._noise(t, { dur: 0.05, peak: 0.1 * v, type: 'lowpass', freq: 750 * p, q: 0.6 }, pan);
  }

  _placeSand(t, v, p, pan) {
    this._noise(t, { dur: 0.08, peak: 0.17 * v, attack: 0.002, type: 'lowpass', freq: 900 * p, q: 0.6, freqEnd: 350 * p }, pan);
    this._tone(t, { type: 'triangle', f0: 120 * p, f1: 100 * p, dur: 0.05, peak: 0.09 * v, lowpass: 600 }, pan);
  }

  _placeGlass(t, v, p, pan) {
    this._tone(t, { type: 'sine', f0: 2350 * p, f1: 2200 * p, dur: 0.08, peak: 0.16 * v, attack: 0.001 }, pan);
    this._noise(t, { dur: 0.04, peak: 0.12 * v, type: 'highpass', freq: 3500 * p, q: 0.8 }, pan);
  }

  // ---------------------------------------------------------------- 脚步音
  // 比破碎更轻更短，峰值约为 break 的 0.35x

  _stepStone(t, v, p, pan) {
    this._noise(t, { dur: 0.05, peak: 0.15 * v, attack: 0.002, type: 'lowpass', freq: 1150 * p, q: 0.8, freqEnd: 500 * p }, pan);
    this._tone(t, { type: 'triangle', f0: 120 * p, f1: 95 * p, dur: 0.04, peak: 0.08 * v, lowpass: 700 }, pan);
  }

  _stepWood(t, v, p, pan) {
    this._noise(t, { dur: 0.055, peak: 0.15 * v, attack: 0.002, type: 'bandpass', freq: 620 * p, q: 1.4 }, pan);
    this._tone(t, { type: 'triangle', f0: 175 * p, f1: 130 * p, dur: 0.045, peak: 0.07 * v, lowpass: 900 }, pan);
  }

  _stepGrass(t, v, p, pan) {
    this._noise(t, { dur: 0.045, peak: 0.1 * v, attack: 0.002, type: 'highpass', freq: 2000 * p, q: 0.7 }, pan);
    this._noise(t, { dur: 0.04, peak: 0.06 * v, type: 'lowpass', freq: 900 * p, q: 0.6 }, pan);
  }

  _stepSand(t, v, p, pan) {
    this._noise(t, { dur: 0.07, peak: 0.12 * v, attack: 0.003, type: 'lowpass', freq: 1500 * p, q: 0.5, freqEnd: 500 * p }, pan);
  }

  // ---------------------------------------------------------------- 水 / 移动

  _splash(t, v, p, pan) {
    this._noise(t, { dur: 0.25, peak: 0.4 * v, attack: 0.004, type: 'lowpass', freq: 2600 * p, q: 0.8, freqEnd: 700 * p }, pan);
    this._noise(t + 0.02, { dur: 0.12, peak: 0.2 * v, type: 'bandpass', freq: 1200 * p, q: 0.9, freqEnd: 3200 * p }, pan);
    this._tone(t, { type: 'sine', f0: 420 * p, f1: 880 * p, dur: 0.1, peak: 0.09 * v }, pan);
  }

  _swim(t, v, p, pan) {
    this._noise(t, { dur: 0.45, peak: 0.24 * v, attack: 0.05, type: 'lowpass', freq: 800 * p, q: 0.6, freqEnd: 420 * p }, pan);
    this._noise(t + 0.12, { dur: 0.3, peak: 0.11 * v, attack: 0.03, type: 'bandpass', freq: 1600 * p, q: 0.7 }, pan);
  }

  _jump(t, v, p, pan) {
    this._tone(t, { type: 'sine', f0: 250 * p, f1: 520 * p, dur: 0.13, peak: 0.18 * v }, pan);
    this._noise(t, { dur: 0.05, peak: 0.06 * v, type: 'highpass', freq: 2000 * p, q: 0.7 }, pan);
  }

  _land(t, v, p, pan) {
    this._noise(t, { dur: 0.1, peak: 0.26 * v, attack: 0.002, type: 'lowpass', freq: 650 * p, q: 0.7, freqEnd: 250 * p }, pan);
    this._tone(t, { type: 'sine', f0: 150 * p, f1: 75 * p, dur: 0.12, peak: 0.24 * v }, pan);
  }

  // ---------------------------------------------------------------- UI / 交互

  _hurt(t, v, p, pan) {
    this._tone(t, { type: 'sawtooth', f0: 190 * p, f1: 90 * p, dur: 0.28, peak: 0.2 * v, attack: 0.006, lowpass: 950 }, pan);
    this._tone(t, { type: 'triangle', f0: 95 * p, f1: 60 * p, dur: 0.3, peak: 0.14 * v, attack: 0.006, lowpass: 700 }, pan);
    this._noise(t, { dur: 0.12, peak: 0.09 * v, type: 'bandpass', freq: 600 * p, q: 1 }, pan);
  }

  _click(t, v, p, pan) {
    this._tone(t, { type: 'sine', f0: 1150 * p, f1: 1600 * p, dur: 0.028, peak: 0.16 * v, attack: 0.001, lowpass: 6000 }, pan);
    this._noise(t, { dur: 0.02, peak: 0.06 * v, type: 'highpass', freq: 4200 * p, q: 0.7 }, pan);
  }

  _craft(t, v, p, pan) {
    // 两段上行音
    this._tone(t, { type: 'triangle', f0: 660 * p, dur: 0.1, peak: 0.16 * v, attack: 0.003, lowpass: 4000 }, pan);
    this._tone(t + 0.1, { type: 'triangle', f0: 990 * p, dur: 0.16, peak: 0.18 * v, attack: 0.003, lowpass: 4500 }, pan);
    this._tone(t + 0.1, { type: 'sine', f0: 1320 * p, dur: 0.09, peak: 0.07 * v }, pan);
  }

  _pop(t, v, p, pan) {
    // 短促上滑
    this._tone(t, { type: 'sine', f0: 480 * p, f1: 940 * p, dur: 0.085, peak: 0.2 * v, attack: 0.002 }, pan);
    this._tone(t, { type: 'triangle', f0: 260 * p, f1: 470 * p, dur: 0.07, peak: 0.06 * v, lowpass: 1500 }, pan);
  }

  _open(t, v, p, pan) {
    this._tone(t, { type: 'sine', f0: 440 * p, f1: 720 * p, dur: 0.14, peak: 0.13 * v, attack: 0.004 }, pan);
    this._noise(t, { dur: 0.1, peak: 0.06 * v, attack: 0.01, type: 'lowpass', freq: 1800 * p, q: 0.6, freqEnd: 900 * p }, pan);
  }

  _close(t, v, p, pan) {
    this._tone(t, { type: 'sine', f0: 680 * p, f1: 380 * p, dur: 0.13, peak: 0.13 * v, attack: 0.004 }, pan);
    this._noise(t, { dur: 0.08, peak: 0.08 * v, attack: 0.003, type: 'lowpass', freq: 700 * p, q: 0.7, freqEnd: 300 * p }, pan);
  }

  // ---------------------------------------------------------------- 环境音

  _thunder(t, volume, pitch, pan) {
    const ctx = this._ctx;
    if (!ctx || !this._noiseBuf) return;
    try {
      const dur = 2.4;
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(340, t);
      lp.frequency.exponentialRampToValueAtTime(55, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(MIN, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.02, volume * 0.55), t + 0.06);
      g.gain.exponentialRampToValueAtTime(MIN, t + dur);
      let out = g;
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        g.connect(panner);
        out = panner;
        out.connect(this._master);
        src.onended = () => {
          for (const n of [src, lp, g, panner]) { try { n.disconnect(); } catch (e) { /* ignore */ } }
        };
      } else {
        out.connect(this._master);
        src.onended = () => {
          for (const n of [src, lp, g]) { try { n.disconnect(); } catch (e) { /* ignore */ } }
        };
      }
      src.connect(lp);
      lp.connect(g);
      src.start(t);
      src.stop(t + dur + 0.05);
    } catch (e) { /* ignore */ }
  }

  _startAmbience() {
    if (this._amb || !this.ready || !this._noiseBuf || this._disposed) return;
    try {
      const ctx = this._ctx;
      const now = ctx.currentTime;

      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 70;
      hp.Q.value = 0.5;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.Q.value = 0.6;

      const amp = ctx.createGain();
      const base = 0.03;
      amp.gain.setValueAtTime(MIN, now);
      amp.gain.exponentialRampToValueAtTime(this._muted ? MIN : base, now + 2.5);

      // 缓慢幅度起伏
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.06;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.012;

      // 缓慢滤波扫动，让风声更自然
      const lfo2 = ctx.createOscillator();
      lfo2.type = 'sine';
      lfo2.frequency.value = 0.023;
      const lpDepth = ctx.createGain();
      lpDepth.gain.value = 110;

      src.connect(hp);
      hp.connect(lp);
      lp.connect(amp);
      amp.connect(this._master);

      lfo.connect(lfoDepth);
      lfoDepth.connect(amp.gain);
      lfo2.connect(lpDepth);
      lpDepth.connect(lp.frequency);

      lfo.start(now);
      lfo2.start(now);
      src.start(now);

      this._amb = { src, hp, lp, amp, lfo, lfo2, lfoDepth, lpDepth };
    } catch (e) {
      this._amb = null;
    }
  }
}
