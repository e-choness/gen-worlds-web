// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * What the hangar's 3D vehicle is built from: plain numbers and switches derived from the design,
 * so the model builder knows nothing about parts catalogs and the mission layer nothing about meshes.
 */
export type VehicleKind = 'rover' | 'lander' | 'satellite';

export type PowerLayout =
  | 'none'
  /** Cells on the top deck. */
  | 'deck'
  /** Upright panels on three sides (low Sun). */
  | 'sides'
  /** A panel on a tall mast that turns to the Sun. */
  | 'mast'
  /** Cells on a satellite's body. */
  | 'skin'
  /** Two fixed wings. */
  | 'wings'
  /** Two wings on rotating booms. */
  | 'tracking_wings'
  /** Radioisotope generator on a boom. */
  | 'rtg';

export type AntennaKind = 'none' | 'whip' | 'patch' | 'dish' | 'helix';

export interface VehicleSpec {
  kind: VehicleKind;
  /** Body width, height and depth, m. */
  body: readonly [number, number, number];
  /** Gold foil for heavily insulated vehicles, white paint otherwise. */
  foil: boolean;
  power: PowerLayout;
  /** Total solar array area, m² (0 without solar cells). */
  solarAreaM2: number;
  /** 0, 4 or 6. */
  wheels: number;
  wheelRadiusM: number;
  /** Landing legs (a lander that does not drive). */
  legs: boolean;
  /** Radius of the propellant tank, m (0 without propulsion). */
  tankRadiusM: number;
  /** A descent or orbit engine nozzle under the body. */
  engine: boolean;
  antenna: AntennaKind;
  antennaDiameterM: number;
  /** A camera head on a mast. */
  mastCamera: boolean;
  /** Length of the drill string, m (0 without a drill). */
  drillM: number;
  /** A telescope looking down (Earth imagers). */
  telescope: boolean;
  /** Small instrument boxes on the deck. */
  instrumentBoxes: number;
}
