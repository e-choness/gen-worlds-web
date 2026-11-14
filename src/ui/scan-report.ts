// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/** Builds the scanner read-out for a target. Pure DOM construction from universe descriptors. */
import type { ScanTarget } from '@/player/scanner';
import type { BiomeDesc } from '@/universe/biome';
import { AU, EARTH_RADIUS, SOLAR_RADIUS } from '@/universe/constants';
import type { BodyDesc, PlanetKind, StarDesc, Vec3Tuple } from '@/universe/types';
import { h } from './dom';
import { formatDistance, formatTemperature } from './format';

const KIND_LABEL: Record<PlanetKind, string> = {
  barren: 'Airless rocky body',
  desert: 'Arid terrestrial',
  terra: 'Temperate terrestrial',
  ocean: 'Ocean world',
  ice: 'Ice world',
  lava: 'Lava world',
  toxic: 'Greenhouse terrestrial',
  gasGiant: 'Gas giant',
  iceGiant: 'Ice giant',
};

const STAR_LABEL: Record<string, string> = {
  O: 'Blue supergiant-class star',
  B: 'Blue-white star',
  A: 'White star',
  F: 'Yellow-white star',
  G: 'Yellow dwarf',
  K: 'Orange dwarf',
  M: 'Red dwarf',
  WD: 'White dwarf',
  NS: 'Neutron star',
  BH: 'Stellar black hole',
};

export function kindLabel(kind: PlanetKind): string {
  return KIND_LABEL[kind];
}

export function cssColor(c: Vec3Tuple, gain = 1): string {
  const f = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v * gain)) ** (1 / 2.2));
  return `rgb(${f(c[0])} ${f(c[1])} ${f(c[2])})`;
}

export function targetTitle(target: ScanTarget): { name: string; subtitle: string } {
  if (target.kind === 'star')
    return {
      name: target.star.name,
      subtitle: `${target.star.spectralType} · ${STAR_LABEL[target.star.class]}`,
    };
  if (target.kind === 'body')
    return { name: target.body.desc.name, subtitle: KIND_LABEL[target.body.desc.kind] };
  return { name: target.body.desc.name, subtitle: `Surface site · ${target.site.terrainType}` };
}

function row(label: string, value: string): HTMLElement {
  return h('div.row', null, h('span.k', null, label), h('span.v', null, value));
}

function section(title: string, ...children: Array<HTMLElement | null>): HTMLElement {
  return h('section.block', null, h('h4', null, title), ...children);
}

function bar(label: string, fraction: number, detail: string, color = 'var(--ui-accent)'): HTMLElement {
  const fill = h('i');
  fill.style.width = `${Math.round(Math.min(1, Math.max(0.02, fraction)) * 100)}%`;
  fill.style.background = color;
  return h('div.bar', null, h('span.k', null, label), h('span.track', null, fill), h('span.v', null, detail));
}

function starReport(star: StarDesc): HTMLElement[] {
  return [
    section(
      'Stellar data',
      row('Class', star.spectralType),
      row('Temperature', `${Math.round(star.temperatureK).toLocaleString('en-US')} K`),
      row('Radius', `${(star.radius / SOLAR_RADIUS).toPrecision(3)} R☉`),
      row('Mass', `${star.massSolar.toPrecision(3)} M☉`),
      row('Luminosity', `${star.luminositySolar.toPrecision(3)} L☉`),
      row('Age', `${star.ageGyr.toFixed(1)} Gyr`),
    ),
    section(
      'Galactic position',
      row('X · Y · Z', `${star.positionLy.map((v) => Math.round(v).toLocaleString('en-US')).join(' · ')} ly`),
    ),
  ];
}

function bodyReport(body: BodyDesc): HTMLElement[] {
  const out: HTMLElement[] = [];
  out.push(
    section(
      'Physical',
      row(
        'Radius',
        `${Math.round(body.radius / 1000).toLocaleString('en-US')} km (${(body.radius / EARTH_RADIUS).toFixed(2)} R⊕)`,
      ),
      row('Mass', `${body.massEarths.toPrecision(3)} M⊕`),
      row('Gravity', `${(body.gravity / 9.80665).toFixed(2)} g`),
      row('Mean temperature', formatTemperature(body.temperatureK)),
      row('Day length', `${body.dayLengthHours.toFixed(1)} h`),
      row('Axial tilt', `${((body.axialTilt * 180) / Math.PI).toFixed(1)}°`),
    ),
  );
  out.push(
    section(
      'Orbit',
      row(
        body.parentId ? 'Distance from planet' : 'Semi-major axis',
        body.parentId ? formatDistance(body.orbitRadius) : `${(body.orbitRadius / AU).toFixed(3)} AU`,
      ),
      row(
        'Period',
        body.orbitalPeriodDays > 800
          ? `${(body.orbitalPeriodDays / 365.25).toFixed(1)} yr`
          : `${body.orbitalPeriodDays.toFixed(1)} d`,
      ),
      body.moons.length ? row('Moons', String(body.moons.length)) : null,
      body.rings
        ? row(
            'Rings',
            `${Math.round(body.rings.innerRadius / 1000).toLocaleString('en-US')}–${Math.round(body.rings.outerRadius / 1000).toLocaleString('en-US')} km`,
          )
        : null,
    ),
  );
  if (body.atmosphere) {
    const a = body.atmosphere;
    out.push(
      section(
        'Atmosphere',
        row(
          'Surface pressure',
          a.surfacePressureBar >= 100 ? 'No solid surface' : `${a.surfacePressureBar.toPrecision(2)} bar`,
        ),
        row('Scale height', formatDistance(a.rayleighScaleHeight)),
        ...a.composition.map((c) =>
          bar(c.gas, c.fraction, `${(c.fraction * 100).toFixed(c.fraction < 0.1 ? 1 : 0)} %`),
        ),
      ),
    );
  } else {
    out.push(section('Atmosphere', row('Status', 'None detected — hard vacuum')));
  }
  if (body.ocean) {
    out.push(
      section(
        'Surface liquid',
        row('Composition', body.ocean.liquid),
        row('Coverage', body.kind === 'ocean' ? 'Global ocean' : 'Seas and basins'),
      ),
    );
  }
  out.push(section('Biosphere', row('Assessment', body.life.description)));
  if (body.bands === null) {
    out.push(
      section(
        'Regions',
        h(
          'div.tags',
          null,
          ...regionsPresent(body).map((b) => {
            const swatch = h('i.swatch');
            swatch.style.background = cssColor(b.color, 2.2);
            return h('span.tag', { title: b.description }, swatch, b.name);
          }),
        ),
      ),
    );
  }
  if (body.resources.length) {
    out.push(
      section(
        'Resources',
        ...body.resources.map((r) => bar(`${r.name}`, r.abundance, r.symbol, 'var(--ui-warn)')),
      ),
    );
  }
  if (body.phenomena.length) {
    out.push(section('Phenomena', h('div.tags', null, ...body.phenomena.map((p) => h('span.tag', null, p)))));
  }
  return out;
}

/** Biomes that actually occur in the body's climate grid, most extensive first. */
function regionsPresent(body: BodyDesc): BiomeDesc[] {
  const counts = new Map<number, number>();
  for (const index of body.biomes.grid) counts.set(index, (counts.get(index) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([index]) => body.biomes.biomes[index]);
}

export function buildReport(target: ScanTarget): HTMLElement[] {
  if (target.kind === 'star') return starReport(target.star);
  if (target.kind === 'body') return bodyReport(target.body.desc);
  const s = target.site;
  return [
    section(
      'Site analysis',
      row('Region', s.region.name),
      h('p.note', null, s.region.description),
      row('Terrain', s.terrainType),
      row(
        'Coordinates',
        `${Math.abs(s.latitude).toFixed(2)}° ${s.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(s.longitude).toFixed(2)}° ${s.longitude >= 0 ? 'E' : 'W'}`,
      ),
      row('Elevation', formatDistance(s.elevation)),
      row('Slope', `${s.slopeDegrees.toFixed(1)}°`),
      row('Ground temperature', formatTemperature(s.temperatureK)),
      row('Soil moisture', `${Math.round(s.moisture * 100)} %`),
    ),
    section(
      'Drill prospect',
      ...(s.minerals.length
        ? s.minerals.map((m) => bar(m.name, m.abundance, m.symbol, 'var(--ui-warn)'))
        : [row('Result', 'No recoverable deposits')]),
    ),
    ...bodyReport(target.body.desc).slice(0, 1),
  ];
}
