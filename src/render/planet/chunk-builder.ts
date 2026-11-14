// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Builds the vertex data of one terrain chunk. Pure and DOM-free: runs inside terrain workers.
 *
 * A chunk is a node of a cube-sphere quadtree: (face, level, ix, iy). Its grid has `CHUNK_CELLS`
 * cells per side plus a one-vertex skirt ring that hangs below the surface to hide the cracks
 * between neighbours of different LOD.
 *
 * Positions are stored relative to the chunk centre (float32) while the centre itself is returned in
 * float64. The renderer places chunks camera-relative, so vertex precision is independent of the
 * planet's size and of how far the planet is from the system origin.
 */
import type { TerrainField } from '@/universe/terrain-field';

/** Cells per chunk side. */
export const CHUNK_CELLS = 64;
/** Vertices per side including the skirt ring. */
export const CHUNK_VERTS = CHUNK_CELLS + 3;
/** Period of the wrapped detail coordinates, metres. Detail texture tile sizes must divide it. */
export const DETAIL_PERIOD = 8192;

export interface ChunkAddress {
  face: number;
  level: number;
  ix: number;
  iy: number;
}

export interface ChunkData {
  /** Chunk centre in planet-local coordinates, float64. */
  center: [number, number, number];
  /** Radius of the bounding sphere around `center`. */
  boundRadius: number;
  minHeight: number;
  maxHeight: number;
  positions: Float32Array;
  normals: Float32Array;
  /** Per vertex: height above datum (m), moisture 0..1. */
  surface: Float32Array;
  /** Present when the body has an ocean and part of the chunk is below sea level. */
  water: { positions: Float32Array; normals: Float32Array; depth: Float32Array } | null;
}

// Face bases chosen so that U × V = N: (i, j) grid order yields outward-facing CCW triangles.
const FACE_N = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
const FACE_U = [0, 0, -1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0];
const FACE_V = [0, 1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 0, 0, 1, 0];
const QUARTER_PI = Math.PI / 4;

/**
 * Unit direction for face coordinates (u, v) in [-1, 1]. The tangent warp equalises cell area
 * across the face (a plain normalised cube bunches vertices toward the corners).
 */
export function faceDirection(face: number, u: number, v: number, out: Float64Array | number[]): void {
  const f = face * 3;
  const a = Math.tan(u * QUARTER_PI);
  const b = Math.tan(v * QUARTER_PI);
  const x = FACE_N[f] + FACE_U[f] * a + FACE_V[f] * b;
  const y = FACE_N[f + 1] + FACE_U[f + 1] * a + FACE_V[f + 1] * b;
  const z = FACE_N[f + 2] + FACE_U[f + 2] * a + FACE_V[f + 2] * b;
  const inv = 1 / Math.sqrt(x * x + y * y + z * z);
  out[0] = x * inv;
  out[1] = y * inv;
  out[2] = z * inv;
}

/** Approximate edge length of a chunk at `level`, metres. */
export function chunkSize(radius: number, level: number): number {
  return (Math.PI * 0.5 * radius) / 2 ** level;
}

/** Shared index buffer for every chunk (same topology). */
export function buildChunkIndices(): Uint16Array | Uint32Array {
  const n = CHUNK_VERTS;
  const cells = n - 1;
  const indices = new Uint16Array(cells * cells * 6);
  let k = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }
  return indices;
}

export function buildChunk(field: TerrainField, addr: ChunkAddress, hasOcean: boolean): ChunkData {
  const R = field.radius;
  const N = CHUNK_CELLS;
  const E = N + 3; // evaluation grid: cells -1 .. N+1
  const span = 2 / 2 ** addr.level;
  const u0 = -1 + addr.ix * span;
  const v0 = -1 + addr.iy * span;
  const step = span / N;
  const spacing = chunkSize(R, addr.level) / N;
  const minWavelength = spacing * 1.6;
  const dir = new Float64Array(3);

  // Evaluate true surface points on an extended grid (one extra ring) for seamless normals.
  const px = new Float64Array(E * E);
  const py = new Float64Array(E * E);
  const pz = new Float64Array(E * E);
  const hh = new Float32Array(E * E);
  const dirs = new Float32Array(E * E * 3);
  let minH = Number.POSITIVE_INFINITY;
  let maxH = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < E; j++) {
    for (let i = 0; i < E; i++) {
      faceDirection(addr.face, u0 + (i - 1) * step, v0 + (j - 1) * step, dir);
      const h = field.height(dir[0], dir[1], dir[2], minWavelength);
      const k = j * E + i;
      const r = R + h;
      px[k] = dir[0] * r;
      py[k] = dir[1] * r;
      pz[k] = dir[2] * r;
      hh[k] = h;
      dirs[k * 3] = dir[0];
      dirs[k * 3 + 1] = dir[1];
      dirs[k * 3 + 2] = dir[2];
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  faceDirection(addr.face, u0 + span * 0.5, v0 + span * 0.5, dir);
  const midH = (minH + maxH) * 0.5;
  const cx = dir[0] * (R + midH);
  const cy = dir[1] * (R + midH);
  const cz = dir[2] * (R + midH);

  const V = CHUNK_VERTS;
  const positions = new Float32Array(V * V * 3);
  const normals = new Float32Array(V * V * 3);
  const surface = new Float32Array(V * V * 2);
  const needWater = hasOcean && minH < 0;
  const wPos = needWater ? new Float32Array(V * V * 3) : null;
  const wNor = needWater ? new Float32Array(V * V * 3) : null;
  const wDepth = needWater ? new Float32Array(V * V) : null;
  const skirt = spacing * 6 + (maxH - minH) * 0.05;
  let boundSq = 0;

  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      // Output vertex (i, j): ring vertices clamp onto the edge and drop by the skirt depth.
      const isSkirt = i === 0 || j === 0 || i === V - 1 || j === V - 1;
      const gi = Math.min(Math.max(i, 1), V - 2);
      const gj = Math.min(Math.max(j, 1), V - 2);
      const k = gj * E + gi;
      const o = (j * V + i) * 3;
      const ddx = dirs[k * 3];
      const ddy = dirs[k * 3 + 1];
      const ddz = dirs[k * 3 + 2];
      const drop = isSkirt ? skirt : 0;
      const x = px[k] - cx - ddx * drop;
      const y = py[k] - cy - ddy * drop;
      const z = pz[k] - cz - ddz * drop;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      const dsq = x * x + y * y + z * z;
      if (dsq > boundSq) boundSq = dsq;

      // Central-difference normal from the extended grid.
      const ax = px[k + 1] - px[k - 1];
      const ay = py[k + 1] - py[k - 1];
      const az = pz[k + 1] - pz[k - 1];
      const bx = px[k + E] - px[k - E];
      const by = py[k + E] - py[k - E];
      const bz = pz[k + E] - pz[k - E];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;

      const s = (j * V + i) * 2;
      surface[s] = hh[k];
      surface[s + 1] = field.moisture(ddx, ddy, ddz);

      if (wPos && wNor && wDepth) {
        const wr = R - drop;
        wPos[o] = ddx * wr - cx;
        wPos[o + 1] = ddy * wr - cy;
        wPos[o + 2] = ddz * wr - cz;
        wNor[o] = ddx;
        wNor[o + 1] = ddy;
        wNor[o + 2] = ddz;
        wDepth[j * V + i] = -hh[k];
        const wsq = wPos[o] * wPos[o] + wPos[o + 1] * wPos[o + 1] + wPos[o + 2] * wPos[o + 2];
        if (wsq > boundSq) boundSq = wsq;
      }
    }
  }

  return {
    center: [cx, cy, cz],
    boundRadius: Math.sqrt(boundSq),
    minHeight: minH,
    maxHeight: maxH,
    positions,
    normals,
    surface,
    water: wPos && wNor && wDepth ? { positions: wPos, normals: wNor, depth: wDepth } : null,
  };
}
