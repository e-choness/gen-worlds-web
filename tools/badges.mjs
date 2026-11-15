// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Writes the README's live badges as shields.io endpoint files into dist/badges/, so they are
// published with the site and always describe what is deployed. Run by the deploy workflow after
// the tests (JSON report in .cache/vitest.json) and the build:
//   node tools/badges.mjs
// Each badge then reads https://img.shields.io/endpoint?url=https://gen-worlds.surf/badges/<name>.json
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const OUT = 'dist/badges';
const COLOUR = { accent: '6fd3ff', ok: '3fb950', warn: 'd29922', fail: 'f85149', dim: '57606a' };
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

const badges = {};
const badge = (name, label, message, color) => {
  badges[name] = { schemaVersion: 1, label, message: String(message), color, cacheSeconds: 3600 };
};

// Tests, from the run that gated this deploy.
const report = existsSync('.cache/vitest.json') ? json('.cache/vitest.json') : null;
if (report) {
  const passed = report.numPassedTests;
  const total = report.numTotalTests;
  badge(
    'tests',
    'tests',
    passed === total ? `${passed} passing` : `${passed}/${total} passing`,
    passed === total ? COLOUR.ok : COLOUR.fail,
  );
} else badge('tests', 'tests', 'not run', COLOUR.dim);

// Game content, counted from the data files.
const scenarios = readdirSync('src/data').filter((name) => /^scenario_.*\.json$/.test(name));
badge('missions', 'missions', `${scenarios.length} + every world in the galaxy`, COLOUR.accent);
badge('parts', 'spacecraft parts', json('src/data/parts_catalog.json').parts.length, COLOUR.accent);
badge('launchers', 'launch vehicles', json('src/data/launch_vehicles.json').vehicles.length, COLOUR.accent);
badge('events', 'random events', json('src/data/events_catalog.json').events.length, COLOUR.accent);

// What a first visit downloads before the title screen: the entry script, gzipped.
const html = readFileSync('dist/index.html', 'utf8');
const entry = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
if (entry) {
  const file = `dist/${entry.replace(/^.*?assets\//, 'assets/')}`;
  const kb = gzipSync(readFileSync(file)).length / 1024;
  badge(
    'bundle',
    'first load (gzip)',
    `${kb.toFixed(0)} kB`,
    kb < 200 ? COLOUR.ok : kb < 400 ? COLOUR.warn : COLOUR.fail,
  );
}

badge('deployed', 'deployed', new Date().toISOString().slice(0, 10), COLOUR.accent);

mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(badges))
  writeFileSync(`${OUT}/${name}.json`, `${JSON.stringify(body)}\n`);
console.log(
  Object.entries(badges)
    .map(([name, body]) => `${name}: ${body.message}`)
    .join('\n'),
);
