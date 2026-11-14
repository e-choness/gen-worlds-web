/**
 * A 3D map view: glowing points and orbit rings in perspective, with a camera that orbits a centre.
 * Drag turns the view, the wheel (or + and −) moves in and out, a click picks the nearest point and
 * a double click opens it. Drawn on a 2D canvas with its own projection, so it needs no WebGPU and
 * the mission screens can show it on any device.
 *
 * The scene is rebuilt by `build(time)` every frame while `animated`, otherwise only when the
 * camera or the inputs change. Units are whatever the scene uses; `reach` says how big it is.
 */
import { useEffect, useRef } from 'preact/hooks';

export interface MapPoint {
  id: string;
  /** Position relative to the centre of the view. +Y is up. */
  x: number;
  y: number;
  z: number;
  color: string;
  /** Radius in scene units of a lit sphere, or 0 for a point of light sized by `glow`. */
  radius: number;
  /** Size of the glow in pixels at the reference distance. */
  glow: number;
  label: string;
  /** Labelled even when far away or dim. */
  important: boolean;
  /** Draws a line down to the reference plane, which is what gives a star its depth. */
  stem: boolean;
}

export interface MapRing {
  /** Centre of the ring. */
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Tilt of the ring's plane from the reference plane, radians, about an axis at angle `node`. */
  tilt: number;
  node: number;
  selected: boolean;
}

export interface MapScene {
  points: MapPoint[];
  rings: MapRing[];
  /** Spacing of the range circles on the reference plane, in scene units; 0 for none. */
  gridStep: number;
  gridLabel: string;
}

export interface SpaceMap3dProps {
  build: (timeSeconds: number) => MapScene;
  /** Anything that changes when `build` would return something new without time passing. */
  version: unknown;
  /** Changing this puts the camera back at its starting place (a new centre or a new level). */
  resetKey: unknown;
  /** Rough radius of the scene: sets the starting distance and the zoom limits. */
  reach: number;
  selectedId: string | null;
  animated: boolean;
  label: string;
  onPick: (id: string) => void;
  onOpen: (id: string) => void;
}

const PICK_RADIUS_PX = 18;
const DRAG_THRESHOLD_PX = 4;
const MIN_PITCH = 0.08;
const MAX_PITCH = 1.5;
const START_PITCH = 0.5;
const LABEL_FONT = '500 12px system-ui, sans-serif';

interface Camera {
  yaw: number;
  pitch: number;
  distance: number;
}

interface Projected {
  point: MapPoint;
  sx: number;
  sy: number;
  depth: number;
  scale: number;
}

export function SpaceMap3d(props: SpaceMap3dProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const camera = useRef<Camera>({ yaw: 0.6, pitch: START_PITCH, distance: props.reach * 2.4 });
  const dirty = useRef(true);
  const projected = useRef<Projected[]>([]);

  // A new centre or level: back to the starting view.
  useEffect(() => {
    camera.current.distance = props.reach * 2.4;
    camera.current.pitch = START_PITCH;
    dirty.current = true;
  }, [props.resetKey]);
  useEffect(() => {
    dirty.current = true;
  }, [props.version, props.selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    const resize = (): void => {
      const ratio = Math.min(devicePixelRatio, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      dirty.current = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (time: number): void => {
      frame = requestAnimationFrame(draw);
      const { build, animated, selectedId } = latest.current;
      if (!animated && !dirty.current) return;
      dirty.current = false;
      const scene = build(time / 1000);
      const { yaw, pitch, distance } = camera.current;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const focal = height * 1.1;
      /** Scene point to screen: [x, y, depth, pixels per scene unit], or null behind the camera. */
      const project = (x: number, y: number, z: number): [number, number, number, number] | null => {
        const rx = x * cosYaw - z * sinYaw;
        const rz = x * sinYaw + z * cosYaw;
        const ry = y * cosPitch - rz * sinPitch;
        const depth = y * sinPitch + rz * cosPitch + distance;
        if (depth <= distance * 0.02) return null;
        const scale = focal / depth;
        return [width / 2 + rx * scale, height / 2 - ry * scale, depth, scale];
      };
      const path = (cx: number, cy: number, cz: number, radius: number, tilt: number, node: number): void => {
        context.beginPath();
        let started = false;
        for (let step = 0; step <= 96; step++) {
          const angle = (step / 96) * Math.PI * 2;
          // A circle in the reference plane, tilted about the line of nodes.
          const along = Math.cos(angle) * radius;
          const across = Math.sin(angle) * radius;
          const px = along * Math.cos(node) - across * Math.cos(tilt) * Math.sin(node);
          const pz = along * Math.sin(node) + across * Math.cos(tilt) * Math.cos(node);
          const py = across * Math.sin(tilt);
          const screen = project(cx + px, cy + py, cz + pz);
          if (!screen) {
            started = false;
            continue;
          }
          if (started) context.lineTo(screen[0], screen[1]);
          else context.moveTo(screen[0], screen[1]);
          started = true;
        }
        context.stroke();
      };

      context.clearRect(0, 0, width, height);
      context.fillStyle = '#03060b';
      context.fillRect(0, 0, width, height);

      // Range circles and spokes on the reference plane: the floor the stems stand on.
      if (scene.gridStep > 0) {
        context.lineWidth = 1;
        const rings = Math.ceil((latest.current.reach * 1.6) / scene.gridStep);
        for (let ring = 1; ring <= rings; ring++) {
          context.strokeStyle = ring % 5 === 0 ? 'rgba(108,197,255,0.28)' : 'rgba(108,197,255,0.11)';
          path(0, 0, 0, ring * scene.gridStep, 0, 0);
        }
        context.strokeStyle = 'rgba(108,197,255,0.11)';
        for (let spoke = 0; spoke < 12; spoke++) {
          const angle = (spoke / 12) * Math.PI * 2;
          const from = project(0, 0, 0);
          const to = project(
            Math.cos(angle) * rings * scene.gridStep,
            0,
            Math.sin(angle) * rings * scene.gridStep,
          );
          if (!from || !to) continue;
          context.beginPath();
          context.moveTo(from[0], from[1]);
          context.lineTo(to[0], to[1]);
          context.stroke();
        }
        context.fillStyle = 'rgba(154,169,188,0.9)';
        context.font = LABEL_FONT;
        const mark = project(scene.gridStep * 5, 0, 0);
        if (mark) context.fillText(scene.gridLabel, mark[0] + 6, mark[1] - 4);
      }

      for (const ring of scene.rings) {
        context.lineWidth = ring.selected ? 1.6 : 1;
        context.strokeStyle = ring.selected ? 'rgba(108,197,255,0.95)' : 'rgba(120,150,190,0.4)';
        path(ring.x, ring.y, ring.z, ring.radius, ring.tilt, ring.node);
      }

      const list: Projected[] = [];
      for (const point of scene.points) {
        const screen = project(point.x, point.y, point.z);
        if (!screen) continue;
        if (screen[0] < -60 || screen[1] < -60 || screen[0] > width + 60 || screen[1] > height + 60) continue;
        list.push({ point, sx: screen[0], sy: screen[1], depth: screen[2], scale: screen[3] });
      }
      // Far to near, so near things cover far ones.
      list.sort((a, b) => b.depth - a.depth);
      projected.current = list;
      const reference = focal / distance;

      for (const item of list) {
        const { point, sx, sy, scale } = item;
        const chosen = point.id === selectedId;
        if (point.stem) {
          const foot = project(point.x, 0, point.z);
          if (foot) {
            context.strokeStyle = chosen ? 'rgba(108,197,255,0.8)' : 'rgba(150,170,200,0.2)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(sx, sy);
            context.lineTo(foot[0], foot[1]);
            context.stroke();
            context.fillStyle = context.strokeStyle;
            context.fillRect(foot[0] - 1.5, foot[1] - 1.5, 3, 3);
          }
        }
        const near = Math.min(2.2, Math.max(0.35, scale / reference));
        if (point.radius > 0) {
          // A sphere lit from the centre of the scene (the star).
          const size = Math.max(3.5, point.radius * scale);
          const toStar = project(0, 0, 0);
          const lx = toStar ? Math.sign(toStar[0] - sx) : 0;
          const ly = toStar ? Math.sign(toStar[1] - sy) : 0;
          const shade = context.createRadialGradient(
            sx + lx * size * 0.4,
            sy + ly * size * 0.4,
            size * 0.1,
            sx,
            sy,
            size,
          );
          shade.addColorStop(0, '#ffffff');
          shade.addColorStop(0.18, point.color);
          shade.addColorStop(0.75, point.color);
          shade.addColorStop(1, '#0a0e16');
          context.fillStyle = shade;
          context.beginPath();
          context.arc(sx, sy, size, 0, Math.PI * 2);
          context.fill();
          item.scale = size;
        } else {
          const size = point.glow * near;
          context.globalCompositeOperation = 'lighter';
          const glow = context.createRadialGradient(sx, sy, 0, sx, sy, size * 2.2);
          glow.addColorStop(0, point.color);
          glow.addColorStop(0.18, point.color);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          context.globalAlpha = Math.min(1, 0.35 + near * 0.5);
          context.fillStyle = glow;
          context.beginPath();
          context.arc(sx, sy, size * 2.2, 0, Math.PI * 2);
          context.fill();
          context.globalAlpha = 1;
          context.globalCompositeOperation = 'source-over';
          context.fillStyle = '#ffffff';
          context.beginPath();
          context.arc(sx, sy, Math.max(0.7, size * 0.32), 0, Math.PI * 2);
          context.fill();
          item.scale = size;
        }
        if (chosen) {
          context.strokeStyle = '#6cc5ff';
          context.lineWidth = 2;
          context.beginPath();
          context.arc(sx, sy, item.scale + 7, 0, Math.PI * 2);
          context.stroke();
        }
        if (chosen || point.important || near > 1.7) {
          context.font = chosen ? '600 13px system-ui, sans-serif' : LABEL_FONT;
          context.fillStyle = chosen ? '#ffffff' : `rgba(230,237,245,${Math.min(1, 0.4 + near * 0.5)})`;
          context.fillText(point.label, sx + item.scale + 9, sy + 4);
        }
      }
    };
    frame = requestAnimationFrame(draw);

    let pressed: { x: number; y: number; moved: boolean } | null = null;
    const zoom = (factor: number): void => {
      const { reach } = latest.current;
      camera.current.distance = Math.min(reach * 8, Math.max(reach * 0.25, camera.current.distance * factor));
      dirty.current = true;
    };
    const nearest = (event: MouseEvent): string | null => {
      const box = canvas.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      let best: Projected | null = null;
      let bestDistance = PICK_RADIUS_PX;
      for (const item of projected.current) {
        const reachPx = Math.hypot(item.sx - x, item.sy - y) - Math.min(item.scale, 30);
        if (reachPx < bestDistance) {
          bestDistance = reachPx;
          best = item;
        }
      }
      return best ? best.point.id : null;
    };
    const onDown = (event: PointerEvent): void => {
      pressed = { x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent): void => {
      if (!pressed) return;
      const dx = event.clientX - pressed.x;
      const dy = event.clientY - pressed.y;
      if (!pressed.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      pressed.moved = true;
      camera.current.yaw += dx * 0.006;
      camera.current.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, camera.current.pitch + dy * 0.005));
      pressed.x = event.clientX;
      pressed.y = event.clientY;
      dirty.current = true;
    };
    const onUp = (event: PointerEvent): void => {
      const wasClick = pressed && !pressed.moved;
      pressed = null;
      if (!wasClick) return;
      const id = nearest(event);
      if (id) latest.current.onPick(id);
    };
    const onDouble = (event: MouseEvent): void => {
      const id = nearest(event);
      if (id) latest.current.onOpen(id);
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1 / 1.15 : 1.15);
    };
    const onKey = (event: KeyboardEvent): void => {
      const turn = 0.12;
      if (event.key === 'ArrowLeft') camera.current.yaw -= turn;
      else if (event.key === 'ArrowRight') camera.current.yaw += turn;
      else if (event.key === 'ArrowUp')
        camera.current.pitch = Math.min(MAX_PITCH, camera.current.pitch + turn);
      else if (event.key === 'ArrowDown')
        camera.current.pitch = Math.max(MIN_PITCH, camera.current.pitch - turn);
      else if (event.key === '+' || event.key === '=') zoom(1 / 1.25);
      else if (event.key === '-') zoom(1.25);
      else return;
      event.preventDefault();
      dirty.current = true;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    // The canvas takes arrow keys to turn the view; the list beside it offers every star and world.
    <canvas ref={canvasRef} class="space-map-3d" role="img" aria-label={props.label} tabIndex={0} />
  );
}
