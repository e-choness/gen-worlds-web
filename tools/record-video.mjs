// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Records the 30-second demo video frame by frame: the page's clock is stepped 1/30 s at a time and
// each frame is photographed, so the result is smooth even though the capture container renders in
// software. Runs inside the `capture` compose service only; frames are encoded afterwards.
//   node tools/record-video.mjs <framesDir>          every frame
//   VIDEO_EVERY=15 node tools/record-video.mjs <dir>  a contact sheet: one frame in 15
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [framesDir = '.cache/video/frames'] = process.argv.slice(2);
const every = Number(process.env.VIDEO_EVERY ?? '1');
const base = process.env.CAPTURE_BASE_URL ?? 'http://localhost:5173';
const FPS = 30;
const FRAME_MS = 1000 / FPS;
/** Fixed start time: the mission seed and the Earth's turn follow the clock, so runs repeat. */
const START = new Date(process.env.VIDEO_START ?? '2026-11-15T18:00:00Z');

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const seen = new Set();
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text().slice(0, 300);
  if (!seen.has(text)) console.log('[error]', text);
  seen.add(text);
});
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

await page.clock.install({ time: START });
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.clock.pauseAt(new Date(START.getTime() + 3000));

// The caption bar belongs to the recording, not to the game.
await page.addStyleTag({
  content: `
  .video-caption { position: fixed; z-index: 99999; left: 0; right: 0; bottom: 0; padding: 18px 40px 22px;
    background: linear-gradient(to top, rgba(3,6,11,.96) 70%, rgba(3,6,11,0)); color: #f2f5f9;
    font: 500 27px/1.3 system-ui, "Segoe UI", sans-serif; text-align: center; letter-spacing: .01em;
    transition: opacity .3s; pointer-events: none; }
  .video-card { position: fixed; z-index: 99998; inset: 0; display: grid; place-content: center; gap: 14px;
    background: rgba(3,6,11,.78); color: #f2f5f9; text-align: center; font-family: system-ui, "Segoe UI", sans-serif; }
  .video-card h1 { margin: 0; font-size: 76px; font-weight: 600; letter-spacing: .02em; }
  .video-card p { margin: 0; font-size: 30px; color: #b9c6d6; }
  .video-card strong { font-size: 40px; color: #7fd4ff; font-weight: 500; }`,
});
const caption = (text) =>
  page.evaluate((value) => {
    let bar = document.querySelector('.video-caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'video-caption';
      document.body.append(bar);
    }
    bar.textContent = value;
    bar.style.opacity = value ? '1' : '0';
  }, text);

let frame = 0;
let elapsed = 0;
/** Advances the page by one frame of video (times `speed`) and photographs it. */
async function shoot(speed = 1) {
  elapsed += FRAME_MS * speed;
  const whole = Math.floor(elapsed);
  elapsed -= whole;
  if (whole > 0) await page.clock.runFor(whole);
  if (frame % every === 0) {
    await page.screenshot({
      path: `${framesDir}/${String(frame).padStart(4, '0')}.jpg`,
      type: 'jpeg',
      quality: 93,
      timeout: 180000,
    });
  }
  frame++;
}
const shootFor = async (frames, speed = 1, each = null) => {
  for (let index = 0; index < frames; index++) {
    if (each) await each(index / Math.max(1, frames - 1));
    await shoot(speed);
  }
};
/** Lets real-time work (downloads, WebGPU start-up, the forecast worker) finish between shots. */
const settle = async (ms) => {
  await page.waitForTimeout(ms);
  await page.clock.runFor(120);
};
const click = async (text, exact = false) => {
  const button = exact
    ? page.getByRole('button', { name: text, exact: true })
    : page.locator('button', { hasText: text });
  await button.first().click({ timeout: 15000 });
  await page.clock.runFor(200);
  await page.waitForTimeout(250);
};
const ease = (t) => t * t * (3 - 2 * t);
const scrollTo = (y) => page.evaluate((top) => window.scrollTo(0, top), y);
const topOf = (selector) =>
  page.evaluate((query) => {
    const element = document.querySelector(query);
    return element ? element.getBoundingClientRect().top + window.scrollY : 0;
  }, selector);
const mark = (name) => console.log(`${(frame / FPS).toFixed(2)}s  ${name}`);

// --- 1. Title -------------------------------------------------------------------------------
await page
  .waitForSelector('.title-hero[data-ready]', { timeout: 60000 })
  .catch(() => console.log('no globe'));
await settle(1500);
mark('title');
await caption('Mission design is trade-offs. You only feel them when you fly.');
await shootFor(88);

// --- 2. Hangar ------------------------------------------------------------------------------
await click('New mission');
await page.locator('.scenario-card').nth(2).click();
await page.clock.runFor(200);
await click('Start the design');
await click('baseline');
await settle(6000);
mark('hangar');
await caption('Choose every system. Nine live budgets say what each choice costs, and why.');
await shootFor(42);
// One trade-off on camera: a lighter frame, what it does to the budgets, and back again.
const part = (name) => page.locator('.part-card', { hasText: name }).first();
await part('Light composite frame').click();
await page.waitForTimeout(400);
await shootFor(66);
await part('Standard aluminium frame').click();
await page.waitForTimeout(400);
await shootFor(37);

// --- 3. Trajectory --------------------------------------------------------------------------
await click('Plan the trajectory');
await settle(2500);
const chart = await topOf('.porkchop');
await scrollTo(Math.max(0, chart - 90));
await page.clock.runFor(100);
mark('trajectory');
await caption('Real NASA data sets the launch windows: pick when to leave and when to arrive.');
await shootFor(95);

// --- 4. Flight ------------------------------------------------------------------------------
await click('Call the Go/No-Go poll');
await click('All four roles');
await click('Launch', true);
await page.waitForTimeout(600);
const auto = page.locator('button', { hasText: 'guidance computer land' });
if (await auto.count()) await auto.first().click();
await page.waitForSelector('.flight-theatre', { timeout: 30000 });
// Room to scroll the 3D scene to the top of the frame, whatever the page's height is yet.
await page.addStyleTag({ content: 'main { min-height: 220vh; }' });
await scrollTo(Math.max(0, (await topOf('.phase-rail')) - 14));
// The 3D scene starts in real time: let it load its textures and build its pipelines, drawing a
// few frames, before the clock moves on.
await page.waitForTimeout(5000);
for (let warm = 0; warm < 4; warm++) {
  await page.clock.runFor(50);
  await page.waitForTimeout(1500);
}
const phaseNow = () =>
  page.evaluate(() => document.querySelector('.phase-rail li[data-state="now"]')?.textContent ?? '');
/** Runs the clock on, unrecorded, until the log reaches one of `labels`; returns which. */
const skipUntil = async (...labels) => {
  for (let guard = 0; guard < 400; guard++) {
    const now = await phaseNow();
    if (labels.includes(now)) return now;
    await page.clock.runFor(100);
  }
  throw new Error(`the flight never reached ${labels.join(' or ')}`);
};
mark('pad');
await caption('Then fly it. Your own spacecraft, step by step:');
await shootFor(20);
await skipUntil('Launch');
mark('launch');
await caption('Launch');
await shootFor(120, 1.25);
// A cruise with no events has no line in the log: the 3D scene then plays a short coast itself.
const afterLaunch = await skipUntil('Cruise', 'Landing');
if (afterLaunch === 'Cruise') await page.clock.runFor(1200);
mark('cruise');
await caption('Cruise: seven months to Mars');
await shootFor(60);
if (afterLaunch === 'Cruise') await skipUntil('Landing');
else await page.clock.runFor(300);
mark('landing');
await caption('Entry, descent and landing');
await shootFor(112, 1.6);
await skipUntil('Operations');
await page.clock.runFor(1500);
mark('operations');
await caption('Surface operations, hour by hour');
await shootFor(85);

// --- 5. Debrief -----------------------------------------------------------------------------
const skip = page.locator('button', { hasText: 'Skip to the end' });
if (await skip.count()) await skip.first().click();
await page.clock.runFor(300);
await click('Open the debrief');
await scrollTo(0);
await settle(1500);
mark('debrief');
await caption('The debrief traces every outcome back to the decision that caused it.');
const debriefEnd = Math.max(0, (await page.evaluate(() => document.documentElement.scrollHeight)) - 720);
await shootFor(40);
await shootFor(62, 1, (t) => scrollTo(Math.min(debriefEnd, 620) * ease(t)));

// --- 6. End card ----------------------------------------------------------------------------
await caption('');
await page.evaluate(() => {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.innerHTML =
    '<h1>Gen Worlds</h1><p>Design a space mission, then fly it. 1 to 4 players, in your browser.</p><strong>gen-worlds.surf</strong>';
  document.body.append(card);
});
mark('end card');
await shootFor(45);

console.log(`${frame} frames = ${(frame / FPS).toFixed(2)} s`);
await browser.close();
