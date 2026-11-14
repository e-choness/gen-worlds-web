// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import type { ResolvedDesign } from '@/mission/design';
import type { AntennaKind, PowerLayout, VehicleSpec } from '@/render/hangar/vehicle-spec';

/** Propellant density used to size the tanks on the model, kg/m³. */
const PROPELLANT_DENSITY = 1000;

function powerLayout(resolved: ResolvedDesign, satellite: boolean): PowerLayout {
  const { power } = resolved;
  if (!power) return 'none';
  if (power.powerKind === 'rtg') return 'rtg';
  if (power.mounting === 'body') return satellite ? 'skin' : 'deck';
  if (power.mounting === 'vertical') return satellite ? 'wings' : 'sides';
  return satellite ? 'tracking_wings' : 'mast';
}

function antennaKind(resolved: ResolvedDesign): AntennaKind {
  const { comms } = resolved;
  if (!comms) return 'none';
  if (comms.relay) return 'helix';
  if (comms.antennaDiameterM >= 0.2) return 'dish';
  return comms.needsPointingClass >= 1 ? 'patch' : 'whip';
}

/** The 3D model's description of a design, or null before a frame is chosen. */
export function vehicleSpecFromDesign(
  resolved: ResolvedDesign,
  propellantKg: number | null,
): VehicleSpec | null {
  const { bus, mobility, scenario, instruments } = resolved;
  if (!bus) return null;
  const satellite = scenario.orbit !== null;
  // Size follows what the frame can carry: mass grows with volume, so length with its cube root.
  const scale = Math.cbrt(bus.payloadCapacityKg);
  const body: VehicleSpec['body'] = satellite
    ? [0.14 * scale, 0.17 * scale, 0.14 * scale]
    : [0.19 * scale, 0.075 * scale, 0.15 * scale];
  const tankVolume =
    propellantKg && Number.isFinite(propellantKg) ? propellantKg / PROPELLANT_DENSITY / 2 : 0;
  const tankRadiusM =
    tankVolume > 0 ? Math.min(body[0] * 0.3, Math.max(0.06, Math.cbrt((3 * tankVolume) / (4 * Math.PI)))) : 0;
  const drill = instruments.reduce((depth, instrument) => Math.max(depth, instrument.drillDepthM), 0);
  const onMast = instruments.filter(
    (instrument) =>
      instrument.measures.includes('imaging') || instrument.measures.includes('remote_chemistry'),
  );
  const telescopes = instruments.filter((instrument) => instrument.swathKmAt500 > 0);
  const boxed = instruments.length - onMast.length - telescopes.length - (drill > 0 ? 1 : 0);
  return {
    kind: satellite ? 'satellite' : mobility ? 'rover' : 'lander',
    body,
    foil: (resolved.thermal?.heatLeakFactor ?? 1) < 1,
    power: powerLayout(resolved, satellite),
    solarAreaM2: resolved.power?.powerKind === 'solar' ? resolved.power.areaM2 : 0,
    wheels: mobility ? (scenario.targetBody === 'mars' ? 6 : 4) : 0,
    wheelRadiusM: mobility ? (mobility.maxSlopeDeg > 15 ? 0.27 : 0.21) : 0,
    legs: !mobility && !satellite,
    tankRadiusM,
    engine: !!resolved.propulsion,
    antenna: antennaKind(resolved),
    antennaDiameterM: resolved.comms?.antennaDiameterM ?? 0,
    mastCamera: onMast.length > 0,
    drillM: drill > 0 ? Math.max(drill, 0.4) : 0,
    telescope: telescopes.length > 0,
    instrumentBoxes: Math.max(0, Math.min(4, boxed)),
  };
}
