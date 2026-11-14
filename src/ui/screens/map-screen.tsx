/**
 * The galaxy map: browse the stars near home, open a system, pick a world, and plan a mission to it.
 * Drawn in SVG from the same generator the 3D view uses, so it works without WebGPU and every world
 * on it is the world you would fly to. The map only reads the galaxy; choosing a mission goes
 * through `onPlan`.
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { encodeWorld } from '@/data/world';
import { num } from '@/mission/format';
import { TEXT } from '@/ui/text';
import { AU, SECTOR_SIZE_LY } from '@/universe/constants';
import { Galaxy } from '@/universe/galaxy';
import { createSolarSystem, solarBodyId } from '@/universe/solar-system';
import { generateSystem } from '@/universe/system';
import type { BodyDesc, StarDesc, SystemDesc } from '@/universe/types';
import { HOME_SECTOR, isLandable, worldParamsOf } from '@/universe/world-params';

export interface MapScreenProps {
  /** Scenario ids of the catalog missions, by the solar-system body they fly to. */
  catalogMissions: Readonly<Record<string, string>>;
  onPlan: (scenarioId: string) => void;
  /** Opens the 3D view at a generated world; null where it cannot run. */
  onFly: ((worldId: string) => void) | null;
  onBack: () => void;
}

const EARTH_GRAVITY = 9.81;
const VIEW = 720;
const MIN_ZOOM = 3;
const MAX_ZOOM = 40;
/** Stars in the list beside the map. */
const LIST_LIMIT = 40;
/** Stars at least this bright (in Suns) are named on the chart before the others. */
const LABEL_LUMINOSITY = 2;
const KIND_COLORS: Record<string, string> = {
  barren: '#9aa3ad',
  desert: '#d9a066',
  terra: '#5fb37a',
  ocean: '#4f8fd6',
  ice: '#bfe3f2',
  lava: '#e2603c',
  toxic: '#c9b458',
  gasGiant: '#d8b48a',
  iceGiant: '#8fc7d9',
};

const rgb = (color: readonly number[]): string =>
  `rgb(${color.map((channel) => Math.round(Math.min(1, channel) * 255)).join(' ')})`;

function figure(value: number): string {
  return value >= 100
    ? num(value, 0)
    : value >= 10
      ? value.toFixed(0)
      : value >= 1
        ? value.toFixed(1)
        : value.toPrecision(2);
}

/** Radius on the system chart: orbits are spread by the logarithm of their size so inner worlds stay apart. */
function chartRadius(orbit: number, inner: number, outer: number): number {
  if (outer <= inner) return VIEW * 0.25;
  const share = Math.log(orbit / inner) / Math.log(outer / inner);
  return VIEW * (0.1 + 0.36 * share);
}

export function MapScreen({ catalogMissions, onPlan, onFly, onBack }: MapScreenProps) {
  const t = TEXT.map;
  const galaxy = useMemo(() => new Galaxy(), []);
  const sol = useMemo(() => createSolarSystem(), []);
  // Centre of the galaxy chart, light-years, and its scale in pixels per light-year.
  const [centre, setCentre] = useState<[number, number]>(() => [
    (HOME_SECTOR[0] + 0.5) * SECTOR_SIZE_LY,
    (HOME_SECTOR[2] + 0.5) * SECTOR_SIZE_LY,
  ]);
  const [zoom, setZoom] = useState(18);
  const [star, setStar] = useState<StarDesc | null>(null);
  const [system, setSystem] = useState<SystemDesc | null>(null);
  const [body, setBody] = useState<BodyDesc | null>(null);
  const [query, setQuery] = useState('');
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Every star of the sectors the chart can show, three sectors deep.
  const stars = useMemo(() => {
    const reach = Math.ceil(VIEW / 2 / zoom / SECTOR_SIZE_LY) + 1;
    const sx = Math.floor(centre[0] / SECTOR_SIZE_LY);
    const sz = Math.floor(centre[1] / SECTOR_SIZE_LY);
    const found: StarDesc[] = [];
    for (let x = -reach; x <= reach; x++) {
      for (let z = -reach; z <= reach; z++) {
        for (let y = -1; y <= 1; y++) found.push(...galaxy.sectorStars(sx + x, HOME_SECTOR[1] + y, sz + z));
      }
    }
    return found;
  }, [galaxy, centre, zoom]);

  const listed = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const distance = (entry: StarDesc): number =>
      Math.hypot(entry.positionLy[0] - centre[0], entry.positionLy[2] - centre[1]);
    return stars
      .filter((entry) => !wanted || entry.name.toLowerCase().includes(wanted))
      .sort((a, b) => distance(a) - distance(b))
      .slice(0, LIST_LIMIT);
  }, [stars, query, centre]);

  const openSystem = (next: StarDesc, real: boolean): void => {
    setStar(next);
    setSystem(real ? sol : generateSystem(next));
    setBody(null);
  };
  const toGalaxy = (): void => {
    setSystem(null);
    setBody(null);
  };
  const selectStar = (next: StarDesc): void => {
    setStar(next);
    setBody(null);
    setSystem(null);
    setCentre([next.positionLy[0], next.positionLy[2]]);
  };

  const bodies = system ? system.planets.flatMap((planet) => [planet, ...planet.moons]) : [];
  const orbits = system ? system.planets.map((planet) => planet.orbitRadius) : [];
  const inner = Math.min(...orbits);
  const outer = Math.max(...orbits);
  const planetPoint = (planet: BodyDesc): [number, number] => {
    const radius = chartRadius(planet.orbitRadius, inner, outer);
    return [VIEW / 2 + Math.cos(planet.orbitPhase) * radius, VIEW / 2 + Math.sin(planet.orbitPhase) * radius];
  };

  // What the selected body offers: a catalog mission, a generated one, or nothing.
  const catalogId = body && system?.real ? catalogMissions[solarBodyId(body) ?? ''] : undefined;
  const landable = body !== null && isLandable(body);
  const worldId =
    body && system && !system.real && landable ? encodeWorld(worldParamsOf(system, body)) : null;
  const parent = body && system ? system.planets.find((planet) => planet.id === body.parentId) : undefined;
  const sunlight =
    body && system ? system.star.luminositySolar / ((parent ?? body).orbitRadius / AU) ** 2 : 0;

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2))));
  };
  const onPointerDown = (event: PointerEvent): void => {
    drag.current = { x: event.clientX, y: event.clientY };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!drag.current || system) return;
    const box = (event.currentTarget as Element).getBoundingClientRect();
    const perPixel = VIEW / box.width / zoom;
    setCentre([
      centre[0] - (event.clientX - drag.current.x) * perPixel,
      centre[1] - (event.clientY - drag.current.y) * perPixel,
    ]);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };

  return (
    <section class="screen wide map-screen">
      <div class="map-head">
        <nav class="map-crumbs" aria-label={t.crumbs}>
          <button type="button" class="link-button" onClick={toGalaxy}>
            {t.galaxy}
          </button>
          {star && (
            <>
              <span aria-hidden="true">›</span>
              <button type="button" class="link-button" onClick={() => setBody(null)}>
                {star.name}
              </button>
            </>
          )}
          {body && (
            <>
              <span aria-hidden="true">›</span>
              <strong>{body.name}</strong>
            </>
          )}
        </nav>
        <label class="map-search">
          <span class="visually-hidden">{t.search}</span>
          <input
            type="search"
            placeholder={t.search}
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </div>

      <div class="map-layout">
        <nav class="map-tree" aria-label={t.explore}>
          <h2>
            {t.explore}{' '}
            <span class="dim">
              {stars.length} {t.starsNearby}
            </span>
          </h2>
          <ul>
            <li>
              <button
                type="button"
                class={system?.real ? 'tree-row selected' : 'tree-row'}
                data-autofocus
                onClick={() => openSystem(sol.star, true)}
              >
                <span class="tree-dot" style={{ background: rgb(sol.star.color) }} />
                <span class="tree-name">{sol.star.name}</span>
                <span class="tree-note">{t.home}</span>
              </button>
            </li>
            {listed.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  class={star?.id === entry.id && !system?.real ? 'tree-row selected' : 'tree-row'}
                  onClick={() => openSystem(entry, false)}
                >
                  <span class="tree-dot" style={{ background: rgb(entry.color) }} />
                  <span class="tree-name">{entry.name}</span>
                  <span class="tree-note">{entry.spectralType}</span>
                </button>
                {system && star?.id === entry.id && !system.real && (
                  <BodyRows bodies={system.planets} selected={body} onSelect={setBody} />
                )}
              </li>
            ))}
          </ul>
          {system?.real && <BodyRows bodies={system.planets} selected={body} onSelect={setBody} />}
        </nav>

        <div class="map-stage">
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            role="img"
            aria-label={system ? `${star?.name}: ${t.systemChart}` : t.galaxyChart}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {!system &&
              stars.map((entry) => {
                const x = VIEW / 2 + (entry.positionLy[0] - centre[0]) * zoom;
                const y = VIEW / 2 + (entry.positionLy[2] - centre[1]) * zoom;
                if (x < -20 || y < -20 || x > VIEW + 20 || y > VIEW + 20) return null;
                const size = Math.min(6, 1.1 + Math.log10(1 + entry.luminositySolar * 20) * 1.4);
                const chosen = star?.id === entry.id;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: an SVG star cannot be a button; the list beside the map offers the same stars to the keyboard.
                  <g
                    key={entry.id}
                    class="map-star"
                    role="button"
                    tabIndex={-1}
                    onClick={() => selectStar(entry)}
                    onDblClick={() => openSystem(entry, false)}
                  >
                    <circle cx={x} cy={y} r={12} fill="transparent" />
                    <circle cx={x} cy={y} r={size} fill={rgb(entry.color)} />
                    {chosen && <circle cx={x} cy={y} r={size + 6} class="map-ring" />}
                    {(chosen || zoom > 30 || (zoom > 12 && entry.luminositySolar > LABEL_LUMINOSITY)) && (
                      <text x={x + size + 8} y={y + 4}>
                        {entry.name}
                      </text>
                    )}
                  </g>
                );
              })}
            {system && star && (
              <>
                {system.planets.map((planet) => (
                  <circle
                    key={`orbit-${planet.id}`}
                    cx={VIEW / 2}
                    cy={VIEW / 2}
                    r={chartRadius(planet.orbitRadius, inner, outer)}
                    class={
                      body?.id === planet.id || body?.parentId === planet.id
                        ? 'map-orbit selected'
                        : 'map-orbit'
                    }
                  />
                ))}
                <circle cx={VIEW / 2} cy={VIEW / 2} r={14} fill={rgb(star.color)} class="map-sun" />
                <text x={VIEW / 2 + 22} y={VIEW / 2 + 5} class="map-sun-label">
                  {star.name}
                </text>
                {system.planets.map((planet) => {
                  const [x, y] = planetPoint(planet);
                  const chosen = body?.id === planet.id;
                  const giant = planet.kind === 'gasGiant' || planet.kind === 'iceGiant';
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: an SVG planet cannot be a button; the list beside the map offers the same worlds to the keyboard.
                    <g
                      key={planet.id}
                      class="map-planet"
                      role="button"
                      tabIndex={-1}
                      onClick={() => setBody(planet)}
                    >
                      <circle cx={x} cy={y} r={16} fill="transparent" />
                      <circle cx={x} cy={y} r={giant ? 9 : 6} fill={KIND_COLORS[planet.kind]} />
                      {chosen && <circle cx={x} cy={y} r={(giant ? 9 : 6) + 5} class="map-ring" />}
                      <text x={x + 14} y={y + 4} class={chosen ? 'selected' : ''}>
                        {planet.name}
                      </text>
                      {(chosen || body?.parentId === planet.id) &&
                        planet.moons.map((moon, index) => {
                          const angle = moon.orbitPhase;
                          const reach = 24 + index * 9;
                          const mx = x + Math.cos(angle) * reach;
                          const my = y + Math.sin(angle) * reach;
                          return (
                            <circle
                              key={moon.id}
                              cx={mx}
                              cy={my}
                              r={body?.id === moon.id ? 4.5 : 3}
                              fill={KIND_COLORS[moon.kind]}
                              class={body?.id === moon.id ? 'map-moon selected' : 'map-moon'}
                            />
                          );
                        })}
                    </g>
                  );
                })}
              </>
            )}
          </svg>
          <p class="map-caption">{system ? t.systemHint : t.galaxyHint}</p>
          <div class="map-tools">
            {!system && (
              <>
                <button
                  type="button"
                  class="button small"
                  aria-label={t.zoomIn}
                  onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.4))}
                >
                  +
                </button>
                <button
                  type="button"
                  class="button small"
                  aria-label={t.zoomOut}
                  onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.4))}
                >
                  −
                </button>
              </>
            )}
            {system && (
              <button type="button" class="button small" onClick={toGalaxy}>
                {t.backToGalaxy}
              </button>
            )}
          </div>
        </div>

        <aside class="map-info" aria-live="polite">
          {!star && <p class="hint">{t.pickStar}</p>}
          {star && !body && (
            <>
              <span class="chip">
                {t.starClass} {star.spectralType}
              </span>
              <h1>{star.name}</h1>
              <dl class="map-facts">
                <div>
                  <dt>{t.temperature}</dt>
                  <dd>{num(star.temperatureK, 0)} K</dd>
                </div>
                <div>
                  <dt>{t.luminosity}</dt>
                  <dd>
                    {figure(star.luminositySolar)} × {t.sun}
                  </dd>
                </div>
                <div>
                  <dt>{t.mass}</dt>
                  <dd>
                    {figure(star.massSolar)} × {t.sun}
                  </dd>
                </div>
                <div>
                  <dt>{t.age}</dt>
                  <dd>
                    {figure(star.ageGyr)} {t.gyr}
                  </dd>
                </div>
              </dl>
              {system ? (
                <p class="hint">
                  {bodies.length} {t.worlds}. {t.pickWorld}
                </p>
              ) : (
                <button type="button" class="button primary" onClick={() => openSystem(star, false)}>
                  {t.openSystem}
                </button>
              )}
            </>
          )}
          {body && system && (
            <>
              <span class="chip">{t.kinds[body.kind]}</span>
              <h1>{body.name}</h1>
              <p class="map-verdict" data-ok={landable || catalogId ? 'true' : 'false'}>
                {catalogId ? t.catalogMission : landable ? t.landable : t.notLandable}
              </p>
              <dl class="map-facts">
                <div>
                  <dt>{t.gravity}</dt>
                  <dd>{figure((body.gravity / EARTH_GRAVITY) * 100)} %</dd>
                  <dd class="dim">{t.gravityMeans}</dd>
                </div>
                <div>
                  <dt>{t.sunlight}</dt>
                  <dd>{figure(sunlight * 100)} %</dd>
                  <dd class="dim">{t.sunlightMeans}</dd>
                </div>
                <div>
                  <dt>{t.day}</dt>
                  <dd>{figure(body.dayLengthHours)} h</dd>
                  <dd class="dim">{t.dayMeans}</dd>
                </div>
                <div>
                  <dt>{t.air}</dt>
                  <dd>{body.atmosphere ? `${figure(body.atmosphere.surfacePressureBar)} bar` : t.noAir}</dd>
                  <dd class="dim">{t.airMeans}</dd>
                </div>
                <div>
                  <dt>{t.surface}</dt>
                  <dd>{(body.temperatureK - 273.15).toFixed(0)} °C</dd>
                  <dd class="dim">{t.surfaceMeans}</dd>
                </div>
                <div>
                  <dt>{t.radius}</dt>
                  <dd>{num(body.radius / 1000, 0)} km</dd>
                </div>
              </dl>
              {catalogId && (
                <button type="button" class="button primary" onClick={() => onPlan(catalogId)}>
                  {t.plan}
                </button>
              )}
              {worldId && (
                <>
                  <button type="button" class="button primary" onClick={() => onPlan(worldId)}>
                    {t.plan}
                  </button>
                  <button type="button" class="button" disabled={!onFly} onClick={() => onFly?.(worldId)}>
                    {onFly ? t.fly : t.flyNeedsWebgpu}
                  </button>
                </>
              )}
            </>
          )}
        </aside>
      </div>

      <div class="actions">
        <button type="button" class="button" onClick={onBack}>
          {TEXT.nav.back}
        </button>
      </div>
    </section>
  );
}

interface BodyRowsProps {
  bodies: readonly BodyDesc[];
  selected: BodyDesc | null;
  onSelect: (body: BodyDesc) => void;
}

/** The planets of the open system and their moons, as rows under the star. */
function BodyRows({ bodies, selected, onSelect }: BodyRowsProps) {
  return (
    <ul class="tree-children">
      {bodies.map((planet) => (
        <li key={planet.id}>
          <button
            type="button"
            class={selected?.id === planet.id ? 'tree-row selected' : 'tree-row'}
            onClick={() => onSelect(planet)}
          >
            <span class="tree-dot" style={{ background: KIND_COLORS[planet.kind] }} />
            <span class="tree-name">{planet.name}</span>
            <span class="tree-note">{TEXT.map.kindsShort[planet.kind]}</span>
          </button>
          {planet.moons.length > 0 && (
            <ul class="tree-children">
              {planet.moons.map((moon) => (
                <li key={moon.id}>
                  <button
                    type="button"
                    class={selected?.id === moon.id ? 'tree-row selected' : 'tree-row'}
                    onClick={() => onSelect(moon)}
                  >
                    <span class="tree-dot" style={{ background: KIND_COLORS[moon.kind] }} />
                    <span class="tree-name">{moon.name}</span>
                    <span class="tree-note">{TEXT.map.kindsShort[moon.kind]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
