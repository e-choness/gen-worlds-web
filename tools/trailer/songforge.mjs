// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Talks to a local SongForge (the AI music studio, run in its own Docker stack) to make the
// trailer's sung narration and its sound effects, and to fetch the results. The trailer's only music
// is the narration song: its instrumental passages are the song's own band, split off by `vocals`.
// Runs in a node container on SongForge's network (base http://web:8080):
//   docker run --rm --network songforge_default -v "$PWD:/app" -w /app node:26-slim \
//     node tools/trailer/songforge.mjs <command> ...
//   song   <lyricsFile> <variations> [seed]   sung narration (YuE2 Studio)
//   sound  <name> <seconds> <prompt...>       one-shot sound effect (TangoFlux)
//   wait   <id...>                            waits for songs, then saves them to .cache/trailer/audio
//   vocals <id...>                            splits songs into vocals and band, saves both stems
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.env.SONGFORGE_URL ?? 'http://web:8080';
const outDir = '.cache/trailer/audio';
const [command, ...args] = process.argv.slice(2);

/** The narrator: one style line and voice for every take, so retakes sound like the same singer. */
export const VOICE_STYLE =
  'cinematic pop anthem, epic orchestral, soaring clear female vocal, clear diction, piano, ' +
  'strings, pipe organ, big drums, hopeful, wonder, space, English';

async function post(path, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data;
}

async function getSong(id) {
  const response = await fetch(`${base}/api/songs/${id}`);
  if (!response.ok) throw new Error(`song ${id}: HTTP ${response.status}`);
  return response.json();
}

function printSongs(data) {
  for (const song of data.songs) console.log(song.id);
}

if (command === 'song') {
  const [file, variations = '2', seed] = args;
  const data = await post('/api/generate', {
    mode: 'custom',
    title: 'Design It, Fly It',
    style: VOICE_STYLE,
    vocal_gender: 'female',
    language: 'en',
    lyrics: readFileSync(file, 'utf8'),
    model: 'yue2',
    variations: Number(variations),
    visual: { cover: false },
    ...(seed === undefined ? {} : { seed: Number(seed) }),
  });
  printSongs(data);
} else if (command === 'sound') {
  const [name, seconds, ...prompt] = args;
  const data = await post('/api/sounds', {
    prompt: prompt.join(' '),
    duration: Number(seconds),
    variations: 2,
  });
  console.log(`# ${name}`);
  printSongs(data);
} else if (command === 'vocals') {
  // Splits each song into vocals and instrumental (Demucs), reusing an earlier split of the same
  // song, and saves <id>.vocals.wav and <id>.instrumental.wav. The lyric alignment hears the singer
  // far better without the band; the trailer's instrumental passages are the song's own band.
  mkdirSync(outDir, { recursive: true });
  const listing = await (await fetch(`${base}/api/separations?mode=vocals&limit=100`)).json();
  for (const songId of args) {
    const earlier = listing.items.find((s) => s.source_song_id === songId && s.status !== 'failed');
    const job = earlier ?? (await post('/api/separations', { song_id: songId, mode: 'vocals' }));
    for (;;) {
      const response = await fetch(`${base}/api/separations/${job.id}`);
      const sep = await response.json();
      if (sep.status === 'failed') throw new Error(`separation ${job.id}: ${sep.error}`);
      if (sep.status === 'complete') {
        for (const key of ['vocals', 'instrumental']) {
          const stem = await fetch(`${base}/api/separations/${job.id}/download?format=wav&stem=${key}`);
          if (!stem.ok) throw new Error(`${key} stem download: HTTP ${stem.status}`);
          writeFileSync(`${outDir}/${songId}.${key}.wav`, Buffer.from(await stem.arrayBuffer()));
          console.log(`${songId} ${key} -> ${outDir}/${songId}.${key}.wav`);
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
} else if (command === 'wait') {
  mkdirSync(outDir, { recursive: true });
  const pending = new Set(args);
  const started = Date.now();
  while (pending.size) {
    for (const id of [...pending]) {
      const song = await getSong(id);
      if (song.status === 'failed' || song.status === 'cancelled') {
        console.log(`${id} ${song.status}: ${song.error ?? ''}`);
        pending.delete(id);
      } else if (song.status === 'complete' && song.audio_url) {
        const flac = await fetch(`${base}/api/songs/${id}/download?format=wav`);
        const audio = Buffer.from(await flac.arrayBuffer());
        const file = `${outDir}/${id}.wav`;
        writeFileSync(file, audio);
        writeFileSync(`${outDir}/${id}.json`, JSON.stringify(song, null, 1));
        console.log(
          `${id} ${song.title} ${song.model} ${song.duration}s key=${song.keyscale} bpm=${song.bpm} -> ${file}`,
        );
        pending.delete(id);
      }
    }
    if (pending.size) await new Promise((resolve) => setTimeout(resolve, 5000));
    if (Date.now() - started > 3600_000) throw new Error('gave up after an hour');
  }
} else {
  console.log('commands: song | sound | wait | vocals');
  process.exit(1);
}
