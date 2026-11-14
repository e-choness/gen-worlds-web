// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The hand-flown landing: starts the 3D engine at the landing site on the landing date, lets the
 * player fly the terminal descent, and reports what they did. Like the sandbox, this module pulls
 * in the whole engine and is only reached through a dynamic import after WebGPU is confirmed.
 */
import * as THREE from 'three/webgpu';
import { App } from '@/app/app';
import { decodeWorld, isWorldId } from '@/data/world';
import type { DescentOutcome, DescentPlan } from '@/mission/descent-plan';
import { MIN_CLEARANCE } from '@/player/flight-controller';
import { buildVehicle, createVehicleMaterials, disposeVehicle } from '@/render/hangar/vehicle-model';
import type { VehicleSpec } from '@/render/hangar/vehicle-spec';
import { DescentHud } from '@/ui/descent-hud';

/** Seconds the result stays on screen before control returns to the mission screens. */
const RESULT_HOLD_SECONDS = 3.5;

export async function runDescent(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  plan: DescentPlan,
  /** The designed vehicle, flown in place of the survey craft; null keeps the survey craft. */
  vehicle: VehicleSpec | null,
): Promise<DescentOutcome> {
  const app = await App.create({
    canvas,
    start: {
      ...(isWorldId(plan.bodyId)
        ? { world: decodeWorld(plan.bodyId) }
        : { solarSystem: true, at: plan.bodyId }),
      dateJd: plan.landingJd,
      altitude: plan.startAltitudeM + 4000,
    },
  });
  window.__app = app;
  const materials = vehicle ? createVehicleMaterials() : null;
  const model = vehicle && materials ? buildVehicle(vehicle, materials) : null;
  if (model) {
    // The flight model keeps the craft's centre this far above the ground; the vehicle stands on it.
    const craft = new THREE.Group();
    model.position.y = -MIN_CLEARANCE;
    craft.add(model);
    app.setCraftModel(craft);
  }
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
    app.setCraftModel(null);
    if (model) disposeVehicle(model);
    if (materials) for (const material of Object.values(materials)) material.dispose();
    app.dispose();
    window.__app = undefined;
  }
}
