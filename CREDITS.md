# Credits

Every dataset, texture, model, library and ported technique used by Gen Worlds, with its source and
licence. The project page's references are generated from this file: add a line the moment
something enters the repo.

## NASA and other open data

_None shipped yet. Entries are added with the data files in `src/data/`._

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
| Galaxy density model | [dgreenheck/webgpu-galaxy](https://github.com/dgreenheck/webgpu-galaxy) | MIT | Galaxy backdrop and star distribution |

## AI use

Gen Worlds is built with Claude Code (Anthropic) writing code under the team's direction, and the
audio is AI-generated as noted above. The project page describes this in full.
