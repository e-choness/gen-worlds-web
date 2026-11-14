/**
 * Instruments for the hand-flown landing: height, descent rate, drift, propellant and range to the
 * target. Plain DOM over the 3D view; text refreshes at 10 Hz, enough to fly by.
 */
import type { Disposable } from '@/core/disposable';
import { h, setText } from '@/ui/dom';

export interface DescentReadout {
  /** Height above the terrain, m. */
  altitude: number;
  /** Vertical speed, m/s, positive upward. */
  verticalSpeed: number;
  groundSpeed: number;
  /** Δv left in the tanks and the amount at hand-over, m/s. */
  deltaVLeft: number;
  deltaVTotal: number;
  /** Distance over the ground to the target, m. */
  range: number;
  /** Vertical and sideways speeds a touchdown survives, m/s. */
  safeSpeed: number;
  safeDrift: number;
  /** One line for the pilot: what to do now, or how it ended. */
  status: string;
  /** How the status reads: instruction, good news or bad news. */
  tone: 'info' | 'good' | 'bad';
}

const REFRESH_SECONDS = 0.1;

function metres(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.max(0, value).toFixed(0)} m`;
}

export class DescentHud implements Disposable {
  private readonly root: HTMLElement;
  private readonly altitude = h('strong');
  private readonly rate = h('strong');
  private readonly drift = h('strong');
  private readonly range = h('strong');
  private readonly fuel = h('strong');
  private readonly fuelBar = h('div');
  private readonly status = h('p.descent-status');
  private sinceRefresh = REFRESH_SECONDS;

  constructor(parent: HTMLElement, siteName: string) {
    const cell = (label: string, value: HTMLElement): HTMLElement =>
      h('div.descent-cell', null, h('span', null, label), value);
    this.root = h(
      'section.descent-hud',
      { 'aria-label': 'Landing instruments' },
      h('div.descent-title', null, `Landing · ${siteName}`),
      h(
        'div.descent-grid',
        null,
        cell('Height', this.altitude),
        cell('Descent rate', this.rate),
        cell('Drift', this.drift),
        cell('To target', this.range),
      ),
      h(
        'div.descent-fuel',
        null,
        h('span', null, 'Propellant (Δv)'),
        this.fuel,
        h('div.bar', null, this.fuelBar),
      ),
      this.status,
      h('p.descent-keys', null, 'Space main engine · W A S D translate · mouse turn'),
    );
    parent.append(this.root);
  }

  update(dt: number, readout: DescentReadout): void {
    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH_SECONDS) return;
    this.sinceRefresh = 0;
    setText(this.altitude, metres(readout.altitude));
    const sinking = -readout.verticalSpeed;
    setText(this.rate, `${sinking >= 0 ? '↓' : '↑'} ${Math.abs(sinking).toFixed(1)} m/s`);
    setText(this.drift, `${readout.groundSpeed.toFixed(1)} m/s`);
    setText(this.range, metres(readout.range));
    setText(this.fuel, `${Math.max(0, readout.deltaVLeft).toFixed(0)} m/s`);
    const share = Math.max(0, Math.min(1, readout.deltaVLeft / readout.deltaVTotal));
    this.fuelBar.style.width = `${share * 100}%`;
    // Shape words, not colour alone, carry the warnings.
    this.rate.dataset.state = sinking > readout.safeSpeed ? 'fast' : 'safe';
    this.drift.dataset.state = readout.groundSpeed > readout.safeDrift ? 'fast' : 'safe';
    this.fuelBar.dataset.state = share < 0.2 ? 'low' : 'ok';
    setText(this.status, readout.status);
    this.status.dataset.tone = readout.tone;
  }

  dispose(): void {
    this.root.remove();
  }
}
