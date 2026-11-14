/**
 * The robot's motion. Two regimes share one controller:
 *
 *  - `flight`: six degrees of freedom in open space. Approaching a body the craft is progressively
 *    locked to the local horizon (it rolls itself upright, yaw turns about the local vertical and
 *    pitch stops short of straight up/down), so arriving from any attitude ends level, never
 *    inverted. Speed scales with altitude, gently near the ground and steeply in space, so the same
 *    keys cover hovering over a rock and crossing a star system.
 *  - `surface`: landed. The robot hovers just above the terrain under the body's gravity, walks with
 *    WASD relative to its heading and hops with its jets.
 *
 * `orientation` is where the player looks (camera and instruments); `bodyOrientation` is the hull,
 * which stays level on the ground while the view pitches.
 */
import * as THREE from 'three/webgpu';
import type { Settings } from '@/core/settings';
import type { BodyState } from '@/render/space/system-view';
import type { Input } from './input';

const MOUSE_RATE = 0.0016;
/** Hover height of the hull centre above the ground, metres. */
export const MIN_CLEARANCE = 1.6;
/** Landing is offered below this altitude, metres. */
export const LANDING_ALTITUDE = 400;
/** Above this altitude a landed robot is flying again. */
const SURFACE_CEILING = 90;
const WALK_SPEED = 7;
const SPRINT_SPEED = 19;
/** Largest |forward · up| allowed while horizon-locked (about 80 degrees of pitch). */
const PITCH_LIMIT = 0.985;

export type FlightMode = 'flight' | 'surface';

/** Sideways thruster acceleration as a share of the main engine's, and its ceiling in m/s². */
const TRANSLATE_SHARE = 0.3;
const TRANSLATE_LIMIT = 2.2;

/**
 * A powered descent flown by hand: real gravity, an engine of fixed acceleration and a Δv budget.
 * Space fires the main engine straight up; W A S D translate with the side thrusters.
 */
export interface DescentFlight {
  /** Local gravity and main engine acceleration, m/s². */
  gravity: number;
  thrustAcceleration: number;
  /** Δv in the tanks at hand-over and spent so far, m/s. */
  availableDeltaV: number;
  deltaVUsed: number;
  /** Vertical speed and sideways drift a touchdown survives, m/s. */
  maxTouchdownSpeed: number;
  maxTouchdownDrift: number;
  /** Current vertical speed (up positive) and ground speed, m/s. */
  verticalSpeed: number;
  groundSpeed: number;
  /** Null while flying. `dry`: the tanks emptied and the craft fell. */
  outcome: 'landed' | 'crashed' | 'dry' | null;
  /** Speed at ground contact, m/s. */
  touchdownSpeed: number;
}

export interface FlightTelemetry {
  /** Altitude above the terrain / ocean of the nearest body, metres. */
  altitude: number;
  /** Altitude above the datum radius. */
  altitudeDatum: number;
  speed: number;
  body: BodyState | null;
  throttle: number;
  mode: FlightMode;
  /** True while the hull rests at hover height on the ground. */
  grounded: boolean;
  /** 0 free attitude … 1 fully locked to the local horizon. */
  horizonLock: number;
}

/** Cruise speed in m/s for an altitude: ~14 m/s at the ground, ~110 at 1 km, half the altitude per second in space. */
export function cruiseSpeed(altitude: number): number {
  if (!Number.isFinite(altitude)) return 1e13;
  const a = Math.max(altitude, 0);
  const near = 14 + a * 0.1;
  const far = a * 0.5;
  const t = THREE.MathUtils.smoothstep(a, 15e3, 600e3);
  return Math.min(near + (far - near) * t, 3e17);
}

export class FlightController {
  /** Position in system space, float64. */
  readonly position = new THREE.Vector3();
  /** View attitude. */
  readonly orientation = new THREE.Quaternion();
  /** Hull attitude (equals `orientation` in flight, level on the ground). */
  readonly bodyOrientation = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  readonly telemetry: FlightTelemetry = {
    altitude: Number.POSITIVE_INFINITY,
    altitudeDatum: Number.POSITIVE_INFINITY,
    speed: 0,
    body: null,
    throttle: 1,
    mode: 'flight',
    grounded: false,
    horizonLock: 0,
  };
  mode: FlightMode = 'flight';
  /** Speed multiplier adjusted with the mouse wheel. */
  throttle = 1;
  /** 0..1 commanded thrust this frame, for engine visuals and audio. */
  thrust = 0;
  /** 0..1 downward jet output (hover, hop), for effects. */
  lift = 0;
  /** Destination the craft is flying itself to, or null under manual control. */
  autopilot: { target: THREE.Vector3; standoff: number; name: string } | null = null;
  /** False while a menu is open: look and thrust inputs are ignored, physics continues. */
  controlsEnabled = true;
  /** Set while a hand-flown landing is in progress or just ended (see `beginDescent`). */
  descent: DescentFlight | null = null;

  private readonly tmp = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();
  private readonly dq = new THREE.Quaternion();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  private readonly lookMatrix = new THREE.Matrix4();
  private readonly lookQuat = new THREE.Quaternion();
  private readonly origin = new THREE.Vector3();
  /** Vertical speed along the local up while landed, m/s. */
  private verticalSpeed = 0;
  private landing = false;

  constructor(
    private readonly input: Input,
    private readonly settings: Settings,
  ) {}

  /**
   * Flies to a point and parks `radius` × 3.2 away from it. The approach is exponential in the
   * remaining distance, so an interplanetary hop and a short one take a similar few seconds.
   */
  engageAutopilot(target: THREE.Vector3, radius: number, name: string): void {
    this.mode = 'flight';
    this.landing = false;
    // Keep the caller's vector: bodies of the real solar system move, and the target must follow.
    this.autopilot = { target, standoff: radius * 3.2, name };
  }

  cancelAutopilot(): void {
    this.autopilot = null;
  }

  /** Lands (from low flight) or takes off (from the ground). Returns what happened, for the HUD. */
  toggleLanding(): 'landing' | 'takeoff' | 'too-high' {
    if (this.mode === 'surface' || this.landing) {
      this.mode = 'flight';
      this.landing = false;
      // A short kick so the craft clears the ground before the pilot takes over.
      this.velocity.addScaledVector(this.up, 9);
      return 'takeoff';
    }
    const t = this.telemetry;
    if (!t.body || t.altitude > LANDING_ALTITUDE || t.body.desc.bands !== null) return 'too-high';
    this.autopilot = null;
    this.landing = true;
    return 'landing';
  }

  update(dt: number, nearest: BodyState | null): void {
    const input = this.input;
    const mouse = input.consumeMouse();
    const enabled = this.controlsEnabled;
    if (enabled && mouse.wheel !== 0)
      this.throttle = THREE.MathUtils.clamp(this.throttle * 1.3 ** -mouse.wheel, 0.1, 12);
    const sensitivity = MOUSE_RATE * this.settings.values.mouseSensitivity;
    const yaw = enabled ? -mouse.dx * sensitivity : 0;
    const pitch = enabled ? -mouse.dy * sensitivity * (this.settings.values.invertY ? -1 : 1) : 0;

    if (this.flyAutopilot(dt, enabled)) {
      this.bodyOrientation.copy(this.orientation);
      this.writeTelemetry(nearest, null);
      return;
    }

    // --- local vertical and altitude
    let altitude = Number.POSITIVE_INFINITY;
    let lock = 0;
    const up = this.up;
    if (nearest) {
      up.subVectors(this.position, nearest.position);
      const r = up.length();
      up.divideScalar(r);
      const surface = nearest.view ? nearest.view.surfaceHeightAt(up) : 0;
      altitude = r - nearest.desc.radius - surface;
      const lockAltitude = Math.min(nearest.desc.radius * 0.05, 60e3);
      lock = 1 - THREE.MathUtils.smoothstep(altitude, lockAltitude * 0.3, lockAltitude);
    }
    if (this.mode === 'surface' && (!nearest || altitude > SURFACE_CEILING)) this.mode = 'flight';

    // --- attitude
    if (lock > 0.5 || this.mode === 'surface') {
      // Horizon frame: yaw about the local vertical, pitch about the craft's own right axis.
      this.orientation.premultiply(this.dq.setFromAxisAngle(up, yaw));
      const elevation = Math.asin(
        THREE.MathUtils.clamp(this.forward.set(0, 0, -1).applyQuaternion(this.orientation).dot(up), -1, 1),
      );
      const limit = Math.asin(PITCH_LIMIT);
      const allowed = pitch > 0 ? Math.max(0, limit - elevation) : Math.min(0, -limit - elevation);
      const applied = pitch > 0 ? Math.min(pitch, allowed) : Math.max(pitch, allowed);
      this.orientation.multiply(this.dq.setFromAxisAngle(this.axisX, applied));
    } else {
      this.orientation.multiply(this.dq.setFromAxisAngle(this.axisY, yaw));
      this.orientation.multiply(this.dq.setFromAxisAngle(this.axisX, pitch));
      if (enabled)
        this.orientation.multiply(
          this.dq.setFromAxisAngle(this.axisZ, input.axis('KeyQ', 'KeyE') * 1.2 * dt),
        );
    }
    if (lock > 0) this.levelToHorizon(dt, this.mode === 'surface' ? 1 : lock);
    this.orientation.normalize();

    if (this.descent && !this.descent.outcome && nearest) this.updateDescent(dt, nearest, enabled);
    else if (this.descent?.outcome && this.descent.outcome !== 'landed') this.velocity.set(0, 0, 0);
    else if (this.mode === 'surface') this.updateSurface(dt, nearest as BodyState, enabled);
    else this.updateFlight(dt, nearest, altitude, enabled);

    this.writeTelemetry(nearest, lock);
  }

  /** Removes roll relative to the local vertical; from inverted it rolls the short way round. */
  private levelToHorizon(dt: number, strength: number): void {
    const forward = this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
    const vertical = forward.dot(this.up);
    if (Math.abs(vertical) > 0.9995) return;
    this.lookMatrix.lookAt(this.origin, forward, this.up);
    this.lookQuat.setFromRotationMatrix(this.lookMatrix);
    this.orientation.slerp(this.lookQuat, 1 - Math.exp(-dt * 5 * strength));
  }

  private updateFlight(dt: number, nearest: BodyState | null, altitude: number, enabled: boolean): void {
    const input = this.input;
    const move = this.move.set(0, 0, 0);
    if (enabled) {
      move.set(input.axis('KeyD', 'KeyA'), input.axis('Space', 'ControlLeft'), input.axis('KeyS', 'KeyW'));
      if (move.lengthSq() > 1) move.normalize();
    }
    const boosting = enabled && input.down('ShiftLeft');
    if (this.landing && move.lengthSq() > 0) this.landing = false;
    this.thrust +=
      (Math.min(1, move.length() * (boosting ? 1 : 0.6)) - this.thrust) * (1 - Math.exp(-dt * 8));
    move.applyQuaternion(this.orientation);
    move.multiplyScalar(cruiseSpeed(altitude) * this.throttle * (boosting ? 4 : 1));

    if (this.landing && nearest) {
      // Automatic descent: straight down, slowing with height, until the hover height is reached.
      move.copy(this.up).multiplyScalar(-Math.min(30, 2.5 + altitude * 0.45));
      if (altitude < MIN_CLEARANCE + 0.6) {
        this.landing = false;
        this.mode = 'surface';
        this.verticalSpeed = 0;
      }
    }
    // Heavier response in space, snappier near the ground where precision matters.
    const k = 1 - Math.exp(-dt * (altitude < 2000 ? 3.2 : 2.4));
    this.velocity.lerp(move, k);
    this.position.addScaledVector(this.velocity, dt);
    this.lift += ((this.landing ? 0.7 : altitude < 30 ? 0.35 : 0) - this.lift) * (1 - Math.exp(-dt * 6));

    if (nearest) this.collide(nearest);
    this.bodyOrientation.copy(this.orientation);
  }

  /** Starts a hand-flown descent from the current position with the given velocity (system space). */
  beginDescent(
    params: Pick<
      DescentFlight,
      'gravity' | 'thrustAcceleration' | 'availableDeltaV' | 'maxTouchdownSpeed' | 'maxTouchdownDrift'
    >,
    velocity: THREE.Vector3,
  ): void {
    this.mode = 'flight';
    this.landing = false;
    this.autopilot = null;
    this.velocity.copy(velocity);
    this.descent = {
      ...params,
      deltaVUsed: 0,
      verticalSpeed: 0,
      groundSpeed: 0,
      outcome: null,
      touchdownSpeed: 0,
    };
  }

  private updateDescent(dt: number, body: BodyState, enabled: boolean): void {
    const d = this.descent as DescentFlight;
    const input = this.input;
    const up = this.up;
    // Heading frame on the ground plane, so "forward" is where the pilot looks, not up or down.
    const forward = this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    const right = this.right.crossVectors(forward, up);

    const dry = d.deltaVUsed >= d.availableDeltaV;
    const main = enabled && !dry && input.down('Space') ? 1 : 0;
    const move = this.move.set(0, 0, 0);
    if (enabled && !dry) {
      move
        .addScaledVector(forward, input.axis('KeyW', 'KeyS'))
        .addScaledVector(right, input.axis('KeyD', 'KeyA'));
      if (move.lengthSq() > 1) move.normalize();
    }
    const translate = Math.min(d.thrustAcceleration * TRANSLATE_SHARE, TRANSLATE_LIMIT);
    const sideways = move.length();
    this.velocity
      .addScaledVector(up, (main * d.thrustAcceleration - d.gravity) * dt)
      .addScaledVector(move, translate * dt);
    d.deltaVUsed += (main * d.thrustAcceleration + sideways * translate) * dt;
    this.position.addScaledVector(this.velocity, dt);

    // Ground contact decides the landing.
    up.subVectors(this.position, body.position);
    const r = up.length();
    up.divideScalar(r);
    const surface = body.view ? body.view.surfaceHeightAt(up) : 0;
    const restR = body.desc.radius + surface + MIN_CLEARANCE;
    const vertical = this.velocity.dot(up);
    const drift = this.tmp.copy(this.velocity).addScaledVector(up, -vertical).length();
    d.verticalSpeed = vertical;
    d.groundSpeed = drift;
    if (r <= restR) {
      d.touchdownSpeed = this.velocity.length();
      const gentle = -vertical <= d.maxTouchdownSpeed && drift <= d.maxTouchdownDrift;
      d.outcome = gentle ? 'landed' : dry ? 'dry' : 'crashed';
      this.position.copy(body.position).addScaledVector(up, restR);
      this.velocity.set(0, 0, 0);
      this.verticalSpeed = 0;
      this.mode = 'surface';
    }

    this.thrust += (Math.max(main, sideways * 0.5) - this.thrust) * (1 - Math.exp(-dt * 10));
    this.lift += (main - this.lift) * (1 - Math.exp(-dt * 10));
    // The hull stays level and faces the heading; only the view pitches.
    this.lookMatrix.lookAt(this.origin, forward, up);
    this.bodyOrientation.setFromRotationMatrix(this.lookMatrix);
  }

  private updateSurface(dt: number, body: BodyState, enabled: boolean): void {
    const input = this.input;
    const up = this.up;
    // Heading frame: forward and right projected onto the ground plane.
    const forward = this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    const right = this.right.crossVectors(forward, up);

    const move = this.move.set(0, 0, 0);
    let jets = false;
    if (enabled) {
      move
        .addScaledVector(forward, input.axis('KeyW', 'KeyS'))
        .addScaledVector(right, input.axis('KeyD', 'KeyA'));
      if (move.lengthSq() > 1) move.normalize();
      jets = input.down('Space');
    }
    const sprint = enabled && input.down('ShiftLeft');
    const commanded = move.length();
    move.multiplyScalar(sprint ? SPRINT_SPEED : WALK_SPEED);

    // Horizontal velocity follows the command; vertical is ballistic with jet thrust.
    const horizontal = this.tmp.copy(this.velocity).addScaledVector(up, -this.velocity.dot(up));
    horizontal.lerp(move, 1 - Math.exp(-dt * 9));
    const gravity = body.desc.gravity;
    if (jets) this.verticalSpeed = Math.min(this.verticalSpeed + (gravity + 16) * dt, 13);
    else this.verticalSpeed -= gravity * dt;
    this.velocity.copy(horizontal).addScaledVector(up, this.verticalSpeed);
    this.position.addScaledVector(this.velocity, dt);

    // Ground contact: rest at hover height and follow the terrain downhill instead of skipping off it.
    up.subVectors(this.position, body.position);
    const r = up.length();
    up.divideScalar(r);
    const surface = body.view ? body.view.surfaceHeightAt(up) : 0;
    const restR = body.desc.radius + surface + MIN_CLEARANCE;
    const grounded = r <= restR + (this.verticalSpeed <= 0 ? 0.45 : 0);
    if (grounded && !jets) {
      this.position.copy(body.position).addScaledVector(up, restR);
      this.verticalSpeed = 0;
    } else if (r < restR) {
      this.position.copy(body.position).addScaledVector(up, restR);
      this.verticalSpeed = Math.max(this.verticalSpeed, 0);
    }
    this.telemetry.grounded = grounded && !jets;

    this.thrust += (commanded * (sprint ? 0.8 : 0.35) - this.thrust) * (1 - Math.exp(-dt * 8));
    this.lift += ((jets ? 1 : 0.3) - this.lift) * (1 - Math.exp(-dt * 10));

    // The hull stays level and faces the heading; only the view pitches.
    this.lookMatrix.lookAt(this.origin, forward, up);
    this.bodyOrientation.setFromRotationMatrix(this.lookMatrix);
  }

  /** Keeps the craft above the terrain and removes the velocity component into it. */
  private collide(body: BodyState): void {
    const up = this.up.subVectors(this.position, body.position);
    const r = up.length();
    up.divideScalar(r);
    const surface = body.view ? body.view.surfaceHeightAt(up) : 0;
    const minR = body.desc.radius + surface + MIN_CLEARANCE;
    if (r >= minR) return;
    this.position.copy(body.position).addScaledVector(up, minR);
    const vn = this.velocity.dot(up);
    if (vn < 0) this.velocity.addScaledVector(up, -vn);
  }

  private flyAutopilot(dt: number, enabled: boolean): boolean {
    const auto = this.autopilot;
    if (!auto) return false;
    const input = this.input;
    if (
      enabled &&
      (input.axis('KeyD', 'KeyA') !== 0 ||
        input.axis('KeyS', 'KeyW') !== 0 ||
        input.axis('Space', 'ControlLeft') !== 0)
    ) {
      this.autopilot = null;
      return false;
    }
    const toTarget = this.tmp.subVectors(auto.target, this.position);
    const distance = toTarget.length();
    const remaining = distance - auto.standoff;
    if (remaining < auto.standoff * 0.01) {
      this.autopilot = null;
      this.velocity.set(0, 0, 0);
      return false;
    }
    toTarget.divideScalar(distance);
    // Turn toward the destination, then accelerate once roughly aligned.
    const up = this.forward.set(0, 1, 0).applyQuaternion(this.orientation);
    this.lookMatrix.lookAt(this.origin, toTarget, up);
    this.lookQuat.setFromRotationMatrix(this.lookMatrix);
    this.orientation.slerp(this.lookQuat, 1 - Math.exp(-dt * 3.5));
    const forward = this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
    const aligned = THREE.MathUtils.smoothstep(forward.dot(toTarget), 0.9, 0.995);
    const speed = Math.max(remaining * 0.9, auto.standoff * 0.02) * aligned;
    this.velocity.copy(toTarget).multiplyScalar(speed);
    this.position.addScaledVector(this.velocity, Math.min(dt, remaining / Math.max(speed, 1e-9)));
    this.thrust = aligned;
    this.lift = 0;
    return true;
  }

  private writeTelemetry(nearest: BodyState | null, lock: number | null): void {
    const t = this.telemetry;
    t.altitude = Number.POSITIVE_INFINITY;
    t.altitudeDatum = Number.POSITIVE_INFINITY;
    if (nearest) {
      const up = this.tmp.subVectors(this.position, nearest.position);
      const r = up.length();
      up.divideScalar(r);
      t.altitudeDatum = r - nearest.desc.radius;
      // Under autopilot the craft is far from the ground: the datum is close enough and cheaper.
      t.altitude =
        lock === null
          ? t.altitudeDatum
          : t.altitudeDatum - (nearest.view ? nearest.view.surfaceHeightAt(up) : 0);
    }
    t.speed = this.velocity.length();
    t.body = nearest;
    t.throttle = this.throttle;
    t.mode = this.mode;
    if (this.mode !== 'surface') t.grounded = false;
    t.horizonLock = lock ?? 0;
  }

  /** True while the automatic descent started by `toggleLanding` is running. */
  get isLanding(): boolean {
    return this.landing;
  }

  /** Points the craft along `direction` (world axes), keeping `up` upward. */
  lookAlong(direction: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)): void {
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), direction, up);
    this.orientation.setFromRotationMatrix(m);
    this.bodyOrientation.copy(this.orientation);
  }

  /** Places the craft `altitude` above `body`, on the side given by `direction`, looking at the horizon. */
  placeAbove(body: BodyState, direction: THREE.Vector3, altitude: number): void {
    const up = direction.clone().normalize();
    const surface = body.view ? body.view.surfaceHeightAt(up) : 0;
    // `surface` is already the sea surface where there is one; real ground can lie below the datum.
    this.position.copy(body.position).addScaledVector(up, body.desc.radius + surface + altitude);
    // Look along the surface toward the sun's azimuth, slightly down.
    const toSun = body.sunDir.clone();
    const forward = toSun.addScaledVector(up, -toSun.dot(up));
    if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0).addScaledVector(up, -up.x);
    forward.normalize();
    // From orbit look at the planet (slightly off-centre so the limb is in frame); near the ground look
    // just below the horizon.
    const pitchDown = altitude > body.desc.radius * 0.2 ? 5 : 0.12;
    forward.addScaledVector(up, -pitchDown).normalize();
    // The planet's spin axis is "up" from orbit, so its north is at the top of the first view.
    const axis = new THREE.Vector3(...body.desc.axis);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, pitchDown > 1 ? axis : up);
    this.orientation.setFromRotationMatrix(m);
    this.bodyOrientation.copy(this.orientation);
    this.velocity.set(0, 0, 0);
    this.mode = 'flight';
    this.landing = false;
  }
}
