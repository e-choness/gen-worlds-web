import { capacityAt, type LaunchVehicle } from '@/data/launch-vehicles';
import { num } from '@/mission/format';
import { TEXT } from '@/ui/text';

export interface CapacityChartProps {
  vehicles: readonly LaunchVehicle[];
  selectedId: string | null;
  /** Where on the x axis the mission sits, or null before it is chosen: launch energy in km²/s², or altitude in km. */
  c3: number | null;
  /** `altitude` plots payload to a sun-synchronous orbit instead of payload against launch energy. */
  axis?: 'energy' | 'altitude';
  /** Mass the launcher must lift (fuelled spacecraft + adapter), kg, or null if not known yet. */
  neededKg: number | null;
}

const WIDTH = 520;
const HEIGHT = 250;
const PAD = { left: 56, right: 16, top: 14, bottom: 36 };
const ENERGY_RANGE = { min: -4, max: 60, ticks: [0, 20, 40, 60] };
const ALTITUDE_RANGE = { min: 380, max: 820, ticks: [400, 500, 600, 700, 800] };

/**
 * What each rocket can send away from Earth against launch energy. The vertical line is the energy
 * the chosen transfer needs and the horizontal one the spacecraft's mass: a rocket whose curve
 * passes above their crossing can fly the mission.
 */
export function CapacityChart({ vehicles, selectedId, c3, neededKg, axis = 'energy' }: CapacityChartProps) {
  const range = axis === 'altitude' ? ALTITUDE_RANGE : ENERGY_RANGE;
  const C3_MIN = range.min;
  const C3_MAX = range.max;
  const curveOf = (vehicle: LaunchVehicle) =>
    axis === 'altitude' ? vehicle.ssoCapacity : vehicle.c3Capacity;
  const capable = vehicles.filter((vehicle) => curveOf(vehicle).length > 0);
  const maxKg = Math.max(neededKg ?? 0, ...capable.map((vehicle) => curveOf(vehicle)[0][1])) * 1.08;
  // A square-root mass axis keeps the small rockets readable next to the giants.
  const x = (value: number): number =>
    PAD.left + ((value - C3_MIN) / (C3_MAX - C3_MIN)) * (WIDTH - PAD.left - PAD.right);
  const y = (kg: number): number =>
    HEIGHT - PAD.bottom - Math.sqrt(Math.max(kg, 0) / maxKg) * (HEIGHT - PAD.top - PAD.bottom);
  const t = TEXT.trajectory;
  const massTicks = [50, 200, 500, 2000, 5000, 10000, 20000].filter((kg) => kg < maxKg && kg > maxKg / 40);

  return (
    <figure class="chart capacity-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={axis === 'altitude' ? t.capacityAltitudeLabel : t.capacityLabel}
      >
        {massTicks.map((kg) => (
          <g key={kg} class="tick">
            <line x1={PAD.left} y1={y(kg)} x2={WIDTH - PAD.right} y2={y(kg)} />
            <text x={PAD.left - 6} y={y(kg) + 4} text-anchor="end">
              {num(kg)} kg
            </text>
          </g>
        ))}
        {range.ticks.map((value) => (
          <text key={value} class="axis" x={x(value)} y={HEIGHT - PAD.bottom + 15} text-anchor="middle">
            {value}
          </text>
        ))}
        <text class="axis" x={(PAD.left + WIDTH - PAD.right) / 2} y={HEIGHT - 4} text-anchor="middle">
          {axis === 'altitude' ? t.altitudeAxis : t.c3Axis}
        </text>

        {capable.map((vehicle) => {
          const selected = vehicle.id === selectedId;
          const points = curveOf(vehicle).filter(([value]) => value <= C3_MAX);
          const path = points
            .map(([value, kg], index) => `${index ? 'L' : 'M'}${x(value)},${y(kg)}`)
            .join(' ');
          const [lastC3, lastKg] = points[points.length - 1];
          return (
            <g key={vehicle.id} class={selected ? 'curve selected' : 'curve'}>
              <path d={path} />
              <text x={x(lastC3)} y={y(lastKg) - 6} text-anchor="end">
                {vehicle.name.replace(/\s*\(.*\)/, '')}
              </text>
            </g>
          );
        })}

        {c3 !== null && <line class="marker" x1={x(c3)} y1={PAD.top} x2={x(c3)} y2={HEIGHT - PAD.bottom} />}
        {neededKg !== null && Number.isFinite(neededKg) && (
          <g class="needed">
            <line x1={PAD.left} y1={y(neededKg)} x2={WIDTH - PAD.right} y2={y(neededKg)} />
            <text x={PAD.left + 14} y={y(neededKg) + 13}>
              {t.needed} {num(neededKg)} kg
            </text>
          </g>
        )}
        {c3 !== null && neededKg !== null && Number.isFinite(neededKg) && (
          <circle class="crossing" cx={x(c3)} cy={y(neededKg)} r="4.5" />
        )}
      </svg>
      <figcaption>
        {axis === 'altitude' ? t.capacityAltitudeCaption : t.capacityCaption}
        {c3 !== null && selectedId && (
          <>
            {' '}
            {t.capacityAt}{' '}
            {num(capacityAt(curveOf(vehicles.find((v) => v.id === selectedId) ?? vehicles[0]), c3))} kg.
          </>
        )}
      </figcaption>
    </figure>
  );
}
