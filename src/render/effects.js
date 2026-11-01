import * as THREE from 'three';

const MAX_PARTICLES = 720;
const MAX_LABELS = 18;
const MAX_SLASHES = 12;
const MAX_RINGS = 10;
const MAX_BEAMS = 10;
const UP = new THREE.Vector3(0, 1, 0);

const TEAM_COLORS = [new THREE.Color('#67b4ff'), new THREE.Color('#ff7a5f')];

function makeGlowTexture(inner = 'rgba(255,255,255,0.95)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.rng = Math.random;

    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.baseColors = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    this.drag = new Float32Array(MAX_PARTICLES);
    this.cursor = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.19,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);

    this.glowTex = makeGlowTexture();
    this.labels = [];
    for (let i = 0; i < MAX_LABELS; i++) this.labels.push(this._makeLabel());
    this.labelCursor = 0;

    const slashGeo = new THREE.RingGeometry(0.46, 0.96, 26, 1, -0.6, 2.1);
    slashGeo.rotateX(-Math.PI / 2);
    this.slashes = [];
    for (let i = 0; i < MAX_SLASHES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(slashGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 7;
      scene.add(mesh);
      this.slashes.push({ mesh, life: 0, maxLife: 0.22 });
    }

    const ringGeo = new THREE.RingGeometry(0.55, 0.68, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 0.8 });
    }

    const beamGeo = new THREE.CylinderGeometry(0.035, 0.075, 1, 5);
    this.beams = [];
    for (let i = 0; i < MAX_BEAMS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 9;
      scene.add(mesh);
      this.beams.push({ mesh, life: 0, maxLife: 0.18 });
    }

    this.glowSprites = [];
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: '#ffd28a',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(1, 1, 1);
      sp.visible = false;
      scene.add(sp);
      this.glowSprites.push({ sprite: sp, life: 0, maxLife: 0.35 });
    }
  }

  _makeLabel() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.75, 0.44, 1);
    sprite.visible = false;
    sprite.renderOrder = 20;
    this.scene.add(sprite);
    return { canvas, ctx, tex, sprite, life: 1.2, maxLife: 1.2, vy: 1 };
  }

  addLabel(x, y, z, text, color = '#ffe2a0', scale = 1) {
    const label = this.labels[this.labelCursor++ % MAX_LABELS];
    const { ctx, canvas } = label;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '700 40px Inter, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(10, 12, 9, 0.85)';
    ctx.strokeText(text, 128, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 34);
    label.tex.needsUpdate = true;
    label.sprite.material.opacity = 1;
    label.sprite.scale.set(1.75 * scale, 0.44 * scale, 1);
    label.sprite.position.set(x, y, z);
    label.sprite.visible = true;
    label.life = 0;
    label.maxLife = 1.15;
    label.vy = 0.55;
  }

  burst(x, y, z, color, count = 10, speed = 1.4, life = 0.7, gravity = -3.2) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const i3 = i * 3;
      this.positions[i3] = x;
      this.positions[i3 + 1] = y;
      this.positions[i3 + 2] = z;
      const theta = this.rng() * Math.PI * 2;
      const phi = Math.acos(2 * this.rng() - 1);
      const v = speed * (0.35 + this.rng() * 0.75);
      this.vel[i3] = Math.sin(phi) * Math.cos(theta) * v;
      this.vel[i3 + 1] = Math.abs(Math.cos(phi)) * v * 1.2 + 0.4;
      this.vel[i3 + 2] = Math.sin(phi) * Math.sin(theta) * v;
      const tint = 0.8 + this.rng() * 0.4;
      this.baseColors[i3] = c.r * tint;
      this.baseColors[i3 + 1] = c.g * tint;
      this.baseColors[i3 + 2] = c.b * tint;
      this.colors[i3] = c.r * tint;
      this.colors[i3 + 1] = c.g * tint;
      this.colors[i3 + 2] = c.b * tint;
      this.life[i] = life * (0.6 + this.rng() * 0.7);
      this.maxLife[i] = this.life[i];
      this.gravity[i] = gravity;
      this.drag[i] = 1.8;
    }
  }

  slash(x, z, angle, team, color = null) {
    const slot = this.slashes.find((s) => s.life <= 0) || this.slashes[0];
    slot.life = slot.maxLife;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, 0.75 + this.rng() * 0.2, z);
    slot.mesh.rotation.y = -angle + this.rng() * 0.4;
    slot.mesh.scale.setScalar(0.78 + this.rng() * 0.25);
    // Neutral events (a bear maul) pass an explicit colour instead of a team.
    if (color) slot.mesh.material.color.set(color);
    else slot.mesh.material.color.copy(TEAM_COLORS[team] || TEAM_COLORS[0]);
    slot.mesh.material.opacity = 0.85;
  }

  ring(x, z, color, radius = 1, life = 0.8) {
    const slot = this.rings.find((r) => r.life <= 0) || this.rings[0];
    slot.life = life;
    slot.maxLife = life;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, 0.06, z);
    slot.mesh.scale.setScalar(radius);
    slot.mesh.material.color.set(color);
    slot.mesh.material.opacity = 0.8;
  }

  glow(x, y, z, color, size = 1.4, life = 0.35) {
    const slot = this.glowSprites.find((g) => g.life <= 0) || this.glowSprites[0];
    slot.life = life;
    slot.maxLife = life;
    slot.sprite.visible = true;
    slot.sprite.position.set(x, y, z);
    slot.sprite.scale.setScalar(size);
    slot.sprite.material.color.set(color);
    slot.sprite.material.opacity = 1;
  }

  beam(x, y, z, tx, ty, tz, color, life = 0.18) {
    const slot = this.beams.find((b) => b.life <= 0) || this.beams[0];
    const dir = new THREE.Vector3(tx - x, ty - y, tz - z);
    const len = dir.length() || 0.001;
    slot.life = life;
    slot.maxLife = life;
    slot.mesh.visible = true;
    slot.mesh.position.set((x + tx) / 2, (y + ty) / 2, (z + tz) / 2);
    slot.mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    slot.mesh.scale.set(1, len, 1);
    slot.mesh.material.color.set(color);
    slot.mesh.material.opacity = 1;
  }

  update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.positions[i3 + 1] = -999;
        this.colors[i3] = this.colors[i3 + 1] = this.colors[i3 + 2] = 0;
        continue;
      }
      const drag = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] += this.gravity[i] * dt;
      this.vel[i3 + 2] *= drag;
      this.positions[i3] += this.vel[i3] * dt;
      this.positions[i3 + 1] += this.vel[i3 + 1] * dt;
      this.positions[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.positions[i3 + 1] < 0.04) {
        this.positions[i3 + 1] = 0.04;
        this.vel[i3 + 1] *= -0.25;
      }
      const fade = Math.min(1, (this.life[i] / this.maxLife[i]) * 1.7);
      this.colors[i3] = this.baseColors[i3] * fade;
      this.colors[i3 + 1] = this.baseColors[i3 + 1] * fade;
      this.colors[i3 + 2] = this.baseColors[i3 + 2] * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    for (const label of this.labels) {
      if (label.life >= label.maxLife) continue;
      label.life += dt;
      const t = label.life / label.maxLife;
      label.sprite.position.y += label.vy * dt * (1 - t * 0.6);
      label.sprite.material.opacity = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
      if (t >= 1) {
        label.sprite.visible = false;
        label.life = label.maxLife;
      }
    }

    for (const s of this.slashes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const t = 1 - s.life / s.maxLife;
      s.mesh.material.opacity = 0.9 * (1 - t);
      s.mesh.scale.multiplyScalar(1 + dt * 2.1);
      if (s.life <= 0) s.mesh.visible = false;
    }

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.mesh.material.opacity = 0.7 * (1 - t);
      r.mesh.scale.multiplyScalar(1 + dt * 3.2);
      if (r.life <= 0) r.mesh.visible = false;
    }

    for (const g of this.glowSprites) {
      if (g.life <= 0) continue;
      g.life -= dt;
      const t = 1 - g.life / g.maxLife;
      g.sprite.material.opacity = 0.85 * (1 - t);
      g.sprite.scale.multiplyScalar(1 + dt * 1.3);
      if (g.life <= 0) g.sprite.visible = false;
    }

    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = 1 - b.life / b.maxLife;
      b.mesh.material.opacity = 0.95 * (1 - t);
      b.mesh.scale.x = b.mesh.scale.z = 1 + t * 1.8;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }

  clear() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.life[i] = 0;
      this.positions[i * 3 + 1] = -999;
      this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0;
    }
    for (const l of this.labels) {
      l.sprite.visible = false;
      l.life = l.maxLife;
    }
    for (const s of this.slashes) {
      s.mesh.visible = false;
      s.life = 0;
    }
    for (const r of this.rings) {
      r.mesh.visible = false;
      r.life = 0;
    }
    for (const g of this.glowSprites) {
      g.sprite.visible = false;
      g.life = 0;
    }
    for (const b of this.beams) {
      b.mesh.visible = false;
      b.life = 0;
    }
  }
}
