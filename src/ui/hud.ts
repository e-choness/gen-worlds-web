/**
 * In-flight interface: location header, telemetry, flight-mode chip, reticle with target read-out,
 * on-screen body and beacon markers, the scanner panel, contextual action prompts and toasts.
 *
 * Plain DOM over the canvas. Text refreshes at 8 Hz; only marker transforms update every frame.
 * The HUD only reads state; menus live in `menu.ts`.
 */
import * as THREE from 'three/webgpu';
import type { Beacon } from '@/player/beacon';
import { type FlightTelemetry, LANDING_ALTITUDE } from '@/player/flight-controller';
import type { Scanner } from '@/player/scanner';
import type { SystemView } from '@/render/space/system-view';
import { AU } from '@/universe/constants';
import { isLandable } from '@/universe/world-params';
import { clear, h, setText } from './dom';
import { formatDistance, formatSpeed, formatTemperature } from './format';
import { buildReport, cssColor, kindLabel, targetTitle } from './scan-report';

export interface HudFrame {
  system: SystemView;
  telemetry: FlightTelemetry;
  camera: THREE.PerspectiveCamera;
  /** Camera position in system space. */
  cameraPosition: THREE.Vector3;
  galacticPosition: THREE.Vector3;
  autopilotTarget: string | null;
  /** True while the automatic descent is running. */
  landing: boolean;
  beacons: readonly Beacon[];
  /** Name of the region under the craft, when close enough to tell. */
  region: string | null;
  /** Hide everything (a menu covers the view). */
  hidden: boolean;
  /** Play is active but the pointer is free: prompt for a click. */
  promptClick: boolean;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly location = h('div.location');
  private readonly sublocation = h('div.sublocation');
  private readonly telemetry: Record<string, HTMLElement> = {};
  private readonly throttleFill = h('i');
  private readonly reticle = h('div.reticle', null, h('i.ring'), h('i.dot'));
  private readonly reticleProgress = h('i.progress');
  private readonly targetLabel = h('div.target-label');
  private readonly markers = h('div.markers');
  private readonly markerEls = new Map<string, HTMLElement>();
  private readonly panel = h('aside.scan-panel');
  private readonly panelTitle = h('h3');
  private readonly panelSub = h('div.sub');
  private readonly panelBody = h('div.body');
  private readonly panelBadge = h('span.badge');
  private readonly prompts = h('div.prompts');
  private readonly toasts = h('div.toasts');
  private readonly inventory = h('div.inventory');
  private readonly status = h('div.status');
  private readonly modeChip = h('div.mode');
  private readonly clickPrompt = h('div.click-prompt', null, 'Click to take control');
  private readonly tmp = new THREE.Vector3();
  private readonly invQuat = new THREE.Quaternion();
  private elapsed = 1;
  private reportFor = '';
  private promptKey = '';

  constructor(
    parent: HTMLElement,
    private readonly scanner: Scanner,
  ) {
    const tele = h('section.telemetry');
    for (const [key, label] of [
      ['alt', 'ALTITUDE'],
      ['spd', 'VELOCITY'],
      ['grav', 'GRAVITY'],
      ['temp', 'AMBIENT'],
      ['pres', 'PRESSURE'],
    ] as const) {
      const value = h('b', null, '—');
      this.telemetry[key] = value;
      tele.append(h('div.cell', null, h('span', null, label), value));
    }
    tele.append(
      h('div.cell.throttle', null, h('span', null, 'SPEED RANGE'), h('span.track', null, this.throttleFill)),
    );

    this.reticle.append(this.reticleProgress);
    this.panel.append(
      h('header', null, h('div', null, this.panelTitle, this.panelSub), this.panelBadge),
      this.panelBody,
    );

    this.root = h(
      'div.hud',
      null,
      h('header.top', null, this.location, this.sublocation, this.modeChip),
      this.markers,
      this.reticle,
      this.targetLabel,
      tele,
      this.inventory,
      this.status,
      this.panel,
      this.prompts,
      this.toasts,
      this.clickPrompt,
    );
    parent.append(this.root);

    scanner.events.on('target', () => this.refreshPanel(true));
    scanner.events.on('complete', (target) => {
      this.refreshPanel(true);
      this.toast(`Survey complete — ${targetTitle(target).name}`);
    });
    scanner.events.on('sample', () => this.refreshInventory());
  }

  toast(message: string): void {
    // One line per message: repeating a toggle should not stack copies.
    for (const el of this.toasts.children) if (el.textContent === message) el.remove();
    const el = h('div.toast', { role: 'status' }, message);
    this.toasts.append(el);
    window.setTimeout(() => el.classList.add('out'), 2600);
    window.setTimeout(() => el.remove(), 3200);
  }

  update(dt: number, frame: HudFrame): void {
    this.root.classList.toggle('hidden', frame.hidden);
    if (frame.hidden) return;
    this.updateMarkers(frame);
    this.reticleProgress.style.setProperty('--p', String(this.scanner.progress));
    this.reticle.classList.toggle('locked', this.scanner.target !== null);
    this.reticle.classList.toggle('scanning', this.scanner.scanning);
    this.clickPrompt.classList.toggle('visible', frame.promptClick);

    this.elapsed += dt;
    if (this.elapsed < 0.125) return;
    this.elapsed = 0;

    const t = frame.telemetry;
    const star = frame.system.system.star;
    const body = t.body;
    const nearBody = body && t.altitude < body.desc.radius * 12 ? body : null;
    setText(this.location, nearBody ? `${star.name}  ›  ${nearBody.desc.name}` : star.name);
    const g = frame.galacticPosition;
    setText(
      this.sublocation,
      nearBody
        ? frame.region
          ? `${frame.region} · ${kindLabel(nearBody.desc.kind)}`
          : `${kindLabel(nearBody.desc.kind)} · ${(nearBody.position.length() / AU).toFixed(2)} AU from ${star.spectralType} star`
        : `${star.spectralType} system · galactic ${Math.round(g.x).toLocaleString('en-US')}, ${Math.round(g.y)}, ${Math.round(g.z).toLocaleString('en-US')} ly`,
    );

    const mode = frame.autopilotTarget
      ? 'AUTOPILOT'
      : frame.landing
        ? 'LANDING'
        : t.mode === 'surface'
          ? t.grounded
            ? 'LANDED'
            : 'JETS'
          : t.horizonLock > 0.5
            ? 'ATMOSPHERIC FLIGHT'
            : 'SPACE FLIGHT';
    setText(this.modeChip, mode);
    this.modeChip.classList.toggle('active', mode !== 'SPACE FLIGHT' && mode !== 'ATMOSPHERIC FLIGHT');

    setText(this.telemetry.alt, nearBody ? formatDistance(t.altitude) : '—');
    setText(this.telemetry.spd, formatSpeed(t.speed));
    setText(this.telemetry.grav, nearBody ? `${(nearBody.desc.gravity / 9.80665).toFixed(2)} g` : '0.00 g');
    const inAir = nearBody?.desc.atmosphere && t.altitudeDatum < nearBody.desc.atmosphere.height;
    setText(
      this.telemetry.temp,
      nearBody && t.altitude < nearBody.desc.radius * 0.05
        ? formatTemperature(nearBody.desc.temperatureK)
        : '2.7 K',
    );
    setText(
      this.telemetry.pres,
      inAir && nearBody?.desc.atmosphere
        ? `${(nearBody.desc.atmosphere.surfacePressureBar * Math.exp(-Math.max(t.altitudeDatum, 0) / nearBody.desc.atmosphere.rayleighScaleHeight)).toPrecision(2)} bar`
        : 'vacuum',
    );
    // Log scale: the range multiplier spans two decades.
    this.throttleFill.style.width = `${Math.round(THREE.MathUtils.clamp((Math.log10(t.throttle) + 1) / 2.08, 0.03, 1) * 100)}%`;

    const target = this.scanner.target;
    if (target) {
      const title = targetTitle(target);
      setText(this.targetLabel, `${title.name}  ·  ${formatDistance(target.distance)}`);
    }
    // The site under the craft needs no label: the robot is standing on it.
    this.targetLabel.classList.toggle('visible', target !== null && target.kind !== 'site');
    setText(this.status, frame.autopilotTarget ? `AUTOPILOT  ›  ${frame.autopilotTarget}` : '');
    this.status.classList.toggle('visible', frame.autopilotTarget !== null);

    this.refreshPrompts(frame);
    this.refreshPanel(false);
  }

  /** Key prompts for what can be done right now. */
  private refreshPrompts(frame: HudFrame): void {
    const t = frame.telemetry;
    const target = this.scanner.target;
    const list: Array<[string, string]> = [];
    if (frame.autopilotTarget) {
      list.push(['G', 'Cancel autopilot']);
    } else if (t.mode === 'surface') {
      list.push(
        ['F', 'Scan site'],
        ['LMB', 'Drill'],
        ['R', 'Survey pulse'],
        ['B', 'Beacon'],
        ['Space', 'Jets'],
      );
      list.push(['L', 'Lift off']);
    } else {
      if (target && target.kind !== 'site') list.push(['F', 'Scan'], ['G', 'Autopilot']);
      else if (target) list.push(['F', 'Scan site']);
      if (t.body && t.body.desc.bands === null && t.altitude < LANDING_ALTITUDE)
        list.push(['L', frame.landing ? 'Abort landing' : 'Land']);
      if (!target) list.push(['Tab', 'System map']);
    }
    if (t.body && isLandable(t.body.desc)) list.push(['P', 'Plan a mission here']);
    list.push(['Esc', 'Menu']);
    const key = list.map((p) => p.join(':')).join('|');
    if (key === this.promptKey) return;
    this.promptKey = key;
    clear(this.prompts);
    for (const [k, label] of list) this.prompts.append(h('span.prompt', null, h('kbd', null, k), label));
  }

  private refreshPanel(force: boolean): void {
    const target = this.scanner.target;
    this.panel.classList.toggle('open', target !== null);
    if (!target) {
      this.reportFor = '';
      return;
    }
    const id =
      target.kind === 'star'
        ? target.star.id
        : target.kind === 'body'
          ? target.body.desc.id
          : `${target.body.desc.id}#site`;
    const known = this.scanner.discovered.has(id);
    // Site data changes as the craft moves; bodies only need a rebuild when the target or its status changes.
    const key = `${id}:${known}:${target.kind === 'site' ? Math.round(target.site.elevation) + target.site.terrainType : ''}`;
    if (!force && key === this.reportFor) return;
    this.reportFor = key;
    const title = targetTitle(target);
    setText(this.panelTitle, title.name);
    setText(this.panelSub, title.subtitle);
    setText(this.panelBadge, known ? 'SURVEYED' : 'UNSURVEYED');
    this.panelBadge.classList.toggle('known', known);
    // Until surveyed the panel is just a header with a prompt, so it does not cover the view.
    this.panel.classList.toggle('compact', !known);
    clear(this.panelBody);
    if (known) {
      this.panelBody.append(...buildReport(target));
    } else {
      this.panelBody.append(h('p.placeholder', null, 'No survey data — press F to scan.'));
    }
  }

  private refreshInventory(): void {
    clear(this.inventory);
    const entries = [...this.scanner.inventory.values()].sort((a, b) => b.amount - a.amount).slice(0, 6);
    if (!entries.length) return;
    this.inventory.append(h('span.title', null, 'SAMPLES'));
    for (const e of entries)
      this.inventory.append(
        h('span.item', null, h('b', null, e.resource.symbol), ` ${e.amount.toFixed(1)} kg`),
      );
  }

  private updateMarkers(frame: HudFrame): void {
    const { camera, cameraPosition, system } = frame;
    this.invQuat.copy(camera.quaternion).invert();
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    const tanX = tanY * camera.aspect;
    const seen = new Set<string>();
    const current = frame.telemetry.body;

    /** Projects a system-space point; returns false when it is behind the camera or off screen. */
    const place = (id: string, make: () => HTMLElement): HTMLElement | null => {
      this.tmp.sub(cameraPosition).applyQuaternion(this.invQuat);
      if (this.tmp.z > -1) return null;
      const x = this.tmp.x / -this.tmp.z / tanX;
      const y = this.tmp.y / -this.tmp.z / tanY;
      if (Math.abs(x) > 1.02 || Math.abs(y) > 1.02) return null;
      seen.add(id);
      let el = this.markerEls.get(id);
      if (!el) {
        el = make();
        this.markerEls.set(id, el);
        this.markers.append(el);
      }
      el.style.transform = `translate(${((x * 0.5 + 0.5) * 100).toFixed(2)}vw, ${((0.5 - y * 0.5) * 100).toFixed(2)}vh)`;
      return el;
    };

    for (const body of system.bodies) {
      // Markers are for navigation between bodies: hide moons from afar and whatever fills the view.
      const apparent = body.desc.radius / body.distance;
      if (apparent > 0.06) continue;
      if (body.parent && body.parent.distance > body.parent.desc.radius * 400) continue;
      this.tmp.copy(body.position);
      const el = place(body.desc.id, () => {
        const marker = h('div.marker', null, h('i'), h('span', null, body.desc.name));
        (marker.firstChild as HTMLElement).style.borderColor = cssColor(
          body.desc.bands ? body.desc.bands[0] : body.desc.palette.midland,
          2.2,
        );
        return marker;
      });
      el?.classList.toggle('current', body === current);
    }

    for (const beacon of frame.beacons) {
      this.tmp.copy(beacon.body.position).add(beacon.local);
      const distance = this.tmp.distanceTo(cameraPosition);
      // Beacons are a surface aid: only shown from the world they stand on.
      if (beacon.body !== current || distance > beacon.body.desc.radius) continue;
      const id = `beacon:${beacon.id}`;
      const el = place(id, () => h('div.marker.beacon', null, h('i'), h('span')));
      if (el) setText(el.lastChild as HTMLElement, `${beacon.label} · ${formatDistance(distance)}`);
    }

    for (const [id, el] of this.markerEls) {
      if (!seen.has(id)) {
        el.remove();
        this.markerEls.delete(id);
      }
    }
  }
}
