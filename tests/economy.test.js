import test from 'node:test';
import assert from 'node:assert/strict';

import { BattleEnv } from '../src/sim/env.js';
import {
  ACTIONS,
  ACTION_BUILD_CAMP,
  ACTION_BUILD_TOWER,
  AGENTS_PER_TEAM,
  FORGE_HP,
  MAX_FORGE,
  MAX_HP,
  OBS_DIM,
  RESOURCE_META,
  STATE_DIM,
} from '../src/sim/config.js';

const idle = () => [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];

test('depleted food nodes regrow after their cooldown', () => {
  const env = new BattleEnv({ seed: 31, events: true });
  const node = env.resources.find((r) => r.type === 'food');
  node.amount = 0;
  node.alive = false;
  node.regrow = RESOURCE_META.food.regrow;
  let regrown = null;
  const steps = Math.ceil((RESOURCE_META.food.regrow + 0.5) / 0.1);
  for (let i = 0; i < steps; i++) {
    const out = env.step(idle());
    regrown = out.events.find((e) => e.type === 'regrow' && e.kind === 'food') || regrown;
  }
  assert.equal(node.alive, true);
  assert.ok(node.amount > 0);
  assert.ok(regrown, 'a regrow event should be emitted');
});

test('wood builds a watchtower that consumes stock and fires on enemies', () => {
  const env = new BattleEnv({ seed: 32, events: true });
  const builder = env.agents[0][0];
  builder.x = 18;
  builder.z = 18;
  env.teamStats[0].stock.wood = 40;
  const actions = idle();
  actions[0][0] = ACTION_BUILD_TOWER;
  const out = env.step(actions);
  assert.equal(env.structures.length, 1);
  assert.equal(env.structures[0].type, 'tower');
  assert.ok(env.teamStats[0].stock.wood <= 22.001);
  assert.ok(out.events.some((e) => e.type === 'build'));

  const victim = env.agents[1][0];
  victim.x = 18.7;
  victim.z = 18.4;
  const before = victim.hp;
  let bolt = null;
  for (let i = 0; i < 40; i++) {
    const res = env.step(idle());
    bolt = res.events.find((e) => e.type === 'bolt') || bolt;
  }
  assert.ok(victim.hp < before, 'watchtower should damage an enemy in range');
  assert.ok(bolt, 'watchtower should emit a bolt event');
  assert.ok(env.teamStats[0].towerDamage > 0);
});

test('field camps produce food and heal nearby allies', () => {
  const env = new BattleEnv({ seed: 33, events: true });
  const builder = env.agents[0][0];
  builder.x = 18;
  builder.z = 18;
  builder.hp = 50;
  env.teamStats[0].stock.wood = 40;
  const actions = idle();
  actions[0][0] = ACTION_BUILD_CAMP;
  env.step(actions);
  assert.equal(env.structures[0].type, 'camp');
  const food = env.teamStats[0].stock.food;
  for (let i = 0; i < 20; i++) env.step(idle());
  assert.ok(env.teamStats[0].stock.food > food, 'camp should generate food');
  assert.ok(builder.hp > 50, 'camp should heal a nearby ally');
});

test('gold is automatically forged into team-wide combat upgrades', () => {
  const env = new BattleEnv({ seed: 34, events: true });
  env.teamStats[0].stock.gold = 300;
  const out = env.step(idle());
  assert.equal(env.teamStats[0].forge, MAX_FORGE);
  assert.equal(env.teamStats[0].stock.gold, 25);
  assert.equal(env.agents[0][0].maxHp, MAX_HP + FORGE_HP[MAX_FORGE]);
  assert.equal(out.events.filter((e) => e.type === 'forge').length, MAX_FORGE);
});

test('observations expose economy features and build masks', () => {
  const env = new BattleEnv({ seed: 35, events: false });
  assert.equal(env.getObs(0).length, AGENTS_PER_TEAM * OBS_DIM);
  assert.equal(env.getState(0).length, STATE_DIM);

  const masks = env.getMasks(0);
  assert.equal(masks.length, AGENTS_PER_TEAM * ACTIONS);
  assert.equal(masks[ACTION_BUILD_TOWER], 0, 'no wood should block tower construction');

  env.teamStats[0].stock.wood = 100;
  env.agents[0][0].x = 18;
  env.agents[0][0].z = 18;
  const richMasks = env.getMasks(0);
  assert.equal(richMasks[ACTION_BUILD_TOWER], 1);
  assert.equal(richMasks[ACTION_BUILD_CAMP], 1);
});
