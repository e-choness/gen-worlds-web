import { sampler, texture, uniform, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import type { AtmosphereDesc } from '@/universe/types';
import { atmMultiScatterLut, atmTransmittanceLut } from './atmosphere-wgsl';

const TRANSMITTANCE_SIZE: [number, number] = [256, 64];
const MULTISCATTER_SIZE: [number, number] = [32, 32];

function createLutTarget(width: number, height: number): THREE.RenderTarget {
  const target = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

/**
 * Renders the LUTs of any AtmosphereModel. One shared pair of materials: the per-planet values are
 * uniforms, so every planet reuses the same two GPU pipelines.
 */
export class AtmosphereLutBaker implements Disposable {
  private readonly P = uniform(new THREE.Matrix4());
  private readonly Q = uniform(new THREE.Vector4());
  private readonly transmittanceInput = texture(new THREE.Texture());
  private readonly transmittanceQuad: THREE.QuadMesh;
  private readonly multiScatterQuad: THREE.QuadMesh;
  private readonly materials: THREE.NodeMaterial[];

  constructor(private readonly renderer: THREE.WebGPURenderer) {
    const tMat = new THREE.NodeMaterial();
    tMat.fragmentNode = atmTransmittanceLut({ uv: uv(), P: this.P, Q: this.Q });
    this.transmittanceQuad = new THREE.QuadMesh(tMat);

    const mMat = new THREE.NodeMaterial();
    mMat.fragmentNode = atmMultiScatterLut({
      uv: uv(),
      tex: this.transmittanceInput,
      smp: sampler(this.transmittanceInput),
      P: this.P,
      Q: this.Q,
    });
    this.multiScatterQuad = new THREE.QuadMesh(mMat);
    this.materials = [tMat, mMat];
  }

  bake(model: AtmosphereModel): void {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    this.P.value.copy(model.P);
    this.Q.value.copy(model.Q);
    renderer.setRenderTarget(model.transmittance);
    this.transmittanceQuad.render(renderer);
    this.transmittanceInput.value = model.transmittance.texture;
    renderer.setRenderTarget(model.multiScatter);
    this.multiScatterQuad.render(renderer);
    renderer.setRenderTarget(previous);
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}

/** Per-planet atmosphere state: packed parameters and the two LUT render targets. */
export class AtmosphereModel implements Disposable {
  /** Packed parameters; layout documented in atmosphere-wgsl.ts. */
  readonly P = new THREE.Matrix4();
  readonly Q = new THREE.Vector4();
  readonly transmittance = createLutTarget(...TRANSMITTANCE_SIZE);
  readonly multiScatter = createLutTarget(...MULTISCATTER_SIZE);
  readonly groundRadius: number;
  readonly topRadius: number;

  constructor(
    readonly desc: AtmosphereDesc,
    radius: number,
    groundAlbedo = 0.25,
  ) {
    // Ground radius sits slightly below the datum so deep basins stay inside the model.
    this.groundRadius = radius - desc.rayleighScaleHeight * 0.25;
    this.topRadius = radius + desc.height;
    const mieExt: [number, number, number] = [
      desc.mie * (1 + desc.mieAbsorption[0]),
      desc.mie * (1 + desc.mieAbsorption[1]),
      desc.mie * (1 + desc.mieAbsorption[2]),
    ];
    // Matrix4.set() takes rows; read each column downward (see the layout in atmosphere-wgsl.ts).
    this.P.set(
      desc.rayleigh[0],
      desc.mie,
      mieExt[0],
      desc.absorption[0],
      desc.rayleigh[1],
      desc.mie,
      mieExt[1],
      desc.absorption[1],
      desc.rayleigh[2],
      desc.mie,
      mieExt[2],
      desc.absorption[2],
      desc.rayleighScaleHeight,
      desc.mieScaleHeight,
      desc.mieG,
      this.groundRadius,
    );
    this.Q.set(this.topRadius, desc.rayleighScaleHeight * 3, desc.rayleighScaleHeight * 1.9, groundAlbedo);
  }

  dispose(): void {
    this.transmittance.dispose();
    this.multiScatter.dispose();
  }
}
