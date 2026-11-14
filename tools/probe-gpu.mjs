// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Finds a Chromium flag set that exposes WebGPU inside the capture container.
import { chromium } from 'playwright-core';

const base = process.env.CAPTURE_BASE_URL ?? 'http://localhost:5173';
const common = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
const variants = {
  'vulkan-gpu': ['--enable-features=Vulkan', '--use-angle=vulkan'],
  'swiftshader-webgpu': ['--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader'],
  'swiftshader-all': [
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-angle=swiftshader',
    '--use-webgpu-adapter=swiftshader',
  ],
  'gl-egl': ['--use-gl=angle', '--use-angle=gl-egl'],
};
for (const [name, args] of Object.entries(variants)) {
  for (const channel of ['chromium', undefined]) {
    try {
      const browser = await chromium.launch({ headless: true, channel, args: [...common, ...args] });
      const page = await browser.newPage();
      await page.goto(`${base}/index.html?probe`).catch(() => {});
      await page.waitForTimeout(1500);
      const info = await page.evaluate(async () => {
        if (!navigator.gpu) return `no navigator.gpu (secure=${isSecureContext})`;
        const a = await navigator.gpu.requestAdapter();
        return a
          ? `${a.info.vendor}|${a.info.architecture}|${a.info.description}|fallback=${a.info.isFallbackAdapter}`
          : 'adapter null';
      });
      console.log(`${name} [${channel ?? 'headless-shell'}]: ${info}`);
      await browser.close();
    } catch (e) {
      console.log(`${name} [${channel ?? 'headless-shell'}]: launch failed ${String(e).slice(0, 120)}`);
    }
  }
}
