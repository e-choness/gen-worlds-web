// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Lights for objects that use three's standard PBR materials (the robot, props, vegetation, rocks).
 * Terrain, oceans and gas giants shade themselves; this keeps everything else consistent with them:
 * one directional light for the star, already attenuated by the air above the viewer, and a
 * hemisphere light for sky and ground bounce.
 */
import * as THREE from 'three/webgpu';

export class SceneLights {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly sky = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
  /** The robot's headlamp, for standard-material objects (terrain handles it in its own shader). */
  readonly lamp = new THREE.SpotLight(0xfff0d8, 0, 160, 0.5, 0.6, 2);
  private readonly up = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.sun, this.sun.target, this.sky, this.lamp, this.lamp.target);
  }

  /** @param origin lamp position relative to the camera; @param direction unit aim. */
  setLamp(origin: THREE.Vector3, direction: THREE.Vector3, on: boolean): void {
    this.lamp.intensity = on ? 260 : 0;
    this.lamp.position.copy(origin);
    this.lamp.target.position.copy(origin).addScaledVector(direction, 10);
  }

  /**
   * @param sunDir unit direction toward the star (world axes).
   * @param sunColor star radiance arriving at the viewer (after atmospheric extinction).
   * @param skyColor ambient sky radiance.
   * @param up local vertical, or null in open space.
   */
  update(
    sunDir: THREE.Vector3,
    sunColor: THREE.Vector3,
    skyColor: THREE.Vector3,
    groundColor: THREE.Vector3,
    up: THREE.Vector3 | null,
  ): void {
    // The camera is the scene origin, so the light only needs a direction.
    this.sun.position.copy(sunDir).multiplyScalar(100);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.setRGB(sunColor.x, sunColor.y, sunColor.z);
    this.sun.intensity = 1;
    // A little fill always remains (starlight, the craft's own running lights) so shapes never go fully black.
    const fill = 0.035;
    this.sky.color.setRGB(skyColor.x + fill, skyColor.y + fill, skyColor.z + fill * 1.15);
    this.sky.groundColor.setRGB(
      groundColor.x + fill * 0.5,
      groundColor.y + fill * 0.5,
      groundColor.z + fill * 0.5,
    );
    this.sky.intensity = 1;
    // HemisphereLight shades along its position vector.
    this.sky.position.copy(up ?? this.up.set(0, 1, 0));
  }
}
