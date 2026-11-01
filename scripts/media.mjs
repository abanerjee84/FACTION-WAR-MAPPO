// Encodes README media from the frames produced by scripts/capture.mjs.
//   npm run capture   -> raw clip frames + stills in docs/assets/raw
//   npm run media     -> docs/assets/hero.gif, docs/assets/demo.mp4, stills
//
// Needs ffmpeg and ImageMagick on PATH. The clip is played back at the rate it
// was captured (see clip/manifest.json), so the GIF is real time, not fast-forward.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('docs/assets/raw');
const OUT = path.resolve('docs/assets');
const CLIP = path.join(RAW, 'clip');
const SCALED = path.join(RAW, 'clip_scaled');
const GIF_WIDTH = Number(process.env.GIF_WIDTH ?? 1000);
const GIF_HEIGHT = Number(process.env.GIF_HEIGHT ?? 625);
const STILLS = ['closeup', 'vision', 'council', 'telemetry', 'victory'];

if (!existsSync(path.join(CLIP, 'manifest.json'))) {
  console.error('no clip manifest — run: node scripts/capture.mjs');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(path.join(CLIP, 'manifest.json'), 'utf8'));
const fps = manifest.fps.toFixed(3);
console.log(`clip: ${manifest.frames.length} frames, ${manifest.duration.toFixed(2)}s (${fps} fps)`);

rmSync(SCALED, { recursive: true, force: true });
mkdirSync(SCALED, { recursive: true });

// ImageMagick does the downscale; this ffmpeg build cannot chain scale with the palette filters.
run('magick', [`${CLIP}/c00*.jpg`, '-resize', `${GIF_WIDTH}x${GIF_HEIGHT}`, `${SCALED}/c%04d.png`]);

const palette = path.join(RAW, 'palette.png');
run('ffmpeg', ['-hide_banner', '-y', '-framerate', fps, '-i', `${SCALED}/c%04d.png`, '-vf', 'palettegen=max_colors=128', palette]);

const hero = path.join(OUT, 'hero.gif');
run('ffmpeg', [
  '-hide_banner', '-y', '-framerate', fps, '-i', `${SCALED}/c%04d.png`, '-i', palette,
  '-lavfi', 'paletteuse=dither=sierra2_4a', hero,
]);

const demo = path.join(OUT, 'demo.mp4');
run('ffmpeg', [
  '-hide_banner', '-y', '-framerate', fps, '-i', `${CLIP}/c%04d.jpg`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', demo,
]);

for (const name of STILLS) {
  const src = path.join(RAW, `${name}.png`);
  if (existsSync(src)) copyFileSync(src, path.join(OUT, `${name}.png`));
}

for (const file of [hero, demo, ...STILLS.map((n) => path.join(OUT, `${n}.png`))]) {
  if (existsSync(file)) console.log(`${path.relative('.', file)}: ${(statSync(file).size / 1024).toFixed(0)} kB`);
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}
