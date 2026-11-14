/**
 * Entry point. Boots the 2D shell first, which is the whole game on browsers without WebGPU, and
 * loads the 3D engine by dynamic import only once an adapter has been confirmed and a 3D screen is
 * actually opened.
 */
import { effect } from '@preact/signals';
import { GameStore } from '@/app/game-store';
import { MonteCarloClient } from '@/app/monte-carlo-client';
import { mountShell } from '@/app/shell';
import { hasWebgpu } from '@/app/webgpu-support';
import { screenFromHash } from '@/ui/screen-id';

declare global {
  interface Window {
    /** 'running' once the first screen is interactive (for the 3D sandbox: once the engine runs). */
    __status?: 'booting' | 'running' | 'failed';
  }
}

function main(): void {
  window.__status = 'booting';
  const canvas = document.getElementById('viewport') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root') as HTMLElement;
  const shellRoot = document.getElementById('shell-root') as HTMLElement;

  // Capture and debug URLs (?nostart, ?menu=…, ?sandbox) open the 3D sandbox directly.
  const params = new URLSearchParams(location.search);
  const direct = params.has('nostart') || params.has('menu') || params.has('sandbox');
  const store = new GameStore(direct ? 'sandbox' : screenFromHash(location.hash), new MonteCarloClient());
  mountShell(shellRoot, store);

  void hasWebgpu().then((supported) => {
    store.webgpu.value = supported ? 'available' : 'unavailable';
  });

  let sandbox: 'idle' | 'starting' | 'running' = 'idle';
  effect(() => {
    const screen = store.screen.value;
    const webgpu = store.webgpu.value;
    if (screen !== 'sandbox') {
      // The engine has no warm restart yet: leaving the sandbox reloads into the 2D shell.
      if (sandbox !== 'idle') location.reload();
      else window.__status = 'running';
      return;
    }
    if (webgpu === 'unavailable') window.__status = 'failed';
    if (webgpu !== 'available' || sandbox !== 'idle') return;
    sandbox = 'starting';
    import('@/app/sandbox')
      .then((module) => module.startSandbox(canvas, uiRoot, location.search))
      .then(() => {
        sandbox = 'running';
        shellRoot.hidden = true;
        window.__status = 'running';
      })
      .catch((error: unknown) => {
        console.error(error);
        store.engineError.value = error instanceof Error ? error.message : String(error);
        window.__status = 'failed';
      });
  });
}

main();
