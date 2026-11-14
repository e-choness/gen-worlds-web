// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Probes for a usable WebGPU adapter without importing the engine, so browsers without WebGPU never
 * download three.js and still get the full 2D game.
 */
export async function hasWebgpu(): Promise<boolean> {
  if (!('gpu' in navigator)) return false;
  try {
    return (await navigator.gpu.requestAdapter()) !== null;
  } catch {
    // Some browsers expose navigator.gpu but reject the request (blocklisted GPU, disabled flag).
    return false;
  }
}
