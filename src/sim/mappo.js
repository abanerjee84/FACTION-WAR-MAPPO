import { BattleEnv } from './env.js';
import { Actor, Critic } from './policy.js';
import { RNG } from './rng.js';
import {
  ACTIONS,
  AGENTS_PER_TEAM,
  MAPPO,
  OBS_DIM,
  STATE_DIM,
  TEAMS,
  DT,
} from './config.js';

const N = AGENTS_PER_TEAM;
const OBS = OBS_DIM;
const ST = STATE_DIM;

/**
 * Standard GAE with explicit terminal masks. Bootstrap values are only used
 * on truncated-but-not-terminal steps.
 */
export function computeGAE({ rewards, values, dones, bootstrap, T, E, gamma, lambda }) {
  const advantages = new Float32Array(T * E);
  const returns = new Float32Array(T * E);
  for (let e = 0; e < E; e++) {
    let last = 0;
    for (let t = T - 1; t >= 0; t--) {
      const idx = t * E + e;
      const done = dones[idx] ? 1 : 0;
      const nextValue = t === T - 1 ? bootstrap[e] || 0 : values[(t + 1) * E + e];
      const nonTerminal = 1 - done;
      const delta = rewards[idx] + gamma * nonTerminal * nextValue - values[idx];
      last = delta + gamma * lambda * nonTerminal * last;
      advantages[idx] = last;
      returns[idx] = last + values[idx];
    }
  }
  return { advantages, returns };
}

/**
 * Normalizes advantages over active agent-time elements only. Dead agents never
 * contribute weight to the policy or value statistics.
 */
export function normalizeAdvantages(adv, alive, T, E, agentsPerTeam = N) {
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  for (let t = 0; t < T; t++) {
    for (let e = 0; e < E; e++) {
      let nAlive = 0;
      const base = (t * E + e) * agentsPerTeam;
      for (let i = 0; i < agentsPerTeam; i++) nAlive += alive[base + i] ? 1 : 0;
      if (nAlive === 0) continue;
      const a = adv[t * E + e];
      sum += a * nAlive;
      sumSq += a * a * nAlive;
      count += nAlive;
    }
  }
  if (count === 0) return adv;
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const inv = 1 / (Math.sqrt(variance) + 1e-8);
  for (let t = 0; t < T; t++) {
    for (let e = 0; e < E; e++) {
      adv[t * E + e] = (adv[t * E + e] - mean) * inv;
    }
  }
  return adv;
}

function blankTeamParts() {
  return { gather: 0, territory: 0, combat: 0, survival: 0, industry: 0 };
}

function makeTeamBuffer(T, E) {
  const S = T * E;
  const A = S * N;
  return {
    obs: new Float32Array(A * OBS),
    masks: new Uint8Array(A * ACTIONS),
    actions: new Uint8Array(A),
    logp: new Float32Array(A),
    alive: new Uint8Array(A),
    rewards: new Float32Array(S),
    values: new Float32Array(S),
    dones: new Uint8Array(S),
    states: new Float32Array(S * ST),
    adv: new Float32Array(S),
    ret: new Float32Array(S),
  };
}

export class MAPPOTrainer {
  constructor({ seed = 1234, worlds = MAPPO.worlds, rollout = MAPPO.rollout } = {}) {
    this.seed = seed >>> 0;
    this.T = rollout;
    this.E = worlds;
    this.rng = new RNG(this.seed * 17 + 3);
    this.actors = [
      new Actor({ obsDim: OBS_DIM, hidden: MAPPO.hidden, actions: ACTIONS, seed: this.seed + 11 }),
      new Actor({ obsDim: OBS_DIM, hidden: MAPPO.hidden, actions: ACTIONS, seed: this.seed + 29 }),
    ];
    this.critics = [
      new Critic({ stateDim: STATE_DIM, hidden: MAPPO.criticHidden, seed: this.seed + 47 }),
      new Critic({ stateDim: STATE_DIM, hidden: MAPPO.criticHidden, seed: this.seed + 71 }),
    ];
    this.envs = [];
    for (let e = 0; e < worlds; e++) {
      this.envs.push(new BattleEnv({ seed: this.seed + e * 977 + 1, events: false }));
    }
    this.buf = [makeTeamBuffer(this.T, this.E), makeTeamBuffer(this.T, this.E)];

    this.iteration = 0;
    this.totalSteps = 0;
    this.totalEpisodes = 0;
    this.winTotal = [0, 0];
    this.recentWinners = [];
    this.iterEpisodes = [];
    this.lastMetrics = null;

    this.episodeReturn = Array.from({ length: worlds }, () => [0, 0]);
    this.episodeParts = Array.from({ length: worlds }, () => [blankTeamParts(), blankTeamParts()]);
    this.episodeSteps = new Array(worlds).fill(0);
    this.episodeStartIteration = new Array(worlds).fill(0);
  }

  _finalizeEpisode(e) {
    const returns = [this.episodeReturn[e][0], this.episodeReturn[e][1]];
    const length = this.episodeSteps[e];
    const parts = [
      { ...this.episodeParts[e][0] },
      { ...this.episodeParts[e][1] },
    ];
    const env = this.envs[e];
    const winner = env.winner;
    const info = {
      returns,
      length,
      winner,
      parts,
      episode: env.episodeId,
      world: e,
    };
    this.iterEpisodes.push(info);
    this.totalEpisodes += 1;
    if (winner === 0 || winner === 1) {
      this.winTotal[winner] += 1;
      this.recentWinners.push(winner);
      if (this.recentWinners.length > 50) this.recentWinners.shift();
    }
    this.episodeReturn[e] = [0, 0];
    this.episodeParts[e] = [blankTeamParts(), blankTeamParts()];
    this.episodeSteps[e] = 0;
    this.episodeStartIteration[e] = this.iteration;
    env.reset();
  }

  _collect(stepParts, stepRewards, actionStats) {
    const { T, E, buf, rng } = this;
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < E; e++) {
        const env = this.envs[e];
        const actions = [[], []];
        const ae = t * E + e;
        for (let team = 0; team < TEAMS; team++) {
          const b = buf[team];
          const state = env.getState(team);
          b.states.set(state, ae * ST);
          const value = this.critics[team].predict(state);
          b.values[ae] = value;

          const obs = env.getObs(team);
          const masks = env.getMasks(team);
          const agents = env.agents[team];
          for (let i = 0; i < N; i++) {
            const idx = ae * N + i;
            if (!agents[i].alive) {
              b.alive[idx] = 0;
              actions[team][i] = 0;
              continue;
            }
            b.alive[idx] = 1;
            const oo = i * OBS;
            const mo = i * ACTIONS;
            b.obs.set(obs.subarray(oo, oo + OBS), idx * OBS);
            b.masks.set(masks.subarray(mo, mo + ACTIONS), idx * ACTIONS);
            const result = this.actors[team].act(
              obs.subarray(oo, oo + OBS),
              masks,
              mo,
              rng,
              { temperature: 1 },
            );
            b.actions[idx] = result.action;
            b.logp[idx] = result.logp;
            actionStats[team].entropy += result.entropy;
            actionStats[team].count += 1;
            actions[team][i] = result.action;
          }
        }

        const outcome = env.step(actions);
        this.totalSteps += 1;
        for (let team = 0; team < TEAMS; team++) {
          const b = buf[team];
          b.rewards[ae] = outcome.rewards[team];
          b.dones[ae] = outcome.terminated ? 1 : 0;
          this.episodeReturn[e][team] += outcome.rewards[team];
          stepRewards[team] += outcome.rewards[team];
          const parts = outcome.rewardParts[team];
          stepParts[team].gather += parts.gather;
          stepParts[team].territory += parts.territory;
          stepParts[team].combat += parts.combat;
          stepParts[team].survival += parts.survival;
          stepParts[team].industry += parts.industry;
          this.episodeParts[e][team].gather += parts.gather;
          this.episodeParts[e][team].territory += parts.territory;
          this.episodeParts[e][team].combat += parts.combat;
          this.episodeParts[e][team].survival += parts.survival;
          this.episodeParts[e][team].industry += parts.industry;
        }
        this.episodeSteps[e] += 1;

        if (outcome.terminated) this._finalizeEpisode(e);
      }
    }
  }

  _bootstrap() {
    const { T, E } = this;
    const bootstrap = [new Float32Array(E), new Float32Array(E)];
    for (let e = 0; e < E; e++) {
      const idx = (T - 1) * E + e;
      if (this.buf[0].dones[idx]) continue;
      for (let team = 0; team < TEAMS; team++) {
        bootstrap[team][e] = this.critics[team].predict(this.envs[e].getState(team));
      }
    }
    return bootstrap;
  }

  _gaeAndNormalize() {
    const { T, E } = this;
    const bootstrap = this._bootstrap();
    for (let team = 0; team < TEAMS; team++) {
      const b = this.buf[team];
      const gae = computeGAE({
        rewards: b.rewards,
        values: b.values,
        dones: b.dones,
        bootstrap: bootstrap[team],
        T,
        E,
        gamma: MAPPO.gamma,
        lambda: MAPPO.lambda,
      });
      b.adv.set(gae.advantages);
      b.ret.set(gae.returns);
    }
    for (let team = 0; team < TEAMS; team++) {
      const b = this.buf[team];
      normalizeAdvantages(b.adv, b.alive, this.T, this.E, N);
    }
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  _trainActor(team) {
    const { T, E, buf } = this;
    const b = buf[team];
    const actor = this.actors[team];
    const valid = [];
    for (let idx = 0; idx < b.alive.length; idx++) {
      if (b.alive[idx]) valid.push(idx);
    }
    const stats = { loss: 0, entropy: 0, clip: 0, kl: 0, ratio: 0, count: 0 };
    if (!valid.length) return stats;

    for (let epoch = 0; epoch < MAPPO.epochs; epoch++) {
      this._shuffle(valid);
      for (let start = 0; start < valid.length; start += MAPPO.minibatch) {
        const end = Math.min(valid.length, start + MAPPO.minibatch);
        actor.zeroGrads();
        for (let k = start; k < end; k++) {
          const idx = valid[k];
          const ae = Math.floor(idx / N);
          const t = Math.floor(ae / E);
          void t;
          const oo = idx * OBS;
          const mo = idx * ACTIONS;
          const res = actor.accumulate(
            b.obs.subarray(oo, oo + OBS),
            b.actions[idx],
            b.logp[idx],
            b.adv[ae],
            b.masks,
            mo,
            MAPPO.entropy,
            MAPPO.clip,
          );
          stats.loss += res.loss;
          stats.entropy += res.entropy;
          stats.clip += res.clipFrac;
          stats.kl += res.approxKL;
          stats.ratio += res.ratio;
          stats.count += 1;
        }
        actor.step(MAPPO.actorLR, 1 / (end - start), MAPPO.maxGradNorm);
      }
    }
    const inv = 1 / Math.max(1, stats.count);
    return {
      loss: stats.loss * inv,
      entropy: stats.entropy * inv,
      clip: stats.clip * inv,
      kl: Math.max(0, stats.kl * inv),
      ratio: stats.ratio * inv,
      count: stats.count,
    };
  }

  _trainCritic(team) {
    const { T, E, buf } = this;
    const b = buf[team];
    const critic = this.critics[team];
    const samples = [];
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < E; e++) {
        const ae = t * E + e;
        let alive = 0;
        for (let i = 0; i < N; i++) alive += b.alive[ae * N + i] ? 1 : 0;
        if (alive > 0) samples.push({ ae, weight: alive / N });
      }
    }
    const stats = { loss: 0, value: 0, weight: 0, count: 0 };
    if (!samples.length) return stats;

    for (let epoch = 0; epoch < MAPPO.epochs; epoch++) {
      this._shuffle(samples);
      for (let start = 0; start < samples.length; start += MAPPO.minibatch) {
        const end = Math.min(samples.length, start + MAPPO.minibatch);
        critic.zeroGrads();
        let batchWeight = 0;
        for (let k = start; k < end; k++) {
          const s = samples[k];
          const state = b.states.subarray(s.ae * ST, (s.ae + 1) * ST);
          const res = critic.accumulate(
            state,
            b.ret[s.ae],
            b.values[s.ae],
            s.weight,
            MAPPO.valueClip,
          );
          stats.loss += res.loss;
          stats.value += res.value * s.weight;
          stats.weight += s.weight;
          stats.count += 1;
          batchWeight += s.weight;
        }
        critic.step(MAPPO.criticLR, 1 / Math.max(1e-6, batchWeight), MAPPO.maxGradNorm);
      }
    }
    const inv = 1 / Math.max(1e-6, stats.weight);
    return {
      loss: stats.loss * inv,
      value: stats.value * inv,
      count: stats.count,
    };
  }

  runIteration() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.iteration += 1;
    this.iterEpisodes = [];
    const stepParts = [
      blankTeamParts(),
      blankTeamParts(),
    ];
    const stepRewards = [0, 0];
    const actionStats = [
      { entropy: 0, count: 0 },
      { entropy: 0, count: 0 },
    ];

    this._collect(stepParts, stepRewards, actionStats);
    this._gaeAndNormalize();

    const teams = [];
    for (let team = 0; team < TEAMS; team++) {
      const actorStats = this._trainActor(team);
      const criticStats = this._trainCritic(team);
      const episodes = this.iterEpisodes;
      const teamEpisodes = episodes.filter((ep) => ep.winner >= 0);
      let meanReturn = null;
      let meanLength = null;
      let episodeWins = 0;
      if (teamEpisodes.length) {
        meanReturn = teamEpisodes.reduce((s, ep) => s + ep.returns[team], 0) / teamEpisodes.length;
        meanLength = teamEpisodes.reduce((s, ep) => s + ep.length, 0) / teamEpisodes.length;
        episodeWins = teamEpisodes.reduce((s, ep) => s + (ep.winner === team ? 1 : 0), 0);
      }
      const recent = this.recentWinners;
      const winRate = recent.length
        ? recent.reduce((s, w) => s + (w === team ? 1 : 0), 0) / recent.length
        : 0.5;
      const parts = stepParts[team];
      const mag = {
        gather: Math.abs(parts.gather),
        territory: Math.abs(parts.territory),
        combat: Math.abs(parts.combat),
        survival: Math.abs(parts.survival),
        industry: Math.abs(parts.industry),
      };
      const magSum = mag.gather + mag.territory + mag.combat + mag.survival + mag.industry;
      teams.push({
        actorLoss: actorStats.loss,
        criticLoss: criticStats.loss,
        entropy: actorStats.entropy,
        clipFrac: actorStats.clip,
        approxKL: actorStats.kl,
        ratio: actorStats.ratio,
        rewardPerStep: stepRewards[team] / (this.T * this.E),
        meanValue: criticStats.value,
        meanReturn,
        meanLength,
        episodes: this.iterEpisodes.length,
        episodeWins,
        winRate,
        parts,
        partsShare: magSum > 0
          ? {
              gather: mag.gather / magSum,
              territory: mag.territory / magSum,
              combat: mag.combat / magSum,
              survival: mag.survival / magSum,
              industry: mag.industry / magSum,
            }
          : {
              gather: 0.2,
              territory: 0.2,
              combat: 0.2,
              survival: 0.2,
              industry: 0.2,
            },
        rolloutEntropy: actionStats[team].count
          ? actionStats[team].entropy / actionStats[team].count
          : 0,
      });
    }

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const metrics = {
      iteration: this.iteration,
      totalSteps: this.totalSteps,
      totalEpisodes: this.totalEpisodes,
      wins: this.winTotal.slice(),
      timelineSeconds: this.totalSteps * DT,
      iterationMs: t1 - t0,
      teams,
      episodesThisIteration: this.iterEpisodes.length,
    };
    this.lastMetrics = metrics;
    return metrics;
  }

  getActorWeights(team) {
    return this.actors[team].exportWeights();
  }

  actorShape() {
    return { obsDim: OBS_DIM, hidden: MAPPO.hidden, actions: ACTIONS };
  }
}
