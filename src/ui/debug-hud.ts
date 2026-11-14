// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import type { App } from '@/app/app';
import { formatDistance, formatSpeed } from './format';

/** Minimal telemetry readout used during development; the production HUD replaces it. */
export class DebugHud {
  private readonly el: HTMLElement;
  private elapsed = 0;

  constructor(root: HTMLElement, app: App) {
    this.el = document.createElement('pre');
    this.el.className = 'debug-hud';
    root.append(this.el);
    app.onFrame((dt) => {
      this.elapsed += dt;
      if (this.elapsed < 0.2) return;
      this.elapsed = 0;
      const t = app.flight.telemetry;
      const body = t.body;
      const stats = body?.view?.terrain.stats;
      this.el.textContent = [
        `${app.system.system.star.name} · ${app.system.system.star.spectralType}`,
        body ? `${body.desc.name} (${body.desc.kind})` : '—',
        `alt ${formatDistance(t.altitude)}  spd ${formatSpeed(t.speed)}  thr ×${t.throttle.toFixed(2)}`,
        stats ? `chunks ${stats.drawn}/${stats.nodes}  pending ${stats.pending}` : '',
        `${app.fps.toFixed(0)} fps`,
      ].join('\n');
    });
  }
}
