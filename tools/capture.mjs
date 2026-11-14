// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Automated capture: loads the app in headless Chromium (WebGPU), waits for terrain to settle and
// writes a PNG. Runs inside the `capture` compose service only.
//   node tools/capture.mjs "<query string>" <output.png> [width] [height] [settleSeconds]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [query = '', output = 'shots/capture.png', width = '1280', height = '720', settle = '4'] =
  process.argv.slice(2);
const base = process.env.CAPTURE_BASE_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({
  headless: true,
  // Software Vulkan (SwiftShader): Docker Desktop's NVIDIA runtime exposes CUDA but no Vulkan ICD, so
  // captures validate correctness, not performance.
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
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  deviceScaleFactor: 1,
});
let errors = 0;
// Identical messages repeat every frame once something breaks: print each distinct one once.
const seen = new Map();
function report(kind, text) {
  if (kind !== 'warning') errors++;
  const key = `[${kind}] ${text}`;
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  if (count === 0) console.log(key.slice(0, 2400));
}
page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') report(type, msg.text());
});
page.on('pageerror', (err) => report('pageerror', err.message));

await page.goto(`${base}/${query}`, { waitUntil: 'load' });
const adapter = await page.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter();
  return a ? `${a.info.vendor} ${a.info.architecture} ${a.info.device} ${a.info.description}` : 'none';
});
console.log(`adapter: ${adapter}`);

const started = Date.now();
await page.waitForFunction(() => window.__status === 'running' || window.__status === 'failed', null, {
  timeout: 120000,
});
// Wait until terrain workers are idle (or give up after 60 s), then let temporal effects settle.
await page
  .waitForFunction(
    () => {
      const app = window.__app;
      const body = app?.flight.telemetry.body;
      if (!app) return window.__status === 'running';
      return body && (!body.view || (body.view.terrain.ready && body.view.terrain.stats.pending === 0));
    },
    null,
    { timeout: 60000, polling: 500 },
  )
  .catch(() => console.log('terrain did not settle in 60 s'));
// Optional scripted set-up (camera aim etc.): CAPTURE_EVAL is evaluated with `app` in scope.
// CAPTURE_STEPS names a file with one snippet per line, run 300 ms apart: enough to click through
// the 2D screens (each line sees the page as the previous one left it).
if (process.env.CAPTURE_STEPS) {
  const steps = readFileSync(process.env.CAPTURE_STEPS, 'utf8')
    .split('\n')
    .filter((line) => line.trim());
  for (const step of steps) {
    await page.evaluate(`(() => { ${step}; })()`);
    await page.waitForTimeout(300);
  }
}
if (process.env.CAPTURE_EVAL) {
  await page.evaluate(`(() => { const app = window.__app; ${process.env.CAPTURE_EVAL}; })()`);
}
await page.waitForTimeout(Number(settle) * 1000);
const hud = await page.evaluate(
  () =>
    document.querySelector('.debug-hud')?.textContent ??
    document.querySelector('.hud .top')?.textContent ??
    '',
);
console.log(hud);
// Software rendering can take many seconds per frame on heavy views.
await page.screenshot({ path: output, timeout: 180000 });
console.log(`saved ${output} after ${((Date.now() - started) / 1000).toFixed(1)} s, ${errors} error(s)`);
await browser.close();
process.exit(errors > 0 ? 2 : 0);
