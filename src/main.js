// Live arena controller: renders one spectator match on the main thread while
// the MAPPO trainer runs in a worker and streams fresh actor weights here.

import './styles.css';
import { BattleEnv } from './sim/env.js';
import { ArenaView } from './render/arena.js';
import { Actor } from './sim/policy.js';
import { RNG } from './sim/rng.js';
import {
  ACTIONS,
  AGENTS_PER_TEAM,
  DT,
  MAPPO,
  OBS_DIM,
  RESOURCE_META,
  STRUCTURE_META,
  TEAM_NAMES,
  TEAM_SHORT,
  UNIT_NAMES,
} from './sim/config.js';
import { LineChart } from './render/charts.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['—', 'I', 'II', 'III', 'IV'];

const el = {
  canvas: $('world'),
  episode: $('episode-num'),
  clock: $('match-time'),
  status: $('match-status'),
  alive: [$('alive-0'), $('alive-1')],
  wins: [$('wins-0'), $('wins-1')],
  food: [$('food-0'), $('food-1')],
  wood: [$('wood-0'), $('wood-1')],
  gold: [$('gold-0'), $('gold-1')],
  terr: [$('terr-0'), $('terr-1')],
  gather: [$('gather-0'), $('gather-1')],
  kills: [$('kills-0'), $('kills-1')],
  forge: [$('forge-0'), $('forge-1')],
  towers: [$('towers-0'), $('towers-1')],
  camps: [$('camps-0'), $('camps-1')],
  reward: [$('reward-0'), $('reward-1')],
  roster: [$('roster-0'), $('roster-1')],
  balanceText: $('balance-text'),
  balanceBlue: $('balance-blue'),
  balanceRed: $('balance-red'),
  iteration: $('iteration'),
  steps: $('steps'),
  entropy: $('entropy'),
  kl: $('kl'),
  trainDot: $('train-dot'),
  bar: {
    gather: $('bar-gather'),
    territory: $('bar-territory'),
    combat: $('bar-combat'),
    survival: $('bar-survival'),
    industry: $('bar-industry'),
  },
  val: {
    gather: $('val-gather'),
    territory: $('val-territory'),
    combat: $('val-combat'),
    survival: $('val-survival'),
    industry: $('val-industry'),
  },
  feed: $('event-feed'),
  pause: $('btn-pause'),
  recenter: $('btn-recenter'),
  btnTerritory: $('btn-territory'),
  btnVision: $('btn-vision'),
  btnTrain: $('btn-train'),
  victory: $('victory-overlay'),
  victoryCrest: $('victory-crest'),
  victoryTitle: $('victory-title'),
  victorySub: $('victory-sub'),
  victoryStats: $('victory-stats'),
  victoryCountdown: $('victory-countdown'),
  boot: $('boot-overlay'),
  bootFill: $('boot-bar-fill'),
  speedControl: $('speed-control'),
  chartReward: $('chart-reward'),
  chartPolicy: $('chart-policy'),
  chartValue: $('chart-value'),
};

/* ------------------------------ charts ------------------------------ */

const rewardChart = new LineChart(el.chartReward, {
  smooth: 0.5,
  series: [
    { color: '#6fb2ff', fill: 'rgba(111,178,255,0.22)' },
    { color: '#ff8069', fill: 'rgba(255,128,105,0.18)' },
  ],
});
const policyChart = new LineChart(el.chartPolicy, {
  smooth: 0.35,
  series: [
    { color: '#6fb2ff', fill: 'rgba(111,178,255,0.13)' },
    { color: '#ff8069', fill: 'rgba(255,128,105,0.11)' },
  ],
});
const valueChart = new LineChart(el.chartValue, {
  smooth: 0.35,
  series: [
    { color: '#6fb2ff', fill: 'rgba(111,178,255,0.13)' },
    { color: '#ff8069', fill: 'rgba(255,128,105,0.11)' },
  ],
});

/* ---------------------------- live match ---------------------------- */

const liveEnv = new BattleEnv({ seed: (Math.random() * 0xffffffff) >>> 0, events: true });
const arena = new ArenaView({ canvas: el.canvas, env: liveEnv });

const liveActors = [
  new Actor({ obsDim: OBS_DIM, hidden: MAPPO.hidden, actions: ACTIONS, seed: 0x51a7 }),
  new Actor({ obsDim: OBS_DIM, hidden: MAPPO.hidden, actions: ACTIONS, seed: 0x92b3 }),
];
const liveRng = new RNG((Math.random() * 0xffffffff) >>> 0);
const liveWins = [0, 0];
let liveEpisode = 1;

let liveState = 'live'; // live | ending | victory
let paused = false;
let speed = 1;
let simAccum = 0;
let hudAccum = 0;
let victoryTimer = 0;
let endWinner = -1;
let endSnapshot = null;
let lastGatherLog = -99;
let lastRegrowLog = -99;

const rosterRefs = [[], []];
function buildRoster() {
  for (let team = 0; team < 2; team++) {
    const host = el.roster[team];
    host.innerHTML = '';
    const refs = [];
    for (let i = 0; i < AGENTS_PER_TEAM; i++) {
      const row = document.createElement('div');
      row.className = 'unit-row';
      row.innerHTML = `<span class="unit-dot"></span><span class="unit-name">${UNIT_NAMES[i]}</span><span class="unit-hp"><span class="unit-hp-fill"></span></span>`;
      host.appendChild(row);
      refs.push({ row, fill: row.querySelector('.unit-hp-fill') });
    }
    rosterRefs[team] = refs;
  }
}
buildRoster();

/* ------------------------------ helpers ----------------------------- */

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function compact(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function logFeed(html, cls = '') {
  const item = document.createElement('div');
  item.className = `event-item ${cls}`;
  item.innerHTML = `${html}<span class="t">${fmtTime(liveEnv.time)}</span>`;
  el.feed.appendChild(item);
  while (el.feed.children.length > 7) el.feed.removeChild(el.feed.firstChild);
}

function selectActions() {
  const actions = [[], []];
  for (let team = 0; team < 2; team++) {
    const obs = liveEnv.getObs(team);
    const masks = liveEnv.getMasks(team);
    const agents = liveEnv.agents[team];
    const actor = liveActors[team];
    const acts = actions[team];
    for (let i = 0; i < AGENTS_PER_TEAM; i++) {
      if (!agents[i].alive) {
        acts[i] = 0;
        continue;
      }
      const view = obs.subarray(i * OBS_DIM, (i + 1) * OBS_DIM);
      acts[i] = actor.act(view, masks, i * ACTIONS, liveRng).action;
    }
  }
  return actions;
}

function processEvents(events) {
  for (const ev of events) {
    if (ev.type === 'gather') {
      if (liveEnv.time - lastGatherLog > 2.6) {
        lastGatherLog = liveEnv.time;
        const meta = RESOURCE_META[ev.kind];
        logFeed(
          `<b>${TEAM_SHORT[ev.team]}</b> gathers ${meta.label.toLowerCase()}`,
          ev.team === 0 ? 'blue' : 'red',
        );
      }
    } else if (ev.type === 'death') {
      if (ev.starve) {
        logFeed(`A <b>${TEAM_SHORT[ev.team]}</b> legionary starved`, 'danger');
      } else {
        const by = ev.killer >= 0 ? ` to <b>${TEAM_SHORT[ev.killer]}</b>` : '';
        logFeed(`A <b>${TEAM_SHORT[ev.team]}</b> legionary falls${by}`, 'danger');
      }
    } else if (ev.type === 'starve') {
      logFeed(`<b>${TEAM_SHORT[ev.team]}</b> units are starving`, 'danger');
    } else if (ev.type === 'depleted') {
      logFeed(`${RESOURCE_META[ev.kind].label} node exhausted`);
    } else if (ev.type === 'regrow') {
      if (liveEnv.time - lastRegrowLog > 5) {
        lastRegrowLog = liveEnv.time;
        logFeed(`${RESOURCE_META[ev.kind].label} returns to the field`);
      }
    } else if (ev.type === 'build') {
      const meta = STRUCTURE_META[ev.kind];
      logFeed(
        `<b>${TEAM_SHORT[ev.team]}</b> raises a ${meta.label.toLowerCase()}`,
        ev.team === 0 ? 'blue' : 'red',
      );
    } else if (ev.type === 'forge') {
      logFeed(
        `<b>${TEAM_SHORT[ev.team]}</b> forge reaches ${ROMAN[ev.level] || ev.level}`,
        ev.team === 0 ? 'blue' : 'red',
      );
    } else if (ev.type === 'bolt') {
      if (Math.random() < 0.12) {
        logFeed(
          `<b>${TEAM_SHORT[ev.team]}</b> watchtower strikes for ${Math.round(ev.dmg)}`,
          ev.team === 0 ? 'blue' : 'red',
        );
      }
    } else if (ev.type === 'hit') {
      if (Math.random() < 0.07) {
        logFeed(
          `<b>${TEAM_SHORT[ev.team]}</b> strikes for ${Math.round(ev.dmg)}`,
          ev.team === 0 ? 'blue' : 'red',
        );
      }
    }
  }
}

function simulateStep() {
  if (liveState !== 'live') return;
  const outcome = liveEnv.step(selectActions());
  arena.handleEvents(outcome.events);
  processEvents(outcome.events);
  if (outcome.terminated) {
    endWinner = outcome.winner;
    endSnapshot = [liveEnv.teamSnapshot(0), liveEnv.teamSnapshot(1)];
    liveState = 'ending';
    victoryTimer = 0.9;
  }
}

/* ---------------------------- victory flow --------------------------- */

function showVictory() {
  liveState = 'victory';
  victoryTimer = 5;
  const winner = endWinner;
  const valid = winner === 0 || winner === 1;

  el.victoryCrest.textContent = valid ? (winner === 0 ? '✦' : '✧') : '†';
  el.victoryCrest.style.color = valid ? (winner === 0 ? '#8ec6ff' : '#ff947d') : '#d9b46c';
  el.victoryTitle.textContent = valid ? `${TEAM_NAMES[winner]} Triumphs` : 'Mutual Ruin';
  el.victorySub.textContent = valid
    ? `${TEAM_NAMES[1 - winner]} has fallen — no legionary remains.`
    : 'Every legionary on the field has perished.';

  const side = valid ? winner : 0;
  const snap = endSnapshot ? endSnapshot[side] : liveEnv.teamSnapshot(side);
  el.victoryStats.innerHTML = [
    ['DURATION', fmtTime(liveEnv.time)],
    ['GATHERED', Math.floor(snap.gatheredTotal)],
    ['BUILDS', snap.builds],
    ['FORGE', ROMAN[snap.forge] || snap.forge],
    ['KILLS', snap.kills],
    ['SURVIVORS', snap.alive],
  ]
    .map(([label, value]) => `<div><b>${value}</b>${label}</div>`)
    .join('');

  if (valid) liveWins[winner] += 1;
  el.wins[0].textContent = liveWins[0];
  el.wins[1].textContent = liveWins[1];
  el.victory.classList.add('show');
  if (valid) {
    logFeed(`<b>${TEAM_SHORT[winner]}</b> holds the field`, winner === 0 ? 'blue' : 'red');
  } else {
    logFeed('The field is silent — mutual annihilation', 'danger');
  }
}

function resetLive() {
  el.victory.classList.remove('show');
  el.victoryCrest.style.color = '';
  liveState = 'live';
  liveEpisode += 1;
  liveEnv.reset((Math.random() * 0xffffffff) >>> 0);
  endWinner = -1;
  endSnapshot = null;
  simAccum = 0;
  lastGatherLog = -99;
  lastRegrowLog = -99;
  el.feed.innerHTML = '';
  logFeed('A new warband takes the field');
}

/* ------------------------------ training ----------------------------- */

let worker = null;
let workerOk = false;
let workerFailed = false;
let trainingOn = true;
let warmCount = 0;
let bootDone = false;
let latestMetrics = null;
const BOOT_TARGET = 8;

function applyWeights(weights) {
  if (!weights || !weights[0] || !weights[1]) return;
  liveActors[0].importWeights(weights[0]);
  liveActors[1].importWeights(weights[1]);
}

function updateTelemetry(metrics) {
  latestMetrics = metrics;
  const [a, b] = metrics.teams;
  el.iteration.textContent = metrics.iteration;
  el.steps.textContent = compact(metrics.totalSteps);
  el.entropy.textContent = ((a.rolloutEntropy + b.rolloutEntropy) / 2).toFixed(2);
  el.kl.textContent = ((a.approxKL + b.approxKL) / 2).toFixed(3);

  rewardChart.push([a.rewardPerStep, b.rewardPerStep]);
  policyChart.push([a.actorLoss, b.actorLoss]);
  valueChart.push([a.criticLoss, b.criticLoss]);

  for (const key of ['gather', 'territory', 'combat', 'survival', 'industry']) {
    const share = (a.partsShare[key] + b.partsShare[key]) / 2;
    el.bar[key].style.width = `${(share * 100).toFixed(1)}%`;
    el.val[key].textContent = `${Math.round(share * 100)}%`;
  }
}

function finishBoot() {
  if (bootDone) return;
  bootDone = true;
  el.bootFill.style.width = '100%';
  setTimeout(() => el.boot.classList.add('done'), 260);
}

function startTraining() {
  if (!worker || workerFailed) return;
  worker.postMessage({
    type: 'start',
    seed: (Math.random() * 0xffffffff) >>> 0,
    worlds: MAPPO.worlds,
    rollout: MAPPO.rollout,
  });
}

function initWorker() {
  try {
    worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    console.error('Worker unavailable', err);
    workerFailed = true;
    finishBoot();
    return;
  }
  worker.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === 'ready') {
      workerOk = true;
      applyWeights(msg.weights);
      el.trainDot.classList.remove('paused');
    } else if (msg.type === 'iteration') {
      applyWeights(msg.weights);
      updateTelemetry(msg.metrics);
      if (!bootDone) {
        warmCount += 1;
        const pct = Math.min(99, 6 + (warmCount / BOOT_TARGET) * 90);
        el.bootFill.style.width = `${pct.toFixed(0)}%`;
        if (warmCount >= BOOT_TARGET) finishBoot();
      }
    } else if (msg.type === 'error') {
      console.error('Trainer error', msg.message);
      workerFailed = true;
      workerOk = false;
      el.trainDot.classList.add('paused');
      finishBoot();
    }
  };
  worker.onerror = (err) => {
    console.error('Worker error', err.message || err);
    workerFailed = true;
    workerOk = false;
    el.trainDot.classList.add('paused');
    finishBoot();
  };
  startTraining();
}

/* -------------------------------- HUD -------------------------------- */

function updateHud() {
  const snapshot = [liveEnv.teamSnapshot(0), liveEnv.teamSnapshot(1)];
  for (let team = 0; team < 2; team++) {
    const s = snapshot[team];
    el.alive[team].textContent = s.alive;
    el.food[team].textContent = Math.floor(s.stock.food);
    el.wood[team].textContent = Math.floor(s.stock.wood);
    el.gold[team].textContent = Math.floor(s.stock.gold);
    el.terr[team].textContent = `${(s.territoryShare * 100).toFixed(0)}%`;
    el.gather[team].textContent = Math.floor(s.gatheredTotal);
    el.kills[team].textContent = s.kills;
    el.forge[team].textContent = ROMAN[s.forge] || s.forge;
    el.towers[team].textContent = s.structures.tower;
    el.camps[team].textContent = s.structures.camp;
    el.reward[team].textContent = s.reward.toFixed(1);
    for (let i = 0; i < AGENTS_PER_TEAM; i++) {
      const agent = liveEnv.agents[team][i];
      const ref = rosterRefs[team][i];
      ref.row.classList.toggle('dead', !agent.alive);
      ref.row.classList.toggle('starving', agent.alive && agent.starving);
      ref.fill.style.width = `${Math.max(0, Math.round(agent.hp))}%`;
    }
  }

  const share0 = snapshot[0].territoryShare * 100;
  const share1 = snapshot[1].territoryShare * 100;
  el.balanceBlue.style.width = `${share0.toFixed(1)}%`;
  el.balanceRed.style.width = `${share1.toFixed(1)}%`;
  el.balanceText.textContent = `${share0.toFixed(0)} — ${share1.toFixed(0)}`;

  el.episode.textContent = String(liveEpisode).padStart(2, '0');
  el.clock.textContent = fmtTime(liveEnv.time);
  if (paused) {
    el.status.textContent = 'SPECTATOR PAUSED';
  } else if (liveState === 'victory' || liveState === 'ending') {
    el.status.textContent = 'BATTLE CONCLUDED';
  } else if (workerOk && trainingOn) {
    el.status.textContent = `LIVE POLICY · ITER ${latestMetrics ? latestMetrics.iteration : 0}`;
  } else if (workerFailed) {
    el.status.textContent = 'LIVE POLICY · TRAINING OFFLINE';
  } else {
    el.status.textContent = 'LIVE POLICY';
  }
}

/* ------------------------------ controls ------------------------------ */

el.pause.addEventListener('click', () => {
  paused = !paused;
  el.pause.textContent = paused ? 'RESUME' : 'PAUSE';
  el.pause.classList.toggle('paused', paused);
});

el.recenter.addEventListener('click', () => arena.recenter());

el.btnTerritory.addEventListener('click', () => {
  const on = el.btnTerritory.classList.toggle('active');
  arena.toggleTerritory(on);
});

el.btnVision.addEventListener('click', () => {
  const on = el.btnVision.classList.toggle('active');
  arena.toggleVision(on);
  arena.setVisionVisible(on);
});

el.btnTrain.addEventListener('click', () => {
  if (workerFailed) return;
  trainingOn = !trainingOn;
  el.btnTrain.classList.toggle('active', trainingOn);
  el.trainDot.classList.toggle('paused', !trainingOn || !workerOk);
  if (worker) worker.postMessage({ type: trainingOn ? 'resume' : 'pause' });
});

el.speedControl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-speed]');
  if (!button) return;
  speed = Number(button.dataset.speed) || 1;
  for (const b of el.speedControl.querySelectorAll('button')) {
    b.classList.toggle('active', b === button);
  }
});

el.boot.addEventListener('click', finishBoot);
el.boot.title = 'Click to skip warm-up';

/* -------------------------------- loop -------------------------------- */

function updateVictory(dt) {
  if (liveState === 'ending') {
    victoryTimer -= dt;
    if (victoryTimer <= 0) showVictory();
    return;
  }
  if (liveState === 'victory') {
    victoryTimer -= dt;
    el.victoryCountdown.textContent = Math.max(0, Math.ceil(victoryTimer));
    if (victoryTimer <= 0) resetLive();
  }
}

let lastFrame = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - lastFrame) / 1000;
  lastFrame = now;
  // Allow slower machines to keep the simulation near wall-clock speed without
  // jumping violently after a suspended tab.
  const dt = Math.min(0.25, Math.max(0, raw));

  if (!paused) {
    if (liveState === 'live') {
      simAccum += dt * speed;
      let budget = 40;
      while (simAccum >= DT && budget-- > 0 && liveState === 'live') {
        simAccum -= DT;
        simulateStep();
      }
      if (simAccum > DT * 10) simAccum = 0;
    } else {
      simAccum = 0;
      updateVictory(dt);
    }
  }

  arena.update(dt);

  hudAccum += dt;
  if (hudAccum >= 0.12) {
    hudAccum = 0;
    updateHud();
  }
}

/* -------------------------------- boot -------------------------------- */

el.bootFill.style.width = '4%';
updateHud();
requestAnimationFrame(frame);

requestAnimationFrame(() => {
  setTimeout(() => {
    initWorker();
    setTimeout(() => {
      if (!bootDone) finishBoot();
    }, 16000);
  }, 120);
});

if (import.meta.env.DEV) {
  window.__aether = {
    env: liveEnv,
    arena,
    actors: liveActors,
    state: () => ({ liveState, paused, speed, episode: liveEpisode }),
  };
}
