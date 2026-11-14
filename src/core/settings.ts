// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Player preferences: one persisted object, read by whoever needs a value and observed by the
 * subsystems that must react (renderer scale, audio gains). No dependencies, so any layer may use it.
 */
import { Emitter } from './events';

export interface SettingsValues {
  /** Multiplier on the base mouse-look rate. */
  mouseSensitivity: number;
  invertY: boolean;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Upper bound on the device pixel ratio used for rendering. */
  renderScale: number;
  bloom: boolean;
  /** Ambient particles (dust, snow, embers) and tool effects. */
  particles: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  mouseSensitivity: 1,
  invertY: false,
  fov: 60,
  renderScale: 1.5,
  bloom: true,
  particles: true,
  masterVolume: 0.8,
  musicVolume: 0.45,
  effectsVolume: 0.7,
  muted: false,
};

const STORAGE_KEY = 'gen-worlds.settings.v1';

export class Settings {
  readonly values: SettingsValues = { ...DEFAULT_SETTINGS };
  readonly changed = new Emitter<{ change: keyof SettingsValues }>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<SettingsValues>;
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsValues>) {
        // Only accept values of the expected type: the stored object may come from an older build.
        if (typeof saved[key] === typeof DEFAULT_SETTINGS[key])
          Object.assign(this.values, { [key]: saved[key] });
      }
    } catch {
      // Storage unavailable or corrupt: defaults apply.
    }
  }

  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    this.changed.emit('change', key);
  }

  reset(): void {
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsValues>) {
      if (this.values[key] === DEFAULT_SETTINGS[key]) continue;
      Object.assign(this.values, { [key]: DEFAULT_SETTINGS[key] });
      this.changed.emit('change', key);
    }
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Not persisted this session; harmless.
    }
  }
}
