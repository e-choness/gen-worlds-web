// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// The trailer's edit: every shot, caption and sound, placed on a 300-second timeline. The cut points
// follow the sung narration (lyric timings measured by align.py on the chosen take), so the pictures
// change with the words. record.mjs reads the clip lengths from here; build.mjs turns it into ffmpeg.

export const FPS = 30;
export const TOTAL = 300;

/** The audio files, made with SongForge (see songforge.mjs), saved under .cache/trailer/audio. */
export const AUDIO_FILES = {
  song: '93579bd8-41dd-488c-a4e6-596990f46b78', // "Design It, Fly It", YuE2 Studio, B♭ major, 72 BPM
  open: '81f55021-9c58-489d-9669-1b34d437f8a9', // Cinematic: space ambient opening, builds
  launch: 'd45322d5-537f-4186-b216-3c0805bc04ce', // Cinematic: launch sequence, builds
  worlds: '138b5c52-34af-44f1-8386-8cab13fd66ab', // Cinematic: majestic, choir and horns
  boom: '154af667-17f4-4bfe-954b-e5888dc07c35', // TangoFlux: trailer boom
  rocket: '9f7dafc6-7e32-45c5-988d-3a6db3408a31', // TangoFlux: rocket ignition and roar
  whoosh: 'ec840ec7-f5fd-46c3-a430-4e14f1f7b915',
  riser: '67993094-4d98-4ba3-8a79-87e162d7dff0',
  thrusters: 'd3fa944f-d186-4f12-b376-ae267ae8c4b3',
};

/**
 * Where the song is cut. Song seconds, measured on the isolated vocals: 110.64 is the breath before
 * "Lift off", 170.6 the end of the bar after "same luck for everyone", 172.6 two bars before the last
 * chorus. Each song part is placed so the parts and the score between them fill the timeline.
 */
const SONG_A = { from: 0, to: 110.64, at: 30 };
const SONG_B = { from: 110.64, to: 170.6, at: 173.64 };
const SONG_C = { from: 172.6, to: 211.5, at: 261.1 };

/**
 * The picture, shot after shot: each plays `clip` (recorded by record.mjs) from `in` seconds until
 * the trailer reaches `until`. `fade` dips to black over that many seconds at the shot's start.
 */
export const SHOTS = [
  // Cold open (score): deep space, the real Earth, the title.
  { clip: 'space', in: 0, until: 9, fade: 1.6 },
  { clip: 'earth', in: 0, until: 30 },
  // Song intro and first verse: the game, its missions, the worlds they go to.
  { clip: 'title', in: 0, until: 36.5, fade: 0.8 },
  { clip: 'missions', in: 0, until: 46.7 },
  { clip: 'alien', in: 0, until: 49.6 }, // "a world we have never touched"
  { clip: 'th-sat', in: 0.4, until: 53.3 }, // "a satellite above the oceans"
  { clip: 'th-rover', in: 0, until: 56.0 }, // "a rover in the Martian dust"
  { clip: 'moonpole', in: 0, until: 62.8 }, // "ice inside the Moon's dark craters"
  { clip: 'briefing', in: 0, until: 69.3 }, // "pick a world and write the science"
  // First chorus.
  { clip: 'vehicle', in: 0, until: 73.0 },
  { clip: 'th-launch', in: 8.5, until: 76.0 },
  { clip: 'th-arrival', in: 0.6, until: 79.1 },
  { clip: 'mars', in: 0, until: 86.6 }, // "this is Gen Worlds"
  // Second verse: the hangar, the trajectory, the poll.
  { clip: 'hangar-systems', in: 0, until: 92.7 },
  { clip: 'hangar-budgets', in: 0, until: 99.4 },
  { clip: 'hangar-mass', in: 0, until: 106.0 },
  { clip: 'vehicle', in: 3.7, until: 112.2 },
  { clip: 'trajectory', in: 0, until: 119.4 },
  { clip: 'poll', in: 0, until: 122.7 },
  { clip: 'forecast', in: 0, until: 126.0 },
  // Second chorus.
  { clip: 'th-pad', in: 6.0, until: 128.4 },
  { clip: 'map-galaxy', in: 7.0, until: 132.7 },
  { clip: 'th-moonrover', in: 0, until: 135.3 },
  { clip: 'earth', in: 12.0, until: 140.64 },
  // Launch (score and rocket).
  { clip: 'th-pad', in: 0, until: 146.5, fade: 0.5 },
  { clip: 'th-launch', in: 0, until: 160.5 },
  { clip: 'th-cruise', in: 0, until: 170.0 },
  { clip: 'mars-approach', in: 0, until: 177.2 }, // "cross the dark between the worlds"
  // Bridge: the landing, the debrief.
  // Entry under the parachute, then the hand-flown descent: the touchdown falls on "alien sands".
  { clip: 'th-arrival', in: 1.6, until: 178.7 },
  { clip: 'descent', in: 0, until: 189.1 },
  { clip: 'debrief', in: 0, until: 205.7 },
  // Last verse: the galaxy, the crew.
  { clip: 'map-galaxy', in: 0, until: 212.5 },
  { clip: 'map-world', in: 0, until: 219.0 },
  { clip: 'crew', in: 0, until: 226.4 },
  { clip: 'room', in: 0, until: 229.6 },
  { clip: 'daily', in: 0, until: 233.4 },
  // Worlds (score): real data, then generated worlds.
  { clip: 'moon', in: 0, until: 240.4, fade: 0.6 },
  { clip: 'mars', in: 7.6, until: 247.4 },
  { clip: 'jezero', in: 0, until: 254.2 },
  { clip: 'alien-low', in: 0, until: 261.1 },
  // Last chorus and the end.
  { clip: 'rings', in: 0, until: 264.4 },
  { clip: 'vehicle', in: 9.9, until: 268.0 },
  { clip: 'title', in: 6.5, until: 271.1 },
  { clip: 'th-launch', in: 3.5, until: 274.2 },
  { clip: 'earth-limb', in: 0, until: 286.0 },
  { clip: 'black', in: 0, until: TOTAL },
];

/**
 * Captions and title cards (rendered by cards.mjs), shown from `at` to `until` with fades. A feature
 * caption sits low on the left unless `top` is set (to keep clear of an in-game panel there).
 */
export const CARDS = [
  {
    id: 'c-earth',
    kind: 'credit',
    text: 'The real Earth · NASA Blue Marble · NOAA ETOPO',
    at: 11.0,
    until: 17.5,
  },
  {
    id: 'title-open',
    kind: 'title',
    text: 'Design a space mission. <b>Then fly it.</b>',
    at: 22.6,
    until: 29.3,
  },
  {
    id: 'f-missions',
    kind: 'feature',
    eyebrow: 'Choose a mission',
    text: 'Earth orbit. The Moon. Mars.',
    sub: 'And any world in a generated galaxy.',
    at: 38.2,
    until: 46.2,
  },
  { id: 'c-sat', kind: 'credit', text: 'Earth observation satellite', at: 50.0, until: 53.0 },
  { id: 'c-rover', kind: 'credit', text: 'Jezero crater survey · Mars', at: 53.6, until: 55.8 },
  {
    id: 'p-pole',
    kind: 'place',
    eyebrow: 'Lunar ice prospector',
    text: 'The Moon’s south pole',
    credit: 'NASA LRO · LOLA elevation · LROC colour',
    at: 56.6,
    until: 62.5,
  },
  {
    id: 'f-briefing',
    kind: 'feature',
    eyebrow: 'Briefing',
    text: 'Real science goals, a hard budget cap',
    at: 63.4,
    until: 69.0,
  },
  { id: 'title-chorus', kind: 'title', text: '', at: 81.0, until: 86.2 },
  {
    id: 'f-systems',
    kind: 'feature',
    eyebrow: 'Hangar',
    text: 'Choose a part for every system',
    at: 87.2,
    until: 92.5,
  },
  {
    id: 'f-budgets',
    kind: 'feature',
    eyebrow: 'Nine live budgets',
    text: 'Each one tells you why',
    sub: 'Mass · propellant · launch · power · night · data · cost · schedule · risk',
    at: 93.2,
    until: 99.2,
  },
  {
    id: 'f-mass',
    kind: 'feature',
    eyebrow: 'Trade-offs',
    text: 'Every kilogram costs propellant',
    at: 100.0,
    until: 105.8,
  },
  {
    id: 'f-vehicle',
    kind: 'feature',
    eyebrow: 'Built in 3D',
    text: 'Your vehicle, as you design it',
    at: 106.6,
    until: 112.0,
  },
  {
    id: 'f-trajectory',
    kind: 'feature',
    eyebrow: 'Trajectory',
    text: 'Launch windows from real ephemerides',
    sub: 'NASA JPL planetary elements · Lambert transfers · porkchop plots',
    at: 112.8,
    until: 119.2,
  },
  {
    id: 'f-poll',
    kind: 'feature',
    eyebrow: 'Go / No-Go',
    text: 'Every role answers for its part',
    at: 119.8,
    until: 122.5,
  },
  {
    id: 'f-forecast',
    kind: 'feature',
    eyebrow: 'Forecast',
    text: '200 simulated flights before launch',
    at: 123.0,
    until: 125.8,
  },
  { id: 'title-chorus2', kind: 'title', text: '', at: 137.6, until: 140.5 },
  { id: 'f-flight', kind: 'feature', eyebrow: 'Flight', text: 'Then fly it.', at: 141.4, until: 146.2 },
  {
    id: 'c-stage',
    kind: 'credit',
    text: 'Your own vehicle · staged for clarity, not to scale',
    at: 147.5,
    until: 156.0,
  },
  {
    id: 'f-landing',
    kind: 'feature',
    eyebrow: 'Landing',
    text: 'Fly the last kilometres yourself',
    sub: 'Over the real terrain, on the propellant your design left',
    top: true,
    at: 179.0,
    until: 186.6,
  },
  {
    id: 'f-debrief',
    kind: 'feature',
    eyebrow: 'Debrief',
    text: 'Every outcome, traced to its cause',
    at: 190.2,
    until: 197.6,
  },
  {
    id: 'f-again',
    kind: 'feature',
    eyebrow: 'Change one thing',
    text: 'Fly again. Compare.',
    at: 199.8,
    until: 205.4,
  },
  {
    id: 'f-galaxy',
    kind: 'feature',
    eyebrow: 'Galaxy map',
    text: 'A generated galaxy to explore',
    at: 206.3,
    until: 212.2,
  },
  {
    id: 'f-world',
    kind: 'feature',
    eyebrow: 'Any world',
    text: 'Every solid world is a mission',
    sub: 'Its gravity sets the propellant, its star the power, its air the landing',
    at: 213.0,
    until: 218.8,
  },
  {
    id: 'f-crew',
    kind: 'feature',
    eyebrow: '1 to 4 players',
    text: 'Director · Engineer · Science · Comms',
    at: 219.6,
    until: 226.2,
  },
  {
    id: 'f-room',
    kind: 'feature',
    eyebrow: 'Play together',
    text: 'Around one screen, or with a room code',
    at: 226.8,
    until: 229.4,
  },
  {
    id: 'f-daily',
    kind: 'feature',
    eyebrow: 'Daily mission',
    text: 'Same seed, same luck, one leaderboard',
    at: 229.9,
    until: 233.2,
  },
  {
    id: 'p-moon',
    kind: 'place',
    eyebrow: 'Measured, not painted',
    text: 'The Moon',
    credit: 'NASA LRO · LOLA elevation · LROC colour',
    at: 234.2,
    until: 240.0,
  },
  {
    id: 'p-mars',
    kind: 'place',
    eyebrow: 'Measured, not painted',
    text: 'Mars',
    credit: 'MGS MOLA elevation · Viking colour',
    at: 241.0,
    until: 247.0,
  },
  {
    id: 'p-jezero',
    kind: 'place',
    eyebrow: 'Mars 2020 landing site',
    text: 'Jezero crater',
    at: 248.0,
    until: 253.8,
  },
  {
    id: 'p-generated',
    kind: 'place',
    eyebrow: 'Generated from a seed',
    text: 'Worlds no one has seen',
    at: 254.8,
    until: 260.8,
  },
  {
    id: 'f-free',
    kind: 'feature',
    eyebrow: 'No install',
    text: 'Free, in your browser',
    at: 268.3,
    until: 270.9,
  },
  {
    id: 'title-end',
    kind: 'title',
    text: 'Design a space mission. <b>Then fly it.</b>',
    at: 275.0,
    until: 285.8,
  },
  { id: 'end', kind: 'end', at: 286.0, until: TOTAL },
];

/**
 * The mix. Each clip plays `file` from `from` to `to` (source seconds) at trailer time `at`, with
 * fades in and out (seconds) and a gain (linear).
 */
const songPart = (part, fadeIn, fadeOut) => ({
  file: 'song',
  from: part.from,
  to: part.to,
  at: part.at,
  fadeIn,
  fadeOut,
  gain: 1,
});
export const MIX = [
  // The opening score fades under the song's first bar, so the title card never sits in silence.
  { file: 'open', from: 0, to: 30.8, at: 0, fadeIn: 1.5, fadeOut: 3.6, gain: 1 },
  { file: 'boom', from: 0, to: 6, at: 22.5, fadeIn: 0, fadeOut: 1.5, gain: 0.85 },
  songPart(SONG_A, 1.2, 0.04),
  { file: 'boom', from: 0, to: 6, at: 140.6, fadeIn: 0, fadeOut: 2, gain: 0.8 },
  { file: 'launch', from: 0, to: 33.6, at: 140.64, fadeIn: 0.3, fadeOut: 1.4, gain: 0.95 },
  { file: 'rocket', from: 0, to: 20, at: 146.3, fadeIn: 0.2, fadeOut: 4, gain: 0.9 },
  { file: 'whoosh', from: 0, to: 3, at: 172.4, fadeIn: 0.1, fadeOut: 0.8, gain: 0.5 },
  songPart(SONG_B, 0.03, 0.6),
  { file: 'thrusters', from: 0, to: 10, at: 178.4, fadeIn: 0.5, fadeOut: 2, gain: 0.3 },
  { file: 'whoosh', from: 0, to: 3, at: 232.6, fadeIn: 0.1, fadeOut: 0.8, gain: 0.6 },
  { file: 'worlds', from: 0, to: 28.4, at: 233.4, fadeIn: 0.8, fadeOut: 1.8, gain: 0.95 },
  { file: 'riser', from: 0, to: 6, at: 255.2, fadeIn: 0.5, fadeOut: 0.3, gain: 0.55 },
  songPart(SONG_C, 0.5, 2.5),
  { file: 'boom', from: 0, to: 6, at: 274.2, fadeIn: 0, fadeOut: 2, gain: 0.5 },
];

/** Seconds each recorded clip must last: its furthest use plus a short handle. */
export function clipSeconds() {
  const seconds = {};
  let start = 0;
  for (const shot of SHOTS) {
    const end = shot.in + (shot.until - start);
    seconds[shot.clip] = Math.max(seconds[shot.clip] ?? 0, end);
    start = shot.until;
  }
  for (const key of Object.keys(seconds)) seconds[key] = Math.ceil((seconds[key] + 0.3) * FPS) / FPS;
  return seconds;
}
