import { RNG } from './rng.js';
import {
  WORLD,
  CELL,
  CELLS,
  AGENTS_PER_TEAM,
  TEAMS,
  DT,
  VISION,
  MOVE_SPEED,
  ATTACK_RANGE,
  HARVEST_RANGE,
  MAX_HP,
  MAX_ENERGY,
  ENERGY_DRAIN,
  EAT_THRESHOLD,
  EAT_COST,
  EAT_ENERGY,
  STARVE_HP_DRAIN,
  REGEN,
  ATTACK_DAMAGE,
  ATTACK_COOLDOWN,
  ACTIONS,
  ACTION_IDLE,
  ACTION_HARVEST,
  ACTION_ATTACK,
  ACTION_BUILD_TOWER,
  ACTION_BUILD_CAMP,
  RESOURCE_TYPES,
  RESOURCE_META,
  STRUCTURE_META,
  MAX_STRUCTURES_PER_TEAM,
  MAX_FORGE,
  FORGE_COST,
  FORGE_HP,
  FORGE_DAMAGE,
  PREDATORS,
  BEAR_HP,
  BEAR_REGEN,
  BEAR_REGEN_DELAY,
  BEAR_SPEED,
  BEAR_ATTACK_RANGE,
  BEAR_DAMAGE,
  BEAR_COOLDOWN,
  BEAR_WANDER,
  BEAR_RETURN,
  BEAR_BASE_CLEAR,
  BEAR_BAND,
  REWARD,
  OBS_DIM,
  OBS_SELF,
  OBS_RES_K,
  OBS_RES_F,
  OBS_ALLY_K,
  OBS_ALLY_F,
  OBS_ENEMY_K,
  OBS_ENEMY_F,
  OBS_BEAR_K,
  OBS_BEAR_F,
  OBS_TERR,
  OBS_BASE,
  OBS_ECON,
  OBS_ID,
  STATE_DIM,
  HULL_SCALE,
  DIRS,
} from './config.js';

const HALF = WORLD / 2;
const OBS = OBS_DIM;
const ST = STATE_DIM;
const ID_OFFSET = OBS - OBS_ID;
const RES_OFFSET = OBS_SELF;
const ALLY_OFFSET = RES_OFFSET + RESOURCE_TYPES.length * OBS_RES_K * OBS_RES_F;
const ENEMY_OFFSET = ALLY_OFFSET + OBS_ALLY_K * OBS_ALLY_F;
const BEAR_OFFSET = ENEMY_OFFSET + OBS_ENEMY_K * OBS_ENEMY_F;
const TERR_OFFSET = BEAR_OFFSET + OBS_BEAR_K * OBS_BEAR_F;
const BASE_OFFSET = TERR_OFFSET + OBS_TERR;
const ECON_OFFSET = ID_OFFSET - OBS_ECON;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Area of the convex hull of a set of points (Andrew's monotone chain, then the
// shoelace sum). Fewer than three surviving legionaries enclose nothing, and a
// squad that lines up or collapses to a point also measures zero.
function convexHullArea(points) {
  if (points.length < 3) return 0;
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, z1] = hull[i];
    const [x2, z2] = hull[(i + 1) % hull.length];
    area += x1 * z2 - x2 * z1;
  }
  return Math.abs(area) / 2;
}

function blankParts() {
  return { gather: 0, territory: 0, combat: 0, survival: 0, industry: 0 };
}

function newTeamStats() {
  return {
    stock: { food: 0, wood: 0, gold: 0 },
    gathered: { food: 0, wood: 0, gold: 0 },
    gatheredTotal: 0,
    kills: 0,
    deaths: 0,
    reward: 0,
    parts: blankParts(),
    forge: 0,
    builds: 0,
    forgeSpent: 0,
    generatedFood: 0,
    towerDamage: 0,
    bearDamage: 0,
    bearRepelled: 0,
    preyLost: 0,
  };
}

export class BattleEnv {
  constructor({ seed = 1, events = true, mapSize = WORLD } = {}) {
    this.seed = seed;
    this.eventsEnabled = events;
    this.mapSize = mapSize;
    this.episode = 0;
    this.time = 0;
    this.steps = 0;
    this.rng = new RNG(seed);
    this.bases = [
      { x: 5.5, z: 30.5 },
      { x: 30.5, z: 5.5 },
    ];
    this.agents = [[], []];
    this.resources = [];
    this.structures = [];
    this.predators = [];
    this.nextStructureId = 1;
    this.influence = [null, null];
    this.owner = null;
    this.territoryCount = [0, 0];
    this.episodeId = 0;
    this.reset(seed, true);
  }

  reset(seed = this.seed, first = false) {
    if (!first) {
      this.episodeId++;
      this.seed = (seed + 7919) >>> 0;
    }
    this.rng = new RNG(this.seed ^ (this.episodeId * 2654435761));
    this.time = 0;
    this.steps = 0;
    this.events = [];
    this.terminated = false;
    this.winner = -1;
    this.lastRewardParts = [blankParts(), blankParts()];
    this.teamStats = [newTeamStats(), newTeamStats()];
    this.structures = [];
    this.predators = [];
    this.nextStructureId = 1;
    this._generateMap(this.rng);
    this._spawnAgents(this.rng);
    this._spawnPredators(this.rng);
    this._initTerritory();
    this.obsCache = [null, null];
    this.stateCache = [null, null];
    return this;
  }

  _generateMap(rng) {
    const nodes = [];
    const baseClear = 7.2;
    const minBase = (x, z) => Math.min(
      Math.hypot(x - this.bases[0].x, z - this.bases[0].z),
      Math.hypot(x - this.bases[1].x, z - this.bases[1].z),
    );
    const valid = (x, z, minDist) => {
      if (x < 3.2 || x > WORLD - 3.2 || z < 3.2 || z > WORLD - 3.2) return false;
      if (minBase(x, z) < baseClear) return false;
      if (Math.hypot(x - HALF, z - HALF) < 4.1) return false;
      for (const n of nodes) {
        if (Math.hypot(x - n.x, z - n.z) < minDist) return false;
      }
      return true;
    };

    const placePair = (type, opts = {}) => {
      const minDist = opts.minDist ?? 2.15;
      for (let attempt = 0; attempt < 500; attempt++) {
        const relax = attempt > 260 ? 0.65 : 1;
        const x = rng.range(4.2, WORLD - 4.2);
        const z = rng.range(4.2, WORLD - 4.2);
        const mx = WORLD - x;
        const mz = WORLD - z;
        const dc = Math.hypot(x - HALF, z - HALF);
        if (opts.centerBand && (dc < opts.centerBand[0] || dc > opts.centerBand[1])) continue;
        if (!opts.centerBand && dc < 5.5) continue;
        if (minBase(x, z) < 8.2) continue;
        if (!valid(x, z, minDist * relax)) continue;
        let clash = false;
        for (const n of nodes) {
          if (Math.hypot(mx - n.x, mz - n.z) < minDist * relax) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
        const meta = RESOURCE_META[type];
        nodes.push({
          id: nodes.length,
          type,
          x,
          z,
          amount: meta.max,
          max: meta.max,
          alive: true,
          regrow: 0,
        });
        nodes.push({
          id: nodes.length,
          type,
          x: mx,
          z: mz,
          amount: meta.max,
          max: meta.max,
          alive: true,
          regrow: 0,
        });
        return true;
      }
      return false;
    };

    for (let i = 0; i < 5; i++) placePair('gold', { centerBand: [5.2, 13.5], minDist: 2.4 });
    for (let i = 0; i < 6; i++) placePair('food', { minDist: 2.3 });
    for (let i = 0; i < 13; i++) placePair('wood', { minDist: 1.95 });

    this.resources = nodes;
  }

  _spawnAgents(rng) {
    this.agents = [[], []];
    const center = { x: HALF, z: HALF };
    for (let team = 0; team < TEAMS; team++) {
      const base = this.bases[team];
      const centerAngle = Math.atan2(center.z - base.z, center.x - base.x);
      for (let i = 0; i < AGENTS_PER_TEAM; i++) {
        const offset = (i / (AGENTS_PER_TEAM - 1) - 0.5) * 2.25;
        const angle = centerAngle + offset + rng.range(-0.04, 0.04);
        const radius = 2.5 + (i % 2) * 0.55 + rng.range(-0.1, 0.1);
        this.agents[team].push({
          id: i,
          team,
          x: clamp(base.x + Math.cos(angle) * radius, 1, WORLD - 1),
          z: clamp(base.z + Math.sin(angle) * radius, 1, WORLD - 1),
          hp: MAX_HP,
          maxHp: MAX_HP,
          energy: MAX_ENERGY,
          alive: true,
          cooldown: 0,
          starving: false,
          starveTime: 0,
          kills: 0,
          damage: 0,
          gathered: { food: 0, wood: 0, gold: 0 },
          action: ACTION_IDLE,
          fx: Math.cos(angle),
          fz: Math.sin(angle),
          fxTimer: rng.range(0, 0.4),
          lastHit: 0,
          deathType: null,
          deathTime: 0,
        });
      }
    }
  }

  _distToBases(x, z) {
    return Math.min(
      Math.hypot(x - this.bases[0].x, z - this.bases[0].z),
      Math.hypot(x - this.bases[1].x, z - this.bases[1].z),
    );
  }

  /* ---------------- predators (neutral NPCs) ---------------- */

  // A roaming point inside the band around the central ruin, clear of both
  // keeps and of the other bears.
  _bearRoamPoint(rng, avoid = []) {
    for (let attempt = 0; attempt < 240; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const radius = rng.range(BEAR_BAND[0], BEAR_BAND[1]);
      const x = clamp(HALF + Math.cos(angle) * radius, 2.6, WORLD - 2.6);
      const z = clamp(HALF + Math.sin(angle) * radius, 2.6, WORLD - 2.6);
      if (this._distToBases(x, z) < BEAR_BASE_CLEAR) continue;
      let clash = false;
      for (const b of avoid) {
        if (Math.hypot(b.x - x, b.z - z) < 5.2) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      return { x, z };
    }
    return { x: HALF + 6.5, z: HALF - 6.5 };
  }

  _spawnPredators(rng) {
    this.predators = [];
    for (let i = 0; i < PREDATORS; i++) {
      const start = this._bearRoamPoint(rng, this.predators);
      this.predators.push({
        id: i,
        x: start.x,
        z: start.z,
        hp: BEAR_HP,
        maxHp: BEAR_HP,
        alive: true,
        cooldown: 0,
        fx: 0,
        fz: 1,
        walk: rng.range(0, Math.PI * 2),
        moving: 0,
        maulTimer: 0,
        hunting: false,
        lastHit: 0,
        regrow: 0,
        wanderTarget: this._bearRoamPoint(rng, [...this.predators, start]),
        wanderTimer: rng.range(0, BEAR_WANDER),
      });
    }
  }

  _nearestPrey(bear) {
    let best = null;
    let bestD = VISION * VISION;
    for (let team = 0; team < TEAMS; team++) {
      for (const a of this.agents[team]) {
        if (!a.alive) continue;
        const dx = a.x - bear.x;
        const dz = a.z - bear.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = a;
        }
      }
    }
    return best;
  }

  _nearestBear(agent, range = VISION) {
    let best = null;
    let bestD = range * range;
    for (const b of this.predators) {
      if (!b.alive) continue;
      const dx = b.x - agent.x;
      const dz = b.z - agent.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = b;
      }
    }
    return best;
  }

  // Whatever the warband can swing at: an enemy legionary or a bear. Both are
  // legal attack targets, and whichever is nearer inside vision wins.
  _nearestThreat(agent) {
    const enemy = this._nearestEnemy(agent);
    const bear = this._nearestBear(agent);
    if (!enemy && !bear) return null;
    if (!bear) return { kind: 'agent', target: enemy };
    if (!enemy) return { kind: 'bear', target: bear };
    const ed = (enemy.x - agent.x) ** 2 + (enemy.z - agent.z) ** 2;
    const bd = (bear.x - agent.x) ** 2 + (bear.z - agent.z) ** 2;
    return bd < ed ? { kind: 'bear', target: bear } : { kind: 'agent', target: enemy };
  }

  _moveBear(bear, dx, dz, mult = 1) {
    const nx = bear.x + dx * BEAR_SPEED * mult * DT;
    const nz = bear.z + dz * BEAR_SPEED * mult * DT;
    // Bears prowle at the edge of the keeps; they never camp a spawn stack.
    if (this._distToBases(nx, nz) < BEAR_BASE_CLEAR) {
      bear.moving = 0;
      return;
    }
    bear.x = clamp(nx, 0.8, WORLD - 0.8);
    bear.z = clamp(nz, 0.8, WORLD - 0.8);
    bear.fx = dx;
    bear.fz = dz;
    bear.walk += DT * 3.6 * mult;
    bear.moving = mult;
  }

  _maul(agent, dmg, acc, bear) {
    agent.hp -= dmg;
    agent.lastHit = this.time;
    this._emit({
      type: 'maul',
      id: bear.id,
      x: bear.x,
      z: bear.z,
      tx: agent.x,
      tz: agent.z,
      target: agent.team,
      dmg,
    });
    if (agent.hp <= 0) this._killAgent(agent, null, acc, -1, 'predator');
  }

  // Legionaries and watchtowers can answer a bear. Bringing it to 0 HP drives
  // it off the field for BEAR_RETURN seconds rather than killing it, so the
  // hazard stays live and cannot be farmed for reward.
  _damageBear(bear, dmg, team, acc) {
    if (!bear.alive) return;
    bear.hp -= dmg;
    bear.lastHit = this.time;
    acc.bearDamage[team] += dmg;
    this.teamStats[team].bearDamage += dmg;
    this._emit({ type: 'bearHit', id: bear.id, x: bear.x, z: bear.z, team, dmg });
    if (bear.hp <= 0) {
      bear.hp = 0;
      bear.alive = false;
      bear.regrow = BEAR_RETURN;
      bear.moving = 0;
      bear.hunting = false;
      this.teamStats[team].bearRepelled += 1;
      acc.bearRepelled[team] += 1;
      this._emit({ type: 'bearRepelled', id: bear.id, team, x: bear.x, z: bear.z });
    }
  }

  _updatePredators(acc) {
    const living = (b) => b.alive && b !== undefined;
    for (const b of this.predators) {
      if (!b.alive) {
        b.regrow -= DT;
        if (b.regrow > 0) continue;
        b.regrow = 0;
        b.hp = b.maxHp;
        b.cooldown = 0;
        b.maulTimer = 0;
        b.alive = true;
        const others = this.predators.filter((p) => p !== b && living(p));
        const point = this._bearRoamPoint(this.rng, others);
        b.x = point.x;
        b.z = point.z;
        b.wanderTarget = this._bearRoamPoint(this.rng, [...others, point]);
        b.wanderTimer = BEAR_WANDER;
        this._emit({ type: 'bearReturn', id: b.id, x: b.x, z: b.z });
        continue;
      }

      b.cooldown = Math.max(0, b.cooldown - DT);
      b.maulTimer = Math.max(0, b.maulTimer - DT);

      const prey = this._nearestPrey(b);
      if (prey) {
        b.hunting = true;
        const dx = prey.x - b.x;
        const dz = prey.z - b.z;
        const dist = Math.hypot(dx, dz) || 1;
        b.fx = dx / dist;
        b.fz = dz / dist;
        b.wanderTimer = BEAR_WANDER;
        if (dist <= BEAR_ATTACK_RANGE) {
          b.moving = 0;
          if (b.cooldown <= 0) {
            b.cooldown = BEAR_COOLDOWN;
            b.maulTimer = 0.45;
            this._maul(prey, BEAR_DAMAGE, acc, b);
          }
        } else {
          this._moveBear(b, dx / dist, dz / dist);
        }
      } else {
        b.hunting = false;
        b.wanderTimer -= DT;
        const t = b.wanderTarget;
        const dx = t.x - b.x;
        const dz = t.z - b.z;
        const dist = Math.hypot(dx, dz);
        if (b.wanderTimer <= 0 || dist < 1.1) {
          b.wanderTarget = this._bearRoamPoint(this.rng, this.predators.filter((p) => p !== b && living(p)));
          b.wanderTimer = BEAR_WANDER;
          b.moving = 0;
        } else if (dist > 0.001) {
          this._moveBear(b, dx / dist, dz / dist, 0.8);
        } else {
          b.moving = 0;
        }
      }

      if (b.hp < b.maxHp && this.time - b.lastHit > BEAR_REGEN_DELAY) {
        b.hp = Math.min(b.maxHp, b.hp + BEAR_REGEN * DT);
      }
    }
  }

  _initTerritory() {
    const n = CELLS * CELLS;
    this.influence = [new Float32Array(n), new Float32Array(n)];
    this.owner = new Int8Array(n).fill(-1);
    this.territoryCount = [0, 0];
    const radius = 5.1;
    for (let team = 0; team < TEAMS; team++) {
      const base = this.bases[team];
      for (let cz = 0; cz < CELLS; cz++) {
        for (let cx = 0; cx < CELLS; cx++) {
          const x = (cx + 0.5) * CELL;
          const z = (cz + 0.5) * CELL;
          if (Math.hypot(x - base.x, z - base.z) <= radius) {
            const idx = cz * CELLS + cx;
            this.influence[team][idx] = 3.2;
            if (this.owner[idx] === -1) {
              this.owner[idx] = team;
              this.territoryCount[team]++;
            }
          }
        }
      }
    }
  }

  _emit(ev) {
    if (!this.eventsEnabled) return;
    ev.time = this.time;
    this.events.push(ev);
  }

  _nearestEnemy(agent) {
    let best = null;
    let bestD = VISION * VISION;
    const enemies = this.agents[1 - agent.team];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dx = e.x - agent.x;
      const dz = e.z - agent.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
    return best;
  }

  _nearestResource(agent) {
    let best = null;
    let bestD = VISION * VISION;
    for (let i = 0; i < this.resources.length; i++) {
      const r = this.resources[i];
      if (!r.alive) continue;
      const dx = r.x - agent.x;
      const dz = r.z - agent.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = r;
      }
    }
    return best;
  }

  _stepAgent(agent, action, acc, teamStep) {
    if (!agent.alive) return;
    agent.action = action;
    agent.fxTimer = Math.max(0, agent.fxTimer - DT);
    agent.cooldown = Math.max(0, agent.cooldown - DT);

    if (action >= 1 && action <= 8) {
      const [dx, dz] = DIRS[action - 1];
      this._move(agent, dx, dz);
    } else if (action === ACTION_HARVEST) {
      const target = this._nearestResource(agent);
      if (target) {
        const dx = target.x - agent.x;
        const dz = target.z - agent.z;
        const dist = Math.hypot(dx, dz) || 1;
        agent.fx = dx / dist;
        agent.fz = dz / dist;
        if (dist <= HARVEST_RANGE) {
          const meta = RESOURCE_META[target.type];
          const gain = Math.min(target.amount, meta.rate * DT);
          if (gain > 0) {
            target.amount -= gain;
            const stats = this.teamStats[agent.team];
            stats.stock[target.type] += gain;
            stats.gathered[target.type] += gain;
            stats.gatheredTotal += gain;
            agent.gathered[target.type] += gain;
            acc.gathered[agent.team][target.type] += gain;
            if (agent.fxTimer <= 0) {
              this._emit({
                type: 'gather',
                kind: target.type,
                team: agent.team,
                x: target.x,
                z: target.z,
                amount: meta.rate,
              });
              agent.fxTimer = 0.36;
            }
          }
          if (target.amount <= 0.001 && target.alive) {
            target.amount = 0;
            target.alive = false;
            target.regrow = meta.regrow;
            this._emit({ type: 'depleted', kind: target.type, x: target.x, z: target.z });
          }
        } else {
          this._move(agent, dx / dist, dz / dist, 0.94);
        }
      }
    } else if (action === ACTION_ATTACK) {
      const threat = this._nearestThreat(agent);
      if (threat) {
        const dx = threat.target.x - agent.x;
        const dz = threat.target.z - agent.z;
        const dist = Math.hypot(dx, dz) || 1;
        agent.fx = dx / dist;
        agent.fz = dz / dist;
        if (dist <= ATTACK_RANGE) {
          if (agent.cooldown <= 0) {
            agent.cooldown = ATTACK_COOLDOWN;
            const power = agent.energy <= 0 ? 0.55 : 1;
            const forge = this.teamStats[agent.team].forge;
            const dmg = (ATTACK_DAMAGE + FORGE_DAMAGE[forge]) * power;
            this._emit({
              type: 'swing',
              x: agent.x,
              z: agent.z,
              tx: threat.target.x,
              tz: threat.target.z,
              team: agent.team,
            });
            if (threat.kind === 'bear') this._damageBear(threat.target, dmg, agent.team, acc);
            else this._damageAgent(threat.target, dmg, agent.team, acc, agent, true);
          }
        } else {
          this._move(agent, dx / dist, dz / dist);
        }
      }
    } else if (action === ACTION_BUILD_TOWER) {
      this._buildStructure(agent, 'tower', acc);
    } else if (action === ACTION_BUILD_CAMP) {
      this._buildStructure(agent, 'camp', acc);
    }
  }

  _structureCount(team, type = null) {
    let count = 0;
    for (const s of this.structures) {
      if (s.team !== team) continue;
      if (type && s.type !== type) continue;
      count++;
    }
    return count;
  }

  _canBuild(agent, type) {
    const meta = STRUCTURE_META[type];
    const stats = this.teamStats[agent.team];
    if (stats.stock.wood < meta.cost) return false;
    if (this._structureCount(agent.team, type) >= meta.max) return false;
    if (agent.x < 1.6 || agent.x > WORLD - 1.6 || agent.z < 1.6 || agent.z > WORLD - 1.6) {
      return false;
    }
    // Keep structures out of the fortress footprints.
    for (let team = 0; team < TEAMS; team++) {
      const base = this.bases[team];
      if (Math.hypot(agent.x - base.x, agent.z - base.z) < 4.2) return false;
    }
    for (const s of this.structures) {
      if (Math.hypot(s.x - agent.x, s.z - agent.z) < meta.spacing) return false;
    }
    for (const r of this.resources) {
      if (Math.hypot(r.x - agent.x, r.z - agent.z) < 1.4) return false;
    }
    return true;
  }

  _buildStructure(agent, type, acc) {
    if (!this._canBuild(agent, type)) return;
    const meta = STRUCTURE_META[type];
    const stats = this.teamStats[agent.team];
    stats.stock.wood -= meta.cost;
    stats.builds += 1;
    acc.builds[agent.team] += 1;
    const structure = {
      id: this.nextStructureId++,
      team: agent.team,
      type,
      x: agent.x,
      z: agent.z,
      cooldown: 0.7,
      pulseTimer: 0,
      born: this.time,
    };
    this.structures.push(structure);
    this._emit({
      type: 'build',
      kind: type,
      team: agent.team,
      x: agent.x,
      z: agent.z,
    });
  }

  _damageAgent(target, dmg, team, acc, attacker = null, emitHit = true) {
    if (!target.alive) return;
    target.hp -= dmg;
    target.lastHit = this.time;
    if (attacker) attacker.damage += dmg;
    acc.damage[team] += dmg;
    if (emitHit) {
      this._emit({
        type: 'hit',
        x: target.x,
        z: target.z,
        team,
        target: target.team,
        dmg,
      });
    }
    if (target.hp <= 0) this._killAgent(target, attacker, acc, team);
  }

  _move(agent, dx, dz, mult = 1) {
    agent.x = clamp(agent.x + dx * MOVE_SPEED * mult * DT, 0.6, WORLD - 0.6);
    agent.z = clamp(agent.z + dz * MOVE_SPEED * mult * DT, 0.6, WORLD - 0.6);
    agent.fx = dx;
    agent.fz = dz;
  }

  _killAgent(target, killer, acc, killerTeam = killer ? killer.team : -1, deathType = 'combat') {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.deathTime = this.time;
    target.deathType = deathType;
    target.action = ACTION_IDLE;
    const targetTeam = this.teamStats[target.team];
    targetTeam.deaths += 1;
    acc.deaths[target.team] += 1;
    if (deathType === 'predator') targetTeam.preyLost += 1;
    if (killer && killer.alive) killer.kills += 1;
    if (killerTeam >= 0) {
      this.teamStats[killerTeam].kills += 1;
      acc.kills[killerTeam] += 1;
    }
    this._emit({
      type: 'death',
      x: target.x,
      z: target.z,
      team: target.team,
      killer: killerTeam,
      predator: deathType === 'predator',
    });
  }

  _applyUpkeep(acc) {
    for (let team = 0; team < TEAMS; team++) {
      const stats = this.teamStats[team];
      for (const a of this.agents[team]) {
        if (!a.alive) continue;
        a.energy -= ENERGY_DRAIN * DT;

        if (a.energy <= EAT_THRESHOLD && stats.stock.food >= EAT_COST && a.energy < MAX_ENERGY) {
          stats.stock.food -= EAT_COST;
          a.energy = Math.min(MAX_ENERGY, a.energy + EAT_ENERGY);
          a.starving = false;
          this._emit({ type: 'eat', x: a.x, z: a.z, team });
        }

        if (a.energy <= 0) {
          a.energy = 0;
          if (!a.starving) {
            a.starving = true;
            this._emit({ type: 'starve', x: a.x, z: a.z, team });
          }
          a.starveTime += DT;
          a.hp -= STARVE_HP_DRAIN * DT;
        } else {
          a.starving = false;
          if (a.hp < a.maxHp && a.energy > 55) {
            a.hp = Math.min(a.maxHp, a.hp + REGEN * DT);
          }
        }

        if (a.hp <= 0) {
          a.hp = 0;
          a.alive = false;
          a.deathTime = this.time;
          a.deathType = 'starve';
          stats.deaths += 1;
          acc.starveDeaths[team] += 1;
          this._emit({ type: 'death', x: a.x, z: a.z, team, killer: -1, starve: true });
        }
        if (a.starving && a.alive) acc.starving[team] += 1;
      }
    }
  }

  _autoForge(acc) {
    for (let team = 0; team < TEAMS; team++) {
      const stats = this.teamStats[team];
      while (stats.forge < MAX_FORGE && stats.stock.gold >= FORGE_COST[stats.forge]) {
        const cost = FORGE_COST[stats.forge];
        stats.stock.gold -= cost;
        stats.forge += 1;
        stats.forgeSpent += cost;
        acc.forged[team] += 1;
        const hpGain = FORGE_HP[stats.forge] - FORGE_HP[stats.forge - 1];
        for (const a of this.agents[team]) {
          a.maxHp = MAX_HP + FORGE_HP[stats.forge];
          if (a.alive) a.hp = Math.min(a.maxHp, a.hp + hpGain);
        }
        const base = this.bases[team];
        this._emit({
          type: 'forge',
          team,
          level: stats.forge,
          x: base.x,
          z: base.z,
        });
      }
    }
  }

  _updateStructures(acc) {
    for (const s of this.structures) {
      const meta = STRUCTURE_META[s.type];
      const stats = this.teamStats[s.team];
      if (s.type === 'tower') {
        s.cooldown = Math.max(0, s.cooldown - DT);
        if (s.cooldown > 0) continue;
        let target = null;
        let targetIsBear = false;
        let bestD = meta.range * meta.range;
        for (const e of this.agents[1 - s.team]) {
          if (!e.alive) continue;
          const dx = e.x - s.x;
          const dz = e.z - s.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) {
            bestD = d2;
            target = e;
            targetIsBear = false;
          }
        }
        // A bear prowling the watchtower's range is an intruder too.
        for (const b of this.predators) {
          if (!b.alive) continue;
          const dx = b.x - s.x;
          const dz = b.z - s.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) {
            bestD = d2;
            target = b;
            targetIsBear = true;
          }
        }
        if (target) {
          s.cooldown = meta.cooldown;
          const dmg = meta.damage;
          stats.towerDamage += dmg;
          this._emit({
            type: 'bolt',
            team: s.team,
            x: s.x,
            z: s.z,
            tx: target.x,
            tz: target.z,
            dmg,
            target: targetIsBear ? -1 : target.team,
          });
          if (targetIsBear) this._damageBear(target, dmg, s.team, acc);
          else this._damageAgent(target, dmg, s.team, acc, null, false);
        }
      } else {
        const gain = meta.food * DT;
        stats.stock.food += gain;
        stats.generatedFood += gain;
        acc.campFood[s.team] += gain;
        let healed = false;
        const r2 = meta.radius * meta.radius;
        for (const a of this.agents[s.team]) {
          if (!a.alive || a.hp >= a.maxHp) continue;
          const dx = a.x - s.x;
          const dz = a.z - s.z;
          if (dx * dx + dz * dz > r2) continue;
          a.hp = Math.min(a.maxHp, a.hp + meta.heal * DT);
          healed = true;
        }
        s.pulseTimer = Math.max(0, s.pulseTimer - DT);
        if (healed && s.pulseTimer <= 0) {
          s.pulseTimer = 2.4;
          this._emit({ type: 'campHeal', team: s.team, x: s.x, z: s.z });
        }
      }
    }
  }

  _regrowResources() {
    for (const r of this.resources) {
      if (r.alive) continue;
      if (r.regrow > 0) r.regrow -= DT;
      if (r.regrow > 0) continue;
      const meta = RESOURCE_META[r.type];
      r.alive = true;
      r.amount = meta.max * meta.respawn;
      r.regrow = 0;
      this._emit({ type: 'regrow', kind: r.type, x: r.x, z: r.z });
    }
  }

  _claimTerritory() {
    const radius = 2.8;
    const r2 = radius * radius;
    const claim = 1.55 * DT;
    for (let team = 0; team < TEAMS; team++) {
      const infl = this.influence[team];
      for (const a of this.agents[team]) {
        if (!a.alive) continue;
        const cx0 = Math.max(0, Math.floor((a.x - radius) / CELL));
        const cx1 = Math.min(CELLS - 1, Math.floor((a.x + radius) / CELL));
        const cz0 = Math.max(0, Math.floor((a.z - radius) / CELL));
        const cz1 = Math.min(CELLS - 1, Math.floor((a.z + radius) / CELL));
        for (let cz = cz0; cz <= cz1; cz++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const x = (cx + 0.5) * CELL;
            const z = (cz + 0.5) * CELL;
            const dx = x - a.x;
            const dz = z - a.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > r2) continue;
            const falloff = 1 - Math.sqrt(d2) / radius;
            infl[cz * CELLS + cx] += claim * (0.35 + falloff * 0.65);
          }
        }
      }
    }
    for (const s of this.structures) {
      const meta = STRUCTURE_META[s.type];
      const radius = meta.influence;
      const r2 = radius * radius;
      const claim = meta.influenceRate * DT;
      const infl = this.influence[s.team];
      const cx0 = Math.max(0, Math.floor((s.x - radius) / CELL));
      const cx1 = Math.min(CELLS - 1, Math.floor((s.x + radius) / CELL));
      const cz0 = Math.max(0, Math.floor((s.z - radius) / CELL));
      const cz1 = Math.min(CELLS - 1, Math.floor((s.z + radius) / CELL));
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const x = (cx + 0.5) * CELL;
          const z = (cz + 0.5) * CELL;
          const dx = x - s.x;
          const dz = z - s.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2) continue;
          const falloff = 1 - Math.sqrt(d2) / radius;
          infl[cz * CELLS + cx] += claim * (0.4 + falloff * 0.6);
        }
      }
    }
    const decay = Math.exp(-0.105 * DT);
    for (let c = 0; c < this.influence[0].length; c++) {
      this.influence[0][c] *= decay;
      this.influence[1][c] *= decay;
    }
  }

  _updateOwnership(prevCounts) {
    const inf0 = this.influence[0];
    const inf1 = this.influence[1];
    const counts = [0, 0];
    for (let c = 0; c < this.owner.length; c++) {
      const a = inf0[c];
      const b = inf1[c];
      let next = this.owner[c];
      if (a < 0.28 && b < 0.28) next = -1;
      else if (a > b + 0.42) next = 0;
      else if (b > a + 0.42) next = 1;
      if (next >= 0) counts[next]++;
      if (next !== this.owner[c]) {
        this.owner[c] = next;
      }
    }
    this.territoryCount = counts;
    return [counts[0] - prevCounts[0], counts[1] - prevCounts[1]];
  }

  _rewardForTeam(team, deltaTiles, acc, terminal) {
    const stats = this.teamStats[team];
    const W = REWARD;
    const g = acc.gathered[team];
    const gather =
      g.food * W.food + g.wood * W.wood + g.gold * W.gold;
    const territory =
      deltaTiles[team] * W.territoryCapture +
      this.territoryCount[team] * W.territoryHold * DT;
    const alive = this.agents[team].reduce((n, a) => n + (a.alive ? 1 : 0), 0);
    const combat =
      acc.damage[team] * W.damage +
      acc.kills[team] * W.kill +
      acc.deaths[team] * W.death +
      acc.bearDamage[team] * W.bearDamage +
      acc.bearRepelled[team] * W.bearRepel;
    const survival =
      alive * W.survival * DT -
      acc.starving[team] * W.starving * DT +
      acc.starveDeaths[team] * W.starveDeath;
    const industry =
      acc.builds[team] * W.build +
      acc.forged[team] * W.forge +
      acc.campFood[team] * W.campFood;
    let total = gather + territory + combat + survival + industry;

    let verdict = 0;
    if (terminal) {
      if (this.winner === team) verdict = W.victory;
      else if (this.winner >= 0) verdict = W.defeat;
      total += verdict;
    }

    stats.reward += total;
    stats.parts.gather += gather;
    stats.parts.territory += territory;
    stats.parts.combat += combat + verdict;
    stats.parts.survival += survival;
    stats.parts.industry += industry;
    return {
      total,
      parts: { gather, territory, combat: combat + verdict, survival, industry },
    };
  }

  step(actions) {
    this.events = [];
    this.time += DT;
    this.steps += 1;

    const acc = {
      gathered: [
        { food: 0, wood: 0, gold: 0 },
        { food: 0, wood: 0, gold: 0 },
      ],
      damage: [0, 0],
      kills: [0, 0],
      deaths: [0, 0],
      starveDeaths: [0, 0],
      starving: [0, 0],
      builds: [0, 0],
      forged: [0, 0],
      campFood: [0, 0],
      bearDamage: [0, 0],
      bearRepelled: [0, 0],
    };

    for (let team = 0; team < TEAMS; team++) {
      const list = this.agents[team];
      const acts = actions[team] || [];
      for (let i = 0; i < list.length; i++) {
        if (list[i].alive) this._stepAgent(list[i], acts[i] ?? ACTION_IDLE, acc, team);
      }
    }

    this._updatePredators(acc);
    this._autoForge(acc);
    this._applyUpkeep(acc);
    this._updateStructures(acc);
    this._regrowResources();

    const prevCounts = [this.territoryCount[0], this.territoryCount[1]];
    this._claimTerritory();
    const deltaTiles = this._updateOwnership(prevCounts);

    const alive = [
      this.agents[0].reduce((n, a) => n + (a.alive ? 1 : 0), 0),
      this.agents[1].reduce((n, a) => n + (a.alive ? 1 : 0), 0),
    ];
    this.terminated = alive[0] === 0 || alive[1] === 0;
    if (this.terminated) {
      this.winner = alive[0] > 0 ? 0 : alive[1] > 0 ? 1 : -1;
      this._emit({ type: 'end', winner: this.winner });
    }

    const rewarded = [null, null];
    for (let team = 0; team < TEAMS; team++) {
      rewarded[team] = this._rewardForTeam(team, deltaTiles, acc, this.terminated);
    }
    this.lastRewardParts = [rewarded[0].parts, rewarded[1].parts];

    return {
      rewards: [rewarded[0].total, rewarded[1].total],
      rewardParts: this.lastRewardParts,
      terminated: this.terminated,
      winner: this.winner,
      alive,
      events: this.events,
    };
  }

  aliveCounts() {
    return [
      this.agents[0].reduce((n, a) => n + (a.alive ? 1 : 0), 0),
      this.agents[1].reduce((n, a) => n + (a.alive ? 1 : 0), 0),
    ];
  }

  // How much ground a faction actually occupies: the convex hull of its living
  // legionaries, in square field units. Near zero means the squad is huddled or
  // strung along a line; a few hundred means it has broken into solo bands.
  _formationArea(team) {
    const pts = [];
    for (const a of this.agents[team]) if (a.alive) pts.push([a.x, a.z]);
    return convexHullArea(pts);
  }

  /* ---------------- observations (local, fog-limited) ---------------- */

  getObs(team) {
    const out = new Float32Array(AGENTS_PER_TEAM * OBS);
    const allies = this.agents[team];
    const enemies = this.agents[1 - team];
    const base = this.bases[team];
    const invV = 1 / VISION;

    for (let i = 0; i < AGENTS_PER_TEAM; i++) {
      const a = allies[i];
      const o = i * OBS;
      if (!a.alive) continue;

      out[o] = a.hp / a.maxHp;
      out[o + 1] = a.energy / MAX_ENERGY;
      out[o + 2] = (a.x / WORLD) * 2 - 1;
      out[o + 3] = (a.z / WORLD) * 2 - 1;
      out[o + 4] = a.starving ? 1 : 0;
      out[o + 5] = 1;

      let ro = o + RES_OFFSET;
      for (let t = 0; t < RESOURCE_TYPES.length; t++) {
        const type = RESOURCE_TYPES[t];
        const best = [null, null, null];
        const bestD = [Infinity, Infinity, Infinity];
        for (const r of this.resources) {
          if (!r.alive || r.type !== type) continue;
          const dx = r.x - a.x;
          const dz = r.z - a.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > VISION * VISION) continue;
          if (d2 < bestD[2]) {
            if (d2 < bestD[0]) {
              bestD[2] = bestD[1]; best[2] = best[1];
              bestD[1] = bestD[0]; best[1] = best[0];
              bestD[0] = d2; best[0] = r;
            } else if (d2 < bestD[1]) {
              bestD[2] = bestD[1]; best[2] = best[1];
              bestD[1] = d2; best[1] = r;
            } else {
              bestD[2] = d2; best[2] = r;
            }
          }
        }
        for (let k = 0; k < OBS_RES_K; k++) {
          const r = best[k];
          if (r) {
            out[ro++] = clamp((r.x - a.x) * invV, -1.5, 1.5);
            out[ro++] = clamp((r.z - a.z) * invV, -1.5, 1.5);
            out[ro++] = Math.sqrt(bestD[k]) * invV;
            out[ro++] = r.amount / r.max;
            out[ro++] = 1;
          } else {
            ro += 5;
          }
        }
      }

      let ao = o + ALLY_OFFSET;
      const allyBest = [null, null, null, null];
      const allyD = [Infinity, Infinity, Infinity, Infinity];
      for (const m of allies) {
        if (m === a || !m.alive) continue;
        const dx = m.x - a.x;
        const dz = m.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > VISION * VISION) continue;
        for (let k = 0; k < OBS_ALLY_K; k++) {
          if (d2 < allyD[k]) {
            for (let j = OBS_ALLY_K - 1; j > k; j--) {
              allyD[j] = allyD[j - 1];
              allyBest[j] = allyBest[j - 1];
            }
            allyD[k] = d2;
            allyBest[k] = m;
            break;
          }
        }
      }
      for (let k = 0; k < OBS_ALLY_K; k++) {
        const m = allyBest[k];
        if (m) {
          out[ao++] = (m.x - a.x) * invV;
          out[ao++] = (m.z - a.z) * invV;
          out[ao++] = Math.sqrt(allyD[k]) * invV;
          out[ao++] = m.hp / MAX_HP;
        } else {
          ao += 4;
        }
      }

      let eo = o + ENEMY_OFFSET;
      const eBest = [null, null, null, null, null];
      const eD = [Infinity, Infinity, Infinity, Infinity, Infinity];
      for (const m of enemies) {
        if (!m.alive) continue;
        const dx = m.x - a.x;
        const dz = m.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > VISION * VISION) continue;
        for (let k = 0; k < OBS_ENEMY_K; k++) {
          if (d2 < eD[k]) {
            for (let j = OBS_ENEMY_K - 1; j > k; j--) {
              eD[j] = eD[j - 1];
              eBest[j] = eBest[j - 1];
            }
            eD[k] = d2;
            eBest[k] = m;
            break;
          }
        }
      }
      for (let k = 0; k < OBS_ENEMY_K; k++) {
        const m = eBest[k];
        if (m) {
          out[eo++] = (m.x - a.x) * invV;
          out[eo++] = (m.z - a.z) * invV;
          out[eo++] = Math.sqrt(eD[k]) * invV;
          out[eo++] = m.hp / m.maxHp;
          out[eo++] = m.energy / MAX_ENERGY;
        } else {
          eo += 5;
        }
      }

      let bo = o + BEAR_OFFSET;
      const bearBest = [null, null];
      const bearD = [Infinity, Infinity];
      for (const b of this.predators) {
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > VISION * VISION) continue;
        for (let k = 0; k < OBS_BEAR_K; k++) {
          if (d2 < bearD[k]) {
            for (let j = OBS_BEAR_K - 1; j > k; j--) {
              bearD[j] = bearD[j - 1];
              bearBest[j] = bearBest[j - 1];
            }
            bearD[k] = d2;
            bearBest[k] = b;
            break;
          }
        }
      }
      for (let k = 0; k < OBS_BEAR_K; k++) {
        const b = bearBest[k];
        if (b) {
          out[bo++] = clamp((b.x - a.x) * invV, -1.5, 1.5);
          out[bo++] = clamp((b.z - a.z) * invV, -1.5, 1.5);
          out[bo++] = Math.sqrt(bearD[k]) * invV;
          out[bo++] = b.hp / b.maxHp;
        } else {
          bo += OBS_BEAR_F;
        }
      }

      let ownLocal = 0;
      let enemyLocal = 0;
      const acx = Math.floor(a.x / CELL);
      const acz = Math.floor(a.z / CELL);
      for (let cz = acz - 2; cz <= acz + 2; cz++) {
        for (let cx = acx - 2; cx <= acx + 2; cx++) {
          if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) continue;
          const ow = this.owner[cz * CELLS + cx];
          if (ow === team) ownLocal++;
          else if (ow >= 0) enemyLocal++;
        }
      }
      out[o + TERR_OFFSET] = ownLocal / 25;
      out[o + TERR_OFFSET + 1] = enemyLocal / 25;
      out[o + TERR_OFFSET + 2] = this.territoryCount[team] / (CELLS * CELLS);

      out[o + BASE_OFFSET] = clamp((base.x - a.x) / WORLD, -1, 1);
      out[o + BASE_OFFSET + 1] = clamp((base.z - a.z) / WORLD, -1, 1);
      out[o + BASE_OFFSET + 2] = Math.hypot(base.x - a.x, base.z - a.z) / WORLD;

      const stats = this.teamStats[team];
      out[o + ECON_OFFSET] = Math.min(1.5, stats.stock.food / 120);
      out[o + ECON_OFFSET + 1] = Math.min(1.5, stats.stock.wood / 120);
      out[o + ECON_OFFSET + 2] = Math.min(1.5, stats.stock.gold / 120);
      out[o + ECON_OFFSET + 3] = stats.forge / MAX_FORGE;
      out[o + ECON_OFFSET + 4] = this._structureCount(team) / MAX_STRUCTURES_PER_TEAM;

      out[o + ID_OFFSET + i] = 1;
    }
    return out;
  }

  getMasks(team) {
    const out = new Uint8Array(AGENTS_PER_TEAM * ACTIONS);
    for (let i = 0; i < AGENTS_PER_TEAM; i++) {
      const a = this.agents[team][i];
      const o = i * ACTIONS;
      if (!a.alive) continue;
      out.fill(1, o, o + ACTION_HARVEST);
      out[o + ACTION_HARVEST] = this._nearestResource(a) ? 1 : 0;
      out[o + ACTION_ATTACK] = this._nearestThreat(a) ? 1 : 0;
      out[o + ACTION_BUILD_TOWER] = this._canBuild(a, 'tower') ? 1 : 0;
      out[o + ACTION_BUILD_CAMP] = this._canBuild(a, 'camp') ? 1 : 0;
    }
    return out;
  }

  /* ---------------- centralized state (critic only) ---------------- */

  getState(team) {
    const out = new Float32Array(ST);
    let o = 0;
    for (let pass = 0; pass < 2; pass++) {
      const list = this.agents[pass === 0 ? team : 1 - team];
      for (const a of list) {
        out[o++] = a.alive ? 1 : 0;
        out[o++] = a.x / WORLD;
        out[o++] = a.z / WORLD;
        out[o++] = a.hp / a.maxHp;
        out[o++] = a.energy / MAX_ENERGY;
        out[o++] = Math.min(1.5, a.cooldown / ATTACK_COOLDOWN);
      }
    }
    const stats = this.teamStats[team];
    out[o++] = stats.stock.food / 120;
    out[o++] = stats.stock.wood / 120;
    out[o++] = stats.stock.gold / 120;
    out[o++] = stats.gathered.food / 180;
    out[o++] = stats.gathered.wood / 180;
    out[o++] = stats.gathered.gold / 180;
    const owned = this.territoryCount[0] + this.territoryCount[1];
    const cells = CELLS * CELLS;
    out[o++] = this.territoryCount[team] / cells;
    out[o++] = this.territoryCount[1 - team] / cells;
    out[o++] = (cells - owned) / cells;
    out[o++] = this.aliveCounts()[team] / AGENTS_PER_TEAM;
    out[o++] = this.aliveCounts()[1 - team] / AGENTS_PER_TEAM;
    out[o++] = this._formationArea(team) / HULL_SCALE;
    out[o++] = this._formationArea(1 - team) / HULL_SCALE;
    for (const type of RESOURCE_TYPES) {
      let rem = 0;
      for (const r of this.resources) if (r.type === type) rem += r.alive ? r.amount : 0;
      out[o++] = rem / (RESOURCE_META[type].max * 13);
    }
    for (const type of RESOURCE_TYPES) {
      let count = 0;
      for (const r of this.resources) if (r.type === type && r.alive) count++;
      out[o++] = count / 13;
    }
    out[o++] = this.teamStats[team].forge / MAX_FORGE;
    out[o++] = this.teamStats[1 - team].forge / MAX_FORGE;
    out[o++] = this._structureCount(team) / MAX_STRUCTURES_PER_TEAM;
    out[o++] = this._structureCount(1 - team) / MAX_STRUCTURES_PER_TEAM;
    for (const b of this.predators) {
      out[o++] = b.alive ? 1 : 0;
      out[o++] = b.x / WORLD;
      out[o++] = b.z / WORLD;
      out[o++] = b.hp / b.maxHp;
    }
    out[o++] = Math.sin(this.time * 0.13);
    out[o++] = Math.cos(this.time * 0.13);
    return out;
  }

  teamSnapshot(team) {
    const stats = this.teamStats[team];
    const formation = this._formationArea(team);
    return {
      stock: { ...stats.stock },
      gathered: { ...stats.gathered },
      gatheredTotal: stats.gatheredTotal,
      kills: stats.kills,
      deaths: stats.deaths,
      reward: stats.reward,
      parts: { ...stats.parts },
      territory: this.territoryCount[team],
      territoryShare: this.territoryCount[team] / (CELLS * CELLS),
      alive: this.aliveCounts()[team],
      // Square units enclosed by the living squad's convex hull: how clustered
      // or solo the faction currently is.
      formation,
      formationShare: formation / HULL_SCALE,
      forge: stats.forge,
      builds: stats.builds,
      generatedFood: stats.generatedFood,
      towerDamage: stats.towerDamage,
      bearDamage: stats.bearDamage,
      bearRepelled: stats.bearRepelled,
      preyLost: stats.preyLost,
      structures: {
        tower: this._structureCount(team, 'tower'),
        camp: this._structureCount(team, 'camp'),
        total: this._structureCount(team),
      },
    };
  }

  // Field hazard summary for the spectator HUD: bears are neutral, so they are
  // reported once for the whole field rather than per faction.
  predatorSnapshot() {
    return {
      total: this.predators.length,
      alive: this.predators.reduce((n, b) => n + (b.alive ? 1 : 0), 0),
      preyLost: this.teamStats[0].preyLost + this.teamStats[1].preyLost,
      repelled: this.teamStats[0].bearRepelled + this.teamStats[1].bearRepelled,
      bears: this.predators.map((b) => ({
        id: b.id,
        alive: b.alive,
        hunting: b.hunting,
        hp: b.hp,
        maxHp: b.maxHp,
        x: b.x,
        z: b.z,
        returns: b.alive ? 0 : b.regrow,
      })),
    };
  }
}

export { OBS_DIM, STATE_DIM, ACTIONS };
