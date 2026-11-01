import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RNG } from '../sim/rng.js';
import {
  WORLD,
  CELLS,
  VISION,
  MAX_HP,
  MAX_ENERGY,
  MAX_FORGE,
  RESOURCE_META,
  STRUCTURE_META,
} from '../sim/config.js';
import { Effects } from './effects.js';

const HALF = WORLD / 2;
const TEAM_COLORS = ['#4b9dff', '#ff5f45'];
const TEAM_CLOTH = ['#2e63a4', '#a63828'];
const TEAM_CLOTH_DARK = ['#1c3c66', '#641d15'];
const TEAM_SHIELD = ['#17385e', '#54150f'];
const TEAM_PLUME = ['#9fceff', '#ffb29a'];
const TEAM_ROOF = ['#253f62', '#7e2a1f'];
const TEAM_GLOW = [0.35, 0.35];

const STONE = '#7b7562';
const STONE_DARK = '#514d40';
const WOOD = '#6d4d2f';

const worldOf = (x, z) => [x - HALF, z - HALF];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function radialTexture(stops, size = 128) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bannerTexture(team) {
  const c = makeCanvas(160, 260);
  const ctx = c.getContext('2d');
  const base = team === 0 ? '#173a63' : '#5c1b12';
  const accent = team === 0 ? '#8fc5ff' : '#ffa088';
  const gold = '#e3c27e';
  const g = ctx.createLinearGradient(0, 0, 160, 260);
  g.addColorStop(0, base);
  g.addColorStop(1, team === 0 ? '#0a1b30' : '#2e0a06');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 160, 260);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 7;
  ctx.strokeRect(9, 9, 142, 242);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = accent;
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(14, 30 + i * 48, 132, 3);
  }
  ctx.globalAlpha = 1;
  ctx.translate(80, 125);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = accent;
  ctx.fillRect(-34, -34, 68, 68);
  ctx.fillStyle = gold;
  ctx.fillRect(-23, -23, 46, 46);
  ctx.fillStyle = base;
  ctx.fillRect(-12, -12, 24, 24);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = gold;
  ctx.font = '700 18px Cinzel, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(team === 0 ? 'AZURE' : 'EMBER', 0, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function groundTexture(renderer) {
  const size = 2048;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rng = new RNG(90210);
  const px = (x) => ((x + 22) / 44) * size;
  const py = (z) => ((z + 22) / 44) * size;

  const grad = ctx.createRadialGradient(size * 0.5, size * 0.52, size * 0.05, size * 0.5, size * 0.5, size * 0.72);
  grad.addColorStop(0, '#7f8e53');
  grad.addColorStop(0.45, '#6d7e46');
  grad.addColorStop(1, '#55663a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Broad painterly patches.
  for (let i = 0; i < 150; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(30, 190);
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rng.pick(['#7e8d53', '#526236', '#6a7a44', '#8a8b52', '#49592f']);
    g2.addColorStop(0, tone);
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = rng.range(0.06, 0.2);
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.55, 1.1), rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Dirt paths joining both keeps through the central ruin.
  const drawPath = (pts, width, color, alpha) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
    ctx.bezierCurveTo(
      px(pts[1][0]), py(pts[1][1]),
      px(pts[2][0]), py(pts[2][1]),
      px(pts[3][0]), py(pts[3][1]),
    );
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  drawPath([[-12.5, 12.5], [-8, 2], [2, -3], [0, 0]], 105, '#4a3d26', 0.28);
  drawPath([[0, 0], [-2, 5], [7, 9], [12.5, -12.5]], 105, '#4a3d26', 0.28);
  drawPath([[-12.5, 12.5], [-9, 9], [-6, 6], [0, 0]], 70, '#9b875e', 0.25);
  drawPath([[0, 0], [6, -6], [9, -9], [12.5, -12.5]], 70, '#9b875e', 0.25);
  drawPath([[-12.5, 12.5], [-6, 14], [6, -14], [12.5, -12.5]], 40, '#a58f63', 0.12);

  // Base clearings + ruined plaza.
  const clearing = (x, z, r, alpha = 0.3) => {
    const g2 = ctx.createRadialGradient(px(x), py(z), 0, px(x), py(z), r);
    g2.addColorStop(0, `rgba(150,128,84,${alpha})`);
    g2.addColorStop(0.65, `rgba(120,102,66,${alpha * 0.7})`);
    g2.addColorStop(1, 'rgba(90,80,52,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(px(x), py(z), r, 0, Math.PI * 2);
    ctx.fill();
  };
  clearing(-12.5, 12.5, 230, 0.36);
  clearing(12.5, -12.5, 230, 0.36);
  clearing(0, 0, 210, 0.26);

  // Scattered pebbles and flowers baked into the ground.
  for (let i = 0; i < 5200; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(0.6, 2.8);
    ctx.globalAlpha = rng.range(0.06, 0.28);
    ctx.fillStyle = rng.pick(['#a8a06d', '#314024', '#78864d', '#c4b881', '#3d4d2a']);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Grass strokes.
  for (let i = 0; i < 9500; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(2, 8);
    ctx.strokeStyle = rng.pick(['rgba(137,155,88,0.32)', 'rgba(76,94,48,0.35)', 'rgba(174,182,108,0.2)']);
    ctx.lineWidth = rng.range(0.5, 1.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y - len);
    ctx.stroke();
  }

  // Faint old flagstones near the ruin.
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#d8cba4';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(px(0), py(0), 125 + (i % 3) * 22, a, a + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Darker rim so the diorama reads against the mist.
  const rim = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.58);
  rim.addColorStop(0, 'rgba(20,28,18,0)');
  rim.addColorStop(1, 'rgba(18,25,16,0.55)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

export class ArenaView {
  constructor({ canvas, env, onEvent = null }) {
    this.canvas = canvas;
    this.env = env;
    this.onEvent = onEvent;
    this.lastEpisode = env.episodeId;
    this.time = 0;
    this.terrTimer = 0;
    this._tmp = new THREE.Object3D();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xa8a286, 0.0055);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
    this.camera.position.set(0, 41, 39);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.4, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 17;
    this.controls.maxDistance = 105;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI * 0.465;
    this.controls.rotateSpeed = 0.55;
    this.controls.panSpeed = 0.8;
    this.controls.zoomSpeed = 0.8;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.cameraDefault = {
      pos: new THREE.Vector3(0, 41, 39),
      target: new THREE.Vector3(0, 0.4, 0),
    };
    this.cameraAnim = null;

    this._buildSky();
    this._buildLights();
    this._buildPost();
    this._buildTerrain();
    this._buildRuins();
    this._buildBases();
    this._buildDecor();
    this._buildTerritory();
    this._buildResourceGroup();
    this._buildStructureGroup();
    this._buildUnits();

    this.effects = new Effects(this.scene, this.camera);

    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._clock = performance.now();
    this._updateTerritory(true);
  }

  /* ----------------------------- scene setup ----------------------------- */

  _buildSky() {
    const geo = new THREE.SphereGeometry(190, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color('#314c5c') },
        horizonColor: { value: new THREE.Color('#d8c49a') },
        groundColor: { value: new THREE.Color('#5b573e') },
        sunDir: { value: new THREE.Vector3(0.45, 0.38, 0.62).normalize() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        uniform vec3 sunDir;
        void main() {
          float h = vDir.y;
          vec3 col = mix(horizonColor, topColor, smoothstep(0.02, 0.55, h));
          col = mix(groundColor, col, smoothstep(-0.22, 0.01, h));
          float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 180.0);
          col += vec3(1.0, 0.82, 0.54) * sun * 0.75;
          float haze = pow(1.0 - abs(h), 8.0);
          col += vec3(0.12, 0.1, 0.06) * haze;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.position.y = -8;
    this.scene.add(this.sky);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight('#dbe8f0', '#6a6146', 1.02);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#ffe3b4', 2.7);
    this.sun.position.set(26, 38, 24);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 110;
    this.sun.shadow.camera.left = -29;
    this.sun.shadow.camera.right = 29;
    this.sun.shadow.camera.top = 29;
    this.sun.shadow.camera.bottom = -29;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.028;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const fill = new THREE.DirectionalLight('#86aecd', 0.6);
    fill.position.set(-22, 14, -18);
    this.scene.add(fill);

    this.ambient = new THREE.AmbientLight('#646849', 0.34);
    this.scene.add(this.ambient);
  }

  _buildPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.55, 0.84);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _buildTerrain() {
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 170),
      new THREE.MeshStandardMaterial({ color: '#394028', roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.34;
    outer.receiveShadow = true;
    this.scene.add(outer);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(44.6, 1.7, 44.6),
      new THREE.MeshStandardMaterial({ color: '#45402f', roughness: 0.96 }),
    );
    base.position.y = -0.9;
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      new THREE.MeshStandardMaterial({
        map: groundTexture(this.renderer),
        roughness: 1,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    const edgeMat = new THREE.MeshStandardMaterial({ color: '#3a3527', roughness: 1 });
    const edgeGeo = new THREE.BoxGeometry(44.8, 0.55, 1.2);
    for (const [z, sign] of [[22.1, 1], [-22.1, -1]]) {
      const wall = new THREE.Mesh(edgeGeo, edgeMat);
      wall.position.set(0, 0.13, z);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.scene.add(wall);
    }
    const sideGeo = new THREE.BoxGeometry(1.2, 0.55, 44.8);
    for (const x of [-22.1, 22.1]) {
      const wall = new THREE.Mesh(sideGeo, edgeMat);
      wall.position.set(x, 0.13, 0);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.scene.add(wall);
    }
  }

  _buildRuins() {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: '#938b73', roughness: 0.92 });
    const darkStone = new THREE.MeshStandardMaterial({ color: '#6d6654', roughness: 0.95 });

    const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.3, 0.34, 10), stone);
    dais.position.y = 0.17;
    dais.receiveShadow = true;
    dais.castShadow = true;
    group.add(dais);

    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.45, 0.18, 10),
      new THREE.MeshStandardMaterial({ color: '#a19a82', roughness: 0.9 }),
    );
    inner.position.y = 0.4;
    inner.receiveShadow = true;
    group.add(inner);

    const runeMat = new THREE.MeshBasicMaterial({
      color: '#ffd58a',
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rune = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.72, 64), runeMat);
    rune.rotation.x = -Math.PI / 2;
    rune.position.y = 0.505;
    group.add(rune);
    this.ruinRune = rune;

    const pillarGeo = new THREE.CylinderGeometry(0.27, 0.32, 2, 7);
    const capGeo = new THREE.BoxGeometry(0.72, 0.2, 0.72);
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + 0.3;
      const radius = 2.7;
      const broken = i % 3 === 0;
      const pillar = new THREE.Mesh(pillarGeo, i % 2 ? stone : darkStone);
      const height = broken ? 1.05 : 2.15;
      pillar.scale.y = height / 2;
      pillar.position.set(Math.cos(angle) * radius, 0.34 + height / 2, Math.sin(angle) * radius);
      pillar.rotation.z = broken ? 0.22 * (i % 2 ? 1 : -1) : 0.03 * Math.sin(i);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);
      if (!broken) {
        const cap = new THREE.Mesh(capGeo, stone);
        cap.position.set(pillar.position.x, 0.34 + height + 0.08, pillar.position.z);
        cap.rotation.y = angle;
        cap.castShadow = true;
        group.add(cap);
      }
    }

    const crystalMat = new THREE.MeshStandardMaterial({
      color: '#ffe1a1',
      emissive: '#ffc966',
      emissiveIntensity: 1.55,
      metalness: 0.25,
      roughness: 0.22,
    });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crystalMat);
    this.crystal.position.y = 2.15;
    this.crystal.castShadow = true;
    group.add(this.crystal);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([
          [0, 'rgba(255,215,140,0.65)'],
          [0.35, 'rgba(255,190,90,0.25)'],
          [1, 'rgba(255,170,60,0)'],
        ]),
        color: '#ffd28a',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.y = 2.15;
    halo.scale.set(4.2, 4.2, 1);
    group.add(halo);
    this.crystalHalo = halo;

    this.crystalLight = new THREE.PointLight('#ffbd66', 14, 15, 2);
    this.crystalLight.position.y = 2.6;
    group.add(this.crystalLight);

    this.scene.add(group);
    this.ruins = group;
  }

  _stoneMat(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.04 });
  }

  _buildBases() {
    this.bases = [];
    this.baseFires = [];
    this.banners = [];
    for (let team = 0; team < 2; team++) {
      const bp = this.env.bases[team];
      const [wx, wz] = worldOf(bp.x, bp.z);
      const group = new THREE.Group();
      group.position.set(wx, 0, wz);
      const dirX = -wx;
      const dirZ = -wz;
      group.rotation.y = Math.atan2(dirX, dirZ);

      const stone = this._stoneMat(STONE);
      const dark = this._stoneMat(STONE_DARK);
      const wood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 });
      const roof = new THREE.MeshStandardMaterial({
        color: TEAM_ROOF[team],
        roughness: 0.6,
        metalness: 0.2,
      });
      const gold = new THREE.MeshStandardMaterial({
        color: '#d9b56c',
        roughness: 0.35,
        metalness: 0.75,
        emissive: '#3a2a10',
        emissiveIntensity: 0.4,
      });
      const bannerMat = new THREE.MeshBasicMaterial({
        map: bannerTexture(team),
        side: THREE.DoubleSide,
      });
      const bannerGeo = new THREE.PlaneGeometry(1.1, 1.75, 12, 6);
      bannerGeo.translate(0.55, 0, 0);

      const platform = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.48, 6.6), stone);
      platform.position.y = 0.24;
      platform.receiveShadow = true;
      platform.castShadow = true;
      group.add(platform);

      for (let i = 0; i < 2; i++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(2.3 - i * 0.4, 0.2, 0.6), dark);
        step.position.set(0, 0.1 + i * 0.2, 3.5 + i * 0.45);
        step.receiveShadow = true;
        step.castShadow = true;
        group.add(step);
      }

      const keep = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.5, 2.7), stone);
      keep.position.y = 1.7;
      keep.castShadow = true;
      keep.receiveShadow = true;
      group.add(keep);

      const upper = new THREE.Mesh(new THREE.BoxGeometry(2.25, 1.05, 2.25), dark);
      upper.position.y = 3.4;
      upper.castShadow = true;
      upper.receiveShadow = true;
      group.add(upper);

      const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.55, 4), roof);
      roofMesh.position.y = 4.65;
      roofMesh.rotation.y = Math.PI / 4;
      roofMesh.castShadow = true;
      group.add(roofMesh);

      const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), gold);
      finial.position.y = 5.5;
      group.add(finial);

      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 3.0, 8), stone);
          tower.position.set(sx * 2.55, 1.75, sz * 2.55);
          tower.castShadow = true;
          tower.receiveShadow = true;
          group.add(tower);

          const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(0.88, 1.3, 8), roof);
          towerRoof.position.set(sx * 2.55, 3.9, sz * 2.55);
          towerRoof.castShadow = true;
          group.add(towerRoof);

          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.585, 0.585, 0.12, 8), gold);
          band.position.set(sx * 2.55, 3.1, sz * 2.55);
          group.add(band);
        }
      }

      const door = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 1.4, 0.12),
        new THREE.MeshStandardMaterial({ color: '#2a1c12', roughness: 0.9 }),
      );
      door.position.set(0, 1.05, 1.37);
      group.add(door);
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.7, 0.08), gold);
      doorFrame.position.set(0, 1.15, 1.34);
      group.add(doorFrame);

      for (const [px, pz, scale] of [[2.2, 2.1, 1.3], [-2.3, 2.0, 1.05]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 4.7, 6), gold);
        pole.position.set(px, 2.7, pz);
        pole.castShadow = true;
        group.add(pole);
        const flag = new THREE.Mesh(bannerGeo, bannerMat);
        flag.position.set(px + 0.06, 3.55, pz);
        flag.rotation.y = -0.35;
        flag.castShadow = true;
        group.add(flag);
        this.banners.push({
          mesh: flag,
          base: bannerGeo.attributes.position.array.slice(),
          phase: team * 1.7 + px,
        });
      }

      const rune = new THREE.Mesh(
        new THREE.RingGeometry(3.45, 3.72, 64),
        new THREE.MeshBasicMaterial({
          color: TEAM_COLORS[team],
          transparent: true,
          opacity: 0.24,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      rune.rotation.x = -Math.PI / 2;
      rune.position.y = 0.03;
      group.add(rune);

      // Campfire and supplies.
      const fire = new THREE.Group();
      fire.position.set(2.0, 0, 2.0);
      for (let i = 0; i < 5; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.55, 5), wood);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (i / 5) * Math.PI * 2;
        log.position.y = 0.12;
        fire.add(log);
      }
      const flameMat = new THREE.MeshBasicMaterial({
        color: '#ff9a3c',
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.75, 7), flameMat);
      flame.position.y = 0.52;
      fire.add(flame);
      const flame2 = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.5, 6),
        flameMat.clone(),
      );
      flame2.position.y = 0.7;
      flame2.material.color.set('#ffe1a0');
      fire.add(flame2);
      const light = new THREE.PointLight('#ff9a45', 7, 9, 2);
      light.position.y = 0.9;
      fire.add(light);
      group.add(fire);
      this.baseFires.push({ flame, flame2, light, phase: team * 2.4 });

      for (const [bx, bz, ry] of [[-2.2, 1.9, 0.2], [-1.8, 2.3, -0.4]]) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), wood);
        crate.position.set(bx, 0.48, bz);
        crate.rotation.y = ry;
        crate.castShadow = true;
        group.add(crate);
      }

      this.scene.add(group);
      this.bases.push(group);
    }
  }

  _buildDecor() {
    const rng = new RNG(77123);

    // Grass tufts.
    const grassGeo = new THREE.ConeGeometry(0.055, 0.26, 3);
    grassGeo.translate(0, 0.13, 0);
    const grass = new THREE.InstancedMesh(
      grassGeo,
      new THREE.MeshStandardMaterial({ color: '#6d7d42', roughness: 1 }),
      1100,
    );
    grass.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (let i = 0; i < 1100; i++) {
      const x = rng.range(-19.2, 19.2);
      const z = rng.range(-19.2, 19.2);
      dummy.position.set(x, 0.01, z);
      dummy.rotation.y = rng.range(0, Math.PI * 2);
      dummy.scale.set(rng.range(0.6, 1.8), rng.range(0.6, 1.6), rng.range(0.6, 1.8));
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
      col.setHSL(rng.range(0.19, 0.26), rng.range(0.25, 0.45), rng.range(0.28, 0.45));
      grass.setColorAt(i, col);
    }
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.frustumCulled = false;
    this.scene.add(grass);

    // Wildflowers.
    const flowerGeo = new THREE.SphereGeometry(0.05, 5, 4);
    const flowers = new THREE.InstancedMesh(
      flowerGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: '#221a08', emissiveIntensity: 0.2 }),
      240,
    );
    const flowerColors = ['#f0d77b', '#f4efe0', '#b38cd0', '#e7a45d'];
    for (let i = 0; i < 240; i++) {
      dummy.position.set(rng.range(-18.5, 18.5), rng.range(0.08, 0.22), rng.range(-18.5, 18.5));
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(rng.range(0.7, 1.6));
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
      flowers.setColorAt(i, col.set(rng.pick(flowerColors)));
    }
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    flowers.frustumCulled = false;
    this.scene.add(flowers);

    // Scattered fieldstones.
    const rockGeo = new THREE.DodecahedronGeometry(0.42, 0);
    const rocks = new THREE.InstancedMesh(
      rockGeo,
      new THREE.MeshStandardMaterial({ color: '#7e7a67', roughness: 0.95 }),
      70,
    );
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(10, 21.8);
      const s = rng.range(0.3, 1.4);
      dummy.position.set(Math.cos(a) * r, 0.1 * s, Math.sin(a) * r);
      dummy.rotation.set(rng.range(0, 0.5), rng.range(0, Math.PI * 2), rng.range(0, 0.5));
      dummy.scale.set(s, s * rng.range(0.55, 0.9), s);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.frustumCulled = false;
    this.scene.add(rocks);

    // Forest ring outside the diorama, kept off the camera-facing edge.
    const pinePositions = [];
    for (let i = 0; i < 52; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(23.5, 33);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (z > 9 && Math.abs(x) < 26) continue;
      pinePositions.push({ x, z, s: rng.range(0.8, 1.8), ry: rng.range(0, Math.PI * 2) });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1.2, 5);
    trunkGeo.translate(0, 0.6, 0);
    const pineTrunks = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: '#4a3827', roughness: 1 }),
      pinePositions.length,
    );
    const pineGeo = new THREE.ConeGeometry(1.0, 3.4, 7);
    pineGeo.translate(0, 2.6, 0);
    const pines = new THREE.InstancedMesh(
      pineGeo,
      new THREE.MeshStandardMaterial({ color: '#2e4a2c', roughness: 0.95 }),
      pinePositions.length,
    );
    pineTrunks.castShadow = false;
    pines.castShadow = true;
    pinePositions.forEach((p, i) => {
      dummy.position.set(p.x, -0.34, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      pineTrunks.setMatrixAt(i, dummy.matrix);
      pines.setMatrixAt(i, dummy.matrix);
    });
    pineTrunks.instanceMatrix.needsUpdate = true;
    pines.instanceMatrix.needsUpdate = true;
    pineTrunks.frustumCulled = false;
    pines.frustumCulled = false;
    this.scene.add(pineTrunks, pines);

    // Ambient motes.
    const moteCount = 240;
    const mp = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      mp[i * 3] = rng.range(-19, 19);
      mp[i * 3 + 1] = rng.range(0.3, 6);
      mp[i * 3 + 2] = rng.range(-19, 19);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({
        color: '#ffe8b0',
        size: 0.075,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  _buildTerritory() {
    const size = 512;
    this.terrRaw = makeCanvas(size, size);
    this.terrRawCtx = this.terrRaw.getContext('2d');
    this.terrCanvas = makeCanvas(size, size);
    this.terrCtx = this.terrCanvas.getContext('2d');
    this.terrTexture = new THREE.CanvasTexture(this.terrCanvas);
    this.terrTexture.colorSpace = THREE.SRGBColorSpace;
    this.terrTexture.minFilter = THREE.LinearFilter;
    this.terrTexture.magFilter = THREE.LinearFilter;

    const mat = new THREE.MeshBasicMaterial({
      map: this.terrTexture,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.territory = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), mat);
    this.territory.rotation.x = -Math.PI / 2;
    this.territory.position.y = 0.05;
    this.territory.renderOrder = 2;
    this.scene.add(this.territory);
  }

  _updateTerritory(force = false) {
    const env = this.env;
    const raw = this.terrRawCtx;
    const size = this.terrCanvas.width;
    const cellPx = size / CELLS;
    raw.clearRect(0, 0, size, size);
    for (let cz = 0; cz < CELLS; cz++) {
      for (let cx = 0; cx < CELLS; cx++) {
        const owner = env.owner[cz * CELLS + cx];
        if (owner < 0) continue;
        raw.fillStyle = owner === 0 ? '#2f63c8' : '#c0472f';
        raw.fillRect(cx * cellPx - 0.35, cz * cellPx - 0.35, cellPx + 0.7, cellPx + 0.7);
      }
    }
    const ctx = this.terrCtx;
    ctx.clearRect(0, 0, size, size);
    ctx.filter = 'blur(4px)';
    ctx.drawImage(this.terrRaw, 0, 0);
    ctx.filter = 'none';
    this.terrTexture.needsUpdate = true;
    void force;
  }

  /* -------------------------------- resources -------------------------------- */

  _disposeGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else if (obj.material.map && obj.material.userData?.ownMap) {
          obj.material.map.dispose();
          obj.material.dispose();
        }
      }
    });
    this.scene.remove(group);
  }

  _buildResourceGroup() {
    if (this.resourceGroup) this._disposeGroup(this.resourceGroup);
    const group = new THREE.Group();
    this.resourceGroup = group;
    this.scene.add(group);
    this.resViews = [];
    const rng = new RNG(5511);

    const byType = { food: [], wood: [], gold: [] };
    for (const node of this.env.resources) byType[node.type].push(node);

    const addMesh = (geo, mat, count, shadows = true) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };

    // Wood: 26 trunks + three canopies each.
    const wood = byType.wood;
    const trunkMesh = addMesh(
      new THREE.CylinderGeometry(0.15, 0.26, 1.35, 6),
      new THREE.MeshStandardMaterial({ color: '#59412a', roughness: 0.95 }),
      wood.length,
    );
    const canopyMat = new THREE.MeshStandardMaterial({ color: '#456b2e', roughness: 0.9 });
    const canopyMesh = addMesh(new THREE.IcosahedronGeometry(0.78, 0), canopyMat, wood.length * 3);
    const canopyColors = ['#4b7634', '#5f8d3f', '#3f6a2e', '#6d9a48'];
    const cCol = new THREE.Color();
    const dummy = new THREE.Object3D();
    wood.forEach((node, i) => {
      const [wx, wz] = worldOf(node.x, node.z);
      const base = rng.range(0.85, 1.16);
      const rot = rng.range(0, Math.PI * 2);
      dummy.position.set(wx, 0, wz);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(base);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      trunkMesh.setColorAt(i, cCol.set('#59412a'));
      const view = {
        node,
        kind: 'wood',
        base,
        rot,
        phase: rng.range(0, 6.28),
        idx: i,
        scale: 1,
        trunkMesh,
        canopyMesh,
        canopyOffsets: [
          [0, 1.55, 0, 1.0],
          [0.34, 1.95, 0.14, 0.66],
          [-0.29, 1.86, -0.23, 0.58],
        ],
        canopyColors: [
          cCol.set(rng.pick(canopyColors)).clone(),
          cCol.set(rng.pick(canopyColors)).clone(),
          cCol.set(rng.pick(canopyColors)).clone(),
        ],
      };
      for (let k = 0; k < 3; k++) canopyMesh.setColorAt(i * 3 + k, view.canopyColors[k]);
      this.resViews.push(view);
    });

    // Food: bushes with berries.
    const food = byType.food;
    const bushMesh = addMesh(
      new THREE.IcosahedronGeometry(0.62, 1),
      new THREE.MeshStandardMaterial({ color: '#4d6b2d', roughness: 0.95 }),
      food.length,
    );
    bushMesh.scale.set(1, 1, 1);
    const berryMat = new THREE.MeshStandardMaterial({
      color: '#c2363b',
      emissive: '#4a0d10',
      emissiveIntensity: 0.35,
      roughness: 0.5,
    });
    const berryMesh = addMesh(new THREE.SphereGeometry(0.075, 6, 5), berryMat, food.length * 4, false);
    food.forEach((node, i) => {
      const [wx, wz] = worldOf(node.x, node.z);
      const base = rng.range(0.9, 1.25);
      const rot = rng.range(0, Math.PI * 2);
      dummy.position.set(wx, 0, wz);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(base);
      dummy.updateMatrix();
      bushMesh.setMatrixAt(i, dummy.matrix);
      bushMesh.setColorAt(i, cCol.set(rng.pick(['#4a672c', '#587932', '#3f5b27'])));
      const view = {
        node,
        kind: 'food',
        base,
        rot,
        phase: rng.range(0, 6.28),
        idx: i,
        scale: 1,
        bushMesh,
        berryMesh,
        berryOffsets: Array.from({ length: 4 }, () => [
          rng.range(-0.42, 0.42),
          rng.range(0.28, 0.62),
          rng.range(-0.42, 0.42),
        ]),
      };
      for (let k = 0; k < 4; k++) berryMesh.setColorAt(i * 4 + k, cCol.set('#c2363b'));
      this.resViews.push(view);
    });

    // Gold: dark host rock with embedded gleaming chunks.
    const gold = byType.gold;
    const hostMesh = addMesh(
      new THREE.DodecahedronGeometry(0.55, 0),
      new THREE.MeshStandardMaterial({ color: '#6b6656', roughness: 0.92 }),
      gold.length,
    );
    const goldMat = new THREE.MeshStandardMaterial({
      color: '#ffd166',
      metalness: 0.8,
      roughness: 0.24,
      emissive: '#7a5612',
      emissiveIntensity: 0.6,
    });
    const goldMesh = addMesh(new THREE.OctahedronGeometry(0.35, 0), goldMat, gold.length * 3, true);
    gold.forEach((node, i) => {
      const [wx, wz] = worldOf(node.x, node.z);
      const base = rng.range(0.9, 1.2);
      const rot = rng.range(0, Math.PI * 2);
      dummy.position.set(wx, 0, wz);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(base);
      dummy.updateMatrix();
      hostMesh.setMatrixAt(i, dummy.matrix);
      hostMesh.setColorAt(i, cCol.set('#6b6656'));
      const view = {
        node,
        kind: 'gold',
        base,
        rot,
        phase: rng.range(0, 6.28),
        idx: i,
        scale: 1,
        hostMesh,
        goldMesh,
        goldOffsets: Array.from({ length: 3 }, () => [
          rng.range(-0.38, 0.38),
          rng.range(0.22, 0.6),
          rng.range(-0.38, 0.38),
          rng.range(0.15, 0.32),
        ]),
      };
      for (let k = 0; k < 3; k++) goldMesh.setColorAt(i * 3 + k, cCol.set('#f2c258'));
      this.resViews.push(view);
    });

    // Initialize all transforms.
    for (const view of this.resViews) this._updateResourceView(view, 1, true);
    for (const mesh of group.children) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  _updateResourceView(view, dt, force = false) {
    const frac = view.node.alive ? Math.max(0, view.node.amount / view.node.max) : 0;
    const target = view.node.alive ? 0.62 + 0.38 * Math.sqrt(frac) : 0.0001;
    const prev = view.scale;
    view.scale = force ? target : THREE.MathUtils.damp(view.scale, target, 5.5, dt);
    if (!force && Math.abs(view.scale - prev) < 0.0004) return;
    const node = view.node;
    const [wx, wz] = worldOf(node.x, node.z);
    const s = view.base * view.scale;
    const d = this._tmp;
    d.rotation.set(0, view.rot, 0);

    if (view.kind === 'wood') {
      d.position.set(wx, 0, wz);
      d.scale.setScalar(s);
      d.updateMatrix();
      view.trunkMesh.setMatrixAt(view.idx, d.matrix);
      view.canopyOffsets.forEach((off, k) => {
        d.position.set(wx + off[0] * s, off[1] * s, wz + off[2] * s);
        d.scale.setScalar(s * off[3]);
        d.updateMatrix();
        view.canopyMesh.setMatrixAt(view.idx * 3 + k, d.matrix);
      });
      view.trunkMesh.instanceMatrix.needsUpdate = true;
      view.canopyMesh.instanceMatrix.needsUpdate = true;
    } else if (view.kind === 'food') {
      d.position.set(wx, 0.22 * s, wz);
      d.scale.set(s * 1.05, s * 0.8, s * 1.05);
      d.updateMatrix();
      view.bushMesh.setMatrixAt(view.idx, d.matrix);
      view.berryOffsets.forEach((off, k) => {
        d.position.set(wx + off[0] * s, off[1] * s, wz + off[2] * s);
        d.scale.setScalar(s);
        d.updateMatrix();
        view.berryMesh.setMatrixAt(view.idx * 4 + k, d.matrix);
      });
      view.bushMesh.instanceMatrix.needsUpdate = true;
      view.berryMesh.instanceMatrix.needsUpdate = true;
    } else {
      d.position.set(wx, 0.17 * s, wz);
      d.scale.set(s, s * 0.8, s);
      d.updateMatrix();
      view.hostMesh.setMatrixAt(view.idx, d.matrix);
      view.goldOffsets.forEach((off, k) => {
        d.position.set(wx + off[0] * s, off[1] * s, wz + off[2] * s);
        d.rotation.set(0.3, view.rot + k, 0.2);
        d.scale.setScalar(s * off[3] * 1.8);
        d.updateMatrix();
        view.goldMesh.setMatrixAt(view.idx * 3 + k, d.matrix);
      });
      view.hostMesh.instanceMatrix.needsUpdate = true;
      view.goldMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ------------------------------- structures ------------------------------- */

  _buildStructureGroup() {
    this.structureGroup = new THREE.Group();
    this.structureGroup.name = 'structures';
    this.scene.add(this.structureGroup);
    this.structureViews = new Map();
  }

  _makeStructureView(structure) {
    const team = structure.team;
    const meta = STRUCTURE_META[structure.type];
    const [wx, wz] = worldOf(structure.x, structure.z);
    const root = new THREE.Group();
    root.position.set(wx, 0, wz);

    const wood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.9 });
    const stone = this._stoneMat(STONE);
    const dark = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.95 });
    const cloth = new THREE.MeshStandardMaterial({ color: TEAM_CLOTH[team], roughness: 0.82 });
    const gold = new THREE.MeshStandardMaterial({
      color: '#d9b56c',
      roughness: 0.35,
      metalness: 0.75,
      emissive: '#3a2a10',
      emissiveIntensity: 0.4,
    });

    const rune = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.86, 32),
      new THREE.MeshBasicMaterial({
        color: TEAM_COLORS[team],
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    rune.rotation.x = -Math.PI / 2;
    rune.position.y = 0.035;
    root.add(rune);

    const auraRadius = structure.type === 'tower' ? meta.range : meta.radius;
    const aura = new THREE.Mesh(
      new THREE.RingGeometry(auraRadius - 0.08, auraRadius, 56),
      new THREE.MeshBasicMaterial({
        color: TEAM_COLORS[team],
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.045;
    aura.renderOrder = 3;
    root.add(aura);

    let orb = null;
    let flame = null;
    if (structure.type === 'tower') {
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 0.34, 8), stone);
      plinth.position.y = 0.17;
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      root.add(plinth);

      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.95, 5), wood);
        leg.position.set(sx * 0.5, 1.16, sz * 0.5);
        leg.rotation.z = sx * -0.06;
        leg.rotation.x = sz * 0.06;
        leg.castShadow = true;
        root.add(leg);
      }

      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.18, 1.55), wood);
      deck.position.y = 2.08;
      deck.castShadow = true;
      deck.receiveShadow = true;
      root.add(deck);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.92, 1.05), dark);
      cabin.position.y = 2.62;
      cabin.castShadow = true;
      root.add(cabin);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(1.08, 0.82, 4),
        new THREE.MeshStandardMaterial({
          color: TEAM_ROOF[team],
          roughness: 0.6,
          metalness: 0.2,
        }),
      );
      roof.position.y = 3.48;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      root.add(roof);

      const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), gold);
      finial.position.y = 4.02;
      root.add(finial);

      orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.17, 0),
        new THREE.MeshStandardMaterial({
          color: TEAM_PLUME[team],
          emissive: TEAM_COLORS[team],
          emissiveIntensity: 1.6,
          metalness: 0.2,
          roughness: 0.25,
        }),
      );
      orb.position.y = 3.06;
      orb.castShadow = true;
      root.add(orb);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 5), gold);
      pole.position.set(0.72, 3.05, 0.22);
      root.add(pole);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.4),
        new THREE.MeshBasicMaterial({
          map: bannerTexture(team),
          side: THREE.DoubleSide,
          transparent: true,
        }),
      );
      flag.position.set(0.72, 3.38, 0.22);
      flag.rotation.y = -0.3;
      root.add(flag);
    } else {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.12, 1.38, 7), cloth);
      tent.position.y = 0.72;
      tent.castShadow = true;
      tent.receiveShadow = true;
      root.add(tent);

      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.62, 0.1),
        new THREE.MeshStandardMaterial({ color: '#241811', roughness: 0.95 }),
      );
      door.position.set(0, 0.35, 0.76);
      root.add(door);

      for (const [px, pz] of [[-0.9, -0.5], [0.9, 0.55], [0.1, -0.95]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.1, 5), wood);
        pole.position.set(px, 0.55, pz);
        pole.rotation.z = px * 0.16;
        pole.castShadow = true;
        root.add(pole);
      }

      const fire = new THREE.Group();
      fire.position.set(0.95, 0, 0.9);
      for (let i = 0; i < 5; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 5), wood);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (i / 5) * Math.PI * 2;
        log.position.y = 0.1;
        fire.add(log);
      }
      flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.19, 0.55, 6),
        new THREE.MeshBasicMaterial({
          color: '#ff9a3c',
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      flame.position.y = 0.4;
      fire.add(flame);
      const light = new THREE.PointLight('#ff9a45', 4.5, 6, 2);
      light.position.y = 0.65;
      fire.add(light);
      root.add(fire);

      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), wood);
      crate.position.set(-0.85, 0.23, 0.78);
      crate.rotation.y = 0.3;
      crate.castShadow = true;
      root.add(crate);
    }

    root.scale.setScalar(0.01);
    this.structureGroup.add(root);
    return {
      structure,
      root,
      aura,
      orb,
      flame,
      born: this.time,
    };
  }

  _disposeStructureView(view) {
    this.structureGroup.remove(view.root);
    view.root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    });
  }

  _syncStructures(dt) {
    const seen = new Set();
    for (const structure of this.env.structures) {
      seen.add(structure.id);
      let view = this.structureViews.get(structure.id);
      if (!view) {
        view = this._makeStructureView(structure);
        this.structureViews.set(structure.id, view);
      }
      const age = Math.max(0, this.time - view.born);
      const t = Math.min(1, age / 0.55);
      const ease = 1 - Math.pow(1 - t, 3);
      view.root.scale.setScalar(0.06 + 0.94 * ease);
      const pulse = 0.5 + Math.sin(this.time * 1.9 + structure.id) * 0.5;
      view.aura.material.opacity =
        (structure.type === 'tower' ? 0.045 : 0.075) + pulse * 0.02;
      if (view.orb) {
        view.orb.rotation.y += dt * 1.5;
        view.orb.position.y = 3.06 + Math.sin(this.time * 2.2 + structure.id) * 0.05;
      }
      if (view.flame) {
        const flicker = 0.85 + Math.sin(this.time * 10 + structure.id) * 0.12;
        view.flame.scale.set(1, flicker, 1);
      }
    }
    for (const [id, view] of this.structureViews) {
      if (seen.has(id)) continue;
      this._disposeStructureView(view);
      this.structureViews.delete(id);
    }
  }

  /* --------------------------------- units --------------------------------- */

  _unitMaterials(team) {
    if (this._unitMats && this._unitMats[team]) return this._unitMats[team];
    const mats = {
      cloth: new THREE.MeshStandardMaterial({ color: TEAM_CLOTH[team], roughness: 0.82 }),
      dark: new THREE.MeshStandardMaterial({ color: TEAM_CLOTH_DARK[team], roughness: 0.88 }),
      shield: new THREE.MeshStandardMaterial({
        color: TEAM_SHIELD[team],
        roughness: 0.55,
        metalness: 0.35,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: '#b9b5a5',
        roughness: 0.4,
        metalness: 0.6,
      }),
      skin: new THREE.MeshStandardMaterial({ color: '#c89a70', roughness: 0.85 }),
      gold: new THREE.MeshStandardMaterial({
        color: '#d9b56c',
        roughness: 0.35,
        metalness: 0.75,
      }),
      plume: new THREE.MeshStandardMaterial({
        color: TEAM_PLUME[team],
        roughness: 0.65,
        emissive: TEAM_COLORS[team],
        emissiveIntensity: 0.2,
      }),
      wood: new THREE.MeshStandardMaterial({ color: '#795633', roughness: 0.9 }),
    };
    this._unitMats = this._unitMats || [];
    this._unitMats[team] = mats;
    return mats;
  }

  _buildUnits() {
    this.unitGeo = {
      leg: new THREE.CylinderGeometry(0.075, 0.095, 0.48, 6).translate(0, -0.24, 0),
      torso: new THREE.CylinderGeometry(0.2, 0.27, 0.58, 8),
      chest: new THREE.BoxGeometry(0.46, 0.3, 0.3),
      head: new THREE.SphereGeometry(0.145, 10, 8),
      helmet: new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      crest: new THREE.ConeGeometry(0.045, 0.24, 6),
      shoulder: new THREE.SphereGeometry(0.095, 7, 6),
      arm: new THREE.CylinderGeometry(0.052, 0.062, 0.4, 6).translate(0, -0.2, 0),
      hand: new THREE.SphereGeometry(0.062, 6, 5),
      shield: new THREE.CylinderGeometry(0.28, 0.28, 0.055, 12),
      shieldBoss: new THREE.SphereGeometry(0.075, 8, 6),
      belt: new THREE.BoxGeometry(0.42, 0.09, 0.3),
      cape: new THREE.PlaneGeometry(0.42, 0.5),
      spear: new THREE.CylinderGeometry(0.022, 0.026, 1.85, 5).translate(0, 0.4, 0),
      spearTip: new THREE.ConeGeometry(0.06, 0.24, 5),
      foot: new THREE.BoxGeometry(0.13, 0.08, 0.22),
    };

    this.units = [];
    for (let team = 0; team < 2; team++) {
      for (let id = 0; id < 6; id++) {
        const view = this._makeUnit(team, id);
        this.units.push(view);
      }
    }
  }

  _makeUnit(team, id) {
    const mats = this._unitMaterials(team);
    const g = this.unitGeo;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.43, 24),
      new THREE.MeshBasicMaterial({
        color: TEAM_COLORS[team],
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    root.add(ring);

    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(-0.105, 0.5, 0);
    legR.position.set(0.105, 0.5, 0);
    const legLMesh = new THREE.Mesh(g.leg, mats.dark);
    const legRMesh = new THREE.Mesh(g.leg, mats.dark);
    legLMesh.castShadow = true;
    legRMesh.castShadow = true;
    legL.add(legLMesh);
    legR.add(legRMesh);
    const footL = new THREE.Mesh(g.foot, mats.wood);
    footL.position.set(0, -0.455, 0.05);
    const footR = new THREE.Mesh(g.foot, mats.wood);
    footR.position.set(0, -0.455, 0.05);
    legL.add(footL);
    legR.add(footR);
    body.add(legL, legR);

    const torso = new THREE.Mesh(g.torso, mats.cloth);
    torso.position.y = 0.83;
    torso.castShadow = true;
    body.add(torso);

    const chest = new THREE.Mesh(g.chest, mats.dark);
    chest.position.set(0, 0.94, 0.15);
    chest.castShadow = true;
    body.add(chest);

    const belt = new THREE.Mesh(g.belt, mats.wood);
    belt.position.y = 0.59;
    body.add(belt);

    const cape = new THREE.Mesh(
      g.cape,
      new THREE.MeshStandardMaterial({
        color: TEAM_CLOTH_DARK[team],
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    cape.position.set(0, 0.82, -0.22);
    cape.rotation.x = 0.08;
    cape.castShadow = true;
    body.add(cape);

    const armL = new THREE.Group();
    const armR = new THREE.Group();
    armL.position.set(-0.3, 0.99, 0);
    armR.position.set(0.3, 0.99, 0);
    armL.rotation.z = -0.08;
    armR.rotation.z = 0.08;
    const shoulderL = new THREE.Mesh(g.shoulder, mats.cloth);
    const shoulderR = new THREE.Mesh(g.shoulder, mats.cloth);
    armL.add(shoulderL);
    armR.add(shoulderR);
    const armLMesh = new THREE.Mesh(g.arm, mats.skin);
    const armRMesh = new THREE.Mesh(g.arm, mats.skin);
    armLMesh.castShadow = true;
    armRMesh.castShadow = true;
    armL.add(armLMesh);
    armR.add(armRMesh);
    const handL = new THREE.Mesh(g.hand, mats.skin);
    handL.position.y = -0.4;
    armL.add(handL);
    const handR = new THREE.Mesh(g.hand, mats.skin);
    handR.position.y = -0.4;
    armR.add(handR);

    const shield = new THREE.Group();
    const shieldDisc = new THREE.Mesh(g.shield, mats.shield);
    shieldDisc.rotation.x = Math.PI / 2;
    shieldDisc.castShadow = true;
    shield.add(shieldDisc);
    const shieldBoss = new THREE.Mesh(g.shieldBoss, mats.gold);
    shieldBoss.position.set(0, 0, 0.05);
    shield.add(shieldBoss);
    shield.position.set(-0.1, -0.24, 0.07);
    armL.add(shield);

    const spear = new THREE.Group();
    const shaft = new THREE.Mesh(g.spear, mats.wood);
    shaft.castShadow = true;
    spear.add(shaft);
    const tip = new THREE.Mesh(g.spearTip, mats.metal);
    tip.position.y = 1.42;
    tip.castShadow = true;
    spear.add(tip);
    spear.position.set(0.02, -0.38, 0.02);
    spear.rotation.x = 0.18;
    armR.add(spear);
    body.add(armL, armR);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 6), mats.skin);
    neck.position.y = 1.15;
    body.add(neck);

    const head = new THREE.Mesh(g.head, mats.skin);
    head.position.y = 1.27;
    head.castShadow = true;
    body.add(head);

    const helmet = new THREE.Mesh(g.helmet, mats.metal);
    helmet.position.y = 1.3;
    helmet.scale.set(1.06, 0.95, 1.06);
    helmet.castShadow = true;
    body.add(helmet);

    const crest = new THREE.Mesh(g.crest, mats.plume);
    crest.position.set(0, 1.46, -0.02);
    crest.rotation.x = -0.15;
    body.add(crest);
    const crest2 = new THREE.Mesh(g.crest, mats.plume);
    crest2.position.set(0, 1.44, -0.1);
    crest2.rotation.x = -0.5;
    crest2.scale.set(0.8, 0.8, 0.8);
    body.add(crest2);

    const rankPips = [];
    const pipGeo = new THREE.OctahedronGeometry(0.032, 0);
    for (let i = 0; i < MAX_FORGE; i++) {
      const pip = new THREE.Mesh(pipGeo, mats.gold);
      pip.position.set((i - (MAX_FORGE - 1) / 2) * 0.065, 1.53, 0.06);
      pip.visible = false;
      body.add(pip);
      rankPips.push(pip);
    }

    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 5, 4),
      new THREE.MeshBasicMaterial({ color: '#1b1710' }),
    );
    eye.position.set(0.06, 1.3, 0.13);
    body.add(eye);
    const eye2 = eye.clone();
    eye2.position.x = -0.06;
    body.add(eye2);

    // Health + energy plate.
    const canvas = makeCanvas(160, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const health = new THREE.Sprite(spriteMat);
    health.scale.set(0.98, 0.21, 1);
    health.position.y = 1.75;
    health.renderOrder = 12;
    root.add(health);

    const visionRing = new THREE.Mesh(
      new THREE.RingGeometry(VISION - 0.05, VISION, 64),
      new THREE.MeshBasicMaterial({
        color: TEAM_COLORS[team],
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    visionRing.rotation.x = -Math.PI / 2;
    visionRing.position.y = 0.02;
    visionRing.visible = false;
    visionRing.renderOrder = 3;
    root.add(visionRing);

    root.traverse((o) => {
      if (o.isMesh && o !== ring && o !== visionRing) {
        o.castShadow = true;
      }
    });

    const [wx, wz] = worldOf(this.env.agents[team][id].x, this.env.agents[team][id].z);
    root.position.set(wx, 0, wz);
    this.scene.add(root);

    const view = {
      team,
      id,
      root,
      body,
      legL,
      legR,
      armL,
      armR,
      spear,
      shield,
      ring,
      visionRing,
      health,
      rankPips,
      canvas,
      ctx: canvas.getContext('2d'),
      tex,
      pos: new THREE.Vector3(wx, 0, wz),
      facing: 0,
      walk: Math.random() * 10,
      attackT: 0,
      deadT: 0,
      deadHandled: false,
      lastHp: -1,
      lastEnergy: -1,
      lastMaxHp: -1,
      visible: true,
    };
    this._drawHealth(view, this.env.agents[team][id]);
    return view;
  }

  _drawHealth(view, agent) {
    const maxHp = agent.maxHp || MAX_HP;
    const hp = Math.max(0, Math.round(agent.hp));
    const energy = Math.max(0, Math.round(agent.energy));
    if (hp === view.lastHp && energy === view.lastEnergy && maxHp === view.lastMaxHp) return;
    view.lastHp = hp;
    view.lastEnergy = energy;
    view.lastMaxHp = maxHp;
    const ctx = view.ctx;
    const w = view.canvas.width;
    const h = view.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8, 11, 9, 0.72)';
    ctx.fillRect(2, 2, w - 4, 13);
    ctx.strokeStyle = 'rgba(232, 216, 180, 0.24)';
    ctx.lineWidth = 1;
    ctx.strokeRect(2.5, 2.5, w - 5, 12);
    const hpw = ((w - 8) * Math.min(1, hp / maxHp));
    const grd = ctx.createLinearGradient(4, 0, w - 4, 0);
    if (view.team === 0) {
      grd.addColorStop(0, '#2f6da8');
      grd.addColorStop(1, '#8dc8ff');
    } else {
      grd.addColorStop(0, '#a62f22');
      grd.addColorStop(1, '#ff947d');
    }
    ctx.fillStyle = grd;
    ctx.fillRect(4, 4, hpw, 9);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let i = 1; i < 5; i++) ctx.fillRect(4 + (i * (w - 8)) / 5, 4, 1, 9);

    ctx.fillStyle = 'rgba(8, 11, 9, 0.62)';
    ctx.fillRect(2, 18, w - 4, 7);
    const ew = ((w - 8) * energy) / 100;
    ctx.fillStyle = agent.starving ? '#e0ad3f' : '#d8c073';
    ctx.fillRect(4, 20, ew, 3);
    ctx.strokeStyle = 'rgba(232, 216, 180, 0.15)';
    ctx.strokeRect(2.5, 18.5, w - 5, 6);
    view.tex.needsUpdate = true;
  }

  _resetUnitViews() {
    for (const view of this.units) {
      const agent = this.env.agents[view.team][view.id];
      const [wx, wz] = worldOf(agent.x, agent.z);
      view.root.visible = true;
      view.body.rotation.set(0, 0, 0);
      view.body.position.set(0, 0, 0);
      view.legL.rotation.set(0, 0, 0);
      view.legR.rotation.set(0, 0, 0);
      view.armR.rotation.set(0, 0, 0);
      view.armL.rotation.set(0, 0, 0);
      view.health.visible = true;
      view.ring.visible = true;
      view.root.position.set(wx, 0, wz);
      view.pos.set(wx, 0, wz);
      view.deadT = 0;
      view.deadHandled = false;
      view.attackT = 0;
      view.lastHp = -1;
      view.lastEnergy = -1;
      view.lastMaxHp = -1;
      this._drawHealth(view, agent);
    }
  }

  _syncUnits(dt) {
    for (const view of this.units) {
      const agent = this.env.agents[view.team][view.id];
      const [tx, tz] = worldOf(agent.x, agent.z);
      const distToTarget = Math.hypot(tx - view.root.position.x, tz - view.root.position.z);

      if (!agent.alive) {
        if (!view.deadHandled) {
          view.deadHandled = true;
          view.deadT = 0;
          view.health.visible = false;
          view.ring.visible = false;
          view.visionRing.visible = false;
          for (const pip of view.rankPips) pip.visible = false;
        }
        view.deadT += dt;
        const fall = Math.min(1, view.deadT / 0.55);
        view.body.rotation.z = -1.48 * (fall * fall * (3 - 2 * fall));
        view.body.position.y = -0.22 * fall;
        view.root.position.y = -0.15 * Math.max(0, (view.deadT - 2.2) / 1.4);
        if (view.deadT > 3.4) view.root.visible = false;
        continue;
      }

      const forge = this.env.teamStats[view.team].forge;
      for (let i = 0; i < view.rankPips.length; i++) {
        view.rankPips[i].visible = i < forge;
      }

      const smooth = 1 - Math.exp(-14 * dt);
      view.root.position.x += (tx - view.root.position.x) * smooth;
      view.root.position.z += (tz - view.root.position.z) * smooth;
      view.root.position.y = 0;

      const desired = Math.atan2(agent.fx, agent.fz);
      let diff = desired - view.facing;
      diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      view.facing += diff * Math.min(1, dt * 11);
      view.root.rotation.y = view.facing;

      const moving = distToTarget > 0.02 && agent.action !== 0;
      view.walk += dt * (moving ? 11.5 : 2.1);
      const amp = moving ? 1 : 0.22;
      view.legL.rotation.x = Math.sin(view.walk) * 0.55 * amp;
      view.legR.rotation.x = -Math.sin(view.walk) * 0.55 * amp;
      view.armL.rotation.x = -Math.sin(view.walk) * 0.35 * amp;
      view.armR.rotation.x = Math.sin(view.walk) * 0.2 * amp;

      if (view.attackT > 0) {
        view.attackT -= dt;
        const t = 1 - Math.max(0, view.attackT) / 0.26;
        const swing = Math.sin(t * Math.PI);
        view.armR.rotation.x -= swing * 1.5;
        view.body.position.z = swing * 0.16;
        view.body.rotation.y = -swing * 0.28;
      } else {
        view.body.position.z *= 0.86;
        view.body.rotation.y *= 0.86;
        view.body.position.y =
          Math.sin(this.time * 1.9 + view.id * 1.7 + view.team) * 0.014;
        view.body.rotation.z = Math.sin(this.time * 1.3 + view.id) * 0.012;
      }

      if (agent.hp < 40 && agent.alive) {
        view.ring.material.opacity = 0.32 + Math.sin(this.time * 8) * 0.18;
      } else {
        view.ring.material.opacity = 0.36;
      }

      // Only surface the stat plate when something is worth reading: full
      // health legionaries would otherwise litter the battlefield with bars.
      const showBar = agent.hp < agent.maxHp - 0.5 || agent.energy < 60 || agent.starving;
      if (view.health.visible !== showBar) view.health.visible = showBar;
      this._drawHealth(view, agent);
    }
  }

  /* -------------------------------- events -------------------------------- */

  handleEvents(events) {
    if (!events || !events.length) return;
    for (const ev of events) {
      const [x, z] = worldOf(ev.x ?? 0, ev.z ?? 0);
      if (ev.type === 'gather') {
        const color = ev.kind === 'gold' ? '#ffd873' : ev.kind === 'food' ? '#b7e77e' : '#d3a06a';
        this.effects.burst(x, 0.6, z, color, 3, 0.7, 0.55, -1.5);
        if (Math.random() < 0.3) {
          this.effects.addLabel(x, 1.5, z, `+${RESOURCE_META[ev.kind].rate}`, color, 0.8);
        }
      } else if (ev.type === 'build') {
        const meta = STRUCTURE_META[ev.kind];
        this.effects.ring(x, z, meta.color, 2.4, 0.8);
        this.effects.burst(x, 0.8, z, meta.color, 18, 2.2, 1.0, -3);
        this.effects.addLabel(x, 2.6, z, meta.short, meta.color, 1.1);
      } else if (ev.type === 'bolt') {
        const [tx, tz] = worldOf(ev.tx ?? ev.x, ev.tz ?? ev.z);
        this.effects.beam(x, 3.15, z, tx, 1.1, tz, TEAM_COLORS[ev.team], 0.18);
        this.effects.burst(tx, 1.0, tz, '#ffd08a', 8, 1.6, 0.5, -3.5);
        this.effects.addLabel(tx, 1.9, tz, `-${Math.round(ev.dmg)}`, ev.team === 0 ? '#9fd0ff' : '#ff9b86', 0.9);
        this.effects.glow(tx, 1.0, tz, '#ffc37e', 1.3, 0.22);
      } else if (ev.type === 'forge') {
        const roman = ['', 'I', 'II', 'III', 'IV'][ev.level] || String(ev.level);
        this.effects.ring(x, z, '#f3c964', 4.6, 1.1);
        this.effects.burst(x, 1.4, z, '#ffd873', 28, 2.7, 1.2, -2.6);
        this.effects.glow(x, 1.6, z, '#ffd873', 4.2, 0.55);
        this.effects.addLabel(x, 3.4, z, `FORGE ${roman}`, '#ffe4a3', 1.3);
        for (const a of this.env.agents[ev.team]) {
          if (!a.alive) continue;
          const [ax, az] = worldOf(a.x, a.z);
          this.effects.burst(ax, 1.2, az, '#ffd873', 6, 1.1, 0.75, -2);
        }
      } else if (ev.type === 'campHeal') {
        this.effects.ring(x, z, '#a9e77c', 1.2, 0.55);
        this.effects.burst(x, 0.5, z, '#a9e77c', 4, 0.7, 0.5, -1);
      } else if (ev.type === 'regrow') {
        const color = ev.kind === 'food' ? '#b7e77e' : ev.kind === 'gold' ? '#ffd873' : '#d3a06a';
        this.effects.ring(x, z, color, 1.5, 0.7);
        this.effects.burst(x, 0.5, z, color, 7, 1.0, 0.7, -1.5);
      } else if (ev.type === 'hit') {
        this.effects.burst(x, 0.95, z, '#ffd08a', 7, 1.6, 0.45, -3.5);
        this.effects.addLabel(x, 1.9, z, `-${Math.round(ev.dmg)}`, ev.target === 0 ? '#ff9b86' : '#9fd0ff', 0.9);
        this.effects.glow(x, 1.0, z, '#ffc37e', 1.4, 0.22);
      } else if (ev.type === 'swing') {
        const [tx, tz] = worldOf(ev.tx ?? ev.x, ev.tz ?? ev.z);
        const angle = Math.atan2(tx - x, tz - z);
        this.effects.slash(x, z, angle, ev.team);
      } else if (ev.type === 'death') {
        this.effects.burst(x, 1.0, z, ev.starve ? '#e0ad3f' : TEAM_COLORS[ev.team], 22, 2.2, 1.1, -4);
        this.effects.ring(x, z, ev.starve ? '#e0ad3f' : TEAM_COLORS[ev.team], 0.8, 0.9);
        this.effects.glow(x, 1.2, z, ev.starve ? '#e0ad3f' : TEAM_COLORS[ev.team], 2.4, 0.4);
      } else if (ev.type === 'starve') {
        this.effects.burst(x, 1.0, z, '#e0ad3f', 8, 0.8, 0.8, -0.5);
        this.effects.addLabel(x, 1.85, z, 'STARVING', '#f0bf5b', 1.0);
      } else if (ev.type === 'eat') {
        this.effects.burst(x, 1.0, z, '#a9e77c', 3, 0.6, 0.5, -0.6);
      } else if (ev.type === 'depleted') {
        this.effects.ring(x, z, '#c7b58c', 0.6, 0.7);
        this.effects.burst(x, 0.5, z, '#b7a77f', 6, 1, 0.7, -2);
      } else if (ev.type === 'end' && ev.winner >= 0) {
        for (const a of this.env.agents[ev.winner]) {
          const [ax, az] = worldOf(a.x, a.z);
          this.effects.burst(ax, 1.2, az, TEAM_COLORS[ev.winner], 10, 1.5, 1.2, -2.5);
        }
      }
      if (this.onEvent) this.onEvent(ev);
    }
  }

  /* --------------------------------- loop --------------------------------- */

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  recenter() {
    this.cameraAnim = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: this.cameraDefault.pos.clone(),
      toTarget: this.cameraDefault.target.clone(),
    };
  }

  toggleTerritory(show) {
    this.territory.visible = show;
  }

  toggleVision(show) {
    for (const view of this.units) view.visionRing.visible = show && view.root.visible;
  }

  setVisionVisible(show) {
    this._visionOn = show;
  }

  update(dt) {
    this.time += dt;

    if (this.env.episodeId !== this.lastEpisode) {
      this.lastEpisode = this.env.episodeId;
      this._buildResourceGroup();
      this._resetUnitViews();
      this._updateTerritory(true);
      this.effects.clear();
      if (this._visionOn) this.toggleVision(true);
    }

    this._syncUnits(dt);
    this._syncStructures(dt);
    for (const view of this.resViews) this._updateResourceView(view, dt);
    this.effects.update(dt);

    this.terrTimer += dt;
    if (this.terrTimer > 0.22) {
      this.terrTimer = 0;
      this._updateTerritory();
    }

    if (this._visionOn) {
      for (const view of this.units) {
        view.visionRing.visible = view.root.visible && view.deadT === 0;
      }
    }

    // Banner cloth.
    for (const banner of this.banners) {
      const pos = banner.mesh.geometry.attributes.position;
      const arr = pos.array;
      const base = banner.base;
      for (let i = 0; i < pos.count; i++) {
        const i3 = i * 3;
        const x = base[i3];
        arr[i3 + 2] = Math.sin(x * 4.2 - this.time * 3.2 + banner.phase) * 0.075 * x;
      }
      pos.needsUpdate = true;
    }

    // Crystal, rune, fire, motes.
    this.crystal.rotation.y += dt * 0.5;
    this.crystal.position.y = 2.15 + Math.sin(this.time * 1.3) * 0.12;
    this.crystalHalo.position.y = this.crystal.position.y;
    this.crystalHalo.material.opacity = 0.62 + Math.sin(this.time * 2.1) * 0.15;
    this.crystalLight.intensity = 12 + Math.sin(this.time * 2.4) * 3.5;
    this.ruinRune.material.opacity = 0.28 + Math.sin(this.time * 0.9) * 0.12;
    for (const fire of this.baseFires) {
      const flicker = 0.82 + Math.sin(this.time * 9 + fire.phase) * 0.12 + Math.random() * 0.07;
      fire.flame.scale.set(1, flicker, 1);
      fire.flame2.scale.set(0.9 + Math.sin(this.time * 13) * 0.1, flicker * 1.1, 0.9);
      fire.light.intensity = 6.5 + flicker * 1.8;
    }
    this.motes.rotation.y += dt * 0.012;
    this.motes.position.y = Math.sin(this.time * 0.3) * 0.15;

    if (this.cameraAnim) {
      const anim = this.cameraAnim;
      anim.t = Math.min(1, anim.t + dt / 1.1);
      const e = anim.t * anim.t * (3 - 2 * anim.t);
      this.camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
      this.controls.target.lerpVectors(anim.fromTarget, anim.toTarget, e);
      if (anim.t >= 1) this.cameraAnim = null;
    }

    this.controls.update();
    this.composer.render();
  }

  get cameraHeight() {
    return this.camera.position.y;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
