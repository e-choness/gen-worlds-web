// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The launch vehicle and its pad for the mission theatre: a generic two-booster rocket built from
 * cylinders and cones. It stands on y = 0 with its engines at the bottom; units are metres at
 * roughly one tenth of a real launcher, which is the scale the theatre's launch scene works in.
 */
import * as THREE from 'three/webgpu';

/** Height of the rocket from engine bells to fairing tip, m. */
export const ROCKET_HEIGHT_M = 7.2;
/** Height above the base at which exhaust leaves the engines, m. */
export const ROCKET_NOZZLE_Y_M = 0.05;

export interface LaunchMaterials {
  paint: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
}

export function createLaunchMaterials(): LaunchMaterials {
  const material = (color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });
  return {
    paint: material(0xe9ecef, 0.15, 0.5),
    dark: material(0x23272e, 0.5, 0.6),
    metal: material(0x8d96a0, 0.85, 0.4),
    accent: material(0xc2571f, 0.2, 0.55),
    concrete: material(0x6c6f72, 0.05, 0.95),
  };
}

function tube(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  y: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 32), material);
  mesh.position.y = y + height / 2;
  return mesh;
}

/** The rocket alone: core stage, upper stage, fairing and two strap-on boosters. */
export function buildRocket(m: LaunchMaterials): THREE.Group {
  const rocket = new THREE.Group();
  const core = 0.42;
  rocket.add(tube(core * 0.55, core * 0.8, 0.35, 0, m.dark));
  rocket.add(tube(core, core, 3.6, 0.3, m.paint));
  rocket.add(tube(core * 1.01, core * 1.01, 0.22, 2.1, m.accent));
  rocket.add(tube(core, core, 0.18, 3.9, m.dark));
  rocket.add(tube(core, core, 1.3, 4.08, m.paint));
  // The fairing is wider than the stage under it, as on most launchers that carry a lander.
  rocket.add(tube(core * 1.25, core, 0.3, 5.38, m.paint));
  rocket.add(tube(core * 1.25, core * 1.25, 0.75, 5.68, m.paint));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(core * 1.25, 0.77, 32), m.paint);
  nose.position.y = 6.43 + 0.385;
  rocket.add(nose);
  for (const side of [-1, 1]) {
    const booster = new THREE.Group();
    booster.add(tube(0.14, 0.2, 0.3, 0, m.dark));
    booster.add(tube(0.24, 0.24, 2.6, 0.25, m.paint));
    booster.add(tube(0.245, 0.245, 0.14, 1.4, m.accent));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 24), m.paint);
    cap.position.y = 2.85 + 0.275;
    booster.add(cap);
    booster.position.x = side * (core + 0.25);
    rocket.add(booster);
  }
  return rocket;
}

/** The pad: a concrete apron, the launch table and a service tower beside the rocket. */
export function buildPad(m: LaunchMaterials): THREE.Group {
  const pad = new THREE.Group();
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.3, 48), m.concrete);
  apron.position.y = -0.45;
  pad.add(apron);
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 2.6), m.dark);
  table.position.y = -0.15;
  pad.add(table);
  const tower = new THREE.Group();
  for (const [x, z] of [
    [-0.3, -0.3],
    [0.3, -0.3],
    [-0.3, 0.3],
    [0.3, 0.3],
  ]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 6.6, 0.07), m.metal);
    post.position.set(x, 3.0, z);
    tower.add(post);
  }
  for (let level = 0; level < 8; level++) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.7), m.metal);
    deck.position.y = level * 0.9;
    tower.add(deck);
  }
  for (const y of [2.2, 4.6]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.12), m.accent);
    arm.position.set(0.85, y, 0);
    tower.add(arm);
  }
  tower.position.set(-1.85, -0.3, 0);
  pad.add(tower);
  return pad;
}

/** Frees the geometries of a rocket or pad (materials are shared and stay with the caller). */
export function disposeModel(model: THREE.Object3D): void {
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
}
