// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Small WGSL noise primitives shared by shader modules (galaxy backdrop, aurora).
 * Hash without sine (Dave Hoskins) and trilinear value noise built on it, both in 0..1.
 */
import { wgsl } from './tsl';

export const gxHash = wgsl<'float'>(/* wgsl */ `
fn gxHash(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.x + q.y) * q.z);
}`);

export const gxNoise = wgsl<'float'>(
  /* wgsl */ `
fn gxNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(gxHash(i), gxHash(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
        mix(gxHash(i + vec3<f32>(0.0, 1.0, 0.0)), gxHash(i + vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(gxHash(i + vec3<f32>(0.0, 0.0, 1.0)), gxHash(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
        mix(gxHash(i + vec3<f32>(0.0, 1.0, 1.0)), gxHash(i + vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}`,
  [gxHash],
);
