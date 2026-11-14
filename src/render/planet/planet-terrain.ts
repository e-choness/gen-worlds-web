// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Cube-sphere quadtree terrain for one planet.
 *
 * Lifecycle of a node:  created (no data) → requested (worker job) → ready (GPU meshes) → released.
 * A node is drawn when it is the deepest *ready* node along its branch that satisfies the LOD rule;
 * a parent keeps being drawn until all four children are ready, so there are never holes.
 * Nodes untouched by the selection for a while are released (geometry disposed, jobs cancelled).
 *
 * All positions are planet-local float64; meshes are placed camera-relative every frame.
 */
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import type { BodyDesc } from '@/universe/types';
import { buildChunkIndices, type ChunkData, chunkSize, DETAIL_PERIOD, faceDirection } from './chunk-builder';
import type { ChunkTicket, TerrainWorkerPool } from './terrain-worker-pool';

/** Split a node when the camera is closer than this many node sizes. */
const SPLIT_FACTOR = 1.75;
/** Finest vertex spacing we refine to, metres. */
const TARGET_SPACING = 0.6;
/** Frames a node may stay unused before its GPU resources are released. */
const RELEASE_AFTER_FRAMES = 240;
/** Time budget per frame for turning worker results into GPU meshes, milliseconds. */
const UPLOAD_BUDGET_MS = 3;

let sharedIndex: THREE.BufferAttribute | null = null;
function chunkIndex(): THREE.BufferAttribute {
  if (!sharedIndex) sharedIndex = new THREE.BufferAttribute(buildChunkIndices(), 1);
  return sharedIndex;
}

class TerrainNode {
  children: TerrainNode[] | null = null;
  data: ChunkData | null = null;
  ticket: ChunkTicket | null = null;
  /** True from the moment a job is requested until its meshes exist (covers the upload queue too). */
  requested = false;
  mesh: THREE.Mesh | null = null;
  water: THREE.Mesh | null = null;
  lastUsed = 0;
  /** Set when the node left the tree; late worker results for it are dropped. */
  released = false;
  /** Centre used for LOD decisions: analytic until the chunk data arrives, then exact. */
  readonly center = new THREE.Vector3();
  readonly size: number;
  boundRadius: number;

  constructor(
    readonly face: number,
    readonly level: number,
    readonly ix: number,
    readonly iy: number,
    radius: number,
  ) {
    this.size = chunkSize(radius, level);
    this.boundRadius = this.size * 0.75;
    const span = 2 / 2 ** level;
    const dir = [0, 0, 0];
    faceDirection(face, -1 + (ix + 0.5) * span, -1 + (iy + 0.5) * span, dir);
    this.center.set(dir[0] * radius, dir[1] * radius, dir[2] * radius);
  }
}

export interface TerrainStats {
  drawn: number;
  nodes: number;
  pending: number;
}

export class PlanetTerrain implements Disposable {
  readonly group = new THREE.Group();
  readonly stats: TerrainStats = { drawn: 0, nodes: 0, pending: 0 };
  private readonly roots: TerrainNode[] = [];
  private readonly maxLevel: number;
  private readonly uploadQueue: Array<{ node: TerrainNode; data: ChunkData }> = [];
  private readonly camera = new THREE.Vector3();
  private readonly drawn: TerrainNode[] = [];
  private frame = 0;
  private horizonSq = 0;
  private disposed = false;

  constructor(
    private readonly body: BodyDesc,
    private readonly pool: TerrainWorkerPool,
    private readonly terrainMaterial: THREE.Material,
    private readonly waterMaterial: THREE.Material | null,
  ) {
    this.group.name = `terrain:${body.name}`;
    const faceSize = chunkSize(body.radius, 0);
    this.maxLevel = Math.min(20, Math.max(2, Math.ceil(Math.log2(faceSize / (64 * TARGET_SPACING)))));
    for (let face = 0; face < 6; face++) {
      const root = new TerrainNode(face, 0, 0, 0, body.radius);
      this.roots.push(root);
      this.request(root);
    }
  }

  /** True once the six root chunks exist, i.e. the whole planet can be drawn at some LOD. */
  get ready(): boolean {
    return this.roots.every((r) => r.mesh !== null);
  }

  /**
   * Selects the LOD for the given camera and positions the chunk meshes camera-relative.
   * @param cameraLocal camera position relative to the planet centre, planet-local axes.
   * @param refine false freezes the tree (still repositions): used for distant bodies.
   */
  update(cameraLocal: THREE.Vector3, refine = true): void {
    this.frame++;
    this.camera.copy(cameraLocal);
    this.flushUploads();

    // Horizon culling: nothing beyond the geometric horizon (plus the tallest relief) can be seen.
    const r = cameraLocal.length();
    const R = this.body.radius;
    const relief = 12000;
    const camH = Math.max(r - (R - relief), 1);
    const horizon = Math.sqrt(camH * (2 * (R - relief) + camH)) + Math.sqrt(2 * relief * (2 * R));
    this.horizonSq = horizon * horizon;

    for (const node of this.drawn) {
      if (node.mesh) node.mesh.visible = false;
      if (node.water) node.water.visible = false;
    }
    this.drawn.length = 0;
    for (const root of this.roots) this.select(root, refine);
    for (const node of this.drawn) this.place(node);

    if (this.frame % 60 === 0) this.releaseUnused();
    this.stats.drawn = this.drawn.length;
    this.stats.pending = this.pool.pendingCount + this.uploadQueue.length;
  }

  private select(node: TerrainNode, refine: boolean): void {
    node.lastUsed = this.frame;
    const distSq = node.center.distanceToSquared(this.camera);
    const reach = node.boundRadius;
    // Entirely below the horizon: neither draw nor refine (roots always pass so the far side exists).
    if (node.level > 0 && distSq > (Math.sqrt(this.horizonSq) + reach) ** 2) return;

    const dist = Math.max(Math.sqrt(distSq) - reach * 0.35, 0);
    const wantSplit =
      refine && node.level < this.maxLevel && dist < node.size * SPLIT_FACTOR && node.mesh !== null;
    if (wantSplit) {
      if (!node.children) {
        const l = node.level + 1;
        const x = node.ix * 2;
        const y = node.iy * 2;
        const R = this.body.radius;
        node.children = [
          new TerrainNode(node.face, l, x, y, R),
          new TerrainNode(node.face, l, x + 1, y, R),
          new TerrainNode(node.face, l, x, y + 1, R),
          new TerrainNode(node.face, l, x + 1, y + 1, R),
        ];
      }
      let allReady = true;
      for (const child of node.children) {
        child.lastUsed = this.frame;
        if (!child.mesh) {
          allReady = false;
          if (!child.requested) this.request(child);
        }
      }
      if (allReady) {
        for (const child of node.children) this.select(child, refine);
        return;
      }
    }
    if (node.mesh) this.drawn.push(node);
  }

  private request(node: TerrainNode): void {
    const body = this.body;
    const ticket = this.pool.request(
      {
        bodyId: body.id,
        terrain: body.terrain,
        radius: body.radius,
        hasOcean: body.ocean !== null,
        address: { face: node.face, level: node.level, ix: node.ix, iy: node.iy },
      },
      // Coarse and near first: a coarse chunk covers the screen sooner than its descendants.
      () => -node.center.distanceToSquared(this.camera) / (node.size * node.size),
    );
    node.ticket = ticket;
    node.requested = true;
    ticket.promise.then((data) => {
      node.ticket = null;
      if (!data || this.disposed || node.released) return;
      this.uploadQueue.push({ node, data });
    });
  }

  private flushUploads(): void {
    const deadline = performance.now() + UPLOAD_BUDGET_MS;
    while (this.uploadQueue.length > 0) {
      const { node, data } = this.uploadQueue.shift() as { node: TerrainNode; data: ChunkData };
      if (!node.released) this.createMeshes(node, data);
      if (performance.now() > deadline) break;
    }
  }

  private createMeshes(node: TerrainNode, data: ChunkData): void {
    node.data = data;
    node.center.set(data.center[0], data.center[1], data.center[2]);
    node.boundRadius = data.boundRadius;

    const userData = {
      chunkCenter: new THREE.Vector3(data.center[0], data.center[1], data.center[2]),
      detailOffset: new THREE.Vector3(wrap(data.center[0]), wrap(data.center[1]), wrap(data.center[2])),
    };
    const bounds = new THREE.Sphere(new THREE.Vector3(), data.boundRadius);

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(chunkIndex());
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('surface', new THREE.BufferAttribute(data.surface, 2));
    geometry.boundingSphere = bounds;
    const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
    mesh.userData = userData;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    node.mesh = mesh;

    if (data.water && this.waterMaterial) {
      const wg = new THREE.BufferGeometry();
      wg.setIndex(chunkIndex());
      wg.setAttribute('position', new THREE.BufferAttribute(data.water.positions, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(data.water.normals, 3));
      wg.setAttribute('depth', new THREE.BufferAttribute(data.water.depth, 1));
      wg.boundingSphere = bounds;
      const water = new THREE.Mesh(wg, this.waterMaterial);
      water.userData = userData;
      water.visible = false;
      water.matrixAutoUpdate = false;
      this.group.add(water);
      node.water = water;
    }
    this.stats.nodes++;
  }

  private place(node: TerrainNode): void {
    const c = (node.data as ChunkData).center;
    const x = c[0] - this.camera.x;
    const y = c[1] - this.camera.y;
    const z = c[2] - this.camera.z;
    for (const mesh of [node.mesh, node.water]) {
      if (!mesh) continue;
      mesh.visible = true;
      mesh.position.set(x, y, z);
      mesh.updateMatrix();
    }
  }

  private releaseUnused(): void {
    const cutoff = this.frame - RELEASE_AFTER_FRAMES;
    const visit = (node: TerrainNode): void => {
      if (!node.children) return;
      let anyRecent = false;
      for (const child of node.children) {
        if (child.lastUsed > cutoff) anyRecent = true;
      }
      if (anyRecent) {
        for (const child of node.children) visit(child);
      } else {
        for (const child of node.children) this.releaseSubtree(child);
        node.children = null;
      }
    };
    for (const root of this.roots) visit(root);
  }

  private releaseSubtree(node: TerrainNode): void {
    if (node.children) {
      for (const child of node.children) this.releaseSubtree(child);
      node.children = null;
    }
    node.released = true;
    node.ticket?.cancel();
    node.ticket = null;
    for (const mesh of [node.mesh, node.water]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      // The index buffer is shared by every chunk: detach it so dispose() only frees this chunk's data.
      mesh.geometry.setIndex(null);
      mesh.geometry.dispose();
    }
    if (node.mesh) this.stats.nodes--;
    node.mesh = null;
    node.water = null;
    node.data = null;
  }

  dispose(): void {
    this.disposed = true;
    for (const root of this.roots) this.releaseSubtree(root);
    this.uploadQueue.length = 0;
    this.drawn.length = 0;
    this.group.removeFromParent();
  }
}

function wrap(value: number): number {
  return ((value % DETAIL_PERIOD) + DETAIL_PERIOD) % DETAIL_PERIOD;
}
