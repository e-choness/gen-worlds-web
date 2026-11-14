# Credits

Every dataset, texture, model, library and ported technique used by Gen Worlds, with its source and
licence. The project page's references are generated from this file: add a line the moment
something enters the repo.

## NASA and other open data

| Data | Source | Licence | Used for |
| --- | --- | --- | --- |
| `src/data/ephemeris_planets.json` | NASA JPL Solar System Dynamics, [Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html), Table 1 (E. M. Standish) | Public domain (NASA/JPL) | Planet positions, launch windows, porkchop plots |
| `src/data/bodies_solar_system.json` | NASA NSSDCA [Planetary Fact Sheets](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) (Earth, Moon, Mars); JPL SSD astrodynamic parameters; U.S. Standard Atmosphere 1976 | Public domain (NASA) | Gravity, radii, day lengths, drag |
| `src/data/launch_vehicles.json` | NASA Launch Services Program [Launch Vehicle Performance](https://elvperf.ksc.nasa.gov) and vendor payload user guides (Rocket Lab, Firefly, SpaceX, ULA), rounded | Public information | Launch capacity against launch energy and orbit, prices |
| `src/data/parts_catalog.json` | NASA [VIPER](https://science.nasa.gov/mission/viper/) fact sheet and instrument pages, NASA MMRTG fact sheet, NASA [Small Spacecraft Technology State-of-the-Art](https://www.nasa.gov/smallsat-institute/sst-soa/) report; NASA Mars 2020 instrument pages (coring drill, SHERLOC, PIXL, SuperCam, MEDA, Electra-Lite relay radio); generic parts are representative values | Public domain (NASA) | Part masses, power, data rates, readiness levels |
| `src/data/scenario_lunar_ice_prospector.json` | NASA VIPER and Commercial Lunar Payload Services mission pages; NASA Artemis III candidate landing regions; horizon masks and ice quality simplified | Public domain (NASA) | Lunar scenario, landing sites, objectives |
| `src/data/scenario_mars_jezero_survey.json` | NASA [Mars 2020 Perseverance](https://science.nasa.gov/mission/mars-2020-perseverance/) mission pages and launch press kit; NASA Mars Science Laboratory mass breakdown; dust accumulation from Mars Exploration Rover experience; site values simplified | Public domain (NASA) | Mars scenario: entry system, relay links, sites, objectives |
| `src/data/scenario_earth_observation.json` | NASA [Landsat](https://landsat.gsfc.nasa.gov/) and Earth Science Technology Office small-satellite missions; ESA Sentinel-2 and Planet Dove public instrument figures for scale; FCC five-year orbital debris rule (2022) | Public information | Earth-observation scenario: orbits, imaging requirement, disposal rule |
| `src/data/glossary_terms.json` | Written for this game after NASA's public glossaries, the NASA Systems Engineering Handbook (SP-2016-6105) and JPL's Basics of Space Flight | Own work | In-game glossary |
| `src/data/mission_constants.json` | NASA NSSDCA Sun fact sheet (solar constant); NASA GSFC-STD-1000 Gold Rules (margins); NASA Mars Reconnaissance Orbiter telecommunications figures (link reference) | Public domain (NASA) | Power, margins and downlink models |
| `public/maps/moon_albedo_4k.jpg`, `public/maps/moon_height_2880x1440.i16` | NASA Scientific Visualization Studio, [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/): LROC wide-angle colour mosaic and LOLA gridded elevation | Public domain (NASA) | The Moon's real colour and terrain |
| `public/maps/mars_albedo_4k.jpg`, `public/maps/mars_height_2880x1440.i16` | USGS Astrogeology Science Center: [Viking MDIM 2.1 colour mosaic](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m) (NASA Viking Orbiters) and [MGS MOLA elevation mosaic](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m) (NASA Mars Global Surveyor) | Public domain (NASA / USGS) | Mars's real colour and terrain |
| `public/maps/earth_albedo_4k.jpg` | NASA [Blue Marble Next Generation](https://earthobservatory.nasa.gov/features/BlueMarble), cloud-free, served by [NASA GIBS](https://gibs.earthdata.nasa.gov) | Public domain (NASA) | The Earth's real colour |
| `public/maps/earth_height_2880x1440.i16` | NOAA NCEI [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) 60 arc-second global relief, doi:10.25921/fd45-gt74 | Public domain (NOAA) | The Earth's real terrain and sea floor |
| `public/art/*.jpg` | Rendered by this game's engine from the maps above | Own work from public-domain data | Mission card, title, trajectory, flight and debrief pictures |
| `src/data/events_catalog.json` | Event types from real mission experience; probabilities are game balance values | Own work | Random events |

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
| [Firebase JavaScript SDK](https://firebase.google.com/docs/web/setup) (Auth, Firestore) | Apache-2.0 | Online co-op rooms and the global leaderboard (Space Apps Global Offer via Google Cloud) |
| [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev), [Biome](https://biomejs.dev), [Playwright](https://playwright.dev) | MIT / Apache-2.0 | Build, checks and captures |

## Techniques

| Technique | Source | Licence | Used for |
| --- | --- | --- | --- |
| Lambert solver | D. Izzo, "Revisiting Lambert's problem", Celestial Mechanics and Dynamical Astronomy 121 (2015) | Published algorithm, own implementation | Interplanetary transfers |
| Universal-variable Kepler propagation | D. Vallado, "Fundamentals of Astrodynamics and Applications" | Published algorithm, own implementation | Cruise trajectories |
| Galaxy map layout (searchable world list, orbit chart, fact panel) | Echo Yin, [Solar System](https://github.com/e-choness/solar-system-engine), and SpaceEngine's map as a general model | Layout idea only; no code or assets copied | The galaxy map screen |
| Lunar position and libration series | J. Meeus, "Astronomical Algorithms", 2nd ed., chapters 47 and 53 | Published algorithm, own implementation | Moon position, polar lighting and Earth visibility |
| Porkchop plot | Launch energy over a grid of launch and arrival dates from Lambert arcs between JPL ephemeris positions, as in NASA mission design practice | Published method, own implementation | Choosing Mars launch and arrival dates |
| Sun-synchronous orbit, eclipse, ground contact and drag decay | Closed-form relations from J. Wertz, "Space Mission Analysis and Design" and D. Vallado; piecewise-exponential atmosphere (U.S. Standard Atmosphere 1976) | Published relations, own implementation | Earth-orbit trajectory mode |
| Planet sky model | Solar longitude and declination from the JPL elements; Mars equinox at heliocentric longitude 85.06° (Allison & McEwen 2000) | Published relations, own implementation | Day, night, seasons and Earth visibility on Mars |
| Galaxy density model | [dgreenheck/webgpu-galaxy](https://github.com/dgreenheck/webgpu-galaxy) | MIT | Galaxy backdrop and star distribution |

## AI use

Gen Worlds is built with Claude Code (Anthropic) writing code under the team's direction, and the
audio is AI-generated as noted above. The project page describes this in full.
