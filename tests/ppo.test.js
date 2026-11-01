import test from 'node:test';
import assert from 'node:assert/strict';

import { computeGAE, normalizeAdvantages, MAPPOTrainer } from '../src/sim/mappo.js';
import { Actor, maskedSoftmax } from '../src/sim/policy.js';
import { BattleEnv } from '../src/sim/env.js';
import { ACTIONS, OBS_DIM, STATE_DIM, REWARD } from '../src/sim/config.js';
import { RNG } from '../src/sim/rng.js';

const close = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

test('GAE matches a hand-computed three-step trajectory', () => {
  const rewards = new Float32Array([1, 2, 3]);
  const values = new Float32Array([1, 1.5, 2]);
  const dones = new Uint8Array([0, 0, 0]);
  const { advantages, returns } = computeGAE({
    rewards,
    values,
    dones,
    bootstrap: new Float32Array([2.5]),
    T: 3,
    E: 1,
    gamma: 0.9,
    lambda: 0.8,
  });
  const a2 = 3 + 0.9 * 2.5 - 2;
  const a1 = 2 + 0.9 * 2 - 1.5 + 0.9 * 0.8 * a2;
  const a0 = 1 + 0.9 * 1.5 - 1 + 0.9 * 0.8 * a1;
  assert.ok(close(advantages[2], a2));
  assert.ok(close(advantages[1], a1));
  assert.ok(close(advantages[0], a0));
  assert.ok(close(returns[0], a0 + 1));
  assert.ok(close(returns[1], a1 + 1.5));
  assert.ok(close(returns[2], a2 + 2));
});

test('terminal masks suppress the truncation bootstrap', () => {
  const base = {
    rewards: new Float32Array([1]),
    values: new Float32Array([0.5]),
    bootstrap: new Float32Array([2]),
    T: 1,
    E: 1,
    gamma: 0.9,
    lambda: 0.95,
  };
  const live = computeGAE({ ...base, dones: new Uint8Array([0]) });
  const ended = computeGAE({ ...base, dones: new Uint8Array([1]) });
  assert.ok(close(live.advantages[0], 1 + 0.9 * 2 - 0.5));
  assert.ok(close(ended.advantages[0], 1 - 0.5));
  assert.ok(close(ended.returns[0], 1.0));
});

test('advantage normalization uses alive agent-time weight only', () => {
  const adv = new Float32Array([2, 4]);
  const alive = new Uint8Array([1, 0, 1, 1]); // T=2, E=1, N=2
  normalizeAdvantages(adv, alive, 2, 1, 2);
  const weighted = adv[0] * 1 + adv[1] * 2;
  assert.ok(close(weighted, 0, 1e-5));
  const mean = weighted / 3;
  const variance = (adv[0] * adv[0] * 1 + adv[1] * adv[1] * 2) / 3 - mean * mean;
  assert.ok(close(variance, 1, 1e-4));
});

test('legal action masks make illegal actions impossible', () => {
  const rng = new RNG(9);
  const obs = new Float32Array(OBS_DIM);
  const mask = new Uint8Array(ACTIONS);
  mask[0] = 1;
  mask[1] = 1;
  mask[4] = 1;
  const probs = maskedSoftmax(new Float32Array(ACTIONS), mask, 0, ACTIONS, 1);
  assert.equal(probs[2], 0);
  assert.equal(probs[10], 0);
  assert.ok(close(probs[0] + probs[1] + probs[4], 1, 1e-5));

  const actor = new Actor({ obsDim: OBS_DIM, hidden: 16, actions: ACTIONS, seed: 2 });
  for (let i = 0; i < 200; i++) {
    const { action } = actor.act(obs, mask, 0, rng);
    assert.ok(action === 0 || action === 1 || action === 4, `sampled illegal action ${action}`);
  }
});

test('PPO ratio is exactly one before the first update', () => {
  const rng = new RNG(3);
  const actor = new Actor({ obsDim: OBS_DIM, hidden: 16, actions: ACTIONS, seed: 4 });
  const obs = new Float32Array(OBS_DIM);
  for (let i = 0; i < obs.length; i++) obs[i] = rng.normal(0, 0.3);
  const mask = new Uint8Array(ACTIONS).fill(1);
  const before = actor.exportWeights().slice();
  const { action, logp } = actor.act(obs, mask, 0, rng);
  const res = actor.accumulate(obs, action, logp, 0, mask, 0, 0, 0.2);
  assert.ok(close(res.ratio, 1, 1e-6));
  assert.ok(close(res.approxKL, 0, 1e-6));
  actor.step(1e-3, 1, 10);
  const after = actor.exportWeights();
  for (let i = 0; i < after.length; i++) {
    assert.ok(close(before[i], after[i], 1e-7), `zero advantage changed weight ${i}`);
  }
});

test('clipped PPO updates move the policy with non-zero advantage', () => {
  const rng = new RNG(8);
  const actor = new Actor({ obsDim: OBS_DIM, hidden: 16, actions: ACTIONS, seed: 5 });
  const obs = new Float32Array(OBS_DIM);
  const mask = new Uint8Array(ACTIONS).fill(1);
  const { action, logp } = actor.act(obs, mask, 0, rng);
  const before = Math.log(actor.act(obs, mask, 0, rng, { greedy: true }).probs[action] + 1e-9);
  for (let i = 0; i < 20; i++) {
    actor.zeroGrads();
    actor.accumulate(obs, action, logp, 1.5, mask, 0, 0, 0.2);
    actor.step(5e-3, 1, 10);
  }
  const after = Math.log(actor.act(obs, mask, 0, rng, { greedy: true }).probs[action] + 1e-9);
  assert.ok(after > before, 'probability of the advantaged action should increase');
});

test('environment exposes MAPPO buffer shapes and valid legal masks', () => {
  const env = new BattleEnv({ seed: 11, events: false });
  assert.equal(env.getObs(0).length, 6 * OBS_DIM);
  assert.equal(env.getState(1).length, STATE_DIM);
  const masks = env.getMasks(0);
  assert.equal(masks.length, 6 * ACTIONS);
  assert.equal(masks[10], 0, 'attack should be illegal with no visible enemy');
  const actions = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
  const result = env.step(actions);
  assert.equal(result.terminated, false);
  assert.ok(result.rewards.every(Number.isFinite));
});

test('episode terminates when every agent of a faction is dead', () => {
  const env = new BattleEnv({ seed: 12, events: false });
  for (const a of env.agents[1]) {
    a.alive = false;
    a.hp = 0;
  }
  const result = env.step([[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
  assert.equal(result.terminated, true);
  assert.equal(result.winner, 0);
  assert.ok(result.rewards[0] >= REWARD.victory);
  assert.ok(result.rewards[1] < -7);
  assert.ok(result.rewards[0] - result.rewards[1] >= 15);
});

test('starvation drains health and kills an unfed agent', () => {
  const env = new BattleEnv({ seed: 13, events: true });
  const agent = env.agents[0][0];
  env.teamStats[0].stock.food = 0;
  for (const a of env.agents[0]) {
    a.energy = 0;
    a.hp = 3;
  }
  let died = false;
  for (let i = 0; i < 20; i++) {
    const res = env.step([[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]);
    if (!agent.alive) {
      died = true;
      assert.ok(res.events.some((e) => e.type === 'death' && e.starve));
      break;
    }
  }
  assert.ok(died, 'agent should starve to death');
  assert.equal(agent.deathType, 'starve');
});

test('one MAPPO iteration produces finite losses for both factions', () => {
  const trainer = new MAPPOTrainer({ seed: 21, worlds: 1, rollout: 8 });
  const metrics = trainer.runIteration();
  assert.equal(metrics.iteration, 1);
  assert.equal(metrics.teams.length, 2);
  for (const team of metrics.teams) {
    assert.ok(Number.isFinite(team.actorLoss));
    assert.ok(Number.isFinite(team.criticLoss));
    assert.ok(Number.isFinite(team.entropy));
    assert.ok(Number.isFinite(team.rewardPerStep));
    assert.ok(team.entropy > 0);
  }
  const weights = trainer.getActorWeights(0);
  assert.ok(weights.length > 0);
  assert.ok(weights.every(Number.isFinite));
});
