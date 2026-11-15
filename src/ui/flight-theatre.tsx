// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MissionTheatre, TheatrePhase, TheatreSetup } from '@/render/theatre/mission-theatre';
import { prefersReducedMotion } from '@/ui/dom';

export interface FlightTheatreProps {
  setup: TheatreSetup;
  phase: TheatrePhase;
  /** True once the log has shown the mission being lost. */
  lost: boolean;
  /** Text alternative: what the scene is showing. */
  label: string;
  /** Still picture shown where the 3D scene cannot run. */
  fallbackArt: string;
  fallbackAlt: string;
  /** Told once that the 3D scene cannot run, so the log need not wait for it. */
  onUnavailable: () => void;
}

/**
 * The flight in 3D: the scene follows the mission log. The renderer is loaded on demand; where it
 * cannot start, the still picture of the destination takes its place.
 */
export function FlightTheatre({
  setup,
  phase,
  lost,
  label,
  fallbackArt,
  fallbackAlt,
  onUnavailable,
}: FlightTheatreProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theatre = useRef<MissionTheatre | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ phase, lost });
  latest.current = { phase, lost };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    import('@/render/theatre/mission-theatre')
      .then((module) => module.MissionTheatre.create(element, setup, { still: prefersReducedMotion() }))
      .then((created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        theatre.current = created;
        created.show(latest.current.phase, latest.current.lost);
      })
      .catch(() => {
        setFailed(true);
        onUnavailable();
      });
    return () => {
      cancelled = true;
      theatre.current?.dispose();
      theatre.current = null;
    };
  }, [setup]);

  useEffect(() => {
    theatre.current?.show(phase, lost);
  }, [phase, lost]);

  if (failed) return <img src={fallbackArt} alt={fallbackAlt} />;
  return <canvas ref={canvas} class="flight-theatre" role="img" aria-label={label} />;
}
