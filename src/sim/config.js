// Shared simulation + learning constants. Keep these in sync with the telemetry HUD.

export const WORLD = 36;
export const CELL = 2;
export const CELLS = WORLD / CELL;
export const AGENTS_PER_TEAM = 6;
export const TEAMS = 2;

export const DT = 0.1;
export const VISION = 7.0;
export const MOVE_SPEED = 2.55;
export const ATTACK_RANGE = 1.55;
export const HARVEST_RANGE = 1.8;

export const MAX_HP = 100;
export const MAX_ENERGY = 100;
export const ENERGY_DRAIN = 1.35;
export const EAT_THRESHOLD = 34;
export const EAT_COST = 3;
export const EAT_ENERGY = 33;
export const STARVE_HP_DRAIN = 4.0;
export const REGEN = 0.3;

export const ATTACK_DAMAGE = 16;
export const ATTACK_COOLDOWN = 0.75;

export const ACTION_IDLE = 0;
export const ACTION_HARVEST = 9;
export const ACTION_ATTACK = 10;
export const ACTION_BUILD_TOWER = 11;
export const ACTION_BUILD_CAMP = 12;
export const ACTIONS = 13;

export const RESOURCE_TYPES = ['food', 'wood', 'gold'];
export const RESOURCE_META = {
  // regrow: seconds before a spent node returns. respawn: fraction of capacity
  // restored. Food is the lifeblood of a warband, so it still comes back
  // fastest of the three — but not instantly, so foraging has to be planned.
  food: { max: 90, rate: 9, regrow: 18, respawn: 0.85, label: 'Food', color: '#9bcf6a' },
  wood: { max: 140, rate: 8, regrow: 30, respawn: 0.85, label: 'Wood', color: '#c2905c' },
  gold: { max: 70, rate: 6, regrow: 48, respawn: 0.7, label: 'Gold', color: '#f3c964' },
};

// Wood is spent on forward structures. Towers project territory and fire on
// intruders; camps generate food and mend nearby legionaries.
export const STRUCTURE_META = {
  tower: {
    label: 'Watchtower',
    short: 'TOWER',
    cost: 18,
    max: 3,
    spacing: 3.2,
    range: 5.6,
    damage: 8,
    cooldown: 1.8,
    influence: 4.2,
    influenceRate: 1.35,
    color: '#e0c184',
  },
  camp: {
    label: 'Field Camp',
    short: 'CAMP',
    cost: 14,
    max: 2,
    spacing: 2.8,
    radius: 3.4,
    heal: 2.4,
    food: 0.5,
    influence: 2.4,
    influenceRate: 0.8,
    color: '#9bcf6a',
  },
};
export const MAX_STRUCTURES_PER_TEAM =
  STRUCTURE_META.tower.max + STRUCTURE_META.camp.max;

// Gold is melted into team-wide equipment tiers. Every living legionary gains
// damage and maximum health, making gold a long-term military investment.
export const MAX_FORGE = 4;
export const FORGE_COST = [25, 50, 80, 120];
export const FORGE_HP = [0, 12, 26, 42, 60];
export const FORGE_DAMAGE = [0, 3, 6, 9, 12];
export const FORGE_NAMES = ['Militia', 'Bronze', 'Iron', 'Steel', 'Mithril'];

// Reward weights, tuned so a minute of dedicated gathering is worth roughly
// the same as a decisive mid-field fight plus the territory it secures.
export const REWARD = {
  food: 0.09,
  wood: 0.055,
  gold: 0.2,
  territoryCapture: 0.22,
  territoryHold: 0.012,
  survival: 0.06,
  damage: 0.08,
  kill: 1.8,
  death: -1.8,
  starving: 0.28,
  starveDeath: -1.2,
  build: 0.9,
  forge: 1.6,
  campFood: 0.05,
  victory: 10,
  defeat: -10,
};

export const OBS_SELF = 6;
export const OBS_RES_K = 3;
export const OBS_RES_F = 5;
export const OBS_ALLY_K = 4;
export const OBS_ALLY_F = 4;
export const OBS_ENEMY_K = 5;
export const OBS_ENEMY_F = 5;
export const OBS_TERR = 3;
export const OBS_BASE = 3;
export const OBS_ECON = 5; // team food/wood/gold, forge tier, own structures
export const OBS_ID = AGENTS_PER_TEAM;

export const OBS_DIM =
  OBS_SELF +
  RESOURCE_TYPES.length * OBS_RES_K * OBS_RES_F +
  OBS_ALLY_K * OBS_ALLY_F +
  OBS_ENEMY_K * OBS_ENEMY_F +
  OBS_TERR +
  OBS_BASE +
  OBS_ECON +
  OBS_ID;

export const STATE_DIM =
  AGENTS_PER_TEAM * 6 * 2 + // own + enemy roster features
  3 + // stockpiles
  3 + // lifetime gathered
  3 + // territory shares (own / enemy / neutral)
  2 + // alive counts
  3 + // remaining resources
  3 + // living nodes
  4 + // forge tiers + structure counts (own / enemy)
  2; // time phase

export const TEAM_NAMES = ['Azure Compact', 'Ember Dominion'];
export const TEAM_SHORT = ['AZURE', 'EMBER'];
export const UNIT_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export const DIRS = [
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

export const MAPPO = {
  rollout: 96,
  worlds: 4,
  gamma: 0.99,
  lambda: 0.95,
  clip: 0.2,
  epochs: 3,
  minibatch: 256,
  actorLR: 3e-4,
  criticLR: 7e-4,
  entropy: 0.012,
  valueClip: 0.2,
  maxGradNorm: 0.5,
  hidden: 64,
  criticHidden: 96,
};
