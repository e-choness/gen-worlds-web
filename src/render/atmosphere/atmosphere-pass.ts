/**
 * Screen-space atmosphere composite. Runs after the opaque scene: for each pixel it reconstructs
 * the view ray and scene distance from the (reversed-Z) depth buffer and applies up to
 * `SLOT_COUNT` planetary atmospheres, far one first.
 */

import {
  dot,
  Fn,
  float,
  If,
  interleavedGradientNoise,
  normalize,
  sampler,
  screenCoordinate,
  screenUV,
  texture,
  texture3D,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Vec4Node } from '@/engine/tsl';
import type { CloudDesc } from '@/universe/types';
import type { AtmosphereModel } from './atmosphere-model';
import { atmApply } from './atmosphere-wgsl';
import { auroraGlow } from './aurora-wgsl';
import { cloudApply } from './cloud-wgsl';

export const SLOT_COUNT = 2;

class Slot {
  readonly enabled = uniform(0);
  readonly camPos = uniform(new THREE.Vector3());
  readonly camInfo = uniform(new THREE.Vector4());
  readonly sun = uniform(new THREE.Vector4(1, 0, 0, 1));
  readonly sunColor = uniform(new THREE.Vector3(1, 1, 1));
  readonly P = uniform(new THREE.Matrix4());
  readonly Q = uniform(new THREE.Vector4());
  readonly transmittance = texture(placeholder());
  readonly multiScatter = texture(placeholder());
  /** (ground radius, top radius) of the atmosphere model. */
  readonly radii = uniform(new THREE.Vector2());
  readonly cloudEnabled = uniform(0);
  /** (base radius, top radius, coverage, time). */
  readonly cloudK = uniform(new THREE.Vector4());
  /** (r² - base², r² - top²) from float64. */
  readonly cloudInfo = uniform(new THREE.Vector2());
  readonly cloudTint = uniform(new THREE.Vector3(1, 1, 1));
  readonly skyColor = uniform(new THREE.Vector3());
  /** (shell bottom radius, shell top radius, strength, time); strength 0 = no aurora. */
  readonly aurora = uniform(new THREE.Vector4());
  readonly axis = uniform(new THREE.Vector3(0, 1, 0));
}

/** Everything the pass needs to draw one planet's atmosphere (and clouds) this frame. */
export interface AtmosphereSlotInput {
  model: AtmosphereModel;
  /** Camera position relative to the planet centre (float64 components). */
  cameraLocal: THREE.Vector3;
  /** Unit direction to the star. */
  sunDir: THREE.Vector3;
  sunColor: THREE.Vector3;
  /** Ambient sky radiance, lights the clouds' shaded sides. */
  skyColor: THREE.Vector3;
  clouds: CloudDesc | null;
  planetRadius: number;
  time: number;
  /** Spin axis; aurorae ring its poles. */
  axis: THREE.Vector3;
  /** 0 = none. */
  auroraStrength: number;
}

/**
 * Stand-in bound before any planet claims a slot. It must have the same sampling state as the real
 * LUTs (linear, clamped): the shader is compiled against whatever texture is bound first, and three
 * derives the sampler declaration from that state.
 */
function placeholder(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class AtmospherePass {
  private readonly slots: Slot[] = [];
  private readonly frameJitter = uniform(0);
  // Scene-camera basis. TSL's camera nodes cannot be used here: inside a post pass they describe the
  // fullscreen quad's camera, not the camera that rendered the scene.
  private readonly camRight = uniform(new THREE.Vector3(1, 0, 0));
  private readonly camUp = uniform(new THREE.Vector3(0, 1, 0));
  private readonly camForward = uniform(new THREE.Vector3(0, 0, -1));
  /** (tan(fovX/2), tan(fovY/2), near plane). */
  private readonly lens = uniform(new THREE.Vector3(1, 1, 0.1));
  private frame = 0;

  constructor(private readonly cloudNoise: THREE.Data3DTexture) {
    for (let i = 0; i < SLOT_COUNT; i++) this.slots.push(new Slot());
  }

  /** Builds the composite node. Slot 0 is nearest to the camera and is applied last. */
  build(sceneColor: Vec4Node, sceneDepth: Vec4Node): Vec4Node {
    return Fn(() => {
      const ndc = screenUV.mul(2).sub(1);
      const rayDir = normalize(
        this.camForward
          .add(this.camRight.mul(ndc.x.mul(this.lens.x)))
          .sub(this.camUp.mul(ndc.y.mul(this.lens.y))),
      );
      // Reversed-Z with a far plane at ~infinity: depth = near / viewZ, 0 = nothing drawn.
      const depth = sceneDepth.x;
      const viewZ = this.lens.z.div(depth);
      const sceneDist = depth.greaterThan(0).select(viewZ.div(dot(rayDir, this.camForward)), float(-1));
      const noise = interleavedGradientNoise(screenCoordinate.xy.add(this.frameJitter.mul(5.588238))).fract();
      const color = vec3(sceneColor.xyz).toVar();
      const noiseTex = texture3D(this.cloudNoise);
      for (let i = SLOT_COUNT - 1; i >= 0; i--) {
        const s = this.slots[i];
        If(s.enabled.greaterThan(0.5), () => {
          // Clouds first: they become the "surface" the air in front of them is integrated to.
          const dist = float(sceneDist).toVar();
          If(s.cloudEnabled.greaterThan(0.5), () => {
            const clouded = cloudApply({
              sceneColor: color,
              rayDir,
              sceneDist: dist,
              camPos: s.camPos,
              camInfo: vec4(s.camInfo.x, s.cloudInfo.x, s.cloudInfo.y, noise),
              sunDir: s.sun.xyz,
              sunColor: s.sunColor,
              skyColor: s.skyColor,
              tint: s.cloudTint,
              tLut: s.transmittance,
              tSmp: sampler(s.transmittance),
              noise: noiseTex,
              nSmp: sampler(noiseTex),
              K: s.cloudK,
              Rg: s.radii.x,
              Rt: s.radii.y,
            });
            color.assign(clouded.xyz);
            dist.assign(clouded.w);
          });
          color.assign(
            atmApply({
              sceneColor: color,
              rayDir,
              sceneDist: dist,
              camPos: s.camPos,
              camInfo: vec4(s.camInfo.xyz, noise),
              sun: s.sun,
              sunColor: s.sunColor,
              tLut: s.transmittance,
              tSmp: sampler(s.transmittance),
              msLut: s.multiScatter,
              msSmp: sampler(s.multiScatter),
              P: s.P,
              Q: s.Q,
            }),
          );
          If(s.aurora.z.greaterThan(0), () => {
            color.addAssign(
              auroraGlow({
                rayDir,
                camPos: s.camPos,
                sceneDist: dist,
                jitter: noise,
                axis: s.axis,
                sunDir: s.sun.xyz,
                A: s.aurora,
              }),
            );
          });
        });
      }
      return vec4(color, 1);
    })();
  }

  beginFrame(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    this.camRight.value.set(e[0], e[1], e[2]);
    this.camUp.value.set(e[4], e[5], e[6]);
    this.camForward.value.set(-e[8], -e[9], -e[10]);
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    this.lens.value.set(tanY * camera.aspect, tanY, camera.near);
    this.frame = (this.frame + 1) % 64;
    this.frameJitter.value = this.frame;
    for (const slot of this.slots) slot.enabled.value = 0;
  }

  setSlot(index: number, input: AtmosphereSlotInput): void {
    const slot = this.slots[index];
    if (!slot) return;
    const { model, cameraLocal, sunDir, sunColor } = input;
    slot.enabled.value = 1;
    slot.camPos.value.copy(cameraLocal);
    const r = cameraLocal.length();
    // (r - R)(r + R) in float64: exact where r² - R² in float32 would lose the altitude entirely.
    slot.camInfo.value.set(
      r,
      (r - model.groundRadius) * (r + model.groundRadius),
      (r - model.topRadius) * (r + model.topRadius),
      0,
    );
    slot.sun.value.set(sunDir.x, sunDir.y, sunDir.z, 1);
    slot.sunColor.value.copy(sunColor);
    slot.P.value.copy(model.P);
    slot.Q.value.copy(model.Q);
    slot.radii.value.set(model.groundRadius, model.topRadius);
    slot.transmittance.value = model.transmittance.texture;
    slot.multiScatter.value = model.multiScatter.texture;

    // The emitting shell sits well above the scattering atmosphere (Earth: ~100–300 km).
    const scale = model.desc.rayleighScaleHeight;
    slot.aurora.value.set(
      input.planetRadius + scale * 12,
      input.planetRadius + scale * 36,
      input.auroraStrength,
      input.time,
    );
    slot.axis.value.copy(input.axis);

    const clouds = input.clouds;
    slot.cloudEnabled.value = clouds ? 1 : 0;
    if (clouds) {
      const base = input.planetRadius + clouds.baseHeight;
      const top = base + clouds.thickness;
      slot.cloudK.value.set(base, top, clouds.coverage, input.time);
      slot.cloudInfo.value.set((r - base) * (r + base), (r - top) * (r + top));
      slot.cloudTint.value.set(...clouds.color);
      slot.skyColor.value.copy(input.skyColor);
    }
  }
}
