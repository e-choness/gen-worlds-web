// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Soundtrack and effects.
 *
 * Music: three cues (deep space, planetfall, surface) streamed through <audio> elements. A cue plays
 * through once, fades out before its end, rests in silence for a while and then returns: the score
 * comes and goes like a film's rather than looping wall to wall. The setting must hold for a few
 * seconds before the cue follows it, so skimming a boundary does not flip the music back and forth.
 *
 * Effects: short decoded buffers — thruster and drill loops whose gain follows the simulation,
 * one-shots for the scanner. Volumes come from `Settings` (master, music and effects buses).
 *
 * The assets in public/audio are generated for development with the local SongForge service (see
 * docs/ARCHITECTURE.md). Every file is optional: a missing one is simply silent.
 *
 * Browsers only allow audio after a user gesture, so nothing starts until `unlock()` is called from
 * one.
 */
import { type Disposable, DisposableStore } from '@/core/disposable';
import type { Settings } from '@/core/settings';

export type MusicCue = 'space' | 'orbit' | 'surface';
type Loop = 'thruster' | 'drill';
type OneShot = 'scan' | 'chime' | 'thunder';

const MUSIC: Record<MusicCue, string> = {
  space: 'music-space',
  orbit: 'music-orbit',
  surface: 'music-surface',
};
const FADE_SECONDS = 6;
/** The setting has to hold this long before the music follows it. */
const CUE_DWELL_SECONDS = 8;
/** Silence between two plays of a cue. */
const REST_SECONDS = 25;

interface Track {
  element: HTMLAudioElement;
  gain: GainNode;
  /** Seconds of silence left before the cue may start again. */
  rest: number;
}

export class AudioEngine implements Disposable {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private readonly music = new Map<MusicCue, Track>();
  private readonly loops = new Map<Loop, { source: AudioBufferSourceNode; gain: GainNode }>();
  private readonly shots = new Map<OneShot, AudioBuffer>();
  private readonly store = new DisposableStore();
  /** Cue currently playing (or resting). */
  private cue: MusicCue | null = null;
  /** Cue the setting asks for, and for how long it has. */
  private wanted: MusicCue | null = null;
  private wantedFor = 0;

  constructor(private readonly settings: Settings) {
    this.store.add(settings.changed.on('change', () => this.applyVolumes()));
  }

  /** Creates the audio graph. Must be called from a user gesture; safe to call repeatedly. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const context = new AudioContext();
    this.context = context;
    this.master = context.createGain();
    this.musicBus = context.createGain();
    this.effectsBus = context.createGain();
    this.musicBus.connect(this.master);
    this.effectsBus.connect(this.master);
    this.master.connect(context.destination);
    this.applyVolumes();

    for (const [cue, file] of Object.entries(MUSIC) as Array<[MusicCue, string]>) {
      const element = new Audio(this.url(file));
      element.loop = false;
      element.preload = 'none';
      element.crossOrigin = 'anonymous';
      const gain = context.createGain();
      gain.gain.value = 0;
      context.createMediaElementSource(element).connect(gain).connect(this.musicBus);
      this.music.set(cue, { element, gain, rest: 0 });
    }
    void this.loadLoop('thruster', 'sfx-thruster');
    void this.loadLoop('drill', 'sfx-drill');
    void this.loadShot('scan', 'sfx-scan');
    void this.loadShot('chime', 'sfx-chime');
    void this.loadShot('thunder', 'sfx-thunder');
  }

  /** Tells the engine which cue fits the current setting. */
  setCue(cue: MusicCue): void {
    if (cue !== this.wanted) {
      this.wanted = cue;
      this.wantedFor = 0;
    }
  }

  /** Advances cue selection and the play / rest cycle. Call once per frame. */
  update(dt: number): void {
    const context = this.context;
    if (!context) return;
    this.wantedFor += dt;
    if (
      this.wanted &&
      this.wanted !== this.cue &&
      (this.cue === null || this.wantedFor > CUE_DWELL_SECONDS)
    ) {
      const previous = this.cue ? this.music.get(this.cue) : undefined;
      if (previous) this.fade(previous, 0);
      this.cue = this.wanted;
      const next = this.music.get(this.cue);
      if (next) next.rest = Math.min(next.rest, 2);
    }
    for (const [name, track] of this.music) {
      const { element } = track;
      if (name !== this.cue) {
        // Faded out: stop decoding once silent.
        if (!element.paused && track.gain.gain.value < 0.002) element.pause();
        continue;
      }
      if (element.paused) {
        track.rest -= dt;
        if (track.rest <= 0) {
          if (element.ended || element.currentTime > 0) element.currentTime = 0;
          // play() rejects if the file is missing: the cue just stays silent; try again after a rest.
          element.play().catch(() => {});
          track.rest = REST_SECONDS;
          this.fade(track, 1);
        }
      } else if (Number.isFinite(element.duration) && element.duration - element.currentTime < FADE_SECONDS) {
        this.fade(track, 0);
      }
    }
  }

  /** @param level 0..1 engine output. */
  setThrust(level: number): void {
    // Silent at idle; the pitch moves only a little so the loop keeps its character.
    this.setLoop('thruster', level < 0.02 ? 0 : 0.08 + level * 0.4, 0.92 + level * 0.2);
  }

  setDrilling(active: boolean): void {
    this.setLoop('drill', active ? 0.55 : 0, 1);
  }

  play(name: OneShot, level = 0.7): void {
    const buffer = this.shots.get(name);
    if (!buffer || !this.context || !this.effectsBus) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = level;
    source.connect(gain).connect(this.effectsBus);
    source.start();
  }

  private applyVolumes(): void {
    const context = this.context;
    if (!context || !this.master || !this.musicBus || !this.effectsBus) return;
    const v = this.settings.values;
    const now = context.currentTime;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.masterVolume, now, 0.08);
    this.musicBus.gain.setTargetAtTime(v.musicVolume, now, 0.08);
    this.effectsBus.gain.setTargetAtTime(v.effectsVolume, now, 0.08);
  }

  private fade(track: Track, target: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setTargetAtTime(target, now, FADE_SECONDS / 3);
  }

  private setLoop(name: Loop, level: number, rate: number): void {
    const loop = this.loops.get(name);
    if (!loop || !this.context) return;
    loop.gain.gain.setTargetAtTime(level, this.context.currentTime, 0.12);
    loop.source.playbackRate.setTargetAtTime(rate, this.context.currentTime, 0.2);
  }

  private async loadBuffer(file: string): Promise<AudioBuffer | null> {
    if (!this.context) return null;
    try {
      const response = await fetch(this.url(file));
      if (!response.ok) return null;
      return await this.context.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  private async loadLoop(name: Loop, file: string): Promise<void> {
    const buffer = await this.loadBuffer(file);
    if (!buffer || !this.context || !this.effectsBus) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.effectsBus);
    source.start();
    this.loops.set(name, { source, gain });
  }

  private async loadShot(name: OneShot, file: string): Promise<void> {
    const buffer = await this.loadBuffer(file);
    if (buffer) this.shots.set(name, buffer);
  }

  private url(file: string): string {
    return `${import.meta.env.BASE_URL}audio/${file}.mp3`;
  }

  dispose(): void {
    this.store.dispose();
    for (const track of this.music.values()) track.element.pause();
    for (const loop of this.loops.values()) loop.source.stop();
    this.music.clear();
    this.loops.clear();
    void this.context?.close();
    this.context = null;
  }
}
