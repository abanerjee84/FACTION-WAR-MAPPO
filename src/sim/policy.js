import { RNG } from './rng.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Minimal dense network with manual backprop and Adam. Hidden layers are tanh,
 * the output layer is linear. Gradients accumulate across a PPO minibatch and
 * are globally norm-clipped once per optimizer step.
 */
export class MLP {
  constructor(sizes, rng, { outScale = 0.01 } = {}) {
    this.sizes = sizes.slice();
    this.layers = sizes.length - 1;
    this.W = [];
    this.b = [];
    this.gW = [];
    this.gB = [];
    this.mW = [];
    this.vW = [];
    this.mB = [];
    this.vB = [];
    this.t = 0;

    for (let l = 0; l < this.layers; l++) {
      const fanIn = sizes[l];
      const fanOut = sizes[l + 1];
      const w = new Float32Array(fanIn * fanOut);
      const limit = l === this.layers - 1 ? outScale : Math.sqrt(6 / (fanIn + fanOut));
      for (let i = 0; i < w.length; i++) {
        w[i] = l === this.layers - 1 ? rng.normal(0, outScale) : rng.normal(0, limit);
      }
      this.W.push(w);
      this.b.push(new Float32Array(fanOut));
      this.gW.push(new Float32Array(w.length));
      this.gB.push(new Float32Array(fanOut));
      this.mW.push(new Float32Array(w.length));
      this.vW.push(new Float32Array(w.length));
      this.mB.push(new Float32Array(fanOut));
      this.vB.push(new Float32Array(fanOut));
    }

    this.cacheA = new Array(this.layers + 1).fill(null);
    this.tmp = new Array(this.layers).fill(null);
    for (let l = 0; l < this.layers; l++) {
      // Scratch for the gradient flowing back into layer l. Its length is the
      // width of layer l's input, i.e. the output width of layer l-1.
      this.tmp[l] = new Float32Array(sizes[l + 1]);
    }
  }

  forward(x, cache = false) {
    let a = x;
    if (cache) this.cacheA[0] = x;
    for (let l = 0; l < this.layers; l++) {
      const w = this.W[l];
      const b = this.b[l];
      const nIn = this.sizes[l];
      const nOut = this.sizes[l + 1];
      const out = cache
        ? this.cacheA[l + 1] && this.cacheA[l + 1].length === nOut
          ? this.cacheA[l + 1]
          : (this.cacheA[l + 1] = new Float32Array(nOut))
        : new Float32Array(nOut);
      for (let o = 0; o < nOut; o++) {
        let sum = b[o];
        const row = o * nIn;
        for (let i = 0; i < nIn; i++) sum += w[row + i] * a[i];
        out[o] = l === this.layers - 1 ? sum : Math.tanh(sum);
      }
      a = out;
    }
    return a;
  }

  backward(dOut) {
    let delta = dOut;
    for (let l = this.layers - 1; l >= 0; l--) {
      const nIn = this.sizes[l];
      const nOut = this.sizes[l + 1];
      const input = this.cacheA[l];
      const w = this.W[l];
      const gw = this.gW[l];
      const gb = this.gB[l];
      for (let o = 0; o < nOut; o++) {
        const d = delta[o];
        if (d === 0) continue;
        gb[o] += d;
        const row = o * nIn;
        for (let i = 0; i < nIn; i++) gw[row + i] += d * input[i];
      }
      if (l > 0) {
        const dPrev = this.tmp[l - 1];
        dPrev.fill(0);
        for (let o = 0; o < nOut; o++) {
          const d = delta[o];
          if (d === 0) continue;
          const row = o * nIn;
          for (let i = 0; i < nIn; i++) dPrev[i] += w[row + i] * d;
        }
        for (let i = 0; i < nIn; i++) {
          const a = input[i];
          dPrev[i] *= 1 - a * a;
        }
        delta = dPrev;
      }
    }
  }

  zeroGrads() {
    for (let l = 0; l < this.layers; l++) {
      this.gW[l].fill(0);
      this.gB[l].fill(0);
    }
  }

  stepAdam(lr, gradScale, maxNorm) {
    let normSq = 0;
    for (let l = 0; l < this.layers; l++) {
      const g = this.gW[l];
      for (let i = 0; i < g.length; i++) {
        const v = g[i] * gradScale;
        normSq += v * v;
      }
      const gb = this.gB[l];
      for (let i = 0; i < gb.length; i++) {
        const v = gb[i] * gradScale;
        normSq += v * v;
      }
    }
    const norm = Math.sqrt(normSq);
    let scale = gradScale;
    if (norm > maxNorm && norm > 0) scale *= maxNorm / norm;

    this.t += 1;
    const b1 = 0.9;
    const b2 = 0.999;
    const bc1 = 1 - Math.pow(b1, this.t);
    const bc2 = 1 - Math.pow(b2, this.t);
    const eps = 1e-8;

    for (let l = 0; l < this.layers; l++) {
      const w = this.W[l];
      const gw = this.gW[l];
      const mw = this.mW[l];
      const vw = this.vW[l];
      for (let i = 0; i < w.length; i++) {
        const g = gw[i] * scale;
        mw[i] = b1 * mw[i] + (1 - b1) * g;
        vw[i] = b2 * vw[i] + (1 - b2) * g * g;
        w[i] -= (lr * (mw[i] / bc1)) / (Math.sqrt(vw[i] / bc2) + eps);
        gw[i] = 0;
      }
      const b = this.b[l];
      const gbv = this.gB[l];
      const mb = this.mB[l];
      const vb = this.vB[l];
      for (let i = 0; i < b.length; i++) {
        const g = gbv[i] * scale;
        mb[i] = b1 * mb[i] + (1 - b1) * g;
        vb[i] = b2 * vb[i] + (1 - b2) * g * g;
        b[i] -= (lr * (mb[i] / bc1)) / (Math.sqrt(vb[i] / bc2) + eps);
        gbv[i] = 0;
      }
    }
  }

  exportWeights() {
    let n = 0;
    for (let l = 0; l < this.layers; l++) n += this.W[l].length + this.b[l].length;
    const out = new Float32Array(n);
    let o = 0;
    for (let l = 0; l < this.layers; l++) {
      out.set(this.W[l], o);
      o += this.W[l].length;
      out.set(this.b[l], o);
      o += this.b[l].length;
    }
    return out;
  }

  importWeights(flat) {
    let o = 0;
    for (let l = 0; l < this.layers; l++) {
      if (o + this.W[l].length > flat.length) return false;
      this.W[l].set(flat.subarray(o, o + this.W[l].length));
      o += this.W[l].length;
      if (o + this.b[l].length > flat.length) return false;
      this.b[l].set(flat.subarray(o, o + this.b[l].length));
      o += this.b[l].length;
    }
    return true;
  }
}

export function maskedSoftmax(logits, mask, maskOffset, actionCount, temperature = 1, out = null) {
  const probs = out || new Float32Array(actionCount);
  let max = -Infinity;
  let any = false;
  for (let i = 0; i < actionCount; i++) {
    probs[i] = 0;
    if (mask[maskOffset + i]) {
      any = true;
      const v = logits[i] / temperature;
      if (v > max) max = v;
    }
  }
  if (!any) {
    for (let i = 0; i < actionCount; i++) probs[i] = 1 / actionCount;
    return probs;
  }
  let sum = 0;
  for (let i = 0; i < actionCount; i++) {
    if (!mask[maskOffset + i]) continue;
    const e = Math.exp(logits[i] / temperature - max);
    probs[i] = e;
    sum += e;
  }
  const inv = 1 / sum;
  for (let i = 0; i < actionCount; i++) probs[i] *= inv;
  return probs;
}

export class Actor {
  constructor({ obsDim, hidden = 64, actions = 11, seed = 1 }) {
    this.obsDim = obsDim;
    this.hidden = hidden;
    this.actions = actions;
    this.rng = new RNG(seed);
    this.mlp = new MLP([obsDim, hidden, hidden, actions], this.rng, { outScale: 0.01 });
    this._probs = new Float32Array(actions);
    this._logits = null;
    this._dLogits = new Float32Array(actions);
    this._gOut = new Float32Array(1);
  }

  forwardLogits(obs, cache = false) {
    return this.mlp.forward(obs, cache);
  }

  act(obs, mask, maskOffset, rng, { temperature = 1, greedy = false } = {}) {
    const logits = this.forwardLogits(obs, false);
    const probs = maskedSoftmax(logits, mask, maskOffset, this.actions, temperature, this._probs);
    let action = 0;
    if (greedy) {
      let best = -1;
      for (let i = 0; i < this.actions; i++) {
        if (mask[maskOffset + i] && probs[i] > best) {
          best = probs[i];
          action = i;
        }
      }
    } else {
      const r = rng.next();
      let acc = 0;
      let chosen = -1;
      for (let i = 0; i < this.actions; i++) {
        if (!mask[maskOffset + i]) continue;
        acc += probs[i];
        chosen = i;
        if (r <= acc) break;
      }
      action = chosen >= 0 ? chosen : 0;
    }
    let logp = 0;
    let entropy = 0;
    for (let i = 0; i < this.actions; i++) {
      const p = probs[i];
      if (p > 1e-9) entropy -= p * Math.log(p);
    }
    logp = Math.log(Math.max(probs[action], 1e-9));
    return { action, logp, entropy, probs };
  }

  /**
   * Accumulates the clipped-PPO + entropy gradient for one agent-time sample.
   * Returns diagnostics; call step() once per minibatch.
   */
  accumulate(obs, action, oldLogp, advantage, mask, maskOffset, entropyCoef, clipEps) {
    const logits = this.mlp.forward(obs, true);
    const probs = maskedSoftmax(logits, mask, maskOffset, this.actions, 1, this._probs);
    let entropy = 0;
    for (let i = 0; i < this.actions; i++) {
      const p = probs[i];
      if (p > 1e-9) entropy -= p * Math.log(p);
    }
    const logp = Math.log(Math.max(probs[action], 1e-9));
    const ratio = Math.exp(clamp(logp - oldLogp, -20, 20));
    const clipped = clamp(ratio, 1 - clipEps, 1 + clipEps);
    const surrA = ratio * advantage;
    const surrB = clipped * advantage;
    const loss = -Math.min(surrA, surrB) - entropyCoef * entropy;
    const policyGrad = surrA <= surrB ? -advantage * ratio : 0;

    const d = this._dLogits;
    for (let i = 0; i < this.actions; i++) {
      if (!mask[maskOffset + i]) {
        d[i] = 0;
        continue;
      }
      const p = probs[i];
      const oneHot = i === action ? 1 : 0;
      let g = policyGrad * (oneHot - p);
      if (p > 1e-9) g += entropyCoef * p * (Math.log(p) + entropy);
      d[i] = g;
    }
    this.mlp.backward(d);

    return {
      loss,
      entropy,
      ratio,
      clipFrac: Math.abs(ratio - 1) > clipEps ? 1 : 0,
      approxKL: ratio - 1 - Math.log(Math.max(ratio, 1e-9)),
    };
  }

  zeroGrads() {
    this.mlp.zeroGrads();
  }

  step(lr, gradScale, maxNorm) {
    this.mlp.stepAdam(lr, gradScale, maxNorm);
  }

  exportWeights() {
    return this.mlp.exportWeights();
  }

  importWeights(flat) {
    return this.mlp.importWeights(flat);
  }
}

export class Critic {
  constructor({ stateDim, hidden = 96, seed = 1 }) {
    this.stateDim = stateDim;
    this.hidden = hidden;
    this.rng = new RNG(seed);
    this.mlp = new MLP([stateDim, hidden, hidden, 1], this.rng, { outScale: 0.05 });
    this._gOut = new Float32Array(1);
  }

  predict(state) {
    return this.mlp.forward(state, false)[0];
  }

  accumulate(state, target, oldValue, weight, clipEps) {
    const out = this.mlp.forward(state, true);
    const value = out[0];
    const diff = value - oldValue;
    const clippedValue = oldValue + clamp(diff, -clipEps, clipEps);
    const dA = value - target;
    const dB = clippedValue - target;
    const useUnclipped = dA * dA >= dB * dB;
    const loss = 0.5 * (useUnclipped ? dA * dA : dB * dB);
    this._gOut[0] = useUnclipped ? dA * weight : 0;
    this.mlp.backward(this._gOut);
    return { loss: loss * weight, value };
  }

  step(lr, gradScale, maxNorm) {
    this.mlp.stepAdam(lr, gradScale, maxNorm);
  }

  zeroGrads() {
    this.mlp.zeroGrads();
  }
}
