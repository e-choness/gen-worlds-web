/**
 * The robot's survey instrument. Picks what the craft is pointing at (the star, a body, or the
 * ground under it), runs a timed sweep and produces a report for the UI. Also tracks discoveries
 * and collected samples for the session.
 */
import * as THREE from 'three/webgpu';
import { Emitter } from '@/core/events';
import { hashCombine, Rng } from '@/core/random';
import type { BodyState, SystemView } from '@/render/space/system-view';
import { type BiomeDesc, regionAt } from '@/universe/biome';
import type { BodyDesc, ResourceDeposit, StarDesc } from '@/universe/types';

export type ScanTarget =
  | { kind: 'star'; star: StarDesc; distance: number }
  | { kind: 'body'; body: BodyState; distance: number }
  | { kind: 'site'; body: BodyState; site: SiteReport; distance: number };

/** Analysis of the ground at one spot. */
export interface SiteReport {
  /** Latitude in degrees relative to the spin axis, and a longitude-like angle. */
  latitude: number;
  longitude: number;
  elevation: number;
  slopeDegrees: number;
  terrainType: string;
  /** The region (biome) the site lies in. */
  region: BiomeDesc;
  temperatureK: number;
  /** What the drill would bring up here, most abundant first. */
  minerals: ResourceDeposit[];
  moisture: number;
}

/** One completed survey, for the logbook. */
export interface LogEntry {
  id: string;
  name: string;
  subtitle: string;
}

export interface ScannerEvents {
  target: ScanTarget | null;
  progress: { target: ScanTarget; fraction: number };
  complete: ScanTarget;
  sample: { resource: ResourceDeposit; amount: number; total: number };
}

const SCAN_SECONDS = 1.6;
/** Half-angle of the cone within which a body can be targeted, radians. */
const AIM_TOLERANCE = 0.035;

export class Scanner {
  readonly events = new Emitter<ScannerEvents>();
  /** Bodies and stars already surveyed this session, by id. */
  readonly discovered = new Set<string>();
  /** Completed surveys in order (one entry per star / body; sites are not logged individually). */
  readonly log: LogEntry[] = [];
  /** Collected sample mass by resource symbol, kilograms. */
  readonly inventory = new Map<string, { resource: ResourceDeposit; amount: number }>();
  target: ScanTarget | null = null;
  /** 0..1 while a sweep is running, otherwise 0. */
  progress = 0;
  scanning = false;
  private readonly toBody = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();

  /**
   * Re-evaluates the aim. Call every frame.
   * @param position craft position in system space.
   * @param forward unit view direction.
   * @param altitude height above the surface of `nearest`, metres.
   */
  updateTarget(
    system: SystemView,
    position: THREE.Vector3,
    forward: THREE.Vector3,
    nearest: BodyState | null,
    altitude: number,
  ): void {
    let best: ScanTarget | null = null;
    // Close to the ground the instrument reads the site below the craft, unless it is pointed at
    // another world or the star in the sky.
    const nearGround =
      nearest?.view != null &&
      altitude < Math.max(3000, nearest.desc.radius * 0.0006) &&
      nearest.desc.bands === null;
    {
      let bestAngle = Number.POSITIVE_INFINITY;
      const consider = (
        center: THREE.Vector3,
        radius: number,
        make: (distance: number) => ScanTarget,
      ): void => {
        this.toBody.subVectors(center, position);
        const distance = this.toBody.length();
        const angle = Math.acos(THREE.MathUtils.clamp(this.toBody.dot(forward) / distance, -1, 1));
        const apparent = Math.asin(Math.min(1, radius / distance));
        const miss = Math.max(0, angle - apparent);
        if (miss < AIM_TOLERANCE && miss < bestAngle) {
          bestAngle = miss;
          best = make(Math.max(0, distance - radius));
        }
      };
      for (const body of system.bodies) {
        if (nearGround && body === nearest) continue;
        consider(body.position, body.desc.radius, (distance) => ({ kind: 'body', body, distance }));
      }
      const star = system.system.star;
      consider(this.probe.set(0, 0, 0), star.radius, (distance) => ({ kind: 'star', star, distance }));
    }
    if (nearGround && nearest && (best === null || this.belowHorizon(nearest, position, forward))) {
      best = { kind: 'site', body: nearest, site: this.analyseSite(nearest, position), distance: altitude };
    }

    if (targetId(best) !== targetId(this.target)) {
      this.target = best;
      this.cancel();
      this.events.emit('target', best);
    } else {
      // Keep distance and site data fresh without re-announcing the target.
      this.target = best;
    }
  }

  /** True when the view direction points into the ground of `body`. */
  private belowHorizon(body: BodyState, position: THREE.Vector3, forward: THREE.Vector3): boolean {
    this.toBody.subVectors(position, body.position).normalize();
    return this.toBody.dot(forward) < -0.02;
  }

  start(): void {
    if (!this.target || this.scanning) return;
    this.scanning = true;
    this.progress = 0;
  }

  cancel(): void {
    this.scanning = false;
    this.progress = 0;
  }

  update(dt: number): void {
    if (!this.scanning || !this.target) return;
    this.progress = Math.min(1, this.progress + dt / SCAN_SECONDS);
    this.events.emit('progress', { target: this.target, fraction: this.progress });
    if (this.progress >= 1) {
      this.scanning = false;
      const id = targetId(this.target);
      if (!this.discovered.has(id) && this.target.kind !== 'site') {
        this.log.push(
          this.target.kind === 'star'
            ? { id, name: this.target.star.name, subtitle: `${this.target.star.spectralType} star` }
            : { id, name: this.target.body.desc.name, subtitle: this.target.body.desc.kind },
        );
      }
      this.discovered.add(id);
      this.events.emit('complete', this.target);
    }
  }

  /** Drills at the current site and adds what comes up to the inventory. */
  collectSample(dt: number, rng: Rng): void {
    const target = this.target;
    if (target?.kind !== 'site' || target.site.minerals.length === 0) return;
    // Yield follows abundance: pick the deposit by weight, a few hundred grams per second.
    const minerals = target.site.minerals;
    const pick = minerals[rng.int(0, Math.min(minerals.length, 3) - 1)];
    const amount = pick.abundance * dt * 0.6;
    const entry = this.inventory.get(pick.symbol) ?? { resource: pick, amount: 0 };
    entry.amount += amount;
    this.inventory.set(pick.symbol, entry);
    this.events.emit('sample', { resource: pick, amount, total: entry.amount });
  }

  private analyseSite(body: BodyState, position: THREE.Vector3): SiteReport {
    const view = body.view;
    const desc = body.desc;
    const up = this.probe.subVectors(position, body.position).normalize();
    const axis = desc.axis;
    const sinLat = up.x * axis[0] + up.y * axis[1] + up.z * axis[2];
    const elevation = view ? view.heightAt(up) : 0;

    // Slope from two nearby height samples along perpendicular tangents.
    let slope = 0;
    if (view) {
      const t1 = new THREE.Vector3(0, 1, 0).cross(up);
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
      t1.normalize();
      const t2 = up.clone().cross(t1);
      const step = 6 / desc.radius;
      const h1 = view.heightAt(up.clone().addScaledVector(t1, step).normalize());
      const h2 = view.heightAt(up.clone().addScaledVector(t2, step).normalize());
      slope = Math.atan(Math.hypot(h1 - elevation, h2 - elevation) / 6);
    }
    const moisture = view ? view.field.moisture(up.x, up.y, up.z) : 0;
    const region = regionAt(desc, up, elevation, moisture);
    // Warmer at the equator, colder with altitude (lapse rate scaled by gravity).
    const temperatureK =
      desc.temperatureK * (1 + 0.12 * (0.5 - sinLat * sinLat)) -
      Math.max(elevation, 0) * 0.0065 * (desc.gravity / 9.81);

    // Deposits vary by ~1 km cell so prospecting different places pays off; deterministic per site.
    const cell = 1000 / desc.radius;
    const rng = new Rng(
      hashCombine(desc.seed, Math.floor(up.x / cell), Math.floor(up.y / cell), Math.floor(up.z / cell)),
    );
    const minerals = desc.resources
      .map((r) => ({ ...r, abundance: THREE.MathUtils.clamp(r.abundance * rng.range(0.3, 1.7), 0, 1) }))
      .filter(() => rng.chance(0.75))
      .sort((a, b) => b.abundance - a.abundance);

    return {
      latitude: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sinLat, -1, 1))),
      longitude: THREE.MathUtils.radToDeg(Math.atan2(up.z, up.x)),
      elevation,
      slopeDegrees: THREE.MathUtils.radToDeg(slope),
      terrainType: classifyTerrain(desc, region, elevation, slope),
      region,
      temperatureK,
      minerals,
      moisture,
    };
  }
}

function targetId(target: ScanTarget | null): string {
  if (!target) return '';
  if (target.kind === 'star') return target.star.id;
  if (target.kind === 'body') return target.body.desc.id;
  return `${target.body.desc.id}#site`;
}

/** Names the ground at a site: the landform where it dominates, otherwise the region. */
function classifyTerrain(body: BodyDesc, region: BiomeDesc, elevation: number, slope: number): string {
  if (body.ocean && elevation < 0)
    return `${body.ocean.liquid} — ${elevation < -200 ? 'deep basin' : 'shallows'}`;
  if (slope > 0.6) return `${region.name} — cliff face`;
  if (body.ocean && elevation < 20) return `${region.name} — shoreline`;
  if (slope > 0.3) return `${region.name} — slopes`;
  return region.name;
}
