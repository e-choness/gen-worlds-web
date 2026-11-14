/**
 * Measured elevation of a real body as an equirectangular grid, sampled by direction. It is the
 * low-frequency base of the terrain; procedural detail fills in below the data's resolution.
 * Plain data: it is copied into the terrain workers.
 */
export interface HeightmapData {
  width: number;
  height: number;
  /** Row-major, row 0 at the north pole, column 0 at longitude −180°. Units: metres. */
  samples: Int16Array;
  /** Added to every sample, m: moves the data from its reference radius to the body's datum radius. */
  offset: number;
  /**
   * Angle of the body's prime meridian in system space, radians, measured from +X toward −Z about
   * +Y (counter-clockwise seen from the north). The body's north pole is taken as +Y.
   */
  meridian: number;
  /**
   * True when the datum is a sea surface: generated relief then fades out toward it, so measured
   * lowlands stay dry and the sea floor stays under water.
   */
  sea: boolean;
}

const TAU = Math.PI * 2;

/** Body longitude (east positive, radians) and latitude of a system-space direction. */
export function bodyLongitude(map: { meridian: number }, dx: number, dz: number): number {
  return Math.atan2(-dz, dx) - map.meridian;
}

/** Elevation in metres above the body's datum radius for unit direction (dx, dy, dz), bilinear. */
export function sampleHeightmap(map: HeightmapData, dx: number, dy: number, dz: number): number {
  const { width, height, samples } = map;
  let u = bodyLongitude(map, dx, dz) / TAU + 0.5;
  u -= Math.floor(u);
  const v = Math.acos(Math.max(-1, Math.min(1, dy))) / Math.PI;
  // Sample centres sit at half-pixel positions.
  const x = u * width - 0.5;
  const y = Math.max(0, Math.min(height - 1, v * height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = ((x0 % width) + width) % width;
  const xb = (xa + 1) % width;
  const ya = y0;
  const yb = Math.min(height - 1, y0 + 1);
  const top = samples[ya * width + xa] * (1 - fx) + samples[ya * width + xb] * fx;
  const bottom = samples[yb * width + xa] * (1 - fx) + samples[yb * width + xb] * fx;
  return top * (1 - fy) + bottom * fy + map.offset;
}

/** Ground distance covered by one sample at the equator, metres. */
export function heightmapResolution(map: HeightmapData, radius: number): number {
  return (TAU * radius) / map.width;
}
