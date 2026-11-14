/**
 * Near-field surface detail around the craft. What stands in a cell follows the region it lies in
 * (see universe/biome.ts): boulders everywhere, trees (ez-tree) or giant fungi where there is a
 * biosphere, crystal clusters on ice, salt and glass, rock spires in badlands and lava fields.
 * Boulders are breakable (fractured with three-pinata when the drill reaches them).
 *
 * Placement is deterministic and global: the cube-sphere face is divided into fixed cells; each
 * cell's content is a pure function of (body seed, face, cell). Cells are populated within a radius
 * of the craft a few per frame and dropped when they fall behind, so nothing is stored.
 *
 * Instances are positioned relative to a float64 anchor on the surface; the group is then placed
 * camera-relative like everything else.
 */
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import { hashCombine, Rng } from '@/core/random';
import { type FloraKind, regionAt } from '@/universe/biome';
import type { BodyDesc, Vec3Tuple } from '@/universe/types';
import { faceDirection } from './chunk-builder';
import type { PlanetView } from './planet-view';
import {
  makeCrystalGeometry,
  makeMushroomGeometry,
  makeRockGeometry,
  makeSpireGeometry,
} from './scatter-geometry';

const CELL_SIZE = 22;
/** Cells populated around the craft in each direction. */
const CELL_RADIUS = 7;
const CELLS_PER_FRAME = 10;
const MAX_INSTANCES = 700;
/** Scatter only exists near the ground. */
const MAX_ALTITUDE = 900;
const VARIANTS = 3;

type ItemKind = 'rock' | Exclude<FloraKind, 'none'>;
const KINDS: ItemKind[] = ['rock', 'tree', 'mushroom', 'crystal', 'spire'];

interface Item {
  kind: ItemKind;
  variant: number;
  /** Planet-local position, float64. */
  position: THREE.Vector3;
  up: THREE.Vector3;
  yaw: number;
  scale: number;
  broken: boolean;
}

interface Fragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  floor: number;
}

export class SurfaceScatter implements Disposable {
  readonly group = new THREE.Group();
  private readonly cells = new Map<string, Item[]>();
  /** Per kind, per variant: the instanced meshes that share one transform (a tree is two). */
  private readonly layers = new Map<ItemKind, THREE.InstancedMesh[][]>();
  private readonly rockGeometries: THREE.BufferGeometry[] = [];
  private readonly rockMaterial: THREE.MeshStandardNodeMaterial;
  private readonly innerMaterial: THREE.MeshStandardNodeMaterial;
  /** Geometries and materials owned by this scatter, beyond the rock ones above. */
  private readonly resources: Array<{ dispose(): void }> = [];
  private readonly counts = new Map<ItemKind, number[]>();
  private readonly fragments: Fragment[] = [];
  private readonly anchor = new THREE.Vector3();
  private readonly dir = [0, 0, 0];
  private readonly probe = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly yawQuat = new THREE.Quaternion();
  private readonly scaleVec = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private dirty = false;
  private disposed = false;
  private currentKey = '';

  constructor(
    private readonly body: BodyDesc,
    private readonly view: PlanetView,
  ) {
    this.group.name = `scatter:${body.name}`;
    // Boulders weather out of the ground they sit on: halfway between bedrock and the mean soil colour.
    const rock = body.palette.rock.map((c, i) => (c + body.palette.midland[i]) * 0.5);
    this.rockMaterial = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(rock[0], rock[1], rock[2]),
      roughness: 0.96,
      metalness: 0,
    });
    this.rockMaterial.vertexColors = true;
    const cliff = body.palette.cliff;
    // Freshly broken faces are darker and a little glossier than the weathered skin.
    this.innerMaterial = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(cliff[0] * 0.8, cliff[1] * 0.8, cliff[2] * 0.8),
      roughness: 0.7,
      metalness: 0.15,
    });
    for (const kind of KINDS) this.counts.set(kind, new Array<number>(VARIANTS).fill(0));
    const rocks: THREE.InstancedMesh[][] = [];
    for (let v = 0; v < VARIANTS; v++) {
      const geometry = makeRockGeometry(hashCombine(body.seed, 0x70c4, v));
      this.rockGeometries.push(geometry);
      rocks.push([this.instanced(geometry, this.rockMaterial)]);
    }
    this.layers.set('rock', rocks);

    // Only build what this world's regions can actually contain.
    const flora = new Set(body.biomes.biomes.filter((b) => b.floraDensity > 0).map((b) => b.flora));
    if (flora.has('tree')) void this.loadTrees();
    if (flora.has('spire')) {
      this.layers.set(
        'spire',
        this.variants((v) => makeSpireGeometry(hashCombine(body.seed, 0x5b1e, v)), this.rockMaterial),
      );
    }
    if (flora.has('crystal')) {
      const tint = crystalTint(body);
      const material = new THREE.MeshStandardNodeMaterial({
        color: new THREE.Color(tint[0], tint[1], tint[2]),
        roughness: 0.12,
        metalness: 0.1,
        emissive: new THREE.Color(tint[0], tint[1], tint[2]),
        emissiveIntensity: 0.9,
      });
      material.vertexColors = true;
      this.resources.push(material);
      this.layers.set(
        'crystal',
        this.variants((v) => makeCrystalGeometry(hashCombine(body.seed, 0xc415, v)), material),
      );
    }
    if (flora.has('mushroom')) {
      const v = body.palette.vegetation;
      const peak = Math.max(v[0], v[1], v[2], 1e-3);
      const cap = new THREE.Color(v[0] / peak, v[1] / peak, v[2] / peak).multiplyScalar(0.7);
      const material = new THREE.MeshStandardNodeMaterial({
        color: cap,
        roughness: 0.6,
        metalness: 0,
        // A faint glow: the caps stay readable at night and under the canopy of larger ones.
        emissive: cap,
        emissiveIntensity: 0.12,
        side: THREE.DoubleSide,
      });
      material.vertexColors = true;
      this.resources.push(material);
      this.layers.set(
        'mushroom',
        this.variants((i) => makeMushroomGeometry(hashCombine(body.seed, 0xf009, i)), material),
      );
    }
  }

  private instanced(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) {
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  private variants(
    make: (variant: number) => THREE.BufferGeometry,
    material: THREE.Material,
  ): THREE.InstancedMesh[][] {
    const out: THREE.InstancedMesh[][] = [];
    for (let v = 0; v < VARIANTS; v++) {
      const geometry = make(v);
      this.resources.push(geometry);
      out.push([this.instanced(geometry, material)]);
    }
    return out;
  }

  /** ez-tree is several megabytes (embedded bark/leaf textures): loaded only for worlds with flora. */
  private async loadTrees(): Promise<void> {
    const { Tree } = await import('@dgreenheck/ez-tree');
    if (this.disposed) return;
    const presets = ['Oak Medium', 'Pine Medium', 'Ash Medium', 'Aspen Medium'];
    const rng = new Rng(hashCombine(this.body.seed, 0x7ee5));
    const tint = this.body.palette.vegetation;
    const trees: THREE.InstancedMesh[][] = [];
    for (let v = 0; v < VARIANTS; v++) {
      const tree = new Tree();
      tree.loadPreset(presets[rng.int(0, presets.length - 1)]);
      tree.options.seed = rng.int(1, 60000);
      // Alien foliage follows the planet's vegetation colour.
      // Normalised: the leaf texture already carries the darkness; the tint only sets the hue.
      const peak = Math.max(tint[0], tint[1], tint[2], 1e-3);
      tree.options.leaves.tint = new THREE.Color()
        .setRGB(tint[0] / peak, tint[1] / peak, tint[2] / peak)
        .getHex();
      tree.generate();
      trees.push([
        this.instanced(tree.branchesMesh.geometry, tree.branchesMesh.material),
        this.instanced(tree.leavesMesh.geometry, tree.leavesMesh.material),
      ]);
      this.resources.push(tree.branchesMesh.geometry, tree.leavesMesh.geometry);
      for (const m of [tree.branchesMesh.material, tree.leavesMesh.material]) {
        for (const material of Array.isArray(m) ? m : [m]) this.resources.push(material);
      }
    }
    this.layers.set('tree', trees);
    this.dirty = true;
  }

  /**
   * @param craftLocal craft position relative to the planet centre.
   * @param cameraLocal camera position relative to the planet centre.
   */
  update(dt: number, craftLocal: THREE.Vector3, cameraLocal: THREE.Vector3, altitude: number): void {
    const active = altitude < MAX_ALTITUDE;
    this.group.visible = active;
    if (!active) {
      if (this.cells.size > 0) {
        this.cells.clear();
        this.dirty = true;
        this.currentKey = '';
      }
      return;
    }

    // Which cell is the craft over?
    const r = craftLocal.length();
    const face = faceOf(craftLocal);
    const [u, v] = faceUv(face, craftLocal);
    const cellsPerUnit = (this.body.radius * (Math.PI / 4)) / CELL_SIZE;
    const ci = Math.floor(u * cellsPerUnit);
    const cj = Math.floor(v * cellsPerUnit);
    const key = `${face}:${ci}:${cj}`;
    if (key !== this.currentKey) {
      this.currentKey = key;
      // Drop cells that fell out of range.
      for (const k of this.cells.keys()) {
        const [f, i, j] = k.split(':').map(Number);
        if (f !== face || Math.abs(i - ci) > CELL_RADIUS + 1 || Math.abs(j - cj) > CELL_RADIUS + 1) {
          this.cells.delete(k);
          this.dirty = true;
        }
      }
      // Re-anchor when the craft has drifted far from the anchor (keeps float32 offsets small).
      if (this.anchor.distanceToSquared(craftLocal) > 400 * 400) {
        this.anchor.copy(craftLocal).multiplyScalar(this.body.radius / r);
        this.dirty = true;
      }
    }

    // Populate missing cells, nearest first, a few per frame.
    let budget = CELLS_PER_FRAME;
    for (let ring = 0; ring <= CELL_RADIUS && budget > 0; ring++) {
      for (let di = -ring; di <= ring && budget > 0; di++) {
        for (let dj = -ring; dj <= ring && budget > 0; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const k = `${face}:${ci + di}:${cj + dj}`;
          if (this.cells.has(k)) continue;
          this.cells.set(k, this.populate(face, ci + di, cj + dj, cellsPerUnit));
          this.dirty = true;
          budget--;
        }
      }
    }

    if (this.dirty) this.rebuildInstances();
    this.group.position.subVectors(this.anchor, cameraLocal);
    this.updateFragments(dt);
  }

  /**
   * Breaks the nearest intact boulder within `reach` metres of `craftLocal`.
   * @returns true if a boulder was broken.
   */
  breakNearest(craftLocal: THREE.Vector3, reach: number): boolean {
    let best: Item | null = null;
    let bestSq = reach * reach;
    for (const items of this.cells.values()) {
      for (const item of items) {
        if (item.kind !== 'rock' || item.broken) continue;
        const sq = item.position.distanceToSquared(craftLocal) - item.scale * item.scale;
        if (sq < bestSq) {
          bestSq = sq;
          best = item;
        }
      }
    }
    if (!best) return false;
    best.broken = true;
    this.dirty = true;
    this.fracture(best);
    return true;
  }

  private populate(face: number, ci: number, cj: number, cellsPerUnit: number): Item[] {
    const body = this.body;
    const rng = new Rng(hashCombine(body.seed, 0x5ca7, face, ci, cj));
    const items: Item[] = [];
    const sample = (u: number, v: number) => {
      faceDirection(face, toFaceCoord(u / cellsPerUnit), toFaceCoord(v / cellsPerUnit), this.dir);
      const up = new THREE.Vector3(this.dir[0], this.dir[1], this.dir[2]);
      return { up, h: this.view.heightAt(up) };
    };
    // One region per cell, read at its centre.
    const centre = sample(ci + 0.5, cj + 0.5);
    const region = regionAt(
      body,
      centre.up,
      centre.h,
      this.view.field.moisture(centre.up.x, centre.up.y, centre.up.z),
    );

    const place = (kind: ItemKind, scale: number): void => {
      const { up, h } = sample(ci + rng.next(), cj + rng.next());
      // Nothing under water or on the beach line.
      if (body.ocean && h < 2.5) return;
      const sink = kind === 'rock' ? scale * 0.3 : scale * 0.12;
      items.push({
        kind,
        variant: rng.int(0, VARIANTS - 1),
        position: up.clone().multiplyScalar(body.radius + h - sink),
        up,
        yaw: rng.range(0, Math.PI * 2),
        scale,
        broken: false,
      });
    };

    // Boulders: most cells have none, some have a cluster.
    const rockiness = body.kind === 'barren' || body.kind === 'desert' || body.kind === 'lava' ? 0.42 : 0.22;
    if (rng.chance(Math.min(0.9, rockiness * region.rocks))) {
      const count = rng.int(1, 4);
      for (let i = 0; i < count; i++) place('rock', rng.logRange(0.35, 2.6));
    }
    if (region.flora !== 'none') {
      const living = region.flora === 'tree' || region.flora === 'mushroom';
      const density = region.floraDensity * (living ? body.life.vegetationDensity : 1);
      if (rng.chance(Math.min(0.95, 0.6 * density))) {
        const count = rng.int(1, density > 0.6 ? 3 : 2);
        for (let i = 0; i < count; i++) place(region.flora, floraScale(region.flora, rng));
      }
    }
    return items;
  }

  private rebuildInstances(): void {
    this.dirty = false;
    for (const counts of this.counts.values()) counts.fill(0);
    for (const items of this.cells.values()) {
      for (const item of items) {
        if (item.broken) continue;
        // A kind whose meshes are still loading (trees) is simply not drawn yet.
        const meshes = this.layers.get(item.kind)?.[item.variant];
        if (!meshes) continue;
        const counts = this.counts.get(item.kind) as number[];
        const n = counts[item.variant];
        if (n >= MAX_INSTANCES) continue;
        this.itemMatrix(item, this.matrix);
        for (const mesh of meshes) mesh.setMatrixAt(n, this.matrix);
        counts[item.variant] = n + 1;
      }
    }
    for (const [kind, variants] of this.layers) {
      const counts = this.counts.get(kind) as number[];
      variants.forEach((meshes, v) => {
        for (const mesh of meshes) {
          mesh.count = counts[v];
          mesh.instanceMatrix.needsUpdate = true;
        }
      });
    }
  }

  /** Local matrix of an item relative to the anchor: +Y along the surface normal, random yaw. */
  private itemMatrix(item: Item, out: THREE.Matrix4): void {
    this.quat.setFromUnitVectors(this.yAxis, item.up);
    this.yawQuat.setFromAxisAngle(this.yAxis, item.yaw);
    this.quat.multiply(this.yawQuat);
    this.probe.subVectors(item.position, this.anchor);
    out.compose(this.probe, this.quat, this.scaleVec.setScalar(item.scale));
  }

  /** Replaces a boulder by Voronoi fragments (three-pinata) that tumble away and settle. */
  private fracture(item: Item): void {
    const source = new DestructibleMesh(
      this.rockGeometries[item.variant].clone(),
      this.rockMaterial,
      this.innerMaterial,
    );
    const options = new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: 10,
      voronoiOptions: { mode: '3D' },
    });
    this.itemMatrix(item, this.matrix);
    const rng = new Rng(
      hashCombine(this.body.seed, Math.floor(item.position.x), Math.floor(item.position.z)),
    );
    try {
      source.fracture(options, (fragment) => {
        fragment.applyMatrix4(this.matrix);
        this.group.add(fragment);
        fragment.geometry.computeBoundingSphere();
        const centre =
          fragment.geometry.boundingSphere?.center.clone().applyMatrix4(this.matrix) ??
          fragment.position.clone();
        const outward = centre.sub(this.probe.subVectors(item.position, this.anchor)).normalize();
        this.fragments.push({
          mesh: fragment,
          velocity: outward.multiplyScalar(rng.range(1.2, 3.5)).addScaledVector(item.up, rng.range(1.5, 4)),
          spin: new THREE.Vector3(rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)),
          age: 0,
          floor: item.position.length() - item.scale * 0.2,
        });
      });
    } finally {
      source.geometry.dispose();
    }
  }

  private updateFragments(dt: number): void {
    const gravity = this.body.gravity;
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      f.age += dt;
      const up = this.probe.addVectors(f.mesh.position, this.anchor);
      const r = up.length();
      up.divideScalar(r);
      if (r > f.floor) {
        f.velocity.addScaledVector(up, -gravity * dt);
        f.mesh.position.addScaledVector(f.velocity, dt);
        f.mesh.rotation.x += f.spin.x * dt;
        f.mesh.rotation.y += f.spin.y * dt;
        f.mesh.rotation.z += f.spin.z * dt;
      } else {
        // Landed: sink away after a while.
        f.velocity.set(0, 0, 0);
        if (f.age > 5) f.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 1.5));
      }
      if (f.age > 8) {
        this.group.remove(f.mesh);
        f.mesh.geometry.dispose();
        this.fragments.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const f of this.fragments) f.mesh.geometry.dispose();
    this.fragments.length = 0;
    for (const variants of this.layers.values()) {
      for (const meshes of variants) for (const mesh of meshes) mesh.dispose();
    }
    this.layers.clear();
    for (const geometry of this.rockGeometries) geometry.dispose();
    for (const resource of this.resources) resource.dispose();
    this.rockMaterial.dispose();
    this.innerMaterial.dispose();
    this.cells.clear();
    this.group.removeFromParent();
  }
}

/** Size in metres of one flora item. Fungi and spires tower; crystals stay near the ground. */
function floraScale(kind: Exclude<FloraKind, 'none'>, rng: Rng): number {
  switch (kind) {
    case 'tree':
      return rng.range(0.55, 1.25);
    case 'mushroom':
      return rng.logRange(1.2, 9);
    case 'crystal':
      return rng.logRange(0.5, 3.2);
    default:
      return rng.logRange(1, 4.5);
  }
}

/** Crystal colour by what the world is made of. */
function crystalTint(body: BodyDesc): Vec3Tuple {
  switch (body.kind) {
    case 'ice':
      return [0.45, 0.8, 1];
    case 'lava':
      return [1, 0.35, 0.08];
    case 'desert':
      return [1, 0.72, 0.78];
    default:
      return [0.7, 0.85, 1];
  }
}

function faceOf(p: THREE.Vector3): number {
  const ax = Math.abs(p.x);
  const ay = Math.abs(p.y);
  const az = Math.abs(p.z);
  if (ax >= ay && ax >= az) return p.x > 0 ? 0 : 1;
  if (ay >= az) return p.y > 0 ? 2 : 3;
  return p.z > 0 ? 4 : 5;
}

// Inverse of chunk-builder's faceDirection: face axes (must match FACE_U / FACE_V there).
const FACE_AXES: Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]> = [
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
  [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
];

/** Face coordinates (u, v) in [-1, 1] of a point, in the same tangent-warped space as faceDirection. */
function faceUv(face: number, p: THREE.Vector3): [number, number] {
  const [n, u, v] = FACE_AXES[face];
  const d = p.dot(n);
  return [Math.atan(p.dot(u) / d) / (Math.PI / 4), Math.atan(p.dot(v) / d) / (Math.PI / 4)];
}

function toFaceCoord(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
