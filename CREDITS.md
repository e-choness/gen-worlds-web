# Credits

Every dataset, texture, model, library and ported technique used by Gen Worlds, with its source and
licence. The project page's references are generated from this file: add a line the moment
something enters the repo.

## NASA and other open data

| Data | Source | Licence | Used for |
| --- | --- | --- | --- |
| `src/data/ephemeris_planets.json` | NASA JPL Solar System Dynamics, [Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html), Table 1 (E. M. Standish) | Public domain (NASA/JPL) | Planet positions, launch windows, porkchop plots |

## Textures

| Asset | Source | Licence | Used for |
| --- | --- | --- | --- |
| `public/textures/ground_*.jpg` | Poly Haven, [rocky_terrain_02](https://polyhaven.com/a/rocky_terrain_02) | CC0 | Terrain ground layer |
| `public/textures/grass_*.jpg` | Poly Haven, [aerial_grass_rock](https://polyhaven.com/a/aerial_grass_rock) | CC0 | Terrain grass layer |
| `public/textures/sand_*.jpg` | Poly Haven, [sand_01](https://polyhaven.com/a/sand_01) | CC0 | Terrain sand layer |
| `public/textures/rock_*.jpg` | Poly Haven, [rock_face_03](https://polyhaven.com/a/rock_face_03) | CC0 | Terrain rock layer |
| `public/textures/snow_*.jpg` | Poly Haven, [snow_02](https://polyhaven.com/a/snow_02) | CC0 | Terrain snow layer |

## Audio

| Asset | Source | Licence | Used for |
| --- | --- | --- | --- |
| `public/audio/music-*.mp3`, `public/audio/sfx-*.mp3` | Generated for this project with a locally run music and sound-effects model (SongForge) | Project's own | Score and sound effects |

## Libraries

| Library | Licence | Used for |
| --- | --- | --- |
| [three.js](https://threejs.org) | MIT | WebGPU renderer, TSL shading |
| [@dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree) | MIT | Procedural trees |
| [@dgreenheck/three-pinata](https://github.com/dgreenheck/three-pinata) | MIT | Rock fracture when drilling |
| [Preact](https://preactjs.com), [@preact/signals](https://github.com/preactjs/signals) | MIT | 2D screens and the game-state store |
| [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev), [Biome](https://biomejs.dev), [Playwright](https://playwright.dev) | MIT / Apache-2.0 | Build, checks and captures |

## Techniques

| Technique | Source | Licence | Used for |
| --- | --- | --- | --- |
| Lambert solver | D. Izzo, "Revisiting Lambert's problem", Celestial Mechanics and Dynamical Astronomy 121 (2015) | Published algorithm, own implementation | Interplanetary transfers |
| Universal-variable Kepler propagation | D. Vallado, "Fundamentals of Astrodynamics and Applications" | Published algorithm, own implementation | Cruise trajectories |
| Lunar position and libration series | J. Meeus, "Astronomical Algorithms", 2nd ed., chapters 47 and 53 | Published algorithm, own implementation | Moon position, polar lighting and Earth visibility |
| Galaxy density model | [dgreenheck/webgpu-galaxy](https://github.com/dgreenheck/webgpu-galaxy) | MIT | Galaxy backdrop and star distribution |

## AI use

Gen Worlds is built with Claude Code (Anthropic) writing code under the team's direction, and the
audio is AI-generated as noted above. The project page describes this in full.
