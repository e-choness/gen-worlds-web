// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Records the trailer's clips from the running game, frame by frame: the page's clock is stepped
// 1/30 s at a time and each frame is photographed at 1920 × 1080, so the footage is smooth even
// though the capture container renders in software. Clip lengths come from plan.mjs.
// Runs inside the `capture` compose service; several runs can go at once in separate containers:
//   node tools/trailer/record.mjs <run> [clip ...]     a run is a group of clips sharing a set-up
//   TRAILER_EVERY=10   photograph one frame in 10 (a contact sheet to check a clip quickly)
//   TRAILER_SECONDS=3  cap every clip at 3 s (a quick test)
// Frames go to .cache/trailer/clips/<clip>/00000.jpg …
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { clipSeconds, FPS } from './plan.mjs';
import { RUNS } from './runs.mjs';

const [runName, ...only] = process.argv.slice(2);
const run = RUNS[runName];
if (!run) {
  console.log(`runs: ${Object.keys(RUNS).join(', ')}`);
  process.exit(1);
}
const every = Number(process.env.TRAILER_EVERY ?? '1');
const cap = Number(process.env.TRAILER_SECONDS ?? 'Infinity');
const base = process.env.CAPTURE_BASE_URL ?? 'http://localhost:5173';
const lengths = clipSeconds();
const FRAME_MS = 1000 / FPS;
/** Fixed start time: the daily seed and anything else on the clock repeats from run to run. */
const START = new Date('2026-11-15T18:00:00Z');

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-angle=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--disable-gpu-watchdog',
    '--disable-dev-shm-usage',
  ],
});

/** One browser page with a stepped clock: the recording surface of one run. */
class Recorder {
  constructor() {
    this.page = null;
    this.elapsed = 0;
  }

  /** Opens `path` with the clock installed and held; `halfRate` draws one frame per video frame. */
  async open(path, { halfRate = true } = {}) {
    await this.page?.close();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    this.page = page;
    const seen = new Set();
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text().slice(0, 300);
      if (!seen.has(text)) console.log('[error]', text);
      seen.add(text);
    });
    page.on('pageerror', (error) => console.log('[pageerror]', error.message));
    // The recording plays offline: no rooms are opened and no scores reach the live leaderboard.
    await page.route(/googleapis\.com|firebaseio\.com|firebaseapp\.com|firebasestorage/, (route) =>
      route.abort(),
    );
    await page.clock.install({ time: START });
    if (halfRate) {
      // The fake clock fires animation frames every 16 ms: two renders per 1/30 s of video. Every
      // callback waits `__rafEvery` ticks, so each video frame is drawn once (time-based motion is
      // unaffected: it follows the clock, not the frame count). pace() changes it for sped-up clips.
      await page.addInitScript(() => {
        window.__rafEvery = 2;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) => {
          let ticks = 0;
          const step = (time) => (++ticks >= window.__rafEvery ? callback(time) : raf(step));
          return raf(step);
        };
      });
    }
    await page.goto(`${base}${path}`, { waitUntil: 'load' });
    await page.clock.pauseAt(new Date(START.getTime() + 2000));
    this.elapsed = 0;
    return page;
  }

  /** Lets real-time work (downloads, workers, pipeline builds) finish while the clock creeps on. */
  async settle(ms, steps = 4) {
    for (let step = 0; step < steps; step++) {
      await this.page.waitForTimeout(ms / steps);
      await this.page.clock.runFor(40);
    }
  }

  /** One render per video frame at `speed` times real time (the engine steps at most 0.1 s a frame). */
  async pace(speed) {
    await this.page.evaluate(
      (every) => {
        window.__rafEvery = every;
      },
      Math.max(1, Math.round(2 * speed)),
    );
  }

  async css(content) {
    return this.page.addStyleTag({ content });
  }

  /**
   * Records clip `name`: before each frame `each(t, seconds)` may move things (t is clip seconds),
   * then the clock steps 1/30 s (times `speed`) and the page is photographed.
   */
  async clip(name, each = null, { speed = 1, seconds = null } = {}) {
    const total = Math.min(cap, seconds ?? lengths[name] ?? 5);
    const frames = Math.round(total * FPS);
    const dir = `.cache/trailer/clips/${name}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const started = Date.now();
    for (let frame = 0; frame < frames; frame++) {
      const t = frame / FPS;
      if (each) await each(t, total);
      this.elapsed += FRAME_MS * speed;
      const whole = Math.floor(this.elapsed);
      this.elapsed -= whole;
      if (whole > 0) await this.page.clock.runFor(whole);
      if (frame % every === 0) {
        await this.page.screenshot({
          path: `${dir}/${String(frame).padStart(5, '0')}.jpg`,
          type: 'jpeg',
          quality: 92,
          timeout: 1200000,
        });
      }
      if (frame % 60 === 59) {
        const rate = (Date.now() - started) / 1000 / (frame + 1);
        console.log(`${name} ${frame + 1}/${frames} (${rate.toFixed(2)} s/frame)`);
      }
    }
    console.log(`${name}: ${frames} frames in ${((Date.now() - started) / 60000).toFixed(1)} min`);
  }
}

const recorder = new Recorder();
const started = Date.now();
try {
  await run(recorder, (name) => only.length === 0 || only.includes(name));
} finally {
  await browser.close();
}
console.log(`${runName} done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
