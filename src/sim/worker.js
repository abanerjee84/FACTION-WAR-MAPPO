// Training worker: four parallel worlds, synchronous MAPPO iterations.
// Each iteration posts both factions' fresh actor weights so the live match
// on the main thread always plays the current policy.

import { MAPPOTrainer } from './mappo.js';

let trainer = null;
let running = false;
let timer = 0;

function schedule(delay) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, delay);
}

function post(type, payload, transfer) {
  self.postMessage({ type, ...payload }, transfer || []);
}

function tick() {
  timer = 0;
  if (!running || !trainer) return;
  try {
    const metrics = trainer.runIteration();
    const weights = [trainer.getActorWeights(0), trainer.getActorWeights(1)];
    post('iteration', { metrics, weights }, [weights[0].buffer, weights[1].buffer]);
  } catch (err) {
    running = false;
    post('error', { message: String((err && err.stack) || err) });
    return;
  }
  schedule(12);
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'start') {
    if (!trainer) {
      try {
        trainer = new MAPPOTrainer({
          seed: msg.seed ?? 1234,
          worlds: msg.worlds,
          rollout: msg.rollout,
        });
      } catch (err) {
        post('error', { message: String((err && err.stack) || err) });
        return;
      }
      const weights = [trainer.getActorWeights(0), trainer.getActorWeights(1)];
      post('ready', { weights, shape: trainer.actorShape() }, [weights[0].buffer, weights[1].buffer]);
    }
    running = true;
    schedule(0);
  } else if (msg.type === 'pause') {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
  } else if (msg.type === 'resume') {
    if (!trainer) return;
    running = true;
    schedule(24);
  }
};
