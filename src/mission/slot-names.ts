// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/** Player-facing names of the vehicle's slots, used inside explanation strings and by the UI. */
import type { PartCategory } from '@/data/parts';

export const SLOT_NAMES: Record<PartCategory, string> = {
  bus: 'Frame',
  power: 'Power source',
  battery: 'Battery',
  propulsion: 'Propulsion',
  adcs: 'Attitude control',
  computer: 'Computer',
  comms: 'Communications',
  thermal: 'Thermal control',
  mobility: 'Mobility',
  landing: 'Landing system',
  instrument: 'Instruments',
};

/** Player-facing names of the measurement tags instruments provide. */
export const MEASURE_NAMES: Record<string, string> = {
  hydrogen_map: 'hydrogen mapping',
  surface_volatiles: 'surface ice detection',
  mineralogy: 'mineral identification',
  volatile_composition: 'analysis of released gases',
  subsurface_access: 'drilling',
  subsurface_structure: 'profiling of buried layers',
  imaging: 'imaging',
  thermal_map: 'temperature mapping',
  rock_coring: 'rock coring',
  organics_detection: 'detection of organic molecules',
  elemental_chemistry: 'fine-scale chemistry',
  remote_chemistry: 'chemistry at a distance',
  weather: 'weather monitoring',
};

export function measureName(tag: string): string {
  return MEASURE_NAMES[tag] ?? tag.replace(/_/g, ' ');
}
