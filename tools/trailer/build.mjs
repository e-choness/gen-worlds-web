// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Turns plan.mjs into an ffmpeg job: the picture as a list of recorded frames, the cards laid over
// it with fades, the dips to black, and the mix of the song, its band and the sound effects. Writes
// .cache/trailer/frames.ffconcat, filter.txt and args.txt; encode.sh runs ffmpeg with them.
// Runs in a node container:  node tools/trailer/build.mjs
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { AUDIO_FILES, CARDS, FPS, MIX, SHOTS, TOTAL } from './plan.mjs';

const root = '.cache/trailer';
/** TRAILER_DRAFT=1: a quick, lower-quality encode to check the edit. */
const draft = process.env.TRAILER_DRAFT === '1';
mkdirSync(`${root}/out`, { recursive: true });
const frameCount = Math.round(TOTAL * FPS);

// --- Picture: every output frame names the recorded frame it shows. ----------------------------
// Recorded frame numbers per clip, ascending. A test recording keeps only every n-th frame, so a
// wanted frame falls back to the nearest one recorded at or before it.
const available = new Map();
const framesOf = (clip) => {
  if (!available.has(clip)) {
    const dir = `${root}/clips/${clip}`;
    const numbers = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.jpg'))
          .map((f) => Number.parseInt(f, 10))
          .sort((a, b) => a - b)
      : [];
    available.set(clip, numbers);
  }
  return available.get(clip);
};
const nearestFrame = (numbers, wanted) => {
  let pick = numbers[0];
  for (const number of numbers) {
    if (number > wanted) break;
    pick = number;
  }
  return pick;
};
const lines = ['ffconcat version 1.0'];
const missing = new Map();
let shotIndex = 0;
let shotStart = 0;
let previous = null;
let run = 0;
const flush = () => {
  if (!previous) return;
  lines.push(`file '${previous}'`, `duration ${(run / FPS).toFixed(6)}`);
};
for (let n = 0; n < frameCount; n++) {
  const t = n / FPS;
  while (t >= SHOTS[shotIndex].until - 1e-9) {
    shotStart = SHOTS[shotIndex].until;
    shotIndex++;
  }
  const shot = SHOTS[shotIndex];
  let file = 'black.jpg';
  if (shot.clip !== 'black') {
    const have = framesOf(shot.clip);
    const wanted = Math.round((shot.in + (t - shotStart)) * FPS);
    if (have.length === 0) missing.set(shot.clip, (missing.get(shot.clip) ?? 0) + 1);
    else file = `clips/${shot.clip}/${String(nearestFrame(have, wanted)).padStart(5, '0')}.jpg`;
  }
  if (file === previous) run++;
  else {
    flush();
    previous = file;
    run = 1;
  }
}
flush();
// The concat demuxer needs the last file repeated to honour the last duration.
lines.push(`file '${previous}'`);
writeFileSync(`${root}/frames.ffconcat`, `${lines.join('\n')}\n`);
for (const [clip, count] of missing) console.log(`missing clip ${clip}: ${count} frames shown black`);

// --- Inputs ---------------------------------------------------------------------------------------
const args = ['-y', '-hide_banner', '-loglevel', 'warning', '-stats'];
let inputs = 0;
const input = (...spec) => {
  args.push(...spec);
  return inputs++;
};
input('-f', 'concat', '-safe', '0', '-i', `${root}/frames.ffconcat`);

const graph = [];
graph.push(`[0:v]fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p,vignette=angle=0.42[v0]`);
let video = 'v0';
let label = 0;
const over = (source, extra = '') => {
  const out = `v${++label}`;
  graph.push(`[${video}][${source}]overlay=eof_action=pass:format=auto${extra}[${out}]`);
  video = out;
};

// Dips to black: a black layer that rises to opaque at the cut and clears after it.
const dip = (at, rise, fall) => {
  const name = `dip${label}`;
  const length = rise + fall;
  graph.push(
    `color=black:s=1920x1080:r=${FPS}:d=${length.toFixed(3)},format=rgba,` +
      (rise > 0 ? `fade=t=in:st=0:d=${rise.toFixed(3)}:alpha=1,` : '') +
      (fall > 0 ? `fade=t=out:st=${rise.toFixed(3)}:d=${fall.toFixed(3)}:alpha=1,` : '') +
      `setpts=PTS+${(at - rise).toFixed(3)}/TB[${name}]`,
  );
  over(name);
};
let start = 0;
for (const shot of SHOTS) {
  if (shot.fade) dip(start, start === 0 ? 0 : shot.fade / 2, start === 0 ? shot.fade : shot.fade / 2);
  start = shot.until;
}

// Cards: each a still with fades; feature captions also slide in a little.
for (const card of CARDS) {
  const length = card.until - card.at;
  const index = input(
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    length.toFixed(3),
    '-i',
    `${root}/cards/${card.id}.png`,
  );
  const fadeIn = card.kind === 'title' || card.kind === 'end' ? 0.9 : 0.35;
  const fadeOut = card.kind === 'end' ? 0 : card.kind === 'title' ? 0.7 : 0.4;
  const name = `card${index}`;
  graph.push(
    `[${index}:v]format=rgba,fade=t=in:st=0:d=${fadeIn}:alpha=1` +
      (fadeOut ? `,fade=t=out:st=${(length - fadeOut).toFixed(3)}:d=${fadeOut}:alpha=1` : '') +
      `,setpts=PTS+${card.at.toFixed(3)}/TB[${name}]`,
  );
  const slide =
    card.kind === 'feature' || card.kind === 'place'
      ? `:x='-36*pow(1-min(1,max(0,(t-${card.at.toFixed(3)})/0.7)),3)'`
      : '';
  over(name, slide);
}
// The last second fades to black.
dip(TOTAL - 1.4, 1.4, 0);
graph.push(`[${video}]format=yuv420p[vout]`);

// --- Sound ----------------------------------------------------------------------------------------
const mixed = [];
for (const clip of MIX) {
  const index = input('-i', `${root}/audio/${AUDIO_FILES[clip.file]}.wav`);
  const length = clip.to - clip.from;
  const name = `a${index}`;
  graph.push(
    `[${index}:a]atrim=start=${clip.from.toFixed(3)}:end=${clip.to.toFixed(3)},asetpts=PTS-STARTPTS,` +
      'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,' +
      (clip.fadeIn ? `afade=t=in:st=0:d=${clip.fadeIn},` : '') +
      (clip.fadeOut ? `afade=t=out:st=${(length - clip.fadeOut).toFixed(3)}:d=${clip.fadeOut},` : '') +
      `volume=${clip.gain},adelay=${Math.round(clip.at * 1000)}:all=1[${name}]`,
  );
  mixed.push(`[${name}]`);
}
graph.push(
  `${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:dropout_transition=0,` +
    `alimiter=limit=0.89:level=false,loudnorm=I=-14:TP=-1.5:LRA=11,` +
    `afade=t=out:st=${(TOTAL - 1.4).toFixed(2)}:d=1.4,atrim=0:${TOTAL},aresample=48000[aout]`,
);

writeFileSync(`${root}/filter.txt`, `${graph.join(';\n')}\n`);
args.push(
  '-/filter_complex',
  `${root}/filter.txt`,
  '-map',
  '[vout]',
  '-map',
  '[aout]',
  '-t',
  String(TOTAL),
  '-r',
  String(FPS),
  '-c:v',
  'libx264',
  '-preset',
  draft ? 'veryfast' : 'slow',
  '-crf',
  draft ? '24' : '17',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '320k',
  '-movflags',
  '+faststart',
  `${root}/out/gen-worlds-trailer${draft ? '-draft' : ''}.mp4`,
);
writeFileSync(`${root}/args.txt`, `${args.join('\n')}\n`);
console.log(`${inputs} inputs, ${graph.length} filter chains, ${lines.length} frame lines`);
