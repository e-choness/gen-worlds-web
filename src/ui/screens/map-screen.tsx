// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The galaxy map: a 3D chart of the stars near a centre that you turn, zoom and click through; open
 * a star to see its planets and moons moving on their orbits, pick a world, and plan a mission to
 * it. Built from the same generator the flight view uses, so every world on it is the world you
 * would fly to, and drawn without WebGPU so the mission screens can show it anywhere. The map only
 * reads the galaxy; choosing a mission or a destination goes through the callbacks.
 */
import { useCallback, useMemo, useState } from 'preact/hooks';
import { jdFromUnixMs } from '@/astro/time';
import { encodeWorld } from '@/data/world';
import { num } from '@/mission/format';
import { artUrl } from '@/ui/art';
import { type MapPoint, type MapRing, type MapScene, SpaceMap3d } from '@/ui/charts/space-map-3d';
import { prefersReducedMotion } from '@/ui/dom';
import { TEXT } from '@/ui/text';
import { AU, SECTOR_SIZE_LY } from '@/universe/constants';
import { Galaxy } from '@/universe/galaxy';
import { createSolarSystem, solarBodyId, solarBodyPosition } from '@/universe/solar-system';
import { generateSystem } from '@/universe/system';
import type { BodyDesc, StarDesc, SystemDesc, Vec3Tuple } from '@/universe/types';
import { HOME_SECTOR, isLandable, worldParamsOf } from '@/universe/world-params';

/** Shown only if a world's portrait cannot be drawn. */
const WORLD_STOCK_ART = 'art/stage_moon.jpg';

export interface MapScreenProps {
  /** Scenario ids of the catalog missions, by the solar-system body they fly to. */
  catalogMissions: Readonly<Record<string, string>>;
  onPlan: (scenarioId: string) => void;
  /** Opens the 3D view at a generated world; null where it cannot run. */
  onFly: ((worldId: string) => void) | null;
  onBack: () => void;
  /** Where the map opens: the star (and system) the player is at. Defaults to the home neighbourhood. */
  initial?: { star: StarDesc; real: boolean };
  /** Label of the travel button, where the caller travels without leaving the page. */
  flyLabel?: string;
}

const EARTH_GRAVITY = 9.81;
/** Stars within this distance of the centre are on the chart, light-years. */
const GALAXY_REACH_LY = 34;
/** Size of a system on its chart, in chart units. */
const SYSTEM_REACH = 100;
/** Stars in the list beside the map. */
const LIST_LIMIT = 40;
/** Stars at least this bright (in Suns) are named on the chart before the others. */
const LABEL_LUMINOSITY = 20;
/** Angular speed of the innermost planet on the system chart, radians per second. */
const INNER_ORBIT_SPEED = 0.3;
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
  if (outer <= inner) return SYSTEM_REACH * 0.5;
  const share = Math.log(orbit / inner) / Math.log(outer / inner);
  return SYSTEM_REACH * (0.22 + 0.78 * share);
}

/** A point on a circle of `radius` tilted by `tilt` about the line at angle `node`, at `angle` along it. */
function onRing(radius: number, tilt: number, node: number, angle: number): Vec3Tuple {
  const along = Math.cos(angle) * radius;
  const across = Math.sin(angle) * radius;
  return [
    along * Math.cos(node) - across * Math.cos(tilt) * Math.sin(node),
    across * Math.sin(tilt),
    along * Math.sin(node) + across * Math.cos(tilt) * Math.cos(node),
  ];
}

export function MapScreen({ catalogMissions, onPlan, onFly, onBack, initial, flyLabel }: MapScreenProps) {
  const t = TEXT.map;
  const galaxy = useMemo(() => new Galaxy(), []);
  const sol = useMemo(() => createSolarSystem(), []);
  const startSystem = useMemo(
    () => (initial ? (initial.real ? sol : generateSystem(initial.star)) : null),
    [initial, sol],
  );
  // Centre of the galaxy chart, light-years.
  const [centre, setCentre] = useState<Vec3Tuple>(() =>
    initial && !initial.real
      ? [initial.star.positionLy[0], initial.star.positionLy[1], initial.star.positionLy[2]]
      : [
          (HOME_SECTOR[0] + 0.5) * SECTOR_SIZE_LY,
          (HOME_SECTOR[1] + 0.5) * SECTOR_SIZE_LY,
          (HOME_SECTOR[2] + 0.5) * SECTOR_SIZE_LY,
        ],
  );
  const [star, setStar] = useState<StarDesc | null>(initial?.star ?? null);
  const [system, setSystem] = useState<SystemDesc | null>(startSystem);
  const [body, setBody] = useState<BodyDesc | null>(null);
  const [query, setQuery] = useState('');

  // Every star within reach of the centre.
  const stars = useMemo(() => {
    const reach = Math.ceil(GALAXY_REACH_LY / SECTOR_SIZE_LY);
    const sector = centre.map((value) => Math.floor(value / SECTOR_SIZE_LY));
    const found: StarDesc[] = [];
    for (let x = -reach; x <= reach; x++) {
      for (let z = -reach; z <= reach; z++) {
        for (let y = -1; y <= 1; y++) {
          for (const entry of galaxy.sectorStars(sector[0] + x, sector[1] + y, sector[2] + z)) {
            const p = entry.positionLy;
            if (Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) <= GALAXY_REACH_LY) {
              found.push(entry);
            }
          }
        }
      }
    }
    return found;
  }, [galaxy, centre]);

  const listed = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const distance = (entry: StarDesc): number =>
      Math.hypot(
        entry.positionLy[0] - centre[0],
        entry.positionLy[1] - centre[1],
        entry.positionLy[2] - centre[2],
      );
    return stars
      .filter((entry) => !wanted || entry.name.toLowerCase().includes(wanted))
      .sort((first, second) => distance(first) - distance(second))
      .slice(0, LIST_LIMIT);
  }, [stars, query, centre]);

  const centreOn = (next: StarDesc): void => {
    setCentre([next.positionLy[0], next.positionLy[1], next.positionLy[2]]);
  };
  const openSystem = (next: StarDesc, real: boolean): void => {
    setStar(next);
    setSystem(real ? sol : generateSystem(next));
    setBody(null);
    if (!real) centreOn(next);
  };
  const toGalaxy = (): void => {
    setSystem(null);
    setBody(null);
  };
  const selectStar = (next: StarDesc): void => {
    setStar(next);
    setBody(null);
    setSystem(null);
    centreOn(next);
  };

  const bodies = system ? system.planets.flatMap((planet) => [planet, ...planet.moons]) : [];

  // ---- the two scenes
  const galaxyScene = useCallback((): MapScene => {
    const points: MapPoint[] = stars.map((entry) => ({
      id: entry.id,
      x: entry.positionLy[0] - centre[0],
      y: entry.positionLy[1] - centre[1],
      z: entry.positionLy[2] - centre[2],
      color: rgb(entry.color),
      radius: 0,
      glow: 1.5 + Math.log10(1 + entry.luminositySolar * 20) * 1.9,
      label: entry.name,
      important: entry.luminositySolar > LABEL_LUMINOSITY,
      stem: true,
    }));
    return { points, rings: [], gridStep: 5, gridLabel: TEXT.map.gridLabel };
  }, [stars, centre]);

  const systemScene = useCallback(
    (time: number): MapScene => {
      if (!system || !star) return { points: [], rings: [], gridStep: 0, gridLabel: '' };
      const orbits = system.planets.map((planet) => planet.orbitRadius);
      const inner = Math.min(...orbits);
      const outer = Math.max(...orbits);
      const innerRadius = chartRadius(inner, inner, outer);
      const jd = jdFromUnixMs(Date.now());
      const scratch: Vec3Tuple = [0, 0, 0];
      const points: MapPoint[] = [
        {
          id: star.id,
          x: 0,
          y: 0,
          z: 0,
          color: rgb(star.color),
          radius: 0,
          glow: 15,
          label: star.name,
          important: true,
          stem: false,
        },
      ];
      const rings: MapRing[] = [];
      for (const planet of system.planets) {
        const radius = chartRadius(planet.orbitRadius, inner, outer);
        const tilt = Math.min(0.5, Math.abs(planet.orbitInclination));
        const node = (planet.seed % 6283) / 1000;
        // The real planets start where the ephemeris has them today.
        const realId = system.real ? solarBodyId(planet) : null;
        const phase =
          realId && solarBodyPosition(realId, jd, scratch)
            ? Math.atan2(scratch[2], scratch[0]) - node
            : planet.orbitPhase;
        const angle = phase + time * INNER_ORBIT_SPEED * (innerRadius / radius) ** 1.5;
        const at = onRing(radius, tilt, node, angle);
        const giant = planet.kind === 'gasGiant' || planet.kind === 'iceGiant';
        const open = body?.id === planet.id || body?.parentId === planet.id;
        rings.push({ x: 0, y: 0, z: 0, radius, tilt, node, selected: open });
        points.push({
          id: planet.id,
          x: at[0],
          y: at[1],
          z: at[2],
          color: KIND_COLORS[planet.kind],
          radius: giant ? 6.5 : 3.6,
          glow: 0,
          label: planet.name,
          important: true,
          stem: false,
        });
        if (!open) continue;
        for (const [index, moon] of planet.moons.entries()) {
          const reach = (giant ? 12 : 8.5) + index * 4;
          const moonNode = (moon.seed % 6283) / 1000;
          const moonAt = onRing(reach, 0.25, moonNode, moon.orbitPhase + time * (0.9 / (1 + index * 0.5)));
          rings.push({
            x: at[0],
            y: at[1],
            z: at[2],
            radius: reach,
            tilt: 0.25,
            node: moonNode,
            selected: body?.id === moon.id,
          });
          points.push({
            id: moon.id,
            x: at[0] + moonAt[0],
            y: at[1] + moonAt[1],
            z: at[2] + moonAt[2],
            color: KIND_COLORS[moon.kind],
            radius: 1.6,
            glow: 0,
            label: moon.name,
            important: body?.id === moon.id,
            stem: false,
          });
        }
      }
      return { points, rings, gridStep: 0, gridLabel: '' };
    },
    [system, star, body],
  );

  const pickOnChart = (id: string): void => {
    if (!system) {
      const next = stars.find((entry) => entry.id === id);
      if (next) selectStar(next);
      return;
    }
    setBody(bodies.find((entry) => entry.id === id) ?? null);
  };
  const openOnChart = (id: string): void => {
    if (system) return;
    const next = stars.find((entry) => entry.id === id);
    if (next) openSystem(next, false);
  };

  // What the selected body offers: a catalog mission, a generated one, or nothing.
  const catalogId = body && system?.real ? catalogMissions[solarBodyId(body) ?? ''] : undefined;
  const landable = body !== null && isLandable(body);
  const worldId =
    body && system && !system.real && landable ? encodeWorld(worldParamsOf(system, body)) : null;
  const parent = body && system ? system.planets.find((planet) => planet.id === body.parentId) : undefined;
  const sunlight =
    body && system ? system.star.luminositySolar / ((parent ?? body).orbitRadius / AU) ** 2 : 0;

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
          <SpaceMap3d
            build={system ? systemScene : galaxyScene}
            version={system ? body?.id : stars}
            resetKey={system ? `system:${star?.id}` : `galaxy:${centre.join(',')}`}
            reach={system ? SYSTEM_REACH : GALAXY_REACH_LY}
            selectedId={system ? (body?.id ?? null) : (star?.id ?? null)}
            animated={system !== null && !prefersReducedMotion()}
            label={system ? `${star?.name}: ${t.systemChart}` : t.galaxyChart}
            onPick={pickOnChart}
            onOpen={openOnChart}
          />
          <p class="map-caption">{system ? t.systemHint : t.galaxyHint}</p>
          {system && (
            <div class="map-tools">
              <button type="button" class="button small" onClick={toGalaxy}>
                {t.backToGalaxy}
              </button>
            </div>
          )}
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
              {/* Decorative: the world drawn from its own terrain and colours. */}
              {worldId && <img class="map-portrait" src={artUrl(WORLD_STOCK_ART, worldId)} alt="" />}
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
                    {onFly ? (flyLabel ?? t.fly) : t.flyNeedsWebgpu}
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
