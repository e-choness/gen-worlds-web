/**
 * Full-screen menus: title, pause, settings, controls, system map and logbook.
 *
 * One screen is open at a time; sub-screens remember where they were opened from so Back / Esc
 * returns there. The menu owns no simulation state: it reads through `MenuSource` and raises intents
 * through `MenuActions`. Keyboard: arrows or Tab move between controls, Enter activates, Esc goes back.
 */
import type * as THREE from 'three/webgpu';
import { type Disposable, DisposableStore } from '@/core/disposable';
import type { Settings, SettingsValues } from '@/core/settings';
import type { Beacon } from '@/player/beacon';
import type { Scanner } from '@/player/scanner';
import type { BodyState, SystemView } from '@/render/space/system-view';
import { clear, h } from './dom';
import { formatDistance } from './format';
import { cssColor, kindLabel } from './scan-report';

export type MenuScreen = 'title' | 'pause' | 'settings' | 'controls' | 'map' | 'logbook';

export interface MenuSource {
  system(): SystemView;
  cameraPosition(): THREE.Vector3;
  beacons(): readonly Beacon[];
}

export interface MenuActions {
  /** The last screen closed: hand control back to the player. */
  resume(): void;
  /** Engage the autopilot toward a body. */
  navigateTo(body: BodyState): void;
  /** A screen opened while none was open. */
  opened(): void;
}

export const CONTROLS: Array<{ group: string; keys: Array<[string, string]> }> = [
  {
    group: 'Flight',
    keys: [
      ['Mouse', 'Look'],
      ['W A S D', 'Thrust forward / left / back / right'],
      ['Space · Ctrl', 'Ascend · descend'],
      ['Shift', 'Boost'],
      ['Q · E', 'Roll (open space only — near a world the craft levels itself)'],
      ['Mouse wheel', 'Speed range'],
      ['G', 'Autopilot to the targeted body'],
      ['L', 'Land (below 400 m) · lift off'],
    ],
  },
  {
    group: 'On the surface',
    keys: [
      ['W A S D', 'Move'],
      ['Shift', 'Sprint'],
      ['Space', 'Jump jets'],
      ['Left mouse (hold)', 'Drill and collect samples'],
      ['R', 'Survey pulse (elevation contours)'],
      ['B', 'Plant a navigation beacon'],
      ['T', 'Headlamp'],
    ],
  },
  {
    group: 'Instruments',
    keys: [
      ['F', 'Scan the target under the reticle, or the ground below'],
      ['Tab', 'System map'],
      ['J', 'Logbook'],
      ['V', 'Chase / cockpit camera'],
      ['M', 'Mute'],
      ['Esc', 'Pause menu'],
    ],
  },
];

export class Menu implements Disposable {
  private readonly root = h('div.menu');
  private readonly panel = h('div.menu-panel');
  private readonly store = new DisposableStore();
  private stack: MenuScreen[] = [];
  /** False until the first time play starts: the title offers "Begin" rather than "Continue". */
  private started = false;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly scanner: Scanner,
    private readonly source: MenuSource,
    private readonly actions: MenuActions,
  ) {
    this.root.append(this.panel);
    parent.append(this.root);
    this.store.listen(window, 'keydown', (e) => this.onKey(e));
    this.store.defer(() => this.root.remove());
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  get screen(): MenuScreen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Opens a screen on top of the current one (or as the first). */
  open(screen: MenuScreen): void {
    if (this.screen === screen) return;
    const wasOpen = this.isOpen;
    this.stack.push(screen);
    if (!wasOpen) this.actions.opened();
    this.render();
  }

  /** Opens a screen, or closes the menu if that screen is already showing (for toggle keys). */
  toggle(screen: MenuScreen): void {
    if (this.screen === screen) this.back();
    else if (!this.isOpen) this.open(screen);
  }

  back(): void {
    if (!this.isOpen) return;
    // The title screen is the root of everything: there is nothing behind it.
    if (this.stack.length === 1 && this.stack[0] === 'title') return;
    this.stack.pop();
    if (this.isOpen) this.render();
    else this.close();
  }

  close(): void {
    this.stack = [];
    this.started = true;
    this.root.classList.remove('open');
    this.actions.resume();
  }

  private onKey(e: KeyboardEvent): void {
    // Esc is handled here in both directions so one key press cannot close and reopen the menu.
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.isOpen) this.back();
      else this.open('pause');
      return;
    }
    if (!this.isOpen) return;
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
    const items = [...this.panel.querySelectorAll<HTMLElement>('button, input, select')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = (index + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index === -1 ? 0 : next].focus();
    e.preventDefault();
  }

  private render(): void {
    const screen = this.screen;
    if (!screen) return;
    clear(this.panel);
    this.root.classList.add('open');
    this.root.dataset.screen = screen;
    const content =
      screen === 'title'
        ? this.titleScreen()
        : screen === 'pause'
          ? this.pauseScreen()
          : screen === 'settings'
            ? this.settingsScreen()
            : screen === 'controls'
              ? this.controlsScreen()
              : screen === 'map'
                ? this.mapScreen()
                : this.logbookScreen();
    this.panel.append(...content);
    // Focus the first control so the keyboard works without a click.
    this.panel.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }

  private button(label: string, onclick: () => void, variant = ''): HTMLElement {
    return h(`button.menu-item${variant}`, { type: 'button', onclick }, label);
  }

  private backButton(): HTMLElement {
    return this.button(this.stack.length > 1 ? 'Back' : 'Resume', () => this.back(), '.quiet');
  }

  private titleScreen(): HTMLElement[] {
    return [
      h('div.eyebrow', null, 'NASA SPACE APPS 2026 · SANDBOX'),
      h('h1', null, 'Gen Worlds'),
      h(
        'p.lede',
        null,
        'A seamless galaxy of real-scale stars and worlds. Fly an excavation robot from orbit to the ground, survey what you find and drill for samples.',
      ),
      h(
        'nav.menu-list',
        null,
        this.button(this.started ? 'Continue' : 'Begin expedition', () => this.close(), '.primary'),
        this.button('Settings', () => this.open('settings')),
        this.button('Controls', () => this.open('controls')),
      ),
      h('div.footnote', null, 'WebGPU · every star, world and landscape is generated, nothing is stored'),
    ];
  }

  private pauseScreen(): HTMLElement[] {
    return [
      h('div.eyebrow', null, 'PAUSED'),
      h('h2', null, this.source.system().system.star.name),
      h(
        'nav.menu-list',
        null,
        this.button('Resume', () => this.close(), '.primary'),
        this.button('System map', () => this.open('map')),
        this.button('Logbook', () => this.open('logbook')),
        this.button('Settings', () => this.open('settings')),
        this.button('Controls', () => this.open('controls')),
        this.button(
          'Return to title',
          () => {
            this.stack = [];
            this.open('title');
          },
          '.quiet',
        ),
      ),
    ];
  }

  private settingsScreen(): HTMLElement[] {
    const v = this.settings.values;
    const slider = <K extends NumericKey>(
      key: K,
      label: string,
      min: number,
      max: number,
      step: number,
      format: (value: number) => string,
    ): HTMLElement => {
      const out = h('output', null, format(v[key]));
      const input = h('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(v[key]),
        'aria-label': label,
        oninput: (e: Event) => {
          const value = Number((e.target as HTMLInputElement).value);
          this.settings.set(key, value);
          out.textContent = format(value);
        },
      });
      return h('label.setting', null, h('span', null, label), input, out);
    };
    const toggle = (key: BooleanKey, label: string): HTMLElement => {
      const input = h('input', {
        type: 'checkbox',
        'aria-label': label,
        onchange: (e: Event) => this.settings.set(key, (e.target as HTMLInputElement).checked),
      }) as HTMLInputElement;
      input.checked = v[key];
      return h('label.setting', null, h('span', null, label), input, h('output'));
    };
    const percent = (value: number) => `${Math.round(value * 100)} %`;
    return [
      h('div.eyebrow', null, 'SETTINGS'),
      h('h2', null, 'Preferences'),
      h(
        'div.settings',
        null,
        h('h4', null, 'Controls'),
        slider('mouseSensitivity', 'Mouse sensitivity', 0.3, 3, 0.05, (x) => `${x.toFixed(2)}×`),
        toggle('invertY', 'Invert vertical look'),
        h('h4', null, 'Display'),
        slider('fov', 'Field of view', 45, 90, 1, (x) => `${x.toFixed(0)}°`),
        slider('renderScale', 'Resolution scale limit', 0.5, 2, 0.25, (x) => `${x.toFixed(2)}×`),
        toggle('bloom', 'Bloom'),
        toggle('particles', 'Particles and weather'),
        h('h4', null, 'Audio'),
        slider('masterVolume', 'Master volume', 0, 1, 0.05, percent),
        slider('musicVolume', 'Music', 0, 1, 0.05, percent),
        slider('effectsVolume', 'Effects', 0, 1, 0.05, percent),
        toggle('muted', 'Mute all'),
      ),
      h(
        'nav.menu-row',
        null,
        this.backButton(),
        this.button(
          'Restore defaults',
          () => {
            this.settings.reset();
            this.render();
          },
          '.quiet',
        ),
      ),
    ];
  }

  private controlsScreen(): HTMLElement[] {
    return [
      h('div.eyebrow', null, 'CONTROLS'),
      h('h2', null, 'How to fly and work'),
      h(
        'div.controls',
        null,
        ...CONTROLS.map((group) =>
          h(
            'section',
            null,
            h('h4', null, group.group),
            h('dl', null, ...group.keys.flatMap(([k, d]) => [h('dt', null, k), h('dd', null, d)])),
          ),
        ),
      ),
      h('nav.menu-row', null, this.backButton()),
    ];
  }

  private mapScreen(): HTMLElement[] {
    const system = this.source.system();
    const camera = this.source.cameraPosition();
    const star = system.system.star;
    const list = h('div.map-list');
    for (const body of system.bodies) {
      const dot = h('i.dot');
      dot.style.background = cssColor(body.desc.bands ? body.desc.bands[0] : body.desc.palette.midland, 2.2);
      const known = this.scanner.discovered.has(body.desc.id);
      list.append(
        h(
          `button.entry${body.parent ? '.moon' : ''}`,
          {
            type: 'button',
            onclick: () => {
              this.actions.navigateTo(body);
              this.close();
            },
          },
          dot,
          h('span.name', null, body.desc.name),
          h('span.kind', null, kindLabel(body.desc.kind)),
          h('span.dist', null, formatDistance(body.position.distanceTo(camera))),
          h(`span.state${known ? '.known' : ''}`, null, known ? 'surveyed' : 'unsurveyed'),
        ),
      );
    }
    const moons = system.bodies.length - system.system.planets.length;
    return [
      h('div.eyebrow', null, 'SYSTEM MAP'),
      h('h2', null, star.name),
      h('p.lede', null, `${star.spectralType} · ${system.system.planets.length} planets · ${moons} moons`),
      system.bodies.length ? list : h('p.lede', null, 'No bodies orbit this star.'),
      h('div.footnote', null, 'Select a destination to engage the autopilot'),
      h('nav.menu-row', null, this.backButton()),
    ];
  }

  private logbookScreen(): HTMLElement[] {
    const entries = this.scanner.log;
    const samples = [...this.scanner.inventory.values()].sort((a, b) => b.amount - a.amount);
    const beacons = this.source.beacons();
    const camera = this.source.cameraPosition();
    return [
      h('div.eyebrow', null, 'LOGBOOK'),
      h('h2', null, 'Expedition record'),
      h(
        'div.logbook',
        null,
        h(
          'section',
          null,
          h('h4', null, `Surveys · ${entries.length}`),
          entries.length
            ? h(
                'ul',
                null,
                ...entries
                  .slice()
                  .reverse()
                  .map((e) => h('li', null, h('b', null, e.name), h('span', null, e.subtitle))),
              )
            : h('p.empty', null, 'Nothing surveyed yet. Aim at a star or world and press F.'),
        ),
        h(
          'section',
          null,
          h('h4', null, `Samples · ${samples.reduce((sum, s) => sum + s.amount, 0).toFixed(1)} kg`),
          samples.length
            ? h(
                'ul',
                null,
                ...samples.map((s) =>
                  h(
                    'li',
                    null,
                    h('b', null, `${s.resource.name} (${s.resource.symbol})`),
                    h('span', null, `${s.amount.toFixed(1)} kg`),
                  ),
                ),
              )
            : h('p.empty', null, 'The sample bay is empty. Land and hold the left mouse button to drill.'),
          h('h4', null, `Beacons · ${beacons.length}`),
          beacons.length
            ? h(
                'ul',
                null,
                ...beacons.map((b) =>
                  h(
                    'li',
                    null,
                    h('b', null, `${b.label} — ${b.body.desc.name}`),
                    h('span', null, formatDistance(b.body.position.clone().add(b.local).distanceTo(camera))),
                  ),
                ),
              )
            : h('p.empty', null, 'No beacons planted in this system.'),
        ),
      ),
      h('nav.menu-row', null, this.backButton()),
    ];
  }

  dispose(): void {
    this.store.dispose();
  }
}

type NumericKey = {
  [K in keyof SettingsValues]: SettingsValues[K] extends number ? K : never;
}[keyof SettingsValues];
type BooleanKey = {
  [K in keyof SettingsValues]: SettingsValues[K] extends boolean ? K : never;
}[keyof SettingsValues];
