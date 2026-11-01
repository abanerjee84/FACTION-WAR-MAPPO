export class RNG {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }

  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  // Box–Muller, used sparingly (initial network weights, live action sampling).
  normal(mean = 0, std = 1) {
    const u = Math.max(1e-7, this.next());
    const v = this.next();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export function mulberry(seed) {
  const r = new RNG(seed);
  return () => r.next();
}
