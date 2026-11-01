// Small dependency-free line chart tuned for the parchment/glass HUD.
// Smooths incoming metric points with an EMA so per-iteration PPO noise does
// not hide the trend, while keeping the raw series for the y-range.

const FONT = '600 7px Inter, system-ui, sans-serif';

export class LineChart {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = options.series || [
      { color: '#6fb2ff', fill: 'rgba(111,178,255,0.20)' },
      { color: '#ff8069', fill: 'rgba(255,128,105,0.16)' },
    ];
    this.maxPoints = options.maxPoints ?? 180;
    this.smooth = options.smooth ?? 0.38;
    this.zeroLine = options.zeroLine ?? true;
    this.height = options.height ?? Number(canvas.getAttribute('height')) ?? 96;
    this.padTop = 7;
    this.padBottom = 15;
    this.padX = 5;

    this.raw = this.series.map(() => []);
    this.ema = this.series.map(() => []);
    this.w = 0;
    this.h = 0;

    canvas.style.height = `${this.height}px`;

    this._resize = () => this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this._resize);
      this.observer.observe(canvas);
    } else {
      window.addEventListener('resize', this._resize);
    }
    requestAnimationFrame(this._resize);
  }

  push(values) {
    for (let s = 0; s < this.series.length; s++) {
      const v = values[s];
      if (!Number.isFinite(v)) {
        this.raw[s].push(null);
        this.ema[s].push(null);
        continue;
      }
      const prev = this.ema[s][this.ema[s].length - 1];
      const smoothed = prev === null || prev === undefined ? v : prev + (v - prev) * this.smooth;
      this.raw[s].push(v);
      this.ema[s].push(smoothed);
      if (this.raw[s].length > this.maxPoints) {
        this.raw[s].shift();
        this.ema[s].shift();
      }
    }
    this.draw();
  }

  clear() {
    for (let s = 0; s < this.series.length; s++) {
      this.raw[s].length = 0;
      this.ema[s].length = 0;
    }
    this.draw();
  }

  resize() {
    const cssW = this.canvas.clientWidth;
    if (!cssW) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssH = this.height;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = cssW;
    this.h = cssH;
    this.draw();
  }

  _range() {
    let min = Infinity;
    let max = -Infinity;
    for (const line of this.ema) {
      for (const v of line) {
        if (v === null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    if (this.zeroLine) {
      if (min > 0) min = 0;
      if (max < 0) max = 0;
    }
    if (max - min < 1e-6) {
      const mid = (max + min) / 2;
      min = mid - 0.5;
      max = mid + 0.5;
    }
    const pad = (max - min) * 0.14;
    return [min - pad, max + pad];
  }

  _fmt(v) {
    if (!Number.isFinite(v)) return '';
    const a = Math.abs(v);
    if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    return v.toFixed(4);
  }

  draw() {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    if (this.ema[0].length === 0) return;

    const [lo, hi] = this._range();
    const top = this.padTop;
    const bottom = h - this.padBottom;
    const left = this.padX;
    const right = w - this.padX;
    const span = hi - lo || 1;
    const yOf = (v) => bottom - ((v - lo) / span) * (bottom - top);
    const n = Math.max(this.ema[0].length, 2);
    const xOf = (i) => left + (i / (n - 1)) * (right - left);

    // Grid.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
    ctx.beginPath();
    for (let g = 0; g <= 3; g++) {
      const y = Math.round(top + ((bottom - top) * g) / 3) + 0.5;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();

    // Zero baseline.
    if (this.zeroLine && lo < 0 && hi > 0) {
      const y = Math.round(yOf(0)) + 0.5;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(217, 180, 108, 0.22)';
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (let s = 0; s < this.series.length; s++) {
      const line = this.ema[s];
      if (!line.length) continue;
      const meta = this.series[s];

      // Area fill under the curve.
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, meta.fill || 'rgba(255,255,255,0.12)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < line.length; i++) {
        const v = line[i];
        if (v === null) {
          started = false;
          continue;
        }
        const x = xOf(i);
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      const lastX = xOf(line.length - 1);
      ctx.lineTo(lastX, bottom);
      ctx.lineTo(xOf(0), bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Stroke.
      ctx.beginPath();
      started = false;
      for (let i = 0; i < line.length; i++) {
        const v = line[i];
        if (v === null) {
          started = false;
          continue;
        }
        const x = xOf(i);
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = meta.color;
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Leading dot.
      const lastV = line[line.length - 1];
      if (lastV !== null) {
        const x = lastX;
        const y = yOf(lastV);
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = meta.color;
        ctx.shadowColor = meta.color;
        ctx.shadowBlur = 7;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, 3.6, 0, Math.PI * 2);
        ctx.strokeStyle = meta.color;
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Y range + iteration labels.
    ctx.font = FONT;
    ctx.fillStyle = 'rgba(196, 188, 165, 0.42)';
    ctx.textAlign = 'left';
    ctx.fillText(this._fmt(hi), left + 1, top + 6);
    ctx.fillText(this._fmt(lo), left + 1, bottom - 3);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(196, 188, 165, 0.30)';
    ctx.fillText(`ITER ${this.ema[0].length}`, right - 1, h - 3);
  }
}
