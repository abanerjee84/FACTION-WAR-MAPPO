// README media capture. Needs the dev server running (npm run dev).
//   node scripts/capture.mjs   -> clip frames + stills in docs/assets/raw
//   npm run media              -> additionally encodes hero.gif / demo.mp4
//
// The hero clip is a Chrome DevTools Protocol screencast of the live match
// (fast, real-time frame timing), encoded into a looping GIF. Stills are
// Playwright element screenshots of the HUD panels and forced match states.
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const URL = process.env.SHOT_URL ?? 'http://127.0.0.1:5173/';
const OUT = path.resolve(process.env.SHOT_DIR ?? 'docs/assets/raw');
const VIEWPORT = { width: 1280, height: 800 };

const CLIP_SECONDS = Number(process.env.CLIP_SECONDS ?? 5);
const CLIP_FPS = Number(process.env.CLIP_FPS ?? 12);

mkdirSync(OUT, { recursive: true });
rmSync(path.join(OUT, 'clip'), { recursive: true, force: true });
mkdirSync(path.join(OUT, 'clip'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGEERROR', e.stack || e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE ERROR', m.text());
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => document.getElementById('boot-overlay').classList.contains('done'),
  null,
  { timeout: 45000 },
);
console.log('boot complete');

async function still(name, target) {
  const file = path.join(OUT, `${name}.png`);
  if (typeof target === 'string') await page.locator(target).screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log('still:', name);
}

/* ---------------- hero clip: live match, territory overlay, training ---------------- */

await page.click('button[data-speed="4"]');
await page.waitForTimeout(1200);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Page.enable');

const received = [];
cdp.on('Page.screencastFrame', async (frame) => {
  received.push({ at: Date.now(), data: frame.data });
  await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
});

const started = Date.now();
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 80,
  maxWidth: VIEWPORT.width,
  maxHeight: VIEWPORT.height,
});
await page.waitForTimeout(CLIP_SECONDS * 1000);
await cdp.send('Page.stopScreencast');

// keep one frame per intended GIF tick so playback timing is honest
const step = 1000 / CLIP_FPS;
let nextAt = started;
let index = 0;
const kept = [];
for (const frame of received) {
  if (frame.at < nextAt) continue;
  const name = `c${String(index).padStart(4, '0')}.jpg`;
  writeFileSync(path.join(OUT, 'clip', name), Buffer.from(frame.data, 'base64'));
  kept.push({ name, t: (frame.at - started) / 1000 });
  nextAt = frame.at + step;
  index++;
}

// real arrival times: the encoder plays the clip at the pace it was captured
const duration = kept.length ? kept[kept.length - 1].t : 0;
writeFileSync(
  path.join(OUT, 'clip', 'manifest.json'),
  JSON.stringify({ fps: kept.length / duration, duration, frames: kept }, null, 2),
);
console.log(`clip: ${index} frames from ${received.length} screencast frames, ${duration.toFixed(2)}s (${(kept.length / duration).toFixed(1)} fps)`);

/* ---------------- close-up: low camera angle over the mid-field ---------------- */

await page.evaluate(() => {
  const arena = window.__aether.arena;
  arena.camera.position.set(9, 16, 14);
  arena.controls.target.set(0, 0.6, 0);
  arena.controls.update();
});
await page.waitForTimeout(900);
await still('closeup');

/* ---------------- vision overlay: what an agent actually perceives ---------------- */

await page.evaluate(() => {
  const arena = window.__aether.arena;
  arena.camera.position.set(0, 41, 39);
  arena.controls.target.set(0, 0.4, 0);
  arena.controls.update();
});
await page.click('#btn-vision');
await page.waitForTimeout(1000);
await still('vision');
await page.click('#btn-vision');
await page.waitForTimeout(500);

/* ---------------- panels ---------------- */

await page.waitForTimeout(700);
await still('council', '.panel-left');
await still('telemetry', '.panel-right');

/* ---------------- victory: Ember Dominion wiped out ---------------- */

await page.evaluate(() => {
  for (const agent of window.__aether.env.agents[1]) {
    agent.alive = false;
    agent.hp = 0;
  }
});
await page.waitForFunction(
  () => document.getElementById('victory-overlay').classList.contains('show'),
  null,
  { timeout: 15000 },
);
await page.waitForTimeout(400);
await still('victory');

await browser.close();
console.log('done');
