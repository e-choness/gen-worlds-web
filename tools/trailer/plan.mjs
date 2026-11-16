// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// The trailer's edit: every shot, caption and sound, placed on a 300-second timeline. The cut points
// follow the sung narration (lyric timings measured by align.py on the chosen take), so the pictures
// change with the words. record.mjs reads the clip lengths from here; build.mjs turns it into ffmpeg.

export const FPS = 30;
export const TOTAL = 300;

/** The audio files, made with SongForge (see songforge.mjs), saved under .cache/trailer/audio. */
export const AUDIO_FILES = {
  song: '93579bd8-41dd-488c-a4e6-596990f46b78', // "Design It, Fly It", YuE2 Studio
  band: '93579bd8-41dd-488c-a4e6-596990f46b78.instrumental', // the same song without the voice (Demucs)
  rocket: '9f7dafc6-7e32-45c5-988d-3a6db3408a31', // TangoFlux: rocket ignition and roar
  thrusters: 'd3fa944f-d186-4f12-b376-ae267ae8c4b3', // TangoFlux: landing thrusters
};

/**
 * The music is the one song, nothing else: three sung parts, and the song's own band (its
 * instrumental stem) carrying the launch and the tour of worlds between them. Song seconds.
 * Each band passage starts where the sung part stopped, so that join is seamless; it ends by
 * jumping back to where the next sung part starts, at a point joins.py found to match in harmony
 * and rhythm on both sides. The trailer opens on the song's own ending, its last hit under the
 * title card.
 */
const CUT = {
  launchLand: 110.388, // the breath before "Lift off"
  launchLeave: 141.23, // the bridge's last bar, which leads back into launchLand
  worldsLand: 170.225, // the bar after "same luck for everyone"
  worldsLeave: 197.712, // in the outro, which leads back into worldsLand
  lastHit: 202.4, // the song's final hit; the song rings out to silence by 211
  end: 211.5,
};
const SONG_AT = 30; // the song starts from the top when the game appears
const TITLE_AT = 22.6; // the opening title card, on the last hit
const SEAM = 0.06; // crossfade at each join, seconds: short enough that no beat doubles

/**
 * The picture, shot after shot: each plays `clip` (recorded by record.mjs) from `in` seconds until
 * the trailer reaches `until`. `fade` dips to black over that many seconds at the shot's start.
 */
export const SHOTS = [
  // Cold open (the song's own ending): deep space, the real Earth, the title.
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
  { clip: 'earth', in: 12.0, until: 140.39 },
  // Launch (the song's band, the bridge without its words, and the rocket).
  { clip: 'th-pad', in: 0, until: 146.5, fade: 0.5 },
  { clip: 'th-launch', in: 0, until: 160.5 },
  { clip: 'th-cruise', in: 0, until: 170.0 }, // the band drops away: the quiet of space
  { clip: 'mars-approach', in: 0, until: 175.04 }, // "cross the dark between the worlds"
  // Bridge: the landing, the debrief.
  // Entry under the parachute, then the hand-flown descent: the touchdown falls on "alien sands".
  { clip: 'th-arrival', in: 1.6, until: 176.54 },
  { clip: 'descent', in: 0, until: 186.94 },
  { clip: 'debrief', in: 0, until: 203.54 },
  // Last verse: the galaxy, the crew.
  { clip: 'map-galaxy', in: 0, until: 210.34 },
  { clip: 'map-world', in: 0, until: 216.84 },
  { clip: 'crew', in: 0, until: 224.24 },
  { clip: 'room', in: 0, until: 227.44 },
  { clip: 'daily', in: 0, until: 231.24 },
  // Worlds (the song's band, the last chorus without its words): real data, then generated worlds.
  { clip: 'moon', in: 0, until: 238.34, fade: 0.6 },
  { clip: 'mars', in: 5.0, until: 246.64 },
  { clip: 'jezero', in: 0, until: 253.73 },
  { clip: 'alien-low', in: 0, until: 260.93 },
  // Last chorus and the end.
  { clip: 'rings', in: 0, until: 264.23 },
  { clip: 'vehicle', in: 9.9, until: 267.83 },
  { clip: 'title', in: 6.5, until: 270.93 },
  { clip: 'th-launch', in: 3.5, until: 274.03 },
  { clip: 'earth-limb', in: 0, until: 285.83 },
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
  { id: 'title-chorus2', kind: 'title', text: '', at: 137.6, until: 140.3 },
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
    at: 176.84,
    until: 184.44,
  },
  {
    id: 'f-debrief',
    kind: 'feature',
    eyebrow: 'Debrief',
    text: 'Every outcome, traced to its cause',
    at: 188.04,
    until: 195.44,
  },
  {
    id: 'f-again',
    kind: 'feature',
    eyebrow: 'Change one thing',
    text: 'Fly again. Compare.',
    at: 197.64,
    until: 203.24,
  },
  {
    id: 'f-galaxy',
    kind: 'feature',
    eyebrow: 'Galaxy map',
    text: 'A generated galaxy to explore',
    at: 204.14,
    until: 210.04,
  },
  {
    id: 'f-world',
    kind: 'feature',
    eyebrow: 'Any world',
    text: 'Every solid world is a mission',
    sub: 'Its gravity sets the propellant, its star the power, its air the landing',
    at: 210.84,
    until: 216.64,
  },
  {
    id: 'f-crew',
    kind: 'feature',
    eyebrow: '1 to 4 players',
    text: 'Director · Engineer · Science · Comms',
    at: 217.44,
    until: 224.04,
  },
  {
    id: 'f-room',
    kind: 'feature',
    eyebrow: 'Play together',
    text: 'Around one screen, or with a room code',
    at: 224.64,
    until: 227.24,
  },
  {
    id: 'f-daily',
    kind: 'feature',
    eyebrow: 'Daily mission',
    text: 'Same seed, same luck, one leaderboard',
    at: 227.74,
    until: 231.04,
  },
  {
    id: 'p-moon',
    kind: 'place',
    eyebrow: 'Measured, not painted',
    text: 'The Moon',
    credit: 'NASA LRO · LOLA elevation · LROC colour',
    at: 232.0,
    until: 238.0,
  },
  {
    id: 'p-mars',
    kind: 'place',
    eyebrow: 'Measured, not painted',
    text: 'Mars',
    credit: 'MGS MOLA elevation · Viking colour',
    at: 239.2,
    until: 246.2,
  },
  {
    id: 'p-jezero',
    kind: 'place',
    eyebrow: 'Mars 2020 landing site',
    text: 'Jezero crater',
    at: 247.4,
    until: 253.3,
  },
  {
    id: 'p-generated',
    kind: 'place',
    eyebrow: 'Generated from a seed',
    text: 'Worlds no one has seen',
    at: 254.4,
    until: 260.6,
  },
  {
    id: 'f-free',
    kind: 'feature',
    eyebrow: 'No install',
    text: 'Free, in your browser',
    at: 268.13,
    until: 270.73,
  },
  {
    id: 'title-end',
    kind: 'title',
    text: 'Design a space mission. <b>Then fly it.</b>',
    at: 274.83,
    until: 285.63,
  },
  { id: 'end', kind: 'end', at: 285.83, until: TOTAL },
];

/**
 * The mix. Each clip plays `file` from `from` to `to` (source seconds) at trailer time `at`, with
 * fades in and out (seconds) and a gain (linear).
 */
/** The song from the top, piece after piece with no gaps: sung, band, sung, band, sung. */
const PIECES = [
  ['song', 0, CUT.launchLand],
  ['band', CUT.launchLand, CUT.launchLeave],
  ['song', CUT.launchLand, CUT.worldsLand],
  ['band', CUT.worldsLand, CUT.worldsLeave],
  ['song', CUT.worldsLand, CUT.end],
];

/** Lays the pieces end to end from SONG_AT, each join a short crossfade centred on the cut. */
function songPieces() {
  let at = SONG_AT;
  return PIECES.map(([file, from, to], index) => {
    const first = index === 0;
    const last = index === PIECES.length - 1;
    const piece = {
      file,
      from: first ? from : from - SEAM / 2,
      to: last ? to : to + SEAM / 2,
      at: first ? at : at - SEAM / 2,
      fadeIn: first ? 0.5 : SEAM,
      fadeOut: last ? 0 : SEAM,
      gain: 1,
    };
    at += to - from;
    return piece;
  });
}

export const MIX = [
  // Cold open: the song's last chorus and outro on the band alone; the final hit lands on the
  // title card and rings out before the song begins.
  {
    file: 'band',
    from: CUT.lastHit - TITLE_AT,
    to: CUT.lastHit - TITLE_AT + SONG_AT,
    at: 0,
    fadeIn: 3,
    fadeOut: 1,
    gain: 1,
  },
  ...songPieces(),
  // Sound in the scene, kept under the music: the lift-off and the landing burn.
  { file: 'rocket', from: 0, to: 20, at: 146.3, fadeIn: 0.2, fadeOut: 4, gain: 0.6 },
  { file: 'thrusters', from: 0, to: 10, at: 176.24, fadeIn: 0.5, fadeOut: 2, gain: 0.3 },
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
