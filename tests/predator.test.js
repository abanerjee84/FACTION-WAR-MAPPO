import test from 'node:test';
import assert from 'node:assert/strict';

import { BattleEnv } from '../src/sim/env.js';
import {
  ACTION_ATTACK,
  ACTION_BUILD_TOWER,
  ACTIONS,
  AGENTS_PER_TEAM,
  BEAR_BASE_CLEAR,
  BEAR_DAMAGE,
  BEAR_HP,
  BEAR_RETURN,
  OBS_BEAR_F,
  OBS_DIM,
  PREDATORS,
  STATE_DIM,
  VISION,
} from '../src/sim/config.js';

const idle = () => [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

test('bears spawn as a neutral hazard clear of the keeps', () => {
  const env = new BattleEnv({ seed: 21, events: false });
  assert.equal(env.predators.length, PREDATORS);
  for (const bear of env.predators) {
    assert.equal(bear.alive, true);
    assert.equal(bear.hp, BEAR_HP);
    for (const base of env.bases) {
      assert.ok(
        dist(bear.x, bear.z, base.x, base.z) >= BEAR_BASE_CLEAR - 0.01,
        'a bear must never sit inside a fortress footprint',
      );
    }
  }

  // No bear may be visible at reset, so swinging stays illegal for everyone.
  for (const team of [0, 1]) {
    const masks = env.getMasks(team);
    assert.equal(masks.length, AGENTS_PER_TEAM * ACTIONS);
    for (let i = 0; i < AGENTS_PER_TEAM; i++) {
      assert.equal(masks[i * ACTIONS + ACTION_ATTACK], 0, 'attack should be illegal at reset');
    }
  }
  for (const bear of env.predators) {
    for (const team of [0, 1]) {
      for (const agent of env.agents[team]) {
        assert.ok(dist(bear.x, bear.z, agent.x, agent.z) > VISION);
      }
    }
  }
});

test('a bear stalks and mauls legionaries of either faction', () => {
  const env = new BattleEnv({ seed: 22, events: true });
  const bear = env.predators[0];
  const prey = env.agents[0][0];
  prey.x = bear.x + 1.2;
  prey.z = bear.z;
  const before = prey.hp;

  let maul = null;
  for (let i = 0; i < 12; i++) {
    const out = env.step(idle());
    maul = out.events.find((e) => e.type === 'maul') || maul;
  }
  assert.ok(maul, 'a bear should maul prey inside its vision');
  assert.equal(maul.dmg, BEAR_DAMAGE);
  assert.equal(maul.target, 0);
  assert.ok(prey.hp < before);

  // Mauling continues until the legionary is gone, and the kill is attributed
  // to the bear, not to a faction.
  let taken = null;
  for (let i = 0; i < 60; i++) {
    const out = env.step(idle());
    taken = out.events.find((e) => e.type === 'death' && e.predator) || taken;
  }
  assert.ok(taken, 'a maul should end a legionary');
  assert.equal(taken.killer, -1);
  assert.equal(prey.alive, false);
  assert.equal(prey.deathType, 'predator');
  assert.equal(env.teamStats[0].preyLost, 1);
  assert.equal(env.teamStats[0].kills, 0, 'predation is not a faction kill');
});

test('legionaries drive a bear off and it returns after the cooldown', () => {
  const env = new BattleEnv({ seed: 23, events: true });
  const bear = env.predators[0];
  const hunters = env.agents[0].slice(0, 3);
  hunters.forEach((hunter, i) => {
    hunter.hp = 600;
    hunter.maxHp = 600;
    hunter.x = bear.x + 1.3 + i * 0.5;
    hunter.z = bear.z + (i - 1) * 0.5;
  });

  let repelled = null;
  for (let i = 0; i < 200; i++) {
    const out = env.step([
      [ACTION_ATTACK, ACTION_ATTACK, ACTION_ATTACK, 0, 0, 0],
      idle()[1],
    ]);
    repelled = out.events.find((e) => e.type === 'bearRepelled') || repelled;
    if (repelled) break;
  }

  assert.ok(repelled, 'three hunters should drive a bear off');
  assert.equal(repelled.team, 0);
  assert.equal(bear.alive, false);
  assert.ok(bear.hp <= 0);
  assert.ok(bear.regrow > 0 && bear.regrow <= BEAR_RETURN);
  assert.ok(env.teamStats[0].bearDamage >= BEAR_HP);
  assert.equal(env.teamStats[0].bearRepelled, 1);
  assert.ok(env.lastRewardParts[0].combat > 0, 'repelling a bear should pay into combat');

  let returned = null;
  for (let i = 0; i < Math.ceil((BEAR_RETURN + 0.5) / 0.1); i++) {
    const out = env.step(idle());
    returned = out.events.find((e) => e.type === 'bearReturn') || returned;
    if (returned) break;
  }
  assert.ok(returned, 'a driven-off bear should come back');
  assert.equal(bear.alive, true);
  assert.equal(bear.hp, BEAR_HP);
});

test('watchtowers fire on bears as intruders', () => {
  const env = new BattleEnv({ seed: 24, events: true });
  const bear = env.predators[0];
  const builder = env.agents[0][0];
  builder.hp = 900;
  builder.maxHp = 900;
  env.teamStats[0].stock.wood = 40;

  // Find a legal tower footprint within the watchtower's range of the bear.
  let placed = false;
  for (let k = 0; k < 24 && !placed; k++) {
    const angle = (k / 24) * Math.PI * 2;
    builder.x = Math.min(Math.max(bear.x + Math.cos(angle) * 4, 3), 33);
    builder.z = Math.min(Math.max(bear.z + Math.sin(angle) * 4, 3), 33);
    placed = env._canBuild(builder, 'tower');
  }
  assert.ok(placed, 'a legal watchtower spot should exist near the bear');

  const actions = idle();
  actions[0][0] = ACTION_BUILD_TOWER;
  env.step(actions);
  assert.equal(env.structures.length, 1);

  const before = bear.hp;
  let bolt = null;
  for (let i = 0; i < 40; i++) {
    const out = env.step(idle());
    bolt = out.events.find((e) => e.type === 'bolt' && e.target === -1) || bolt;
    if (bolt) break;
  }
  assert.ok(bolt, 'a watchtower should bolt a bear inside its range');
  assert.ok(bear.hp < before);
  assert.ok(env.teamStats[0].towerDamage > 0);
});

test('observations and global state carry the bear block', () => {
  const env = new BattleEnv({ seed: 25, events: false });

  // Isolate one legionary so exactly one observation row sees a bear.
  const watcher = env.agents[0][0];
  watcher.x = 18;
  watcher.z = 18;
  for (let i = 1; i < AGENTS_PER_TEAM; i++) {
    env.agents[0][i].x = 2;
    env.agents[0][i].z = 30;
    env.agents[1][i].x = 30;
    env.agents[1][i].z = 2;
  }
  env.agents[1][0].x = 30;
  env.agents[1][0].z = 2;
  env.predators[0].x = 18 + 3;
  env.predators[0].z = 18 + 1.5;
  env.predators[1].x = 2;
  env.predators[1].z = 2;

  const seen = env.getObs(0);
  assert.equal(seen.length, AGENTS_PER_TEAM * OBS_DIM);
  assert.equal(env.getMasks(0)[ACTION_ATTACK], 1, 'a bear in view should make swinging legal');

  env.predators[0].alive = false;
  const unseen = env.getObs(0);
  assert.equal(env.getMasks(0)[ACTION_ATTACK], 0, 'no threat in view means swinging is illegal');

  let diffs = 0;
  for (let i = 0; i < OBS_DIM; i++) {
    if (seen[i] !== unseen[i]) diffs++;
  }
  assert.equal(diffs, OBS_BEAR_F, 'only the visible bear slot should change');

  const state = env.getState(0);
  assert.equal(state.length, STATE_DIM);
  env.predators[1].x = 12;
  env.predators[1].z = 12;
  assert.notEqual(
    state.join(','),
    env.getState(0).join(','),
    'global state should carry bear positions',
  );
});

test('roaming bears never enter a fortress footprint', () => {
  const env = new BattleEnv({ seed: 26, events: false });
  for (let i = 0; i < 400; i++) env.step(idle());
  for (const bear of env.predators) {
    if (!bear.alive) continue;
    for (const base of env.bases) {
      assert.ok(
        dist(bear.x, bear.z, base.x, base.z) >= BEAR_BASE_CLEAR - 0.01,
        'a prowling bear should stop at the edge of a keep',
      );
    }
  }
});
