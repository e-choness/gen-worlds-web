// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import type { ResolvedDesign } from '@/mission/design';
import { TEXT } from '@/ui/text';

export interface VehicleDiagramProps {
  resolved: ResolvedDesign;
  /** Propellant load, kg: sizes the tank. Null until the propulsion chain is complete. */
  propellantKg: number | null;
}

const GROUND_Y = 204;
const CENTRE_X = 170;

/**
 * Side view of the vehicle drawn from the design: every chosen part changes the picture, so the
 * drawing is a readable summary of the choices (and the hangar view on devices without WebGPU).
 */
export function VehicleDiagram({ resolved, propellantKg }: VehicleDiagramProps) {
  const { bus, power, comms, mobility, propulsion, instruments } = resolved;
  if (!bus) {
    return (
      <div class="vehicle-diagram empty">
        <p>{TEXT.design.vehicleEmpty}</p>
      </div>
    );
  }
  const width = 84 + Math.min(60, bus.payloadCapacityKg / 16);
  const height = 44;
  const wheelRadius = mobility ? (mobility.maxSlopeDeg > 15 ? 19 : 15) : 0;
  const bodyBottom = GROUND_Y - (mobility ? wheelRadius * 1.35 : 34);
  const bodyTop = bodyBottom - height;
  const left = CENTRE_X - width / 2;
  const right = CENTRE_X + width / 2;
  const tankRadius = propellantKg ? Math.max(9, Math.min(20, Math.sqrt(propellantKg) * 0.5)) : 0;
  const drill = instruments.reduce((depth, instrument) => Math.max(depth, instrument.drillDepthM), 0);
  const hasCamera = instruments.some((instrument) => instrument.measures.includes('imaging'));
  const label = [bus.name, power?.name, comms?.name, mobility?.name, ...instruments.map((i) => i.name)]
    .filter(Boolean)
    .join(', ');

  return (
    <div class="vehicle-diagram">
      <svg viewBox="0 0 340 230" role="img" aria-label={`${TEXT.design.vehicle}: ${label}`}>
        <line class="ground" x1="10" y1={GROUND_Y} x2="330" y2={GROUND_Y} />

        {/* descent engine and propellant tank */}
        {propulsion && (
          <g class="propulsion">
            <path
              d={`M${CENTRE_X - 7},${bodyBottom} L${CENTRE_X - 13},${bodyBottom + 16} L${CENTRE_X + 13},${bodyBottom + 16} L${CENTRE_X + 7},${bodyBottom} Z`}
            />
            {tankRadius > 0 && <circle cx={CENTRE_X} cy={bodyTop + height / 2} r={tankRadius} />}
          </g>
        )}

        {/* frame */}
        <rect class="frame" x={left} y={bodyTop} width={width} height={height} rx="3" />

        {/* mobility: wheels, or landing legs for a fixed lander */}
        {mobility ? (
          <g class="wheels">
            {[left + wheelRadius * 0.7, right - wheelRadius * 0.7].map((x) => (
              <g key={x}>
                <circle cx={x} cy={GROUND_Y - wheelRadius} r={wheelRadius} />
                <circle cx={x} cy={GROUND_Y - wheelRadius} r={wheelRadius * 0.35} />
                <line x1={x} y1={bodyBottom} x2={x} y2={GROUND_Y - wheelRadius} />
              </g>
            ))}
          </g>
        ) : (
          <g class="legs">
            <path d={`M${left + 8},${bodyBottom} L${left - 18},${GROUND_Y} M${left - 28},${GROUND_Y} h20`} />
            <path
              d={`M${right - 8},${bodyBottom} L${right + 18},${GROUND_Y} M${right + 8},${GROUND_Y} h20`}
            />
          </g>
        )}

        {/* power source */}
        {power?.powerKind === 'solar' && power.mounting === 'body' && (
          <rect class="solar" x={left + 6} y={bodyTop - 5} width={width - 12} height="5" />
        )}
        {power?.powerKind === 'solar' && power.mounting === 'vertical' && (
          <g class="solar">
            <rect x={left + 8} y={bodyTop + 5} width={width - 16} height={height - 10} />
            {[1, 2, 3].map((i) => (
              <line
                key={i}
                x1={left + 8 + ((width - 16) * i) / 4}
                y1={bodyTop + 5}
                x2={left + 8 + ((width - 16) * i) / 4}
                y2={bodyBottom - 5}
              />
            ))}
          </g>
        )}
        {power?.powerKind === 'solar' && power.mounting === 'tracking_mast' && (
          <g class="solar">
            <line class="mast" x1={left + 16} y1={bodyTop} x2={left + 16} y2="22" />
            <rect x={left - 4} y="22" width="40" height={bodyTop - 46} />
            {[1, 2, 3, 4].map((i) => (
              <line
                key={i}
                x1={left - 4}
                y1={22 + ((bodyTop - 46) * i) / 5}
                x2={left + 36}
                y2={22 + ((bodyTop - 46) * i) / 5}
              />
            ))}
          </g>
        )}
        {power?.powerKind === 'rtg' && (
          <g class="rtg" transform={`rotate(-28 ${left} ${bodyTop + 12})`}>
            <rect x={left - 44} y={bodyTop + 4} width="42" height="16" rx="3" />
            {[0, 1, 2, 3, 4].map((i) => (
              <line
                key={i}
                x1={left - 40 + i * 8.5}
                y1={bodyTop - 2}
                x2={left - 40 + i * 8.5}
                y2={bodyTop + 26}
              />
            ))}
          </g>
        )}

        {/* communications */}
        {comms && comms.antennaDiameterM >= 0.25 ? (
          <g class="antenna">
            <line x1={right - 18} y1={bodyTop} x2={right - 18} y2={bodyTop - 24} />
            <path
              d={`M${right - 18 - comms.antennaDiameterM * 30},${bodyTop - 24 - comms.antennaDiameterM * 26} Q${right - 18 + comms.antennaDiameterM * 14},${bodyTop - 24} ${right - 18 - comms.antennaDiameterM * 30},${bodyTop - 24 + comms.antennaDiameterM * 26}`}
            />
          </g>
        ) : (
          comms && (
            <g class="antenna">
              <line x1={right - 18} y1={bodyTop} x2={right - 18} y2={bodyTop - 26} />
              <circle cx={right - 18} cy={bodyTop - 28} r="2.5" />
              {comms.relay && (
                <path
                  d={`M${right - 28},${bodyTop - 36} q10,-10 20,0 M${right - 34},${bodyTop - 42} q16,-16 32,0`}
                />
              )}
            </g>
          )
        )}

        {/* instruments: camera mast and drill */}
        {hasCamera && (
          <g class="instrument">
            <line x1={CENTRE_X + 4} y1={bodyTop} x2={CENTRE_X + 4} y2={bodyTop - 44} />
            <rect x={CENTRE_X - 7} y={bodyTop - 54} width="22" height="10" rx="2" />
          </g>
        )}
        {drill > 0 && (
          <g class="instrument">
            <rect x={right - 4} y={bodyTop + 8} width="10" height={height - 4} />
            <line
              class="drill"
              x1={right + 1}
              y1={bodyBottom + 4}
              x2={right + 1}
              y2={GROUND_Y + 8 + drill * 9}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
