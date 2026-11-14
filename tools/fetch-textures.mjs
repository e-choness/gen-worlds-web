// Downloads the CC0 ground textures (Poly Haven) used by the terrain material into public/textures.
// Run in the tools container:  docker compose run --rm tools node tools/fetch-textures.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const LAYERS = {
  ground: 'rocky_terrain_02',
  grass: 'aerial_grass_rock',
  sand: 'sand_01',
  rock: 'rock_face_03',
  snow: 'snow_02',
};
const RESOLUTION = '1k';
const OUT = new URL('../public/textures/', import.meta.url);

await mkdir(OUT, { recursive: true });
const credits = ['# Texture credits', '', 'All textures are CC0 from https://polyhaven.com (1k JPG).', ''];
for (const [layer, asset] of Object.entries(LAYERS)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${asset}`)).json();
  const maps = { albedo: files.Diffuse ?? files.diff, normal: files.nor_gl };
  for (const [kind, map] of Object.entries(maps)) {
    const url = map?.[RESOLUTION]?.jpg?.url;
    if (!url) throw new Error(`${asset}: no ${kind} map at ${RESOLUTION}`);
    const data = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(new URL(`${layer}_${kind}.jpg`, OUT), data);
    console.log(`${layer}_${kind}.jpg  ${(data.length / 1024).toFixed(0)} KB  ← ${asset}`);
  }
  credits.push(`- \`${layer}_*.jpg\` — ${asset} (https://polyhaven.com/a/${asset})`);
}
await writeFile(new URL('CREDITS.md', OUT), `${credits.join('\n')}\n`);
