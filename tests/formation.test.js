import test from 'node:test';
import assert from 'node:assert/strict';

import { BattleEnv } from '../src/sim/env.js';
import {
  AGENTS_PER_TEAM,
  PREDATORS,
  STATE_DIM,
} from '../src/sim/config.js';

const idle = () => [[0, 0, 0, 0, 0, 0]];

// Mirrors getState's layout: rosters, stockpiles, lifetime gathered, territory
// shares, alive counts — then the two formation slots.
const FORMATION_OFFSET = AGENTS_PER_TEAM * 6 * 2 + 3 + 3 + 3 + 2;

const place = (env, team, spots) => {
  env.agents[team].forEach((a, i) => {
    a.x = spots[i][0];
    a.z = spots[i][1];
  });
};

test('the hull area matches hand-computed geometry', () => {
  const env = new BattleEnv({ seed: 12, events: false });

  // A 4x2 rectangle with a legionary inside it: interior points add nothing.
  place(env, 0, [
    [10, 10],
    [14, 10],
    [14, 12],
    [10, 12],
    [12, 11],
    [12, 10.5],
  ]);
  assert.equal(env._formationArea(0), 8);

  // Drop a corner and the hull becomes the triangle half of that rectangle.
  env.agents[0][2].alive = false;
  assert.equal(env._formationArea(0), 4);
});

test('dead legionaries and collinear squads enclose no ground', () => {
  const env = new BattleEnv({ seed: 13, events: false });

  // Corpses scattered across the field must not inflate the formation feature.
  place(env, 0, [
    [18, 18],
    [18.4, 18.3],
    [18.2, 18.6],
    [2, 2],
    [34, 34],
    [30, 4],
  ]);
  const scattered = env._formationArea(0);
  assert.ok(scattered > 200, 'a squad spread corner to corner encloses a lot');
  for (const i of [3, 4, 5]) env.agents[0][i].alive = false;
  const survivors = env._formationArea(0);
  assert.ok(survivors < 1, 'the three living legionaries are a tight knot');

  // Three alive legionaries in a line enclose nothing at all.
  place(env, 1, [
    [10, 10],
    [20, 20],
    [30, 30],
    [15, 15],
    [25, 25],
    [12, 12],
  ]);
  assert.equal(env._formationArea(1), 0);

  // Fewer than three survivors enclose nothing, whatever their positions.
  env.agents[1][2].alive = false;
  env.agents[1][3].alive = false;
  env.agents[1][4].alive = false;
  assert.equal(env._formationArea(1), 0);

  // An extinct faction has no formation.
  for (const a of env.agents[0]) a.alive = false;
  assert.equal(env._formationArea(0), 0);
  assert.equal(env.teamSnapshot(0).formation, 0);
});

test('a huddled squad measures far less ground than a scattered one', () => {
  const env = new BattleEnv({ seed: 14, events: false });

  place(env, 0, [
    [18, 18],
    [18.2, 18.1],
    [18.1, 18.3],
    [18.3, 18.2],
    [18.4, 18.4],
    [18.2, 18.4],
  ]);
  const huddled = env.teamSnapshot(0).formationShare;

  place(env, 0, [
    [4, 6],
    [32, 8],
    [28, 30],
    [6, 32],
    [18, 2],
    [2, 18],
  ]);
  const scattered = env.teamSnapshot(0).formationShare;

  assert.ok(huddled < 0.005, 'a knot of legionaries is nearly zero area');
  assert.ok(scattered > 0.3, 'solo bands spread over the field enclose a lot');
  assert.ok(scattered / huddled > 100, 'the feature should discriminate the two');
  assert.ok(scattered <= 1, 'formation stays a fraction of the field');

  // Spawn formations are tight, so a fresh episode reads as clustered.
  env.reset(15);
  const fresh = [env.teamSnapshot(0).formationShare, env.teamSnapshot(1).formationShare];
  assert.ok(fresh[0] < 0.05 && fresh[1] < 0.05, 'rosters spawn as compact knots');
  assert.ok(env._formationArea(0) > 0, 'six spawn positions do enclose a small area');
});

test('the global state carries both squads as formation fractions', () => {
  const env = new BattleEnv({ seed: 16, events: false });
  assert.equal(
    STATE_DIM,
    FORMATION_OFFSET + 2 + 3 + 3 + 4 + PREDATORS * 4 + 2,
    'the formation block must be two slots wide',
  );

  place(env, 0, [
    [4, 6],
    [32, 8],
    [28, 30],
    [6, 32],
    [18, 2],
    [2, 18],
  ]);
  place(env, 1, [
    [30.5, 5.5],
    [31, 5.9],
    [30.8, 6.2],
    [31.4, 6.1],
    [30.2, 6.3],
    [31.2, 5.2],
  ]);

  const own = env.getState(0);
  const rival = env.getState(1);
  assert.equal(own.length, STATE_DIM);

  // The state is a Float32Array, so compare against the snapshot with tolerance.
  const near = (slot, value) => Math.abs(own[slot] - value) < 1e-4;
  assert.ok(near(FORMATION_OFFSET, env.teamSnapshot(0).formationShare));
  assert.ok(near(FORMATION_OFFSET + 1, env.teamSnapshot(1).formationShare));
  assert.ok(own[FORMATION_OFFSET] > own[FORMATION_OFFSET + 1], 'Azure is spread, Ember is huddled');

  // The block is relative: from Ember's view the huddled squad comes first.
  assert.ok(rival[FORMATION_OFFSET] < rival[FORMATION_OFFSET + 1]);
  assert.ok(own[FORMATION_OFFSET] <= 1);

  // Stepping keeps the feature finite and inside the block.
  for (let i = 0; i < 20; i++) env.step(idle());
  const after = env.getState(0);
  for (let i = 0; i < 2; i++) {
    assert.ok(Number.isFinite(after[FORMATION_OFFSET + i]));
    assert.ok(after[FORMATION_OFFSET + i] >= 0 && after[FORMATION_OFFSET + i] <= 1);
  }
});
