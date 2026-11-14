/**
 * The hand-flown landing: starts the 3D engine at the landing site on the landing date, lets the
 * player fly the terminal descent, and reports what they did. Like the sandbox, this module pulls
 * in the whole engine and is only reached through a dynamic import after WebGPU is confirmed.
 */
import { App } from '@/app/app';
import type { DescentOutcome, DescentPlan } from '@/mission/descent-plan';
import { DescentHud } from '@/ui/descent-hud';

/** Seconds the result stays on screen before control returns to the mission screens. */
const RESULT_HOLD_SECONDS = 3.5;

export async function runDescent(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  plan: DescentPlan,
): Promise<DescentOutcome> {
  const app = await App.create({
    canvas,
    start: {
      solarSystem: true,
      at: plan.bodyId,
      dateJd: plan.landingJd,
      altitude: plan.startAltitudeM + 4000,
    },
  });
  window.__app = app;
  const hud = new DescentHud(uiRoot, plan.siteName);
  // Mouse look needs the pointer; the first click on the view captures it and unlocks audio.
  const capture = (): void => {
    app.audio.unlock();
    app.input.lock();
  };
  canvas.addEventListener('pointerdown', capture);
  try {
    return await app.flyDescent(plan, (dt, readout) => hud.update(dt, readout), RESULT_HOLD_SECONDS);
  } finally {
    canvas.removeEventListener('pointerdown', capture);
    app.input.unlock();
    hud.dispose();
    app.dispose();
    window.__app = undefined;
  }
}
