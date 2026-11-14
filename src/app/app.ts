/**
 * Composition root: builds the engine and the long-lived services, owns the frame loop and the
 * current star system. Subsystems never reach for each other through globals; they receive what
 * they need here.
 *
 * Frame order: input → flight (craft pose, float64) → camera rig → galactic frame / system
 * hand-over → system views (floating-origin placement, atmosphere slots) → robot, lights, tools →
 * UI → render.
 */
import * as THREE from 'three/webgpu';
import { AudioEngine } from '@/audio/audio-engine';
import { DisposableStore } from '@/core/disposable';
import { Emitter } from '@/core/events';
import { Rng } from '@/core/random';
import { Settings } from '@/core/settings';
import { Engine } from '@/engine/engine';
import { createDetailTexture } from '@/engine/noise-texture';
import { SceneLights } from '@/engine/scene-lights';
import { TerrainTextures } from '@/engine/terrain-textures';
import type { Beacon } from '@/player/beacon';
import { FlightController } from '@/player/flight-controller';
import { Input } from '@/player/input';
import { RobotModel } from '@/player/robot-model';
import { Scanner } from '@/player/scanner';
import { Effects } from '@/render/fx/effects';
import { TerrainWorkerPool } from '@/render/planet/terrain-worker-pool';
import { GalaxyBackdrop } from '@/render/space/galaxy-backdrop';
import { Starfield } from '@/render/space/starfield';
import { type BodyState, SystemView } from '@/render/space/system-view';
import { LIGHT_YEAR } from '@/universe/constants';
import { Galaxy } from '@/universe/galaxy';
import { generateSystem } from '@/universe/system';
import { TerrainField } from '@/universe/terrain-field';
import type { StarDesc, SystemDesc } from '@/universe/types';

export interface AppOptions {
  canvas: HTMLCanvasElement;
  /** Start-up overrides, mainly for automated captures: see `parseStartOptions`. */
  start?: StartOptions;
}

export interface StartOptions {
  /** Index of the body (planets and moons, flattened) to start at. */
  body?: number;
  /** Altitude above the surface in metres. */
  altitude?: number;
  /** Angle in degrees between the start point and the sub-solar point (0 = noon, 90 = terminator). */
  sunAngle?: number;
  kind?: string;
  /** Require the start body to have rings. */
  rings?: boolean;
  /** Move the start point to the nearest dry land. */
  land?: boolean;
  /** Start in the cockpit view (no robot in frame). */
  cockpit?: boolean;
  /** Start landed (surface mode). */
  landed?: boolean;
}

/** Camera offset from the craft in the craft's frame: chase view sits behind and above. */
const CHASE_OFFSET = new THREE.Vector3(0, 2.2, 7.4);
/** Closer and lower while landed, so the robot and the ground it works on fill the frame. */
const SURFACE_OFFSET = new THREE.Vector3(0, 1.5, 5.4);
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.3, -1.45);
/** Radius the survey pulse reaches on the ground, metres. */
const SCAN_PULSE_RANGE = 600;
const PULSE_COOLDOWN_SECONDS = 4;
const MAX_BEACONS = 12;

export interface AppEvents {
  /** Short status line for the HUD. */
  notice: string;
}

export class App {
  readonly galaxy = new Galaxy();
  readonly flight: FlightController;
  readonly input: Input;
  readonly scanner = new Scanner();
  readonly audio: AudioEngine;
  readonly settings = new Settings();
  readonly events = new Emitter<AppEvents>();
  readonly beacons: Beacon[] = [];
  /** Headlamp state (T). */
  lamp = false;
  system!: SystemView;
  /** Observer position in the galaxy, light-years. */
  readonly galacticPosition = new THREE.Vector3();
  /** Camera position in system space (the craft position plus the rig offset). */
  readonly cameraPosition = new THREE.Vector3();
  /** Simulation time in seconds. */
  time = 0;
  /** Smoothed frames per second, for the HUD. */
  fps = 0;
  cockpit = false;

  private readonly store = new DisposableStore();
  private readonly pool: TerrainWorkerPool;
  private readonly detailTexture: THREE.Texture;
  private readonly terrainTextures: TerrainTextures;
  private readonly clock = new THREE.Timer();
  private readonly backdrop: GalaxyBackdrop;
  private readonly starfield: Starfield;
  private readonly robot: RobotModel;
  private readonly lights: SceneLights;
  private readonly effects: Effects;
  private readonly previousCamera = new THREE.Vector3();
  private readonly cameraDelta = new THREE.Vector3();
  private readonly robotRelative = new THREE.Vector3();
  private readonly localUp = new THREE.Vector3();
  private readonly sampleRng = new Rng(0x5a3d1e);
  private readonly scratch = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();
  private readonly sunAtViewer = new THREE.Vector3();
  private readonly skyAtViewer = new THREE.Vector3();
  private readonly groundBounce = new THREE.Vector3();
  private readonly offsetWorld = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly robotQuat = new THREE.Quaternion();
  private readonly chasePitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.085);
  private frameListeners: Array<(dt: number) => void> = [];
  private armDeploy = 0;
  private pulse = -1;
  private drilling = false;
  private drillTimer = 0;
  private pulseCooldown = 0;
  private brokeRock = false;
  /** Seconds until the next lightning stroke, and the age of the current one (< 0 = none). */
  private lightningWait = 6;
  private lightningAge = -1;
  private thunderDelay = -1;
  private beaconSerial = 0;
  private readonly cameraOffset = CHASE_OFFSET.clone();
  private readonly viewForward = new THREE.Vector3();
  private readonly bodyQuatInverse = new THREE.Quaternion();

  private constructor(
    readonly engine: Engine,
    options: AppOptions,
  ) {
    this.pool = this.store.add(new TerrainWorkerPool());
    this.detailTexture = this.store.add(createDetailTexture());
    this.terrainTextures = this.store.add(new TerrainTextures());
    this.input = this.store.add(new Input(options.canvas));
    this.flight = new FlightController(this.input, this.settings);
    this.backdrop = this.store.add(new GalaxyBackdrop(engine.renderer, this.galaxy.params));
    this.starfield = this.store.add(new Starfield(this.galaxy));
    this.robot = this.store.add(new RobotModel());
    this.lights = new SceneLights(engine.scene);
    this.effects = this.store.add(new Effects());
    engine.scene.add(
      this.backdrop.mesh,
      this.starfield.points,
      this.robot.group,
      this.effects.particles.sprite,
    );
    this.cockpit = options.start?.cockpit ?? false;
    this.audio = this.store.add(new AudioEngine(this.settings));
    engine.applySettings(this.settings.values);
    this.store.add(this.settings.changed.on('change', () => engine.applySettings(this.settings.values)));
    // Audio may only start from a user gesture: the click that captures the pointer is that gesture.
    this.store.listen(options.canvas, 'pointerdown', () => this.audio.unlock());
    this.scanner.events.on('complete', () => this.audio.play('chime'));
    this.scanner.events.on('complete', (target) => {
      if (target.kind === 'site') this.pulse = 0;
    });
  }

  static async create(options: AppOptions): Promise<App> {
    const engine = await Engine.create(options.canvas);
    const app = new App(engine, options);
    app.enterSystem(app.findHomeSystem(options.start?.kind, options.start?.rings));
    app.placeAtStart(options.start ?? {});
    engine.renderer.setAnimationLoop(() => app.frame());
    return app;
  }

  /** Registers a per-frame callback (UI refresh etc.). Runs after simulation, before rendering. */
  onFrame(listener: (dt: number) => void): void {
    this.frameListeners.push(listener);
  }

  /** Sends the craft to a body (or cancels with null). */
  navigateTo(body: BodyState | null): void {
    if (!body) this.flight.cancelAutopilot();
    else this.flight.engageAutopilot(body.position, body.desc.radius, body.desc.name);
  }

  /** Searches outward from a fixed point in a spiral arm for a system with an interesting planet. */
  private findHomeSystem(kind = 'terra', rings = false): SystemDesc {
    const origin: [number, number, number] = [2180, 1, 20];
    let fallback: SystemDesc | null = null;
    for (let radius = 0; radius < 12; radius++) {
      for (let x = -radius; x <= radius; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -radius; z <= radius; z++) {
            if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
            for (const star of this.galaxy.sectorStars(origin[0] + x, origin[1] + y, origin[2] + z)) {
              if (!isMainSequence(star)) continue;
              const system = generateSystem(star);
              fallback ??= system;
              if (system.planets.some((p) => p.kind === kind && (!rings || p.rings))) return system;
            }
          }
        }
      }
    }
    if (!fallback) throw new Error('No star systems found near the home sector');
    return fallback;
  }

  enterSystem(system: SystemDesc): void {
    this.flight.cancelAutopilot();
    this.system?.dispose();
    // Beacons belong to bodies of the system being left.
    this.beacons.length = 0;
    this.system = new SystemView(system, this.engine, {
      engine: this.engine,
      pool: this.pool,
      detailTexture: this.detailTexture,
      terrainTextures: this.terrainTextures,
    });
  }

  private placeAtStart(start: StartOptions): void {
    const bodies = this.system.bodies;
    let body: BodyState | undefined = start.body !== undefined ? bodies[start.body] : undefined;
    body ??=
      bodies.find((b) => b.desc.kind === (start.kind ?? 'terra') && (!start.rings || b.desc.rings)) ??
      bodies[0];
    if (!body) return;
    const angle = THREE.MathUtils.degToRad(start.sunAngle ?? 50);
    // Rotate the sub-solar direction about an axis perpendicular to it.
    const axis = new THREE.Vector3(0, 1, 0).cross(body.sunDir).normalize();
    const direction = body.sunDir.clone().applyAxisAngle(axis, angle);
    if (start.land) findLand(body, direction);
    this.flight.placeAbove(body, direction, start.altitude ?? body.desc.radius * 1.6);
    this.robotQuat.copy(this.flight.orientation);
    if (start.landed) this.flight.mode = 'surface';
  }

  private frame(): void {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    this.time += dt;

    const nearest = this.system.nearestBody(this.flight.position);
    this.handleKeys();
    this.flight.update(dt, nearest);
    this.audio.update(dt);
    this.updateCamera(dt, nearest);
    this.updateGalacticFrame();
    this.updateLightning(dt, nearest);
    this.system.update(this.cameraPosition, this.time);
    this.updateSkyVisibility();
    this.updateTools(dt, nearest);
    this.updateLighting(nearest);
    this.updateEffects(dt, nearest);

    for (const listener of this.frameListeners) listener(dt);
    this.input.endFrame();
    this.engine.render();
  }

  private handleKeys(): void {
    const input = this.input;
    if (!this.flight.controlsEnabled) return;
    if (input.justPressed('KeyV')) this.cockpit = !this.cockpit;
    if (input.justPressed('KeyM')) {
      this.settings.set('muted', !this.settings.values.muted);
      this.events.emit('notice', this.settings.values.muted ? 'Audio muted' : 'Audio on');
    }
    if (input.justPressed('KeyL')) this.toggleLanding();
    if (input.justPressed('KeyT')) {
      this.lamp = !this.lamp;
      this.events.emit('notice', this.lamp ? 'Headlamp on' : 'Headlamp off');
    }
    if (input.justPressed('KeyB')) this.dropBeacon();
    if (input.justPressed('KeyR')) this.surveyPulse();
    if (input.justPressed('KeyF') && this.scanner.target && !this.scanner.scanning) {
      this.scanner.start();
      this.audio.play('scan');
    }
    if (input.justPressed('KeyG')) {
      const target = this.scanner.target;
      if (this.flight.autopilot) this.flight.cancelAutopilot();
      else if (target?.kind === 'body') this.navigateTo(target.body);
      else if (target?.kind === 'star')
        this.flight.engageAutopilot(new THREE.Vector3(), target.star.radius * 4, target.star.name);
    }
  }

  toggleLanding(): void {
    const result = this.flight.toggleLanding();
    this.events.emit(
      'notice',
      result === 'landing'
        ? 'Landing sequence — touch any thrust key to abort'
        : result === 'takeoff'
          ? 'Lift-off'
          : this.flight.telemetry.body?.desc.bands
            ? 'No solid surface to land on'
            : 'Too high to land — descend below 400 m',
    );
  }

  /** Plants a navigation beacon at the robot's feet. */
  dropBeacon(): void {
    const t = this.flight.telemetry;
    if (!t.body || t.mode !== 'surface') {
      this.events.emit('notice', 'Land first to plant a beacon');
      return;
    }
    if (this.beacons.length >= MAX_BEACONS) this.beacons.shift();
    this.beaconSerial++;
    const label = `Beacon ${this.beaconSerial}`;
    this.beacons.push({
      id: this.beaconSerial,
      label,
      body: t.body,
      local: this.flight.position.clone().sub(t.body.position),
    });
    this.audio.play('chime', 0.4);
    this.events.emit('notice', `${label} planted`);
  }

  /** Sends a survey pulse across the terrain: elevation contours for a few hundred metres around. */
  surveyPulse(): void {
    const t = this.flight.telemetry;
    if (!t.body?.view || t.body.desc.bands || t.altitude > 300) {
      this.events.emit('notice', 'Survey pulse needs ground within 300 m');
      return;
    }
    if (this.pulseCooldown > 0) return;
    this.pulse = 0;
    this.pulseCooldown = PULSE_COOLDOWN_SECONDS;
    this.audio.play('scan', 0.5);
  }

  /** Enables or disables player control (menus). The simulation keeps running. */
  setControlsEnabled(enabled: boolean): void {
    this.flight.controlsEnabled = enabled;
  }

  /** Places the render camera relative to the craft and keeps it out of the ground. */
  private updateCamera(dt: number, nearest: BodyState | null): void {
    const camera = this.engine.camera;
    const offset = this.cockpit
      ? COCKPIT_OFFSET
      : this.flight.mode === 'surface'
        ? SURFACE_OFFSET
        : CHASE_OFFSET;
    if (this.cockpit) this.cameraOffset.copy(offset);
    else this.cameraOffset.lerp(offset, 1 - Math.exp(-dt * 3));
    this.offsetWorld.copy(this.cameraOffset).applyQuaternion(this.flight.orientation);
    this.cameraPosition.copy(this.flight.position).add(this.offsetWorld);

    if (nearest?.view) {
      const up = this.scratch.subVectors(this.cameraPosition, nearest.position);
      const r = up.length();
      up.divideScalar(r);
      const minR = nearest.desc.radius + nearest.view.surfaceHeightAt(up) + 0.7;
      if (r < minR) {
        this.cameraPosition.copy(nearest.position).addScaledVector(up, minR);
        this.offsetWorld.subVectors(this.cameraPosition, this.flight.position);
      }
    }
    camera.quaternion.copy(this.flight.orientation);
    if (!this.cockpit) camera.quaternion.multiply(this.chasePitch);

    // The robot trails the commanded attitude slightly, so it visibly leans into turns.
    this.robotQuat.slerp(this.flight.bodyOrientation, 1 - Math.exp(-dt * 9));
    this.robot.group.quaternion.copy(this.robotQuat);
    this.robot.group.position.copy(this.offsetWorld).negate();
    this.robot.group.visible = !this.cockpit;
  }

  /**
   * Tracks where the craft is in the galaxy and hands over to another star system when it has
   * become the closer one. System space is re-based on the new star, so the flight is continuous.
   */
  private updateGalacticFrame(): void {
    const star = this.system.system.star;
    const g = this.galacticPosition;
    g.copy(this.cameraPosition).divideScalar(LIGHT_YEAR);
    g.x += star.positionLy[0];
    g.y += star.positionLy[1];
    g.z += star.positionLy[2];
    this.starfield.update(g);
    this.backdrop.update(g);

    const currentDistanceLy = this.flight.position.length() / LIGHT_YEAR;
    if (currentDistanceLy < 0.05) return;
    const nearest = this.starfield.nearest(g);
    if (!nearest || nearest.star.id === star.id || nearest.distanceLy > currentDistanceLy * 0.8) return;
    const next = nearest.star;
    this.scratch.set(
      star.positionLy[0] - next.positionLy[0],
      star.positionLy[1] - next.positionLy[1],
      star.positionLy[2] - next.positionLy[2],
    );
    this.flight.position.addScaledVector(this.scratch, LIGHT_YEAR);
    this.cameraPosition.addScaledVector(this.scratch, LIGHT_YEAR);
    this.enterSystem(generateSystem(next));
  }

  /** Stars are washed out by a bright sky: fade them with the daylight at the craft's position. */
  private updateSkyVisibility(): void {
    const t = this.flight.telemetry;
    const body = t.body;
    let visibility = 1;
    const atmosphere = body?.desc.atmosphere;
    if (body && atmosphere) {
      const up = this.scratch.subVectors(this.flight.position, body.position).normalize();
      const day = THREE.MathUtils.smoothstep(up.dot(body.sunDir), -0.12, 0.12);
      const air = Math.exp(-Math.max(t.altitudeDatum, 0) / (atmosphere.rayleighScaleHeight * 1.5));
      const thickness = Math.min(1, atmosphere.rayleigh[2] * atmosphere.rayleighScaleHeight * 6);
      visibility = 1 - day * Math.min(1, air * thickness * 4);
    }
    this.backdrop.visibility.value = visibility;
    this.starfield.visibility.value = visibility;
  }

  /** Scanner aim and sweep, drill, survey pulse, robot animation. */
  private updateTools(dt: number, nearest: BodyState | null): void {
    const t = this.flight.telemetry;
    this.forward.set(0, 0, -1).applyQuaternion(this.flight.orientation);
    this.scanner.updateTarget(this.system, this.flight.position, this.forward, nearest, t.altitude);
    this.scanner.update(dt);

    const atSite = this.scanner.target?.kind === 'site' && t.altitude < 12;
    this.drilling = atSite && this.flight.controlsEnabled && this.input.locked && this.input.down('Mouse0');
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    if (this.drilling) this.scanner.collectSample(dt * (0.5 + this.sampleRng.next()), this.sampleRng);
    if (nearest?.view) {
      const craftLocal = this.scratch.subVectors(this.flight.position, nearest.position);
      const cameraLocal = this.scratch2.subVectors(this.cameraPosition, nearest.position);
      nearest.view.updateScatter(dt, craftLocal, cameraLocal, t.altitude);
      // The drill shatters a boulder in reach about once a second; the debris is a richer sample.
      this.drillTimer = this.drilling ? this.drillTimer + dt : 0;
      if (this.drillTimer > 0.9 && nearest.view.breakBoulder(craftLocal, 6)) {
        this.drillTimer = 0;
        this.scanner.collectSample(4, this.sampleRng);
        this.brokeRock = true;
      }
    }
    this.armDeploy = THREE.MathUtils.clamp(this.armDeploy + (atSite ? dt : -dt) * 1.6, 0, 1);

    // Survey pulse: an expanding ring on the terrain around the craft after a site scan.
    if (this.pulse >= 0) {
      this.pulse += dt * 0.55;
      if (this.pulse > 1) this.pulse = -1;
    }
    if (nearest?.view) {
      const active = this.pulse >= 0 || (this.scanner.scanning && this.scanner.target?.kind === 'site');
      const radius = this.pulse >= 0 ? this.pulse * SCAN_PULSE_RANGE : this.scanner.progress * 40;
      nearest.view.setScanPulse(
        active ? this.scratch.copy(this.offsetWorld).negate() : null,
        radius,
        SCAN_PULSE_RANGE,
      );
    }

    // Soundtrack follows the setting: open space, a world filling the view, or its surface.
    const radius = nearest?.desc.radius ?? 0;
    this.audio.setCue(
      !nearest || t.altitude > radius * 14
        ? 'space'
        : t.altitude > Math.max(radius * 0.004, 12000)
          ? 'orbit'
          : 'surface',
    );
    this.audio.setThrust(this.flight.thrust);
    this.audio.setDrilling(this.drilling);

    // How far the view is pitched away from the hull: the sensor head follows the view.
    this.bodyQuatInverse.copy(this.flight.bodyOrientation).invert();
    this.viewForward
      .set(0, 0, -1)
      .applyQuaternion(this.flight.orientation)
      .applyQuaternion(this.bodyQuatInverse);
    // Headlamp: lights the terrain through its shader and everything else through a spot light.
    if (nearest?.view) {
      nearest.view.setLamp(this.scratch.copy(this.offsetWorld).negate(), this.forward, this.lamp ? 2.6 : 0);
    }
    this.lights.setLamp(this.scratch.copy(this.offsetWorld).negate(), this.forward, this.lamp);

    this.robot.update(dt, {
      lift: this.flight.lift,
      headPitch: Math.asin(THREE.MathUtils.clamp(this.viewForward.y, -1, 1)),
      lamp: this.lamp,
      thrust: this.flight.thrust,
      scanning: this.scanner.scanning || this.pulse >= 0,
      drilling: this.drilling,
      armDeploy: this.armDeploy,
    });
  }

  /**
   * Storm lightning on worlds that have it: while the craft is inside the weather layer, strokes
   * light the sky (and through it the ground and clouds) with a double flash; thunder follows.
   */
  private updateLightning(dt: number, nearest: BodyState | null): void {
    const view = nearest?.view;
    if (!nearest || !view) return;
    const desc = nearest.desc;
    const t = this.flight.telemetry;
    const stormy =
      desc.clouds !== null &&
      desc.phenomena.includes('Lightning storms') &&
      t.altitudeDatum < desc.clouds.baseHeight + desc.clouds.thickness * 2;
    if (!stormy) {
      view.flash = 0;
      this.lightningAge = -1;
      return;
    }
    if (this.lightningAge < 0) {
      this.lightningWait -= dt * (0.4 + (desc.clouds?.storminess ?? 0));
      if (this.lightningWait <= 0) {
        this.lightningAge = 0;
        this.lightningWait = 5 + Math.random() * 16;
        this.thunderDelay = 0.6 + Math.random() * 3.5;
      }
    } else {
      this.lightningAge += dt;
      if (this.lightningAge > 0.7) this.lightningAge = -1;
    }
    const a = this.lightningAge;
    // Two strokes 0.18 s apart, each decaying in a few hundredths of a second.
    view.flash = a < 0 ? 0 : 0.9 * (Math.exp(-a * 26) + (a > 0.18 ? 0.7 * Math.exp(-(a - 0.18) * 20) : 0));
    if (this.thunderDelay >= 0) {
      this.thunderDelay -= dt;
      if (this.thunderDelay < 0) this.audio.play('thunder', 0.25 + Math.random() * 0.35);
    }
  }

  /** Particles: exhaust, dust, sparks and the weather of the region below. */
  private updateEffects(dt: number, nearest: BodyState | null): void {
    const t = this.flight.telemetry;
    // A re-based frame (system hand-over) shows up as a huge delta; the particle system retires
    // everything that ends up far away, which is exactly what should happen.
    this.cameraDelta.subVectors(this.cameraPosition, this.previousCamera);
    this.previousCamera.copy(this.cameraPosition);
    this.robotRelative.copy(this.offsetWorld).negate();
    const site = this.scanner.target?.kind === 'site' ? this.scanner.target.site : null;
    const nearGround = nearest !== null && t.altitude < 3000;
    if (nearest) this.localUp.subVectors(this.flight.position, nearest.position).normalize();
    const frame = {
      robot: this.robotRelative,
      orientation: this.robotQuat,
      velocity: this.flight.velocity,
      cameraDelta: this.cameraDelta,
      up: nearGround ? this.localUp : null,
      gravity: nearest?.desc.gravity ?? 0,
      altitude: t.altitude,
      thrust: this.flight.thrust,
      lift: this.flight.lift,
      drilling: this.drilling,
      grounded: t.grounded,
      hasAir: nearest?.desc.atmosphere != null,
      overLiquid: nearest?.desc.ocean != null && site !== null && site.elevation < 0,
      region: site?.region ?? null,
      sunLight: this.sunAtViewer,
      skyLight: this.skyAtViewer,
      enabled: this.settings.values.particles,
    };
    if (this.brokeRock) this.effects.rockBurst(frame);
    this.brokeRock = false;
    this.effects.update(dt, frame);
  }

  /** Light for standard-material objects, matched to what the terrain shader computes. */
  private updateLighting(nearest: BodyState | null): void {
    const star = this.system.system.star;
    this.skyAtViewer.set(0, 0, 0);
    this.groundBounce.set(0, 0, 0);
    if (!nearest) {
      const sunDir = this.scratch.copy(this.cameraPosition).negate().normalize();
      this.sunAtViewer.set(...star.color).multiplyScalar(3.4);
      this.lights.update(sunDir, this.sunAtViewer, this.skyAtViewer, this.groundBounce, null);
      return;
    }

    this.sunAtViewer.copy(nearest.sunColor);
    const up = this.scratch2.subVectors(this.cameraPosition, nearest.position);
    const r = up.length();
    up.divideScalar(r);
    const mu = up.dot(nearest.sunDir);
    // Planet shadow: the star is below the geometric horizon as seen from this height.
    const horizon = -Math.sqrt(Math.max(0, 1 - (nearest.desc.radius / r) ** 2));
    const lit = THREE.MathUtils.smoothstep(mu, horizon - 0.02, horizon + 0.04);
    const atmosphere = nearest.desc.atmosphere;
    if (atmosphere && r < nearest.desc.radius + atmosphere.height) {
      // Rough extinction along the slant path: reddens and dims the light near the horizon.
      const depth = Math.exp(-(r - nearest.desc.radius) / atmosphere.rayleighScaleHeight);
      const airmass = Math.min(38, 1 / Math.max(mu + 0.03, 0.026)) * depth * atmosphere.rayleighScaleHeight;
      this.sunAtViewer.x *= Math.exp(-(atmosphere.rayleigh[0] + atmosphere.mie * 1.1) * airmass);
      this.sunAtViewer.y *= Math.exp(-(atmosphere.rayleigh[1] + atmosphere.mie * 1.1) * airmass);
      this.sunAtViewer.z *= Math.exp(-(atmosphere.rayleigh[2] + atmosphere.mie * 1.1) * airmass);
      if (nearest.view) this.skyAtViewer.copy(nearest.view.shading.skyColor.value).multiplyScalar(depth * 5);
    }
    this.sunAtViewer.multiplyScalar(lit);
    // Light bounced off the ground, fading with altitude.
    const near = Math.exp(-Math.max(r - nearest.desc.radius, 0) / (nearest.desc.radius * 0.5));
    const albedo = nearest.desc.bands ? nearest.desc.bands[0] : nearest.desc.palette.midland;
    this.groundBounce
      .set(...albedo)
      .multiply(nearest.sunColor)
      .multiplyScalar(0.6 * near * Math.max(mu, 0));
    this.lights.update(nearest.sunDir, this.sunAtViewer, this.skyAtViewer, this.groundBounce, up);
  }

  dispose(): void {
    this.engine.renderer.setAnimationLoop(null);
    this.system?.dispose();
    this.store.dispose();
    this.engine.dispose();
  }
}

/** Walks a spiral around `direction` (in place) until it finds ground a little above sea level. */
function findLand(body: BodyState, direction: THREE.Vector3): void {
  const field = new TerrainField(body.desc.terrain, body.desc.radius);
  const tangent = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
  const bitangent = direction.clone().cross(tangent);
  const probe = new THREE.Vector3();
  for (let i = 0; i < 4000; i++) {
    const radius = 0.0004 * i;
    const angle = i * 2.399963;
    probe
      .copy(direction)
      .addScaledVector(tangent, Math.cos(angle) * radius)
      .addScaledVector(bitangent, Math.sin(angle) * radius)
      .normalize();
    const h = field.height(probe.x, probe.y, probe.z, 30);
    if (h > 25 && h < 1800) {
      direction.copy(probe);
      return;
    }
  }
}

function isMainSequence(star: StarDesc): boolean {
  return star.class === 'G' || star.class === 'F' || star.class === 'K';
}

/** Reads start overrides from the query string: ?body=2&alt=1500&sun=70&kind=desert&land&rings&cockpit */
export function parseStartOptions(search: string): StartOptions {
  const params = new URLSearchParams(search);
  const num = (key: string): number | undefined => {
    const raw = params.get(key);
    if (raw === null || raw === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    body: num('body'),
    altitude: num('alt'),
    sunAngle: num('sun'),
    kind: params.get('kind') ?? undefined,
    land: params.has('land'),
    rings: params.has('rings'),
    cockpit: params.has('cockpit'),
    landed: params.has('landed'),
  };
}
