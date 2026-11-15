// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The mission theatre: a small 3D stage that plays what the mission log is describing, so a crew
 * watching the log sees the rocket leave the pad, the spacecraft coast, the landing burn and the
 * vehicle at work. Like the hangar view it has its own light WebGPU renderer (a few hundred meshes,
 * no terrain streaming), separate from the game engine, and it shows the player's own vehicle.
 *
 * It illustrates a result the simulation has already decided: nothing here feeds back into the
 * mission. Motion is staged for clarity, not to scale; the sizes of rocket, vehicle and worlds are
 * theatre sizes. Single-thread only (main thread, one renderer per canvas).
 *
 *   const theatre = await MissionTheatre.create(canvas, setup, { still: false });
 *   theatre.show('launch', false);   // when the log reaches the launch
 *   theatre.dispose();
 */
import { float, normalView } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import { Noise3, smoothstep } from '@/core/noise';
import { Rng } from '@/core/random';
import {
  buildVehicle,
  createVehicleMaterials,
  disposeVehicle,
  type VehicleMaterials,
} from '@/render/hangar/vehicle-model';
import type { VehicleSpec } from '@/render/hangar/vehicle-spec';
import { ParticlePool } from '@/render/theatre/particle-pool';
import {
  buildPad,
  buildRocket,
  createLaunchMaterials,
  disposeModel,
  type LaunchMaterials,
  ROCKET_HEIGHT_M,
  ROCKET_NOZZLE_Y_M,
} from '@/render/theatre/rocket-model';

/** Where the mission log has got to. */
export type TheatrePhase = 'standby' | 'launch' | 'cruise' | 'arrival' | 'operations';

export interface TheatreSetup {
  /** The vehicle that flew; null draws the stage without one. */
  vehicle: VehicleSpec | null;
  /** True for a mission that works from orbit instead of landing. */
  orbiter: boolean;
  /** False when the destination is Earth itself: there is then no coast between worlds. */
  leavesEarth: boolean;
  /** Equirectangular colour maps (north up); null draws a plain globe in `groundTint`. */
  earthMapUrl: string | null;
  targetMapUrl: string | null;
  /** Colour of the destination's ground and dust (sRGB hex). */
  groundTint: number;
  /**
   * Seconds of coasting shown between launch and arrival when the log goes straight from one to
   * the other (a cruise in which nothing happened has no line of its own).
   */
  coastSeconds: number;
  /** Daytime sky of the destination at the horizon and overhead (sRGB hex); null for no air. */
  sky: { horizon: number; zenith: number } | null;
}

export interface TheatreOptions {
  /** True when the player asked for reduced motion: each scene is then one still picture. */
  still: boolean;
}

/** What is on stage: each phase maps to one of these, depending on the kind of mission. */
type Act = 'pad' | 'launch' | 'cruise' | 'orbit' | 'descent' | 'surface';

const EARTH_SKY = { horizon: 0xb4cfe6, zenith: 0x2f66ad } as const;
const EARTH_GROUND = 0x56604a;
const SPACE = 0x020409;
/** Seconds between ignition and lift-off, and the rocket's staged acceleration, m/s². */
const HOLD_DOWN_S = 0.9;
const LIFT_ACCELERATION = 5;
/** Height the staged descent starts from, m, and how long it takes, s. */
const DESCENT_HEIGHT_M = 26;
const DESCENT_SECONDS = 5;
/** Fraction of the descent flown under the parachute where there is air. */
const CHUTE_SHARE = 0.42;
const ROVER_SPEED_MS = 0.55;
const ROVER_CIRCLE_M = 9;
/** Radius of the globe in the orbit scene, and how high the satellite flies over it, m. */
const ORBIT_GLOBE_M = 42;
const ORBIT_HEIGHT_M = 6.5;
/** Scene time a still picture is taken at, s. */
const STILL_POSE_S = 3.2;
const STILL_STEP_S = 1 / 30;
const TAU = Math.PI * 2;
/** Share of the picture height the view is raised by, to clear the caption strip. */
const CAPTION_SHIFT = 0.1;
/** Size of the glowing shell of air round a globe, and the facing (normal·view) it has at the limb. */
const AIR_SHELL = 1.05;
const AIR_SHELL_EDGE = Math.sqrt(1 - 1 / AIR_SHELL ** 2);

interface Ground {
  mesh: THREE.Mesh;
  height(x: number, z: number): number;
}

export class MissionTheatre implements Disposable {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 3000);
  private readonly fog = new THREE.Fog(SPACE, 1e5, 1e6);
  private readonly sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  private readonly fill = new THREE.HemisphereLight(0xa9bcd6, 0x241b14, 0.9);
  /** Light from the far side of the Sun, so the metal faces turned away from it are not black. */
  private readonly bounce = new THREE.DirectionalLight(0x9fc0ff, 1.3);
  private readonly vehicleMaterials: VehicleMaterials = createVehicleMaterials();
  private readonly launchMaterials: LaunchMaterials = createLaunchMaterials();
  private readonly owned: Array<{ dispose(): void }> = [];
  private readonly observer: ResizeObserver;
  private readonly rng = new Rng(20261115);

  private readonly stars: THREE.Points;
  private readonly skyDome: THREE.Mesh;
  private readonly skyMaterial: THREE.MeshBasicMaterial;
  private readonly earthSky: Float32Array;
  private readonly targetSky: Float32Array | null;
  private readonly launchSite = new THREE.Group();
  private readonly rocket: THREE.Group;
  private readonly earthGround: Ground;
  private readonly targetGround: Ground | null;
  private readonly earthGlobe: THREE.Group | null;
  private readonly targetGlobe: THREE.Group;
  private readonly swath: THREE.Mesh;
  private readonly chute = new THREE.Group();
  private readonly craft = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private drill: THREE.Object3D | null = null;
  private drillRestY = 0;
  private readonly flame: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly dust: ParticlePool;

  /** Distance that frames the vehicle, the height of its middle and of its engine, m. */
  private frameM = 6;
  private centreY = 0.8;
  private engineY = 0.2;
  private bodyDepth = 1;

  private act: Act = 'pad';
  /** The scene asked for, which `act` reaches once any interlude before it has played. */
  private wanted: Act = 'pad';
  private lost = false;
  private time = 0;
  private flameDebt = 0;
  private smokeDebt = 0;
  private tumble = false;
  /** True once an orbiter has stopped manoeuvring and is at work. */
  private onStation = false;
  /** Seconds the rover has spent driving. */
  private driven = 0;
  private lastTime = 0;
  private frame = 0;
  private disposed = false;

  private constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly canvas: HTMLCanvasElement,
    private readonly setup: TheatreSetup,
    private readonly still: boolean,
  ) {
    const { scene } = this;
    scene.background = new THREE.Color(SPACE);
    scene.fog = this.fog;
    scene.add(this.sun, this.fill, this.bounce);

    this.stars = this.buildStars();
    scene.add(this.stars);

    // The sky is a dome whose vertex colours run from the horizon colour up to the zenith colour;
    // its material colour scales it, which is how the launch fades blue sky into space.
    const dome = new THREE.SphereGeometry(1500, 32, 16);
    this.earthSky = skyColours(dome, EARTH_SKY.horizon, EARTH_SKY.zenith);
    this.targetSky = setup.sky ? skyColours(dome, setup.sky.horizon, setup.sky.zenith) : null;
    dome.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.earthSky), 3));
    this.skyMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(dome, this.skyMaterial);
    this.skyDome.renderOrder = -1;
    this.owned.push(dome, this.skyMaterial);
    scene.add(this.skyDome);

    this.earthGround = this.buildGround(EARTH_GROUND, 1.2, 11, 0);
    this.rocket = buildRocket(this.launchMaterials);
    this.launchSite.add(this.earthGround.mesh, buildPad(this.launchMaterials), this.rocket);
    scene.add(this.launchSite);

    this.targetGround = setup.orbiter ? null : this.buildGround(setup.groundTint, 7, 29, 140);
    if (this.targetGround) scene.add(this.targetGround.mesh);

    const globe = new THREE.SphereGeometry(1, 96, 64);
    this.owned.push(globe);
    this.earthGlobe = setup.leavesEarth ? this.buildGlobe(globe, setup.earthMapUrl, 0x3d6ea8, true) : null;
    this.targetGlobe = setup.leavesEarth
      ? this.buildGlobe(globe, setup.targetMapUrl, setup.groundTint, setup.sky !== null)
      : this.buildGlobe(globe, setup.earthMapUrl, 0x3d6ea8, true);
    if (this.earthGlobe) scene.add(this.earthGlobe);
    scene.add(this.targetGlobe);

    // The strip of ground an orbiter's instrument sees, as a faint cone under it.
    const swathMaterial = new THREE.MeshBasicMaterial({
      color: 0x66d9ff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const swathShape = new THREE.ConeGeometry(2.4, ORBIT_HEIGHT_M, 40, 1, true);
    this.swath = new THREE.Mesh(swathShape, swathMaterial);
    this.swath.position.y = -ORBIT_HEIGHT_M / 2;
    this.owned.push(swathShape, swathMaterial);
    scene.add(this.swath);

    this.buildChute();
    scene.add(this.chute, this.craft);
    if (setup.vehicle) this.mountVehicle(setup.vehicle);

    this.flame = new ParticlePool(700, {
      from: 0xffb060,
      to: 0xff3a08,
      additive: true,
      opacity: 0.9,
      growth: 2.2,
      drag: 0.35,
      gravity: 0,
    });
    this.smoke = new ParticlePool(520, {
      from: 0xe6e2da,
      to: 0x8d8983,
      additive: false,
      opacity: 0.34,
      growth: 3,
      drag: 0.3,
      gravity: 0.5,
    });
    const tint = new THREE.Color(setup.groundTint);
    this.dust = new ParticlePool(420, {
      from: tint.clone().lerp(new THREE.Color(0xffffff), 0.35).getHex(),
      to: tint.getHex(),
      additive: false,
      opacity: 0.3,
      growth: 3.5,
      drag: 0.2,
      gravity: -0.6,
    });
    scene.add(this.flame.mesh, this.smoke.mesh, this.dust.mesh);
    this.owned.push(this.flame, this.smoke, this.dust);

    this.observer = new ResizeObserver(() => {
      this.resize();
      if (this.still) this.draw();
    });
    this.observer.observe(canvas);
    this.resize();
    this.enter('pad');
    if (still) this.pose();
    else this.frame = requestAnimationFrame(this.tick);
  }

  /** @throws when no WebGPU adapter can be acquired: the caller keeps its still picture. */
  static async create(
    canvas: HTMLCanvasElement,
    setup: TheatreSetup,
    options: TheatreOptions,
  ): Promise<MissionTheatre> {
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
      renderer.dispose();
      throw new Error('A WebGPU adapter could not be acquired.');
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return new MissionTheatre(renderer, canvas, setup, options.still);
  }

  /**
   * Puts the scene for `phase` on stage. `lost` plays the loss of the mission in that scene.
   * Calling it again with the same arguments does nothing, so a scene is never restarted mid-way.
   */
  show(phase: TheatrePhase, lost: boolean): void {
    const act = this.actFor(phase);
    const onStation = phase === 'operations';
    if (act === this.wanted && lost === this.lost && onStation === this.onStation) return;
    this.onStation = onStation;
    if (act !== this.wanted) {
      // Straight from lift-off to a landing: show the coast between the two worlds first.
      const coast =
        act === 'descent' && this.act === 'launch' && this.setup.leavesEarth && !lost && !this.still;
      this.enter(coast ? 'cruise' : act);
      this.wanted = act;
    }
    if (lost && !this.lost) this.lose();
    this.lost = lost;
    if (this.still) this.pose();
  }

  private actFor(phase: TheatrePhase): Act {
    const { orbiter, leavesEarth } = this.setup;
    switch (phase) {
      case 'standby':
        return 'pad';
      case 'launch':
        return 'launch';
      case 'cruise':
        return leavesEarth ? 'cruise' : 'orbit';
      case 'arrival':
        return orbiter ? 'orbit' : 'descent';
      default:
        return orbiter ? 'orbit' : 'surface';
    }
  }

  // --- building the stage -------------------------------------------------------------------

  private buildStars(): THREE.Points {
    const count = 1800;
    const positions = new Float32Array(count * 3);
    const colours = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      // Uniform on a sphere far outside everything else.
      const y = this.rng.range(-1, 1);
      const angle = this.rng.range(0, TAU);
      const ring = Math.sqrt(1 - y * y);
      positions[index * 3] = Math.cos(angle) * ring * 1200;
      positions[index * 3 + 1] = y * 1200;
      positions[index * 3 + 2] = Math.sin(angle) * ring * 1200;
      const brightness = 0.35 + this.rng.next() ** 3 * 0.65;
      const warmth = this.rng.range(-0.12, 0.12);
      colours[index * 3] = brightness * (1 + warmth);
      colours[index * 3 + 1] = brightness;
      colours[index * 3 + 2] = brightness * (1 - warmth);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const material = new THREE.PointsMaterial({
      vertexColors: true,
      sizeAttenuation: false,
      size: 1.5,
      fog: false,
      transparent: true,
      depthWrite: false,
    });
    this.owned.push(geometry, material);
    const stars = new THREE.Points(geometry, material);
    stars.frustumCulled = false;
    return stars;
  }

  /**
   * Rolling ground that is level in the middle, where things stand, and rougher further out.
   * `rocks` is how many boulders to scatter on it.
   */
  private buildGround(tint: number, reliefM: number, seed: number, rocks: number): Ground {
    const noise = new Noise3(seed);
    const height = (x: number, z: number): number => {
      const rough = smoothstep(4, 55, Math.hypot(x, z));
      const hills =
        noise.eval(x * 0.03, 0, z * 0.03) +
        noise.eval(x * 0.085, 7, z * 0.085) * 0.4 +
        noise.eval(x * 0.27, 3, z * 0.27) * 0.09;
      return hills * reliefM * rough + noise.eval(x * 0.6, 11, z * 0.6) * 0.035;
    };
    const geometry = new THREE.PlaneGeometry(360, 360, 160, 160);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position');
    const colours = new Float32Array(position.count * 3);
    const base = new THREE.Color(tint);
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index);
      const z = position.getZ(index);
      position.setY(index, height(x, z));
      // Patches of lighter and darker soil, so the plain is not one flat colour.
      const shade = 0.82 + noise.eval(x * 0.05, 21, z * 0.05) * 0.14 + noise.eval(x * 0.4, 5, z * 0.4) * 0.06;
      colours[index * 3] = base.r * shade;
      colours[index * 3 + 1] = base.g * shade;
      colours[index * 3 + 2] = base.b * shade;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    this.owned.push(geometry, material);

    if (rocks > 0) {
      const rockShape = new THREE.IcosahedronGeometry(1, 0);
      const rockMaterial = new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(0.62),
        roughness: 1,
        flatShading: true,
      });
      const field = new THREE.InstancedMesh(rockShape, rockMaterial, rocks);
      const matrix = new THREE.Matrix4();
      const at = new THREE.Vector3();
      const turn = new THREE.Quaternion();
      const size = new THREE.Vector3();
      const euler = new THREE.Euler();
      for (let index = 0; index < rocks; index++) {
        const distance = 3.5 + this.rng.next() ** 1.6 * 70;
        const angle = this.rng.range(0, TAU);
        const scale = this.rng.logRange(0.08, 0.7) * (1 + distance / 60);
        at.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
        // Sunk a little, so a boulder on a slope never hangs in the air.
        at.y = height(at.x, at.z) - scale * 0.15;
        euler.set(this.rng.range(0, TAU), this.rng.range(0, TAU), 0);
        size.set(scale, scale * this.rng.range(0.5, 0.9), scale * this.rng.range(0.7, 1.2));
        field.setMatrixAt(index, matrix.compose(at, turn.setFromEuler(euler), size));
      }
      mesh.add(field);
      this.owned.push(rockShape, rockMaterial, field);
    }
    return { mesh, height };
  }

  /** A world seen from space: unit sphere (scaled per scene), with a thin glowing rim where it has air. */
  private buildGlobe(
    shape: THREE.SphereGeometry,
    mapUrl: string | null,
    tint: number,
    air: boolean,
  ): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.95,
      metalness: 0,
      fog: false,
    });
    if (mapUrl) {
      new THREE.TextureLoader().load(mapUrl, (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        this.owned.push(texture);
        material.map = texture;
        material.color.setHex(0xffffff);
        material.needsUpdate = true;
        if (this.still) this.draw();
      });
    }
    group.add(new THREE.Mesh(shape, material));
    this.owned.push(material);
    if (air) {
      const rim = new THREE.MeshBasicNodeMaterial({
        color: tint === 0x3d6ea8 ? 0x5aa2ff : new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.4),
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      // Seen from inside-out, the shell is brightest against the limb and fades outward to nothing.
      rim.opacityNode = normalView.z.abs().div(AIR_SHELL_EDGE).min(1).pow(2.5).mul(float(0.75));
      const shell = new THREE.Mesh(shape, rim);
      shell.scale.setScalar(AIR_SHELL);
      group.add(shell);
      this.owned.push(rim);
    }
    return group;
  }

  /** A parachute for worlds with air: canopy and lines, hanging above the group's origin. */
  private buildChute(): void {
    const canopyShape = new THREE.SphereGeometry(2.1, 24, 10, 0, TAU, 0, Math.PI * 0.42);
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8e2d6,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const canopy = new THREE.Mesh(canopyShape, canopyMaterial);
    canopy.position.y = 4.2;
    const points: number[] = [];
    const rimY = 4.2 + Math.cos(Math.PI * 0.42) * 2.1;
    const rimRadius = Math.sin(Math.PI * 0.42) * 2.1;
    for (let line = 0; line < 8; line++) {
      const angle = (line / 8) * TAU;
      points.push(0, 0, 0, Math.cos(angle) * rimRadius, rimY, Math.sin(angle) * rimRadius);
    }
    const lineShape = new THREE.BufferGeometry();
    lineShape.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xcfc9bd });
    this.chute.add(canopy, new THREE.LineSegments(lineShape, lineMaterial));
    this.owned.push(canopyShape, canopyMaterial, lineShape, lineMaterial);
  }

  private mountVehicle(spec: VehicleSpec): void {
    const vehicle = buildVehicle(spec, this.vehicleMaterials);
    this.craft.add(vehicle);
    const bounds = new THREE.Box3().setFromObject(vehicle);
    const size = bounds.getSize(new THREE.Vector3());
    this.centreY = (bounds.min.y + bounds.max.y) / 2;
    this.frameM = Math.max(size.x, size.y, size.z) * 2.3 + 1;
    this.bodyDepth = spec.body[2];
    this.engineY = spec.kind === 'satellite' ? 0 : Math.max(0.1, bounds.min.y + 0.2);
    vehicle.traverse((child) => {
      if (child.name === 'wheel') this.wheels.push(child);
      if (child.name === 'drill') {
        this.drill = child;
        this.drillRestY = child.position.y;
      }
    });
  }

  // --- changing scene -----------------------------------------------------------------------

  private enter(act: Act): void {
    this.act = act;
    this.wanted = act;
    this.time = 0;
    this.tumble = false;
    this.driven = 0;
    this.flameDebt = 0;
    this.smokeDebt = 0;
    this.flame.clear();
    this.smoke.clear();
    this.dust.clear();

    const onEarth = act === 'pad' || act === 'launch';
    const onTarget = act === 'descent' || act === 'surface';
    const inSpace = !onEarth && !onTarget;
    this.launchSite.visible = onEarth;
    this.rocket.visible = onEarth;
    this.rocket.position.set(0, 0, 0);
    this.rocket.rotation.set(0, 0, 0);
    if (this.targetGround) this.targetGround.mesh.visible = onTarget;
    this.craft.visible = !onEarth;
    this.craft.position.set(0, 0, 0);
    this.craft.rotation.set(0, 0, 0);
    this.chute.visible = false;
    this.swath.visible = false;
    if (this.earthGlobe) this.earthGlobe.visible = act === 'cruise';
    this.targetGlobe.visible = inSpace;
    if (this.drill) this.drill.position.y = this.drillRestY;

    // Sky: Earth's by day at the pad, the destination's (if it has air) on its surface, none in space.
    const skyColours = onEarth ? this.earthSky : onTarget ? this.targetSky : null;
    this.skyDome.visible = skyColours !== null;
    if (skyColours) {
      const attribute = this.skyDome.geometry.getAttribute('color') as THREE.BufferAttribute;
      (attribute.array as Float32Array).set(skyColours);
      attribute.needsUpdate = true;
    }
    this.setSkyLevel(skyColours ? 1 : 0);
    const horizon = onEarth ? EARTH_SKY.horizon : (this.setup.sky?.horizon ?? SPACE);
    this.fog.color.setHex(skyColours ? horizon : SPACE);
    // Fog hides the edge of the ground under a sky; under a black sky distance fades to black.
    this.fog.near = inSpace ? 1e5 : 60;
    this.fog.far = inSpace ? 1e6 : 175;

    this.sun.intensity = 3.2;
    this.sun.color.setHex(0xfff1dc);
    this.fill.intensity = inSpace ? 0.22 : skyColours ? 0.95 : 0.3;
    if (inSpace) this.sun.position.set(6, 3.5, 5);
    else this.sun.position.set(-5, 4.2, 6);
    this.bounce.position.set(-this.sun.position.x, 1.6, -this.sun.position.z);

    if (act === 'orbit') {
      this.targetGlobe.scale.setScalar(ORBIT_GLOBE_M);
      this.targetGlobe.position.set(0, -ORBIT_GLOBE_M - ORBIT_HEIGHT_M, 0);
      this.swath.visible = this.setup.orbiter;
    }
  }

  /** 1 shows the daytime sky in full; 0 is black space with every star out. */
  private setSkyLevel(level: number): void {
    this.skyMaterial.color.setScalar(level);
    (this.stars.material as THREE.PointsMaterial).opacity = this.skyDome.visible ? 1 - level : 1;
    (this.scene.background as THREE.Color).setHex(SPACE);
  }

  /** The mission ends here: a burst where the vehicle is, and the light goes out of the scene. */
  private lose(): void {
    const source = this.act === 'pad' || this.act === 'launch' ? this.rocket : this.craft;
    const y = source.position.y + (source === this.rocket ? ROCKET_HEIGHT_M * 0.4 : this.centreY);
    for (let index = 0; index < 110; index++) {
      const up = this.rng.range(-1, 1);
      const angle = this.rng.range(0, TAU);
      const ring = Math.sqrt(1 - up * up);
      const speed = this.rng.range(3, 13);
      this.flame.emit(
        source.position.x,
        y,
        source.position.z,
        Math.cos(angle) * ring * speed,
        up * speed,
        Math.sin(angle) * ring * speed,
        this.rng.range(0.6, 1.4),
        this.rng.range(0.12, 0.32),
      );
    }
    // A launch failure destroys the rocket; anywhere else the vehicle is left dark and adrift.
    if (source === this.rocket && this.act === 'launch') this.rocket.visible = false;
    this.tumble = this.act !== 'surface';
  }

  // --- playing a scene ----------------------------------------------------------------------

  private readonly tick = (time: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.update(dt);
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Plays the scene forward to a representative moment and draws it once (reduced motion). */
  private pose(): void {
    const target = this.act === 'descent' ? DESCENT_SECONDS + 1.5 : STILL_POSE_S;
    while (this.time < target) this.update(STILL_STEP_S);
    this.draw();
  }

  private draw(): void {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }

  private update(dt: number): void {
    this.time += dt;
    if (this.act !== this.wanted && this.time >= this.setup.coastSeconds) this.enter(this.wanted);
    let floorY = Number.NEGATIVE_INFINITY;
    switch (this.act) {
      case 'pad':
      case 'launch':
        floorY = 0.25;
        this.updateLaunch(dt);
        break;
      case 'cruise':
        this.updateCruise(dt);
        break;
      case 'orbit':
        this.updateOrbit(dt);
        break;
      case 'descent':
        floorY = 0.2;
        this.updateDescent(dt);
        break;
      default:
        floorY = 0.2;
        this.updateSurface(dt);
        break;
    }
    if (this.lost) {
      // The light fades to a dull red once the mission is gone.
      this.sun.intensity += (1.1 - this.sun.intensity) * Math.min(1, dt * 1.5);
      this.sun.color.lerp(LOST_LIGHT, Math.min(1, dt * 1.5));
      if (this.tumble) {
        this.craft.rotation.x += dt * 0.9;
        this.craft.rotation.z += dt * 0.55;
      }
    }
    this.flame.update(dt, Number.NEGATIVE_INFINITY);
    this.smoke.update(dt, floorY);
    this.dust.update(dt, floorY);
  }

  private updateLaunch(dt: number): void {
    const { rng, rocket, camera } = this;
    const flying = this.act === 'launch';
    const burn = flying ? Math.max(0, this.time - HOLD_DOWN_S) : 0;
    const altitude = 0.5 * LIFT_ACCELERATION * burn * burn;
    const speed = LIFT_ACCELERATION * burn;
    // A gentle pitch-over once clear of the tower, as every launcher does to gain speed downrange.
    const lean = smoothstep(25, 160, altitude) * 0.42;
    rocket.position.set(altitude * lean * 0.5, altitude, 0);
    rocket.rotation.z = -lean;

    const lit = flying && !this.lost && this.time > 0.25;
    if (lit) {
      const throttle = Math.min(1, this.time / HOLD_DOWN_S);
      this.flameDebt += 260 * throttle * dt;
      while (this.flameDebt >= 1) {
        this.flameDebt -= 1;
        // The core engine and the two boosters each have their own plume.
        const engine = rng.int(-1, 1);
        this.flame.emit(
          rocket.position.x + engine * 0.67 + rng.range(-0.12, 0.12),
          altitude + ROCKET_NOZZLE_Y_M - rng.range(0, 0.4),
          rng.range(-0.12, 0.12),
          rng.range(-0.8, 0.8),
          speed - rng.range(9, 15) * throttle,
          rng.range(-0.8, 0.8),
          rng.range(0.3, 0.6),
          engine === 0 ? 0.5 : 0.36,
        );
      }
      this.smokeDebt += (altitude < 9 ? 85 * throttle : 34) * dt;
      while (this.smokeDebt >= 1) {
        this.smokeDebt -= 1;
        if (altitude < 9) {
          // Exhaust hits the pad and rolls outward along the ground.
          const angle = rng.range(0, TAU);
          const out = rng.range(4, 9);
          this.smoke.emit(
            Math.cos(angle) * 1.2,
            0.4,
            Math.sin(angle) * 1.2,
            Math.cos(angle) * out,
            rng.range(0.3, 1.8),
            Math.sin(angle) * out,
            rng.range(2.2, 3.8),
            rng.range(0.5, 0.9),
          );
        } else {
          // Higher up it trails behind as a column.
          this.smoke.emit(
            rocket.position.x + rng.range(-0.3, 0.3),
            altitude - rng.range(2.5, 4),
            rng.range(-0.3, 0.3),
            rng.range(-0.5, 0.5),
            speed * 0.2,
            rng.range(-0.5, 0.5),
            rng.range(2.5, 4),
            rng.range(0.6, 1),
          );
        }
      }
    } else if (!flying) {
      // On the pad the tanks vent a little cold vapour.
      this.smokeDebt += 5 * dt;
      while (this.smokeDebt >= 1) {
        this.smokeDebt -= 1;
        this.smoke.emit(
          0.5,
          rng.range(1.5, 4),
          0.2,
          rng.range(0.4, 1.1),
          -0.2,
          rng.range(-0.2, 0.2),
          2.2,
          0.16,
        );
      }
    }

    this.setSkyLevel(1 - smoothstep(18, 95, altitude));
    this.fog.far = 175 + altitude * 12;
    const angle = 0.55 + this.time * (flying ? 0.035 : 0.07);
    const radius = flying ? 17 + Math.min(altitude, 40) * 0.25 : 15;
    // The camera climbs behind the rocket, but slower, so the view tilts up as it goes.
    const cameraY = 1.3 + Math.max(0, altitude - 9) * 0.86;
    camera.position.set(Math.sin(angle) * radius, cameraY, Math.cos(angle) * radius);
    // A little shake while the engines are close.
    const shake = lit ? 0.05 / (1 + altitude * 0.08) : 0;
    camera.lookAt(
      rocket.position.x + rng.range(-shake, shake),
      altitude + ROCKET_HEIGHT_M * (flying ? 0.42 : 0.5) + rng.range(-shake, shake),
      0,
    );
  }

  private updateCruise(dt: number): void {
    const { craft, camera, time } = this;
    if (!this.tumble) {
      // The slow roll that keeps a coasting spacecraft evenly warmed.
      craft.rotation.y += dt * 0.22;
      craft.rotation.z = Math.sin(time * 0.3) * 0.06;
    }
    craft.position.set(0, -this.centreY, 0);
    if (this.earthGlobe) {
      const shrink = 1 / (1 + time * 0.06);
      this.earthGlobe.scale.setScalar(9 * shrink);
      this.earthGlobe.position.set(-13 - time * 0.5, -5 + time * 0.1, -30 - time * 2.2);
      this.earthGlobe.rotation.y += dt * 0.02;
    }
    const approach = Math.min(1, time / 30);
    this.targetGlobe.scale.setScalar(1.2 + approach * 5);
    this.targetGlobe.position.set(15 - approach * 3, 5 - approach, -70 + approach * 30);
    this.targetGlobe.rotation.y += dt * 0.03;
    const sway = Math.sin(time * 0.13) * 0.35;
    camera.position.set(Math.sin(sway) * this.frameM, this.frameM * 0.22, Math.cos(sway) * this.frameM);
    camera.lookAt(0, 0, 0);
  }

  private updateOrbit(dt: number): void {
    const { craft, camera, time } = this;
    craft.position.set(0, -this.centreY, 0);
    // The ground streams past underneath: the globe turns, the satellite stays in frame.
    this.targetGlobe.rotation.x += dt * 0.022;
    // Before it is on station the spacecraft is still firing its engine to shape the orbit.
    if (!this.onStation && !this.lost && this.setup.vehicle) this.emitEngine(dt, 0, 0, -1);
    this.swath.visible = this.onStation && this.setup.orbiter;
    (this.swath.material as THREE.MeshBasicMaterial).opacity = this.lost
      ? 0
      : 0.09 + Math.sin(time * 2.4) * 0.04;
    const sway = 0.7 + Math.sin(time * 0.11) * 0.3;
    const distance = this.frameM * 1.15;
    camera.position.set(Math.sin(sway) * distance, distance * 0.3, Math.cos(sway) * distance);
    camera.lookAt(0, -distance * 0.12, 0);
  }

  /** Exhaust from the vehicle's engine, pointing along the given direction in the vehicle's frame. */
  private emitEngine(dt: number, dx: number, dy: number, dz: number): void {
    const { rng, craft } = this;
    this.flameDebt += 110 * dt;
    while (this.flameDebt >= 1) {
      this.flameDebt -= 1;
      const speed = rng.range(5, 9);
      this.flame.emit(
        craft.position.x + rng.range(-0.04, 0.04),
        craft.position.y + (dy === 0 ? this.centreY : this.engineY) + rng.range(-0.04, 0.04),
        craft.position.z + dz * (this.bodyDepth / 2 + 0.15),
        dx * speed + rng.range(-0.5, 0.5),
        dy * speed + rng.range(-0.5, 0.5),
        dz * speed + rng.range(-0.5, 0.5),
        rng.range(0.16, 0.3),
        0.1,
      );
    }
  }

  private updateDescent(dt: number): void {
    const { craft, camera, time, rng, chute } = this;
    const progress = Math.min(1, time / DESCENT_SECONDS);
    // Fast at first, slowing all the way down to a soft touchdown.
    // A lost lander falls the rest of the way.
    const height = this.lost
      ? Math.max(0, craft.position.y - 9 * dt)
      : DESCENT_HEIGHT_M * (1 - progress) ** 2;
    craft.position.set(0, height, 0);
    if (height === 0) this.tumble = false;
    const down = progress >= 1;

    const hasChute = this.setup.sky !== null;
    const powered = !down && !this.lost && (!hasChute || progress > CHUTE_SHARE);
    if (hasChute && !this.lost) {
      const cut = progress - CHUTE_SHARE;
      chute.visible = cut < 0.3;
      if (cut <= 0) {
        chute.position.set(0, height + this.centreY * 2, 0);
        chute.rotation.set(Math.sin(time * 1.7) * 0.05, 0, Math.sin(time * 1.3) * 0.05);
      } else {
        // Cut loose, the canopy drifts off downwind while the engines take over.
        chute.position.x += dt * 5;
        chute.position.y += dt * 1.5;
        chute.rotation.z -= dt * 0.5;
      }
    } else chute.visible = false;

    if (powered) {
      this.emitEngine(dt, 0, -1, 0);
      if (height < 8) {
        this.smokeDebt += 70 * (1 - height / 8) * dt;
        while (this.smokeDebt >= 1) {
          this.smokeDebt -= 1;
          const angle = rng.range(0, TAU);
          const out = rng.range(4, 10);
          this.dust.emit(
            Math.cos(angle) * 0.6,
            0.25,
            Math.sin(angle) * 0.6,
            Math.cos(angle) * out,
            rng.range(0.4, 2.4),
            Math.sin(angle) * out,
            rng.range(1.4, 2.6),
            rng.range(0.3, 0.7),
          );
        }
      }
    }
    const angle = 0.6 + time * 0.06;
    // From a little above the vehicle, so the ground it is coming down to is in view under it.
    const distance = this.frameM * 1.5 + height * 0.35;
    camera.position.set(
      Math.sin(angle) * distance,
      height + 1.2 + distance * 0.22,
      Math.cos(angle) * distance,
    );
    camera.lookAt(0, height + this.centreY + (chute.visible ? 1.6 : 0), 0);
  }

  private updateSurface(dt: number): void {
    const { craft, camera, time, rng } = this;
    const ground = this.targetGround;
    if (this.wheels.length > 0) {
      // The rover drives a wide circle round its landing point, until the mission ends.
      const driving = !this.lost;
      if (driving) this.driven += dt;
      const along = this.driven * (ROVER_SPEED_MS / ROVER_CIRCLE_M);
      const x = Math.sin(along) * ROVER_CIRCLE_M;
      const z = Math.cos(along) * ROVER_CIRCLE_M;
      craft.position.set(x, ground ? ground.height(x, z) : 0, z);
      craft.rotation.y = Math.atan2(Math.cos(along), -Math.sin(along));
      if (driving) {
        const spin = (ROVER_SPEED_MS / 0.25) * dt;
        for (const wheel of this.wheels) wheel.rotation.x += spin;
        if (rng.next() < dt * 14) {
          this.dust.emit(
            x + rng.range(-0.5, 0.5),
            craft.position.y + 0.1,
            z + rng.range(-0.5, 0.5),
            rng.range(-0.3, 0.3),
            rng.range(0.2, 0.6),
            rng.range(-0.3, 0.3),
            rng.range(1, 1.8),
            rng.range(0.1, 0.2),
          );
        }
      }
    } else if (this.drill && !this.lost) {
      // A lander with a drill works it up and down into the ground.
      this.drill.position.y = this.drillRestY - (0.5 + Math.sin(time * 1.1) * 0.5) * 0.28;
      this.drill.rotation.y += dt * 9;
    }
    const angle = 0.9 + time * 0.07;
    const distance = this.frameM * 1.05;
    camera.position.set(
      craft.position.x + Math.sin(angle) * distance,
      craft.position.y + distance * 0.3 + 0.4,
      craft.position.z + Math.cos(angle) * distance,
    );
    camera.lookAt(craft.position.x, craft.position.y + this.centreY, craft.position.z);
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // The caption lies over the bottom of the picture: shift the view so the subject sits above it.
    this.camera.setViewOffset(width, height, 0, Math.round(height * CAPTION_SHIFT), width, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    for (const child of this.craft.children) disposeVehicle(child);
    disposeModel(this.launchSite);
    for (const item of this.owned) item.dispose();
    for (const material of Object.values(this.vehicleMaterials)) material.dispose();
    for (const material of Object.values(this.launchMaterials)) material.dispose();
    this.renderer.dispose();
  }
}

const LOST_LIGHT = new THREE.Color(0xff6a4a);

/** Per-vertex colours for a sky dome: `horizon` at and below eye level, `zenith` overhead. */
function skyColours(dome: THREE.SphereGeometry, horizon: number, zenith: number): Float32Array {
  const position = dome.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const low = new THREE.Color(horizon);
  const high = new THREE.Color(zenith);
  const mixed = new THREE.Color();
  for (let index = 0; index < position.count; index++) {
    const up = Math.max(0, position.getY(index) / 1500);
    mixed.copy(low).lerp(high, up ** 0.55);
    colours[index * 3] = mixed.r;
    colours[index * 3 + 1] = mixed.g;
    colours[index * 3 + 2] = mixed.b;
  }
  return colours;
}
