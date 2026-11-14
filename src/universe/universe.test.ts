// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Guards the one property everything else depends on: the universe is a pure function of its
 * seeds. If these fail, revisiting a place would show a different place.
 */
import { describe, expect, it } from 'vitest';
import { Galaxy } from './galaxy';
import { generateSystem } from './system';
import { TerrainField } from './terrain-field';

describe('procedural universe', () => {
  it('generates identical sectors and systems on repeated calls', () => {
    const a = new Galaxy().sectorStars(2180, 1, 20);
    const b = new Galaxy().sectorStars(2180, 1, 20);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(generateSystem(b[0])).toEqual(generateSystem(a[0]));
  });

  it('places more stars in the disk than far above it', () => {
    const galaxy = new Galaxy();
    expect(galaxy.density(26000, 0, 0)).toBeGreaterThan(galaxy.density(26000, 6000, 0) * 50);
  });

  it('keeps the large-scale terrain shape when detail octaves are added', () => {
    const star = new Galaxy().sectorStars(2180, 1, 20)[0];
    const body = generateSystem(star).planets.find((p) => p.bands === null);
    if (!body) return;
    const field = new TerrainField(body.terrain, body.radius);
    const coarse = field.height(0.3, 0.8, 0.52, 20000);
    const fine = field.height(0.3, 0.8, 0.52, 2);
    // Octaves below 20 km wavelength can only move the surface by a bounded amount.
    expect(Math.abs(fine - coarse)).toBeLessThan(
      body.terrain.mountainHeight * 0.5 + body.terrain.hillHeight + 400,
    );
  });
});
