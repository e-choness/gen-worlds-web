// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Owns the WebGPU renderer, the single scene/camera pair and the post-processing chain.
 *
 * Rendering conventions used across the app:
 *  - The camera never moves: it sits at the scene origin and only rotates. World objects are placed
 *    relative to it every frame from float64 positions ("floating origin"), so float32 GPU precision
 *    is spent where the viewer is, whether that is a pebble or a star 10^13 m away.
 *  - Depth is reversed-Z float32 with an effectively infinite far plane.
 *  - The scene is rendered in linear HDR; atmosphere, bloom and tone mapping follow as post passes.
 */

import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { pass } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { DisposableStore } from '@/core/disposable';
import type { SettingsValues } from '@/core/settings';
import { AtmosphereLutBaker } from '@/render/atmosphere/atmosphere-model';
import { AtmospherePass } from '@/render/atmosphere/atmosphere-pass';
import { createCloudNoiseTexture } from '@/render/atmosphere/cloud-noise';
import type { Vec4Node } from './tsl';

export class UnsupportedError extends Error {}

export class Engine {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.25, 1e14);
  readonly atmospherePass: AtmospherePass;
  readonly lutBaker: AtmosphereLutBaker;
  private readonly pipeline: THREE.RenderPipeline;
  private readonly store = new DisposableStore();
  private pixelRatioCap = 1.5;
  private readonly withAtmosphere: Vec4Node;
  private readonly withBloom: ReturnType<Vec4Node['add']>;
  private bloomEnabled = true;

  private constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.lutBaker = this.store.add(new AtmosphereLutBaker(renderer));
    this.atmospherePass = new AtmospherePass(this.store.add(createCloudNoiseTexture()));
    this.scene.background = new THREE.Color(0x000000);
    this.scene.matrixWorldAutoUpdate = true;

    const scenePass = pass(this.scene, this.camera);
    const sceneColor = scenePass.getTextureNode('output');
    const sceneDepth = scenePass.getTextureNode('depth');
    const withAtmosphere = this.atmospherePass.build(sceneColor, sceneDepth);
    const glow = bloom(withAtmosphere, 0.35, 0.6, 1.2);
    this.withAtmosphere = withAtmosphere;
    this.withBloom = withAtmosphere.add(glow);
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = this.withBloom;

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);
    this.store.defer(() => observer.disconnect());
    this.resize();
  }

  static async create(canvas: HTMLCanvasElement): Promise<Engine> {
    if (!('gpu' in navigator)) throw new UnsupportedError('WebGPU is not available in this browser.');
    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: false,
      reversedDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    await renderer.init();
    if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
      renderer.dispose();
      throw new UnsupportedError('A WebGPU adapter could not be acquired.');
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    return new Engine(renderer, canvas);
  }

  get exposure(): number {
    return this.renderer.toneMappingExposure;
  }

  set exposure(value: number) {
    this.renderer.toneMappingExposure = value;
  }

  /** Applies the display-related preferences. Cheap to call when nothing changed. */
  applySettings(values: SettingsValues): void {
    if (this.camera.fov !== values.fov) {
      this.camera.fov = values.fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.pixelRatioCap !== values.renderScale) {
      this.pixelRatioCap = values.renderScale;
      this.resize();
    }
    if (this.bloomEnabled !== values.bloom) {
      this.bloomEnabled = values.bloom;
      this.pipeline.outputNode = values.bloom ? this.withBloom : this.withAtmosphere;
      this.pipeline.needsUpdate = true;
    }
  }

  render(): void {
    this.pipeline.render();
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.store.dispose();
    this.pipeline.dispose();
    this.renderer.dispose();
  }
}
