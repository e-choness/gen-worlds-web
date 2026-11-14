// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The player's craft: a compact excavation / survey robot, built procedurally (no asset files).
 * Hull with ceramic panels, sensor head, twin vectoring thrusters, a survey dish and a folding
 * drill arm. Parts animate from the flight and tool state passed to `update`.
 *
 * Model space: +Y up, -Z forward, 1 unit = 1 metre; about 2.2 m long.
 */

import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';

export interface RobotState {
  /** 0..1 main thrust. */
  thrust: number;
  /** True while the scanner is sweeping. */
  scanning: boolean;
  /** True while the drill is running. */
  drilling: boolean;
  /** 0 stowed .. 1 deployed arm. */
  armDeploy: number;
  /** 0..1 downward jet output: the thruster pods swivel down to hover and hop. */
  lift: number;
  /** View pitch relative to the hull, radians; the sensor head follows it. */
  headPitch: number;
  /** Headlamp on. */
  lamp: boolean;
}

export class RobotModel implements Disposable {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly dish: THREE.Object3D;
  private readonly dishRing: THREE.Mesh;
  private readonly arm: THREE.Group;
  private readonly forearm: THREE.Group;
  private readonly drill: THREE.Mesh;
  private readonly nozzleGlow: THREE.MeshStandardNodeMaterial;
  private readonly lensGlow: THREE.MeshStandardNodeMaterial;
  private readonly scanGlow: THREE.MeshStandardNodeMaterial;
  private readonly tailGlow: THREE.MeshStandardNodeMaterial;
  private readonly lampGlow: THREE.MeshStandardNodeMaterial;
  private readonly head = new THREE.Group();
  private readonly pods: THREE.Group[] = [];
  private podAngle = 0;
  private phase = 0;

  constructor() {
    const ceramic = this.material({ color: 0xe9ebee, roughness: 0.55, metalness: 0.05 });
    const graphite = this.material({ color: 0x1b1e23, roughness: 0.6, metalness: 0.6 });
    const steel = this.material({ color: 0x8b929b, roughness: 0.35, metalness: 0.9 });
    const accent = this.material({ color: 0xe8641b, roughness: 0.5, metalness: 0.1 });
    this.lensGlow = this.material({
      color: 0x05080a,
      roughness: 0.1,
      metalness: 0.2,
      emissive: 0x3fd0ff,
      emissiveIntensity: 2.5,
    });
    this.nozzleGlow = this.material({
      color: 0x101214,
      roughness: 0.5,
      metalness: 0.5,
      emissive: 0x66b8ff,
      emissiveIntensity: 0,
    });
    this.scanGlow = this.material({
      color: 0x0a0d10,
      roughness: 0.4,
      metalness: 0.3,
      emissive: 0x4dffd2,
      emissiveIntensity: 0.2,
    });

    // --- hull
    const hull = this.mesh(new RoundedBoxGeometry(1.25, 0.55, 1.9, 4, 0.16), graphite);
    this.add(this.mesh(new RoundedBoxGeometry(1.31, 0.3, 1.45, 4, 0.12), ceramic), 0, 0.17, 0.05);
    this.add(this.mesh(new RoundedBoxGeometry(0.5, 0.12, 0.9, 3, 0.05), accent), 0, 0.34, 0.25);
    this.group.add(hull);
    // Rear: ceramic engine cowl, heat-exchanger louvres and running lights.
    this.add(this.mesh(new RoundedBoxGeometry(1.0, 0.36, 0.1, 3, 0.04), ceramic), 0, 0.02, 0.94);
    for (let i = 0; i < 4; i++) {
      this.add(
        this.mesh(new RoundedBoxGeometry(0.7, 0.035, 0.03, 1, 0.01), graphite),
        0,
        -0.1 + i * 0.075,
        1.0,
      );
    }
    this.tailGlow = this.material({
      color: 0x120303,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0xff3b1f,
      emissiveIntensity: 3,
    });
    for (const side of [-1, 1]) {
      this.add(
        this.mesh(new RoundedBoxGeometry(0.16, 0.05, 0.03, 1, 0.012), this.tailGlow),
        side * 0.38,
        0.17,
        1.0,
      );
    }
    // Side armour strips and skids.
    for (const side of [-1, 1]) {
      this.add(this.mesh(new RoundedBoxGeometry(0.08, 0.34, 1.5, 2, 0.03), ceramic), side * 0.67, 0, 0);
      const skid = this.mesh(new THREE.CapsuleGeometry(0.045, 1.5, 4, 10), steel);
      skid.rotation.x = Math.PI / 2;
      this.add(skid, side * 0.5, -0.5, 0);
      for (const z of [-0.5, 0.5]) {
        const strut = this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), steel);
        this.add(strut, side * 0.5, -0.36, z);
      }
    }

    // --- sensor head
    const head = this.head;
    head.position.set(0, 0.12, -1.02);
    this.lampGlow = this.material({
      color: 0x0c0c0c,
      roughness: 0.3,
      metalness: 0.4,
      emissive: 0xfff2d6,
      emissiveIntensity: 0,
    });
    for (const side of [-1, 1]) {
      const lamp = this.mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 16), this.lampGlow);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(side * 0.2, -0.1, -0.2);
      head.add(lamp);
    }
    head.add(this.mesh(new THREE.SphereGeometry(0.3, 32, 20), graphite));
    const lens = this.mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.1, 28), this.lensGlow);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.26;
    head.add(lens);
    const collar = this.mesh(new THREE.TorusGeometry(0.16, 0.025, 10, 32), steel);
    collar.position.z = -0.25;
    head.add(collar);
    for (const side of [-1, 1]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.045, 12, 8), this.lensGlow);
      eye.position.set(side * 0.19, 0.12, -0.17);
      head.add(eye);
    }
    this.group.add(head);

    // --- thrusters
    for (const side of [-1, 1]) {
      const pod = new THREE.Group();
      pod.position.set(side * 0.86, 0.02, 0.45);
      const shell = this.mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.85, 24), ceramic);
      shell.rotation.x = Math.PI / 2;
      pod.add(shell);
      const band = this.mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.12, 24), accent);
      band.rotation.x = Math.PI / 2;
      band.position.z = -0.2;
      pod.add(band);
      const nozzle = this.mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.2, 24, 1, true), steel);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.z = 0.5;
      pod.add(nozzle);
      const flame = this.mesh(new THREE.CircleGeometry(0.15, 24), this.nozzleGlow);
      flame.position.z = 0.44;
      pod.add(flame);
      const pylon = this.mesh(new RoundedBoxGeometry(0.3, 0.08, 0.4, 2, 0.03), graphite);
      pylon.position.set(-side * 0.2, 0, 0);
      pod.add(pylon);
      this.pods.push(pod);
      this.group.add(pod);
    }

    // --- survey dish
    this.dish = new THREE.Group();
    this.dish.position.set(0, 0.52, 0.45);
    const mast = this.mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 10), steel);
    mast.position.y = -0.12;
    this.dish.add(mast);
    const bowl = this.mesh(
      new THREE.SphereGeometry(0.32, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.32),
      ceramic,
    );
    bowl.rotation.x = Math.PI;
    bowl.position.y = 0.36;
    this.dish.add(bowl);
    this.dishRing = this.mesh(new THREE.TorusGeometry(0.2, 0.018, 8, 40), this.scanGlow);
    this.dishRing.rotation.x = Math.PI / 2;
    this.dishRing.position.y = 0.16;
    this.dish.add(this.dishRing);
    this.group.add(this.dish);
    const antenna = this.mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.9, 6), steel);
    this.add(antenna, -0.4, 0.7, 0.75);

    // --- drill arm (shoulder under the nose, elbow, rotating bit)
    this.arm = new THREE.Group();
    this.arm.position.set(0, -0.22, -0.55);
    this.arm.add(this.mesh(new THREE.SphereGeometry(0.1, 16, 12), steel));
    const upper = this.mesh(new RoundedBoxGeometry(0.11, 0.11, 0.7, 2, 0.03), accent);
    upper.position.z = -0.35;
    this.arm.add(upper);
    this.forearm = new THREE.Group();
    this.forearm.position.z = -0.7;
    this.forearm.add(this.mesh(new THREE.SphereGeometry(0.085, 14, 10), steel));
    const lower = this.mesh(new RoundedBoxGeometry(0.09, 0.09, 0.6, 2, 0.03), ceramic);
    lower.position.z = -0.3;
    this.forearm.add(lower);
    this.drill = this.mesh(new THREE.ConeGeometry(0.11, 0.42, 7), steel);
    this.drill.rotation.x = -Math.PI / 2;
    this.drill.position.z = -0.78;
    this.forearm.add(this.drill);
    const chuck = this.mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 14), graphite);
    chuck.rotation.x = Math.PI / 2;
    chuck.position.z = -0.58;
    this.forearm.add(chuck);
    this.arm.add(this.forearm);
    this.group.add(this.arm);

    this.group.name = 'robot';
    this.setArm(0);
  }

  update(dt: number, state: RobotState): void {
    this.phase += dt;
    this.nozzleGlow.emissiveIntensity = 0.04 + Math.max(state.thrust, state.lift * 0.8) * 9;
    // Pods swivel so the nozzles (which face +Z, aft) point at the ground when lifting.
    this.podAngle += (state.lift * 1.35 - this.podAngle) * (1 - Math.exp(-dt * 7));
    for (const pod of this.pods) pod.rotation.x = this.podAngle;
    this.head.rotation.x += (state.headPitch * 0.8 - this.head.rotation.x) * (1 - Math.exp(-dt * 10));
    this.lampGlow.emissiveIntensity = state.lamp ? 14 : 0;
    this.dish.rotation.y += dt * (state.scanning ? 5 : 0.5);
    this.scanGlow.emissiveIntensity = state.scanning ? 5 + Math.sin(this.phase * 18) * 2 : 0.25;
    this.lensGlow.emissiveIntensity = 2.2 + Math.sin(this.phase * 2.1) * 0.4 + (state.scanning ? 2.5 : 0);
    this.setArm(state.armDeploy);
    if (state.drilling) this.drill.rotation.z += dt * 38;
  }

  /** Arm pose: stowed flat under the hull (0) to reaching down and forward (1). */
  private setArm(t: number): void {
    const s = t * t * (3 - 2 * t);
    this.arm.rotation.x = THREE.MathUtils.lerp(0, -0.95, s);
    this.forearm.rotation.x = THREE.MathUtils.lerp(Math.PI * 0.94, -0.55, s);
  }

  private material(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardNodeMaterial {
    const material = new THREE.MeshStandardNodeMaterial(params);
    this.materials.push(material);
    return material;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.push(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private add(object: THREE.Object3D, x: number, y: number, z: number): void {
    object.position.set(x, y, z);
    this.group.add(object);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
