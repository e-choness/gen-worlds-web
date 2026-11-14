// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import type * as THREE from 'three/webgpu';
import type { BodyState } from '@/render/space/system-view';

/** A navigation marker the robot planted on a surface. Lives as long as its star system is loaded. */
export interface Beacon {
  id: number;
  label: string;
  body: BodyState;
  /** Position relative to the body centre, metres (float64). */
  local: THREE.Vector3;
}
