// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Entry point. Boots the 2D shell first, which is the whole game on browsers without WebGPU, and
 * loads the 3D engine by dynamic import only once an adapter has been confirmed and a 3D screen is
 * actually opened. While the player is on the 2D screens, what lies ahead is preloaded in the background.
 */
import { effect, signal } from '@preact/signals';
import { GameStore } from '@/app/game-store';
import { MonteCarloClient } from '@/app/monte-carlo-client';
import { onlineAdapterFactory, scoreBoardFactory } from '@/app/online';
import { type Preloader, startPreload } from '@/app/preload';
import { mountShell } from '@/app/shell';
import { hasWebgpu } from '@/app/webgpu-support';
import { UiAudio } from '@/audio/ui-audio';
import { Settings } from '@/core/settings';
import { getScenario } from '@/data/scenarios';
import { screenFromHash } from '@/ui/screen-id';
import { vehicleSpecFromDesign } from '@/ui/vehicle-spec-from-design';

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
  const direct = params.has('nostart') || params.has('menu') || params.has('sandbox') || params.has('demo');
  const store = new GameStore(
    direct ? 'sandbox' : screenFromHash(location.hash),
    new MonteCarloClient(),
    onlineAdapterFactory(),
    scoreBoardFactory(),
  );
  // A shared mission link carries its design (and seed) in the query string.
  const code = params.get('m');
  if (code && store.openMissionCode(code)) {
    history.replaceState(null, '', `${location.pathname}#/design`);
    store.navigate('design');
  }
  // Sound for the 2D screens. The 3D views bring their own audio engine, so the bed stops there.
  const settings = new Settings();
  const audio = new UiAudio(settings);
  const muted = signal(settings.values.muted);
  // A world chosen in the galaxy arrives as ?world=<id>: open its briefing.
  const worldId = params.get('world');
  if (worldId) {
    try {
      getScenario(worldId);
      store.selectScenario(worldId);
      history.replaceState(null, '', `${location.pathname}#/briefing`);
      store.navigate('briefing');
    } catch (error) {
      // A damaged link: say so on the title screen rather than failing to start.
      store.engineError.value = error instanceof Error ? error.message : String(error);
    }
  }
  mountShell(shellRoot, store, {
    muted,
    onToggle: () => {
      settings.set('muted', !settings.values.muted);
      muted.value = settings.values.muted;
    },
    onCue: (cue) => audio.play(cue),
  });
  // Audio may only start from a gesture; any press on the shell is one, and presses on controls tick.
  shellRoot.addEventListener('pointerdown', () => audio.unlock());
  shellRoot.addEventListener('keydown', () => audio.unlock());
  shellRoot.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button, select, summary'))
      audio.play('select');
  });
  let lastScreen = store.screen.peek();
  effect(() => {
    const screen = store.screen.value;
    audio.setMusic(screen !== 'sandbox' && screen !== 'descent');
    if (screen === 'flight' && lastScreen !== 'flight' && lastScreen !== 'debrief') audio.play('launch');
    lastScreen = screen;
  });

  // Direct 3D URLs start the engine at once: there is nothing ahead of it to preload.
  let preloader: Preloader | null = null;
  void hasWebgpu().then((supported) => {
    store.webgpu.value = supported ? 'available' : 'unavailable';
    if (!direct) preloader = startPreload(supported);
  });

  let sandbox: 'idle' | 'starting' | 'running' = 'idle';
  let descending = false;
  effect(() => {
    const screen = store.screen.value;
    const webgpu = store.webgpu.value;
    // The 3D view loads what it needs itself, and needs the bandwidth.
    if (screen === 'descent' || screen === 'sandbox') preloader?.stop();

    if (screen === 'descent') {
      const arrival = store.arrival.peek();
      if (webgpu !== 'available' || descending || !arrival) return;
      descending = true;
      store.engineError.value = null;
      import('@/app/descent')
        .then((module) => {
          shellRoot.hidden = true;
          const evaluation = store.evaluation.peek();
          const vehicle = evaluation
            ? vehicleSpecFromDesign(evaluation.resolved, evaluation.mass?.propellantKg ?? null)
            : null;
          return module.runDescent(canvas, uiRoot, arrival.plan, vehicle);
        })
        .then((outcome) => store.completeDescent(outcome))
        .catch((error: unknown) => {
          console.error(error);
          store.engineError.value = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          descending = false;
          shellRoot.hidden = false;
        });
      return;
    }

    if (screen !== 'sandbox') {
      // The sandbox has no warm restart yet: leaving it reloads into the 2D shell.
      if (sandbox !== 'idle') location.reload();
      else window.__status = 'running';
      return;
    }
    if (webgpu === 'unavailable') window.__status = 'failed';
    if (webgpu !== 'available' || sandbox !== 'idle') return;
    sandbox = 'starting';
    // ?demo plays the scripted tour of the real bodies instead of free flight.
    (params.has('demo')
      ? import('@/app/demo').then((module) => module.startDemo(canvas, uiRoot))
      : import('@/app/sandbox').then((module) => module.startSandbox(canvas, uiRoot, location.search))
    )
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
