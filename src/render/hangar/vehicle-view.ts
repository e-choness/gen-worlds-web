// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The hangar's 3D view: one vehicle on a turntable in its own small WebGPU renderer, separate from
 * the game engine so the design screen stays light: a few dozen meshes and three lights, drawn each
 * animation frame while the hangar is open and released when it closes.
 */
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import {
  buildVehicle,
  createVehicleMaterials,
  disposeVehicle,
  type VehicleMaterials,
} from '@/render/hangar/vehicle-model';
import type { VehicleSpec } from '@/render/hangar/vehicle-spec';

/** Radians per second of the idle turntable. */
const IDLE_SPIN = 0.25;
const MIN_PITCH = -0.1;
const MAX_PITCH = 1.2;

export class VehicleView implements Disposable {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  private readonly materials: VehicleMaterials = createVehicleMaterials();
  private readonly turntable = new THREE.Group();
  private readonly floor: THREE.Mesh;
  private readonly observer: ResizeObserver;
  private vehicle: THREE.Group | null = null;
  private yaw = 0.7;
  private pitch = 0.32;
  private distance = 6;
  private centreY = 0.8;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lastTime = 0;
  private frame = 0;
  private disposed = false;

  private constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly canvas: HTMLCanvasElement,
    /** False when the player asked for reduced motion: the vehicle then turns only when dragged. */
    private readonly spin: boolean,
  ) {
    this.scene.add(this.turntable);
    const key = new THREE.DirectionalLight(0xfff2dd, 3.2);
    key.position.set(4, 6, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb6ff, 1.6);
    rim.position.set(-5, 2.5, -4);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0x9fb4d0, 0x1a1410, 0.9));
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a2330, metalness: 0.2, roughness: 0.85 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.turntable.add(this.floor);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('keydown', this.onKeyDown);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.frame = requestAnimationFrame(this.tick);
  }

  /** @throws when no WebGPU adapter can be acquired: the caller keeps the 2D diagram. */
  static async create(canvas: HTMLCanvasElement, spin: boolean): Promise<VehicleView> {
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
    await renderer.init();
    if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
      renderer.dispose();
      throw new Error('A WebGPU adapter could not be acquired.');
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    return new VehicleView(renderer, canvas, spin);
  }

  /** Replaces the vehicle on the turntable and frames it. */
  show(spec: VehicleSpec): void {
    if (this.vehicle) {
      this.turntable.remove(this.vehicle);
      disposeVehicle(this.vehicle);
    }
    this.vehicle = buildVehicle(spec, this.materials);
    this.turntable.add(this.vehicle);
    const bounds = new THREE.Box3().setFromObject(this.vehicle);
    const size = bounds.getSize(new THREE.Vector3());
    this.centreY = (bounds.min.y + bounds.max.y) / 2;
    this.distance = Math.max(size.x, size.y, size.z) * 2.5 + 0.4;
    // A satellite has no ground under it.
    this.floor.visible = spec.kind !== 'satellite';
  }

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    if (this.spin && !this.dragging) this.yaw += IDLE_SPIN * dt;
    this.turntable.rotation.y = this.yaw;
    this.camera.position.set(
      0,
      this.centreY + Math.sin(this.pitch) * this.distance,
      Math.cos(this.pitch) * this.distance,
    );
    this.camera.lookAt(0, this.centreY, 0);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.turn((event.clientX - this.lastX) * 0.01, (event.clientY - this.lastY) * 0.006);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };

  /** Arrow keys turn the vehicle for players without a pointer. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const step = 0.15;
    if (event.key === 'ArrowLeft') this.turn(-step, 0);
    else if (event.key === 'ArrowRight') this.turn(step, 0);
    else if (event.key === 'ArrowUp') this.turn(0, step);
    else if (event.key === 'ArrowDown') this.turn(0, -step);
    else return;
    event.preventDefault();
  };

  private turn(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + pitch));
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    if (this.vehicle) disposeVehicle(this.vehicle);
    this.floor.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.renderer.dispose();
  }
}
