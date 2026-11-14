// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Everything that emits particles: thruster exhaust, dust kicked up by the jets, drill sparks and
 * chips, rock-break bursts, touchdown puffs and the weather of the region the robot is in (snow,
 * blowing dust, ash and embers, spores, rain).
 *
 * Particle motion uses Math.random: it is decoration, not world content, and need not be
 * reproducible.
 *
 * Emitters work in camera-relative space with world axes, like the rest of the scene. Dust and
 * weather are lit by the light at the viewer, so they darken at night and redden at sunset.
 */
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import type { BiomeDesc, WeatherKind } from '@/universe/biome';
import { type ParticleSpawn, ParticleSystem } from './particles';

export interface EffectsFrame {
  /** Robot position relative to the camera. */
  robot: THREE.Vector3;
  /** Hull attitude. */
  orientation: THREE.Quaternion;
  /** Craft velocity in system space, m/s. */
  velocity: THREE.Vector3;
  /** How far the camera moved this frame. */
  cameraDelta: THREE.Vector3;
  /** Local vertical, or null in open space. */
  up: THREE.Vector3 | null;
  /** Surface gravity, m/s². */
  gravity: number;
  /** Height of the hull above the ground, metres. */
  altitude: number;
  thrust: number;
  lift: number;
  drilling: boolean;
  grounded: boolean;
  /** True where the body has air: dust billows and hangs instead of flying ballistically. */
  hasAir: boolean;
  /** True when the ground below is liquid. */
  overLiquid: boolean;
  /** Region under the robot, when near enough to the ground to have one. */
  region: BiomeDesc | null;
  /** Star light and sky light arriving at the viewer (scene-linear). */
  sunLight: THREE.Vector3;
  skyLight: THREE.Vector3;
  enabled: boolean;
}

/** Thruster nozzle exits in the robot's frame (see RobotModel). */
const NOZZLES = [new THREE.Vector3(-0.86, 0.02, 0.95), new THREE.Vector3(0.86, 0.02, 0.95)];
const POD_PIVOT_Z = 0.45;
const DRILL_TIP = new THREE.Vector3(0, -1.25, -1.5);
/** Weather only exists near the ground. */
const WEATHER_CEILING = 400;
const WEATHER_RADIUS = 26;

export class Effects implements Disposable {
  readonly particles = new ParticleSystem();
  private readonly p: ParticleSpawn = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size: 0.1,
    endSize: 0.1,
    r: 1,
    g: 1,
    b: 1,
    alpha: 0,
    drag: 0,
    gravity: 0,
  };
  private readonly a = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly bitangent = new THREE.Vector3();
  private readonly gravityVec = new THREE.Vector3();
  private readonly light = new THREE.Vector3();
  private readonly wind = new THREE.Vector3();
  private exhaustDebt = 0;
  private dustDebt = 0;
  private drillDebt = 0;
  private weatherDebt = 0;
  private wasGrounded = false;
  private podAngle = 0;
  private time = 0;

  update(dt: number, f: EffectsFrame): void {
    this.time += dt;
    const up = f.up;
    this.gravityVec.set(0, 0, 0);
    if (up) this.gravityVec.copy(up).multiplyScalar(-f.gravity);
    if (!f.enabled) {
      if (this.particles.alive > 0) this.particles.clear();
      return;
    }
    // Diffuse light on a particle: sun plus sky, never fully black so shapes read at night.
    this.light.copy(f.sunLight).multiplyScalar(0.32).add(f.skyLight).addScalar(0.012);

    this.emitExhaust(dt, f);
    if (up) {
      this.buildTangents(up);
      this.emitGroundDust(dt, f, up);
      this.emitDrill(dt, f, up);
      this.emitWeather(dt, f, up);
      if (f.grounded && !this.wasGrounded) this.burst(f, up, 26, 4.5);
    }
    this.wasGrounded = f.grounded;
    this.particles.update(dt, f.cameraDelta, this.gravityVec);
  }

  /** A puff of debris where a boulder broke, `offset` metres ahead of the robot. */
  rockBurst(f: Pick<EffectsFrame, 'robot' | 'orientation' | 'up' | 'region'>): void {
    if (!f.up) return;
    this.buildTangents(f.up);
    const origin = this.a.set(0, -0.6, -2.4).applyQuaternion(f.orientation).add(f.robot);
    const p = this.p;
    const tint = f.region?.color ?? [0.3, 0.28, 0.25];
    for (let i = 0; i < 46; i++) {
      this.randomHemisphere(f.up);
      const speed = 1.5 + Math.random() * 5;
      p.x = origin.x;
      p.y = origin.y;
      p.z = origin.z;
      p.vx = this.dir.x * speed;
      p.vy = this.dir.y * speed;
      p.vz = this.dir.z * speed;
      p.life = 0.9 + Math.random() * 1.6;
      p.size = 0.25;
      p.endSize = 1.4 + Math.random() * 1.6;
      this.setLit(tint, 0.3);
      p.drag = 1.6;
      p.gravity = 0.25;
      this.particles.spawn(p);
    }
  }

  private emitExhaust(dt: number, f: EffectsFrame): void {
    const power = Math.max(f.thrust, f.lift * 0.9);
    this.podAngle += (f.lift * 1.35 - this.podAngle) * (1 - Math.exp(-dt * 7));
    if (power < 0.03) {
      this.exhaustDebt = 0;
      return;
    }
    this.exhaustDebt += dt * (30 + power * 150);
    const p = this.p;
    const sin = Math.sin(this.podAngle);
    const cos = Math.cos(this.podAngle);
    while (this.exhaustDebt >= 1) {
      this.exhaustDebt -= 1;
      for (const nozzle of NOZZLES) {
        // The pod swivels about its pivot: rotate the nozzle exit and the jet axis with it.
        const dz = nozzle.z - POD_PIVOT_Z;
        this.a.set(nozzle.x, nozzle.y - dz * sin, POD_PIVOT_Z + dz * cos).applyQuaternion(f.orientation);
        this.dir.set((Math.random() - 0.5) * 0.25, -sin, cos).applyQuaternion(f.orientation);
        const speed = 5 + power * 9 + Math.random() * 3;
        p.x = f.robot.x + this.a.x;
        p.y = f.robot.y + this.a.y;
        p.z = f.robot.z + this.a.z;
        p.vx = this.dir.x * speed;
        p.vy = this.dir.y * speed;
        p.vz = this.dir.z * speed;
        p.life = 0.18 + Math.random() * 0.22;
        p.size = 0.2;
        p.endSize = 0.5 + power * 0.5;
        const heat = 1.2 + power * 2.6;
        p.r = 0.3 * heat;
        p.g = 0.55 * heat;
        p.b = 1.0 * heat;
        p.alpha = 0;
        p.drag = 2.5;
        p.gravity = 0;
        this.particles.spawn(p);
      }
    }
  }

  /** Dust, sand or spray thrown outward along the ground by the jets. */
  private emitGroundDust(dt: number, f: EffectsFrame, up: THREE.Vector3): void {
    // Idle hover (lift ≈ 0.3) raises nothing; walking leaves a light trail, the jets a cloud.
    const power = Math.max((f.lift - 0.35) * 1.5, f.thrust * 0.5);
    if (f.altitude > 9 || power < 0.1) {
      this.dustDebt = 0;
      return;
    }
    const closeness = 1 - f.altitude / 9;
    this.dustDebt += dt * power * closeness * 70;
    const p = this.p;
    const tint = f.overLiquid ? WHITE : (f.region?.color ?? DEFAULT_DUST);
    while (this.dustDebt >= 1) {
      this.dustDebt -= 1;
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.6 + Math.random() * 1.6;
      this.dir
        .copy(this.tangent)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(this.bitangent, Math.sin(angle));
      const speed = 2.5 + Math.random() * 5 * power;
      p.x = f.robot.x + this.dir.x * radius - up.x * f.altitude;
      p.y = f.robot.y + this.dir.y * radius - up.y * f.altitude;
      p.z = f.robot.z + this.dir.z * radius - up.z * f.altitude;
      const lift = 0.6 + Math.random() * 1.8;
      p.vx = this.dir.x * speed + up.x * lift;
      p.vy = this.dir.y * speed + up.y * lift;
      p.vz = this.dir.z * speed + up.z * lift;
      if (f.hasAir) {
        // Billows, slows and hangs.
        p.life = 1.4 + Math.random() * 2;
        p.size = 0.5;
        p.endSize = 2.2 + Math.random() * 2.2;
        p.drag = 1.5;
        p.gravity = 0.03;
        this.setLit(tint, f.overLiquid ? 0.18 : 0.26);
      } else {
        // Vacuum: every grain flies on a parabola and lands, with no cloud left behind.
        p.life = 1.2 + Math.random() * 1.6;
        p.size = 0.16;
        p.endSize = 0.3;
        p.drag = 0;
        p.gravity = 1;
        p.vx *= 1.6;
        p.vy *= 1.6;
        p.vz *= 1.6;
        this.setLit(tint, 0.7);
      }
      this.particles.spawn(p);
    }
  }

  private emitDrill(dt: number, f: EffectsFrame, up: THREE.Vector3): void {
    if (!f.drilling) {
      this.drillDebt = 0;
      return;
    }
    this.drillDebt += dt * 90;
    const tip = this.a.copy(DRILL_TIP).applyQuaternion(f.orientation).add(f.robot);
    const p = this.p;
    const tint = f.region?.color ?? DEFAULT_DUST;
    while (this.drillDebt >= 1) {
      this.drillDebt -= 1;
      this.randomHemisphere(up);
      p.x = tip.x;
      p.y = tip.y;
      p.z = tip.z;
      if (Math.random() < 0.55) {
        // Sparks: fast, bright, ballistic.
        const speed = 3 + Math.random() * 7;
        p.vx = this.dir.x * speed;
        p.vy = this.dir.y * speed;
        p.vz = this.dir.z * speed;
        p.life = 0.25 + Math.random() * 0.55;
        p.size = 0.07;
        p.endSize = 0.02;
        p.r = 9;
        p.g = 4 + Math.random() * 3;
        p.b = 0.8;
        p.alpha = 0;
        p.drag = 0.4;
        p.gravity = 1;
      } else {
        // Rock flour.
        const speed = 0.6 + Math.random() * 2;
        p.vx = this.dir.x * speed;
        p.vy = this.dir.y * speed;
        p.vz = this.dir.z * speed;
        p.life = 0.8 + Math.random() * 1.4;
        p.size = 0.2;
        p.endSize = 1 + Math.random();
        this.setLit(tint, 0.22);
        p.drag = f.hasAir ? 1.8 : 0;
        p.gravity = f.hasAir ? 0.05 : 1;
      }
      this.particles.spawn(p);
    }
  }

  /** Touchdown: a ring of dust rolling outward. */
  private burst(f: EffectsFrame, up: THREE.Vector3, count: number, speed: number): void {
    const p = this.p;
    const tint = f.overLiquid ? WHITE : (f.region?.color ?? DEFAULT_DUST);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      this.dir
        .copy(this.tangent)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(this.bitangent, Math.sin(angle));
      const s = speed * (0.6 + Math.random() * 0.8);
      p.x = f.robot.x + this.dir.x - up.x * f.altitude;
      p.y = f.robot.y + this.dir.y - up.y * f.altitude;
      p.z = f.robot.z + this.dir.z - up.z * f.altitude;
      p.vx = this.dir.x * s + up.x * 0.5;
      p.vy = this.dir.y * s + up.y * 0.5;
      p.vz = this.dir.z * s + up.z * 0.5;
      p.life = f.hasAir ? 1.6 + Math.random() * 1.4 : 1 + Math.random();
      p.size = 0.5;
      p.endSize = f.hasAir ? 3 + Math.random() * 2 : 0.4;
      p.drag = f.hasAir ? 1.8 : 0;
      p.gravity = f.hasAir ? 0.02 : 1;
      this.setLit(tint, f.hasAir ? 0.24 : 0.6);
      this.particles.spawn(p);
    }
  }

  private emitWeather(dt: number, f: EffectsFrame, up: THREE.Vector3): void {
    const weather: WeatherKind = f.region?.weather ?? 'none';
    if (weather === 'none' || !f.hasAir || f.altitude > WEATHER_CEILING) {
      this.weatherDebt = 0;
      return;
    }
    const spec = WEATHER[weather];
    const fade = 1 - THREE.MathUtils.smoothstep(f.altitude, WEATHER_CEILING * 0.5, WEATHER_CEILING);
    // Wind blows along the ground in a fixed direction, gusting slowly.
    const gust = 0.7 + 0.3 * Math.sin(this.time * 0.37) + 0.2 * Math.sin(this.time * 1.3);
    this.wind.copy(this.tangent).multiplyScalar(spec.wind * gust);
    // Precipitation comes and goes in fronts; dust, ash and spores are always in the air.
    const front =
      weather === 'rain' || weather === 'snow'
        ? THREE.MathUtils.clamp(
            0.45 + 0.55 * Math.sin(this.time * 0.06) + 0.3 * Math.sin(this.time * 0.017 + 1),
            0.08,
            1,
          )
        : 1;
    this.weatherDebt += dt * spec.rate * fade * front;
    const p = this.p;
    while (this.weatherDebt >= 1) {
      this.weatherDebt -= 1;
      // Fill a volume around the camera, biased upwind and along the direction of travel so the
      // particles are in view by the time they matter.
      const lead = spec.life * 0.4;
      p.x = (Math.random() * 2 - 1) * WEATHER_RADIUS - this.wind.x * lead + f.velocity.x * 0.5;
      p.y = (Math.random() * 2 - 1) * WEATHER_RADIUS - this.wind.y * lead + f.velocity.y * 0.5;
      p.z = (Math.random() * 2 - 1) * WEATHER_RADIUS - this.wind.z * lead + f.velocity.z * 0.5;
      const height = Math.random() * 10 * Math.sign(spec.fall || 1);
      p.x += up.x * height;
      p.y += up.y * height;
      p.z += up.z * height;
      p.vx = this.wind.x - up.x * spec.fall + (Math.random() - 0.5) * spec.jitter;
      p.vy = this.wind.y - up.y * spec.fall + (Math.random() - 0.5) * spec.jitter;
      p.vz = this.wind.z - up.z * spec.fall + (Math.random() - 0.5) * spec.jitter;
      p.life = spec.life * (0.7 + Math.random() * 0.6);
      p.size = spec.size * (0.6 + Math.random() * 0.8);
      p.endSize = p.size * spec.grow;
      p.drag = 0;
      p.gravity = 0;
      if (spec.emberChance > 0 && Math.random() < spec.emberChance) {
        // Embers rise against the ash fall and glow on their own.
        p.vx += up.x * (spec.fall + 1.4);
        p.vy += up.y * (spec.fall + 1.4);
        p.vz += up.z * (spec.fall + 1.4);
        p.size = 0.05;
        p.endSize = 0.02;
        p.r = 7;
        p.g = 2.2;
        p.b = 0.3;
        p.alpha = 0;
      } else if (spec.glow > 0) {
        p.r = spec.color[0] * spec.glow;
        p.g = spec.color[1] * spec.glow;
        p.b = spec.color[2] * spec.glow;
        p.alpha = 0;
      } else {
        this.setLit(weather === 'dust' ? (f.region?.color ?? DEFAULT_DUST) : spec.color, spec.alpha);
      }
      this.particles.spawn(p);
    }
  }

  /** Sets the spawn colour to a lit, premultiplied surface colour. */
  private setLit(albedo: readonly number[], alpha: number): void {
    const p = this.p;
    p.r = albedo[0] * this.light.x * alpha * 3;
    p.g = albedo[1] * this.light.y * alpha * 3;
    p.b = albedo[2] * this.light.z * alpha * 3;
    p.alpha = alpha;
  }

  private buildTangents(up: THREE.Vector3): void {
    this.tangent.set(0.36, 0.48, 0.8).cross(up);
    if (this.tangent.lengthSq() < 1e-4) this.tangent.set(1, 0, 0).cross(up);
    this.tangent.normalize();
    this.bitangent.crossVectors(up, this.tangent);
  }

  /** Random unit direction in the hemisphere around `up`, into `this.dir`. */
  private randomHemisphere(up: THREE.Vector3): void {
    const angle = Math.random() * Math.PI * 2;
    const z = 0.15 + Math.random() * 0.85;
    const r = Math.sqrt(1 - z * z);
    this.dir
      .copy(this.tangent)
      .multiplyScalar(Math.cos(angle) * r)
      .addScaledVector(this.bitangent, Math.sin(angle) * r)
      .addScaledVector(up, z);
  }

  dispose(): void {
    this.particles.dispose();
  }
}

const WHITE = [0.9, 0.92, 0.95];
const DEFAULT_DUST = [0.3, 0.27, 0.23];

interface WeatherSpec {
  /** Particles per second. */
  rate: number;
  life: number;
  size: number;
  /** End size as a multiple of the start size. */
  grow: number;
  /** Downward speed (negative rises), m/s. */
  fall: number;
  wind: number;
  jitter: number;
  color: number[];
  alpha: number;
  /** > 0: emissive particle of this strength instead of a lit one. */
  glow: number;
  emberChance: number;
}

const WEATHER: Record<Exclude<WeatherKind, 'none'>, WeatherSpec> = {
  snow: {
    rate: 260,
    life: 6,
    size: 0.06,
    grow: 1,
    fall: 1.4,
    wind: 2.2,
    jitter: 0.8,
    color: [0.95, 0.97, 1],
    alpha: 0.85,
    glow: 0,
    emberChance: 0,
  },
  dust: {
    rate: 60,
    life: 5,
    size: 1.6,
    grow: 2.2,
    fall: 0.05,
    wind: 7,
    jitter: 1.2,
    color: DEFAULT_DUST,
    alpha: 0.07,
    glow: 0,
    emberChance: 0,
  },
  ash: {
    rate: 170,
    life: 6,
    size: 0.07,
    grow: 1,
    fall: 0.7,
    wind: 1.5,
    jitter: 0.6,
    color: [0.16, 0.15, 0.15],
    alpha: 0.9,
    glow: 0,
    emberChance: 0.16,
  },
  spores: {
    rate: 70,
    life: 7,
    size: 0.05,
    grow: 1,
    fall: -0.25,
    wind: 0.6,
    jitter: 0.5,
    color: [0.7, 1, 0.45],
    alpha: 0,
    glow: 1.6,
    emberChance: 0,
  },
  rain: {
    rate: 520,
    life: 2.4,
    size: 0.035,
    grow: 1,
    fall: 9,
    wind: 2.5,
    jitter: 0.3,
    color: [0.7, 0.78, 0.85],
    alpha: 0.45,
    glow: 0,
    emberChance: 0,
  },
};
