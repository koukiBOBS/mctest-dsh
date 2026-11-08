// ============================================================
// player-model.js — 第三人称玩家模型（方块小人 + 走路动画）
// ============================================================

import * as THREE from 'three';

const SKIN = 0xc9a17c;
const SHIRT = 0x39a7a7;
const PANTS = 0x3b5aa0;
const HAIR = 0x3a2a1c;

export class PlayerModel {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.materials = [];
    this._walk = 0;
    this._swing = 0;

    const mat = (color) => {
      const m = new THREE.MeshBasicMaterial({ color });
      m.userData.base = new THREE.Color(color);
      this.materials.push(m);
      return m;
    };

    const skinMat = mat(SKIN);
    const shirtMat = mat(SHIRT);
    const pantsMat = mat(PANTS);
    const hairMat = mat(HAIR);
    const darkMat = mat(0x1b1b1b);

    const box = (w, h, d, material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);

    // 头
    const head = box(0.5, 0.5, 0.5, skinMat);
    head.position.y = 1.55;
    this.group.add(head);
    const hair = box(0.52, 0.16, 0.52, hairMat);
    hair.position.set(0, 1.75, 0);
    this.group.add(hair);
    for (const ex of [-0.11, 0.11]) {
      const eye = box(0.08, 0.08, 0.02, darkMat);
      eye.position.set(ex, 1.6, -0.26);
      this.group.add(eye);
    }

    // 身体
    const body = box(0.5, 0.75, 0.28, shirtMat);
    body.position.y = 1.0;
    this.group.add(body);

    // 手臂（肩部枢轴）
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.34, 1.32, 0);
      const arm = box(0.18, 0.62, 0.18, skinMat);
      arm.position.y = -0.3;
      pivot.add(arm);
      this.group.add(pivot);
      this.arms.push(pivot);
    }

    // 腿（髋部枢轴）
    this.legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.12, 0.72, 0);
      const leg = box(0.18, 0.7, 0.2, pantsMat);
      leg.position.y = -0.35;
      pivot.add(leg);
      this.group.add(pivot);
      this.legs.push(pivot);
    }

    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = !!visible;
  }

  get visible() {
    return this.group.visible;
  }

  update(dt, player, light = 1) {
    if (!this.group.visible) return;
    this.group.position.set(player.x, player.y, player.z);
    this.group.rotation.y = player.yaw;

    const speed = Math.hypot(player.vx, player.vz);
    const moving = speed > 0.4;
    if (moving) this._walk += dt * (4 + speed * 1.1);
    const swing = moving ? Math.sin(this._walk) * 0.7 : 0;
    if (this.legs[0]) this.legs[0].rotation.x = swing;
    if (this.legs[1]) this.legs[1].rotation.x = -swing;
    if (this.arms[0]) this.arms[0].rotation.x = -swing * 0.8;
    if (this.arms[1]) this.arms[1].rotation.x = swing * 0.8;

    // 攻击/挖掘时手臂挥动
    const swinging = player.breakHeld || player.attackCooldown > 0.15;
    this._swing = swinging ? Math.min(1, this._swing + dt * 6) : Math.max(0, this._swing - dt * 6);
    if (swinging && this.arms[1]) this.arms[1].rotation.x = -0.6 - Math.sin(this._walk * 6) * 0.5;

    // 光照调暗
    for (const m of this.materials) {
      const base = m.userData.base;
      if (base) m.color.copy(base).multiplyScalar(Math.max(0.35, light));
    }
  }
}
