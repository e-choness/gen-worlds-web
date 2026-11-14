// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
// Dev helper: loads the app in the capture container and prints the result of an expression
// evaluated against window.__app at a few points in time.
//   node tools/debug-eval.mjs "<query>" "<js expression using app>" [seconds...]
import { chromium } from 'playwright-core';

const [query = '', expr = 'app.fps', ...times] = process.argv.slice(2);
const base = process.env.CAPTURE_BASE_URL ?? 'http://localhost:5173';
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
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on(
  'console',
  (m) =>
    (m.type() === 'error' || m.type() === 'warning') &&
    console.log(`[${m.type()}] ${m.text().slice(0, 600)}`),
);
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('worker', (w) => console.log(`worker started: ${w.url().slice(-60)}`));
await page.goto(`${base}/${query}`);
await page.waitForFunction(() => window.__status === 'running' || window.__status === 'failed', null, {
  timeout: 120000,
});
for (const t of times.length ? times.map(Number) : [2, 8]) {
  await page.waitForTimeout(t * 1000);
  const out = await page.evaluate(`(() => { const app = window.__app; return JSON.stringify(${expr}); })()`);
  console.log(`t+${t}s: ${out}`);
}
await browser.close();
