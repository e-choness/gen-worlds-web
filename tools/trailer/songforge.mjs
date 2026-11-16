// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Talks to a local SongForge (the AI music studio, run in its own Docker stack) to make the
// trailer's sung narration, its orchestral score and its sound effects, and to fetch the results.
// Runs in a node container on SongForge's network (base http://web:8080):
//   docker run --rm --network songforge_default -v "$PWD:/app" -w /app node:26-slim \
//     node tools/trailer/songforge.mjs <command> ...
//   song   <lyricsFile> <variations> [seed]          sung narration (YuE2 Studio)
//   score  <name> <seconds> <key> <bpm> <style...>   instrumental score (Cinematic)
//   sound  <name> <seconds> <prompt...>              one-shot sound effect (TangoFlux)
//   wait   <id...>                                   waits for songs, then saves them to .cache/trailer/audio
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
} else if (command === 'score') {
  const [name, seconds, key, bpm, ...style] = args;
  const data = await post('/api/generate', {
    mode: 'custom',
    title: `Trailer score ${name}`,
    style: style.join(' '),
    instrumental: true,
    model: 'cinematic',
    duration: Number(seconds),
    ...(key && key !== '-' ? { keyscale: key } : {}),
    ...(bpm && bpm !== '-' ? { bpm: Number(bpm) } : {}),
    variations: 2,
    visual: { cover: false },
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
  // Splits each song into vocals and instrumental (Demucs) and saves <id>.vocals.wav: the lyric
  // alignment hears the singer far better without the band.
  mkdirSync(outDir, { recursive: true });
  for (const songId of args) {
    const job = await post('/api/separations', { song_id: songId, mode: 'vocals' });
    for (;;) {
      const response = await fetch(`${base}/api/separations/${job.id}`);
      const sep = await response.json();
      if (sep.status === 'failed') throw new Error(`separation ${job.id}: ${sep.error}`);
      if (sep.status === 'complete') {
        const stem = await fetch(`${base}/api/separations/${job.id}/download?format=wav&stem=vocals`);
        if (!stem.ok) throw new Error(`stem download: HTTP ${stem.status}`);
        writeFileSync(`${outDir}/${songId}.vocals.wav`, Buffer.from(await stem.arrayBuffer()));
        console.log(`${songId} vocals -> ${outDir}/${songId}.vocals.wav`);
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
  console.log('commands: song | score | sound | wait');
  process.exit(1);
}
