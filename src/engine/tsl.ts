// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Typed helpers over three's TSL. `@types/three` types nodes by their shader type; these aliases
 * keep signatures readable, and `wgsl()` gives raw-WGSL functions a typed result.
 */

import { wgslFn } from 'three/tsl';
import type { Node } from 'three/webgpu';

export type FloatNode = Node<'float'>;
export type Vec2Node = Node<'vec2'>;
export type Vec3Node = Node<'vec3'>;
export type Vec4Node = Node<'vec4'>;

type WgslArgs = Record<string, Node | number>;
export type WgslFunction<T extends string> = (args: WgslArgs) => Node<T>;

/**
 * Wraps one WGSL function. The string must contain exactly one `fn` (three parses the first
 * declaration as the callable); other functions it calls are passed through `includes`.
 */
export function wgsl<T extends string>(
  code: string,
  includes: ReadonlyArray<(args: WgslArgs) => Node> = [],
): WgslFunction<T> {
  return wgslFn(code, includes as never) as unknown as WgslFunction<T>;
}
