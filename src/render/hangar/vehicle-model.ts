// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Builds the hangar's vehicle from a spec: a parametric kit of boxes, panels, wheels and antennas,
 * so every part the player installs shows up on the model. Units are metres; the vehicle stands on
 * y = 0 (a satellite floats around the origin).
 */
import * as THREE from 'three/webgpu';
import type { VehicleSpec } from '@/render/hangar/vehicle-spec';

/** Materials shared by every vehicle; owned by the view and disposed with it. */
export interface VehicleMaterials {
  foil: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  solar: THREE.MeshStandardMaterial;
  tyre: THREE.MeshStandardMaterial;
  hot: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
}

export function createVehicleMaterials(): VehicleMaterials {
  const material = (color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const solar = material(0x16306b, 0.55, 0.28);
  solar.emissive = new THREE.Color(0x061230);
  const hot = material(0x3a3d44, 0.7, 0.5);
  hot.emissive = new THREE.Color(0x401208);
  const paint = material(0xdfe4ea, 0.1, 0.6);
  const dark = material(0x22262c, 0.6, 0.55);
  // Dishes, nozzles and telescope tubes are open shells seen from both sides.
  for (const shell of [paint, dark, hot]) shell.side = THREE.DoubleSide;
  return {
    foil: material(0xc9993a, 0.85, 0.42),
    paint,
    metal: material(0x9aa3ad, 0.9, 0.35),
    dark,
    solar,
    tyre: material(0x8d9299, 0.85, 0.5),
    hot,
    lens: material(0x0a0d14, 0.2, 0.08),
  };
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), material);
}

function rod(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
}

/** A solar panel with a thin frame, lying in the XZ plane, facing +Y. */
function panel(width: number, depth: number, m: VehicleMaterials): THREE.Group {
  const group = new THREE.Group();
  group.add(box(width, 0.02, depth, m.metal));
  const cells = box(width * 0.94, 0.012, depth * 0.94, m.solar);
  cells.position.y = 0.012;
  group.add(cells);
  return group;
}

function wheel(radius: number, m: VehicleMaterials): THREE.Group {
  const group = new THREE.Group();
  const tyre = mesh(new THREE.CylinderGeometry(radius, radius, radius * 0.7, 28), m.tyre);
  tyre.rotation.z = Math.PI / 2;
  group.add(tyre);
  const hub = mesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, radius * 0.75, 16), m.dark);
  hub.rotation.z = Math.PI / 2;
  group.add(hub);
  return group;
}

function dish(diameter: number, m: VehicleMaterials): THREE.Group {
  const group = new THREE.Group();
  const radius = diameter / 2;
  // A shallow spherical cap, open towards +Y.
  const bowl = mesh(new THREE.SphereGeometry(radius * 1.6, 32, 8, 0, Math.PI * 2, 0, 0.67), m.paint);
  bowl.rotation.x = Math.PI;
  bowl.position.y = radius * 1.6;
  group.add(bowl);
  const feed = rod(0.012, radius * 0.9, m.metal);
  feed.position.y = radius * 0.5;
  group.add(feed);
  return group;
}

/**
 * The vehicle as a group of meshes. Geometries are created per build and must be disposed with
 * `disposeVehicle`; materials are shared and stay with the caller.
 */
export function buildVehicle(spec: VehicleSpec, m: VehicleMaterials): THREE.Group {
  const root = new THREE.Group();
  const [width, height, depth] = spec.body;
  const skin = spec.foil ? m.foil : m.paint;
  const satellite = spec.kind === 'satellite';
  const clearance = satellite ? -height / 2 : spec.wheels > 0 ? spec.wheelRadiusM * 1.5 : 0.55;
  const top = clearance + height;

  const body = box(width, height, depth, skin);
  body.position.y = clearance + height / 2;
  root.add(body);
  const deck = box(width * 1.02, 0.03, depth * 1.02, m.dark);
  deck.position.y = top + 0.015;
  root.add(deck);

  // --- running gear
  if (spec.wheels > 0) {
    const rows = spec.wheels / 2;
    for (let row = 0; row < rows; row++) {
      const z = rows === 1 ? 0 : (row / (rows - 1) - 0.5) * depth * 1.05;
      for (const side of [-1, 1]) {
        const x = side * (width / 2 + spec.wheelRadiusM * 0.55);
        const tyre = wheel(spec.wheelRadiusM, m);
        tyre.position.set(x, spec.wheelRadiusM, z);
        root.add(tyre);
        const strut = rod(0.025, clearance + height * 0.3 - spec.wheelRadiusM, m.metal);
        strut.position.set(x * 0.92, (clearance + height * 0.3 + spec.wheelRadiusM) / 2, z);
        root.add(strut);
      }
    }
  } else if (spec.legs) {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const foot = new THREE.Vector3(sx * (width / 2 + 0.55), 0.03, sz * (depth / 2 + 0.55));
      const hip = new THREE.Vector3(sx * width * 0.45, clearance + height * 0.35, sz * depth * 0.45);
      const leg = rod(0.03, foot.distanceTo(hip), m.metal);
      leg.position.copy(foot).add(hip).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hip.clone().sub(foot).normalize());
      root.add(leg);
      const pad = mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.05, 20), m.foil);
      pad.position.copy(foot);
      root.add(pad);
    }
  }

  // --- propulsion
  if (spec.tankRadiusM > 0) {
    for (const side of [-1, 1]) {
      const tank = mesh(new THREE.SphereGeometry(spec.tankRadiusM, 24, 16), m.foil);
      tank.position.set(side * (width / 2) * 0.55, clearance + spec.tankRadiusM * 0.2, 0);
      root.add(tank);
    }
  }
  if (spec.engine) {
    const bell = mesh(
      new THREE.CylinderGeometry(0.07, satellite ? 0.1 : 0.2, satellite ? 0.14 : 0.32, 24, 1, true),
      m.hot,
    );
    if (satellite) {
      bell.rotation.x = Math.PI / 2;
      bell.position.set(0, clearance + height / 2, -depth / 2 - 0.07);
    } else bell.position.y = clearance - 0.16;
    root.add(bell);
  }

  // --- power
  const area = Math.max(spec.solarAreaM2, 0.05);
  switch (spec.power) {
    case 'deck': {
      const cells = panel(width * 0.96, depth * 0.96, m);
      cells.position.y = top + 0.04;
      root.add(cells);
      break;
    }
    case 'sides': {
      const panelHeight = Math.max(height * 1.25, area / (2 * depth + width));
      for (const [x, z, turn, span] of [
        [-(width / 2 + 0.03), 0, Math.PI / 2, depth],
        [width / 2 + 0.03, 0, -Math.PI / 2, depth],
        [0, -(depth / 2 + 0.03), 0, width],
      ] as const) {
        const side = panel(span * 0.96, panelHeight, m);
        side.rotation.set(Math.PI / 2, 0, 0);
        const holder = new THREE.Group();
        holder.add(side);
        holder.rotation.y = turn + Math.PI;
        holder.position.set(x, clearance + panelHeight / 2 + 0.05, z);
        root.add(holder);
      }
      break;
    }
    case 'mast': {
      const mastHeight = 1.6 + Math.sqrt(area) * 0.4;
      const mast = rod(0.035, mastHeight, m.metal);
      mast.position.set(-width * 0.3, top + mastHeight / 2, -depth * 0.25);
      root.add(mast);
      const side = Math.sqrt(area);
      const array = panel(side, side * 1.3, m);
      array.rotation.set(Math.PI / 2 - 0.25, 0.5, 0);
      array.position.set(-width * 0.3, top + mastHeight, -depth * 0.25);
      root.add(array);
      break;
    }
    case 'skin': {
      for (const side of [-1, 1]) {
        // Turned from lying flat to standing against the side face, cells outward.
        const cells = panel(height * 0.9, depth * 0.9, m);
        cells.rotation.z = (-side * Math.PI) / 2;
        cells.position.set(side * (width / 2 + 0.012), clearance + height / 2, 0);
        root.add(cells);
      }
      break;
    }
    case 'wings':
    case 'tracking_wings': {
      const span = Math.max(height * 1.1, Math.sqrt(area / 2) * 1.6);
      const chord = area / 2 / span;
      for (const side of [-1, 1]) {
        const wing = panel(span, Math.max(chord, 0.12), m);
        wing.position.set(side * (width / 2 + span / 2 + 0.08), clearance + height / 2, 0);
        if (spec.power === 'tracking_wings') wing.rotation.x = 0.6;
        root.add(wing);
        const boom = rod(0.012, 0.1, m.metal);
        boom.rotation.z = Math.PI / 2;
        boom.position.set(side * (width / 2 + 0.05), clearance + height / 2, 0);
        root.add(boom);
      }
      break;
    }
    case 'rtg': {
      const generator = new THREE.Group();
      generator.add(rod(0.11, 0.62, m.hot));
      for (let fin = 0; fin < 8; fin++) {
        const blade = box(0.012, 0.58, 0.2, m.dark);
        blade.rotation.y = (fin / 8) * Math.PI * 2;
        blade.translateZ(0.2);
        generator.add(blade);
      }
      generator.rotation.x = -1.05;
      generator.position.set(0, top + 0.12, -(depth / 2 + 0.32));
      root.add(generator);
      break;
    }
    default:
      break;
  }

  // --- communications
  const antennaBase = new THREE.Vector3(width * 0.3, top + 0.03, -depth * 0.22);
  switch (spec.antenna) {
    case 'whip': {
      const whip = rod(0.008, 0.6, m.metal);
      whip.position.copy(antennaBase).setY(antennaBase.y + 0.3);
      root.add(whip);
      break;
    }
    case 'patch': {
      const patch = box(0.16, 0.03, 0.16, m.paint);
      patch.position.copy(antennaBase);
      root.add(patch);
      break;
    }
    case 'helix': {
      const post = rod(0.02, 0.35, m.metal);
      post.position.copy(antennaBase).setY(antennaBase.y + 0.17);
      root.add(post);
      const coil = mesh(new THREE.TorusGeometry(0.07, 0.008, 8, 24), m.metal);
      for (let turn = 0; turn < 4; turn++) {
        const ring = coil.clone();
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(antennaBase).setY(antennaBase.y + 0.1 + turn * 0.07);
        root.add(ring);
      }
      coil.geometry.dispose();
      break;
    }
    case 'dish': {
      const post = rod(0.02, 0.3, m.metal);
      post.position.copy(antennaBase).setY(antennaBase.y + 0.15);
      root.add(post);
      const reflector = dish(Math.max(spec.antennaDiameterM, 0.25), m);
      reflector.rotation.set(0.5, 0, -0.35);
      reflector.position.copy(antennaBase).setY(antennaBase.y + 0.3);
      root.add(reflector);
      break;
    }
    default:
      break;
  }

  // --- instruments
  if (spec.mastCamera) {
    const mastHeight = 0.95;
    const mast = rod(0.025, mastHeight, m.paint);
    mast.position.set(-width * 0.05, top + mastHeight / 2, depth * 0.38);
    root.add(mast);
    const head = box(0.3, 0.13, 0.16, m.paint);
    head.position.set(-width * 0.05, top + mastHeight + 0.06, depth * 0.38);
    root.add(head);
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), m.lens);
      eye.rotation.x = Math.PI / 2;
      eye.position.set(-width * 0.05 + side * 0.08, top + mastHeight + 0.06, depth * 0.38 + 0.085);
      root.add(eye);
    }
  }
  if (spec.drillM > 0) {
    const tower = box(0.14, height + 0.5, 0.14, m.dark);
    tower.position.set(width * 0.32, clearance + (height + 0.5) / 2, depth / 2 + 0.09);
    root.add(tower);
    const length = Math.min(spec.drillM, 2) * 0.5 + 0.2;
    const bit = rod(0.022, length, m.metal);
    bit.position.set(width * 0.32, clearance - length / 2 + 0.05, depth / 2 + 0.09);
    root.add(bit);
  }
  if (spec.telescope) {
    const tube = mesh(
      new THREE.CylinderGeometry(depth * 0.3, depth * 0.3, height * 0.7, 28, 1, true),
      m.dark,
    );
    tube.position.set(0, clearance - height * 0.3, 0);
    root.add(tube);
    const glass = mesh(new THREE.CircleGeometry(depth * 0.29, 28), m.lens);
    glass.rotation.x = Math.PI / 2;
    glass.position.set(0, clearance - height * 0.05, 0);
    root.add(glass);
  }
  for (let index = 0; index < spec.instrumentBoxes; index++) {
    const crate = box(0.2, 0.14, 0.24, index % 2 ? m.paint : m.metal);
    crate.position.set(-width * 0.34 + index * 0.26, top + 0.1, -depth * 0.02 + (index % 2) * 0.2);
    root.add(crate);
  }
  return root;
}

/** Frees the geometries of a built vehicle (its materials are shared and stay alive). */
export function disposeVehicle(vehicle: THREE.Object3D): void {
  vehicle.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
}
