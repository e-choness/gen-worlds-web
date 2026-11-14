// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ResolvedDesign } from '@/mission/design';
import type { VehicleView } from '@/render/hangar/vehicle-view';
import { TEXT } from '@/ui/text';
import { VehicleDiagram } from '@/ui/vehicle-diagram';
import { vehicleSpecFromDesign } from '@/ui/vehicle-spec-from-design';

export interface Vehicle3dProps {
  resolved: ResolvedDesign;
  /** Propellant load, kg: sizes the tanks. Null until the propulsion chain is complete. */
  propellantKg: number | null;
}

/**
 * The vehicle in 3D on a turntable, rebuilt whenever a part changes. The renderer is loaded on
 * demand; if it cannot start, the 2D diagram takes its place.
 */
export function Vehicle3d({ resolved, propellantKg }: Vehicle3dProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<VehicleView | null>(null);
  const [failed, setFailed] = useState(false);
  const spec = useMemo(() => vehicleSpecFromDesign(resolved, propellantKg), [resolved, propellantKg]);
  const latest = useRef(spec);
  latest.current = spec;
  const hasVehicle = spec !== null;

  useEffect(() => {
    const element = canvas.current;
    if (!hasVehicle || !element) return;
    let cancelled = false;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('@/render/hangar/vehicle-view')
      .then((module) => module.VehicleView.create(element, !still))
      .then((created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        view.current = created;
        if (latest.current) created.show(latest.current);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      view.current?.dispose();
      view.current = null;
    };
  }, [hasVehicle]);

  useEffect(() => {
    if (spec) view.current?.show(spec);
  }, [spec]);

  if (failed || !spec) return <VehicleDiagram resolved={resolved} propellantKg={propellantKg} />;
  return (
    <div class="vehicle-3d">
      <canvas ref={canvas} tabIndex={0} aria-label={TEXT.design.vehicle3d} />
      <p class="vehicle-hint">{TEXT.design.vehicleHint}</p>
    </div>
  );
}
