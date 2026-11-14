// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Sound for the 2D mission screens: a quiet music bed and short cues for what the screens report.
 * Screens never call this directly; the app layer turns store changes and reported cues into
 * `play` calls. The cues are synthesised (no files to load), the launch rumble and the music reuse
 * the 3D engine's recordings. Volumes and mute come from `Settings`.
 *
 * Browsers only allow audio after a user gesture: everything is a no-op until `unlock` has run.
 */
import type { Disposable } from '@/core/disposable';
import type { Settings } from '@/core/settings';

/**
 * `select`: a control was pressed. `good` / `bad` / `neutral`: a mission event of that tone was
 * revealed. `alert`: an event waits for a role's answer. `launch`: the rocket left the pad.
 */
export type UiCue = 'select' | 'good' | 'bad' | 'neutral' | 'alert' | 'launch';

interface Tone {
  /** Hz at the start and end of the note. */
  from: number;
  to: number;
  /** Seconds after the cue starts, and how long the note lasts. */
  at: number;
  length: number;
  level: number;
  shape: OscillatorType;
}

const note = (
  from: number,
  to: number,
  at: number,
  length: number,
  level: number,
  shape: OscillatorType,
): Tone => ({
  from,
  to,
  at,
  length,
  level,
  shape,
});

/** Each cue as a few enveloped oscillator notes. Rising is good, falling is bad. */
const TONES: Record<Exclude<UiCue, 'launch'>, readonly Tone[]> = {
  select: [note(620, 560, 0, 0.05, 0.1, 'triangle')],
  neutral: [note(440, 440, 0, 0.12, 0.12, 'sine')],
  good: [note(523, 523, 0, 0.12, 0.16, 'sine'), note(784, 784, 0.1, 0.22, 0.16, 'sine')],
  bad: [note(330, 300, 0, 0.16, 0.18, 'triangle'), note(220, 180, 0.14, 0.34, 0.2, 'triangle')],
  alert: [note(880, 880, 0, 0.09, 0.16, 'square'), note(880, 880, 0.16, 0.09, 0.16, 'square')],
};

/** Music level under the screens, relative to the music bus: it sits behind reading, not over it. */
const MUSIC_BED_LEVEL = 0.55;
const LAUNCH_SECONDS = 4.5;

export class UiAudio implements Disposable {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private music: HTMLAudioElement | null = null;
  private rumble: AudioBuffer | null = null;
  private musicWanted = false;
  private readonly unsubscribe: Disposable;

  constructor(private readonly settings: Settings) {
    this.unsubscribe = settings.changed.on('change', () => this.applyVolumes());
  }

  /** Call from a user gesture. Safe to call again. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      // No audio device or a blocked context: the game stays silent.
      return;
    }
    this.context = context;
    this.master = context.createGain();
    this.master.connect(context.destination);
    this.effects = context.createGain();
    this.effects.connect(this.master);
    this.musicGain = context.createGain();
    this.musicGain.connect(this.master);
    this.music = new Audio(this.url('music-space'));
    this.music.loop = true;
    this.music.preload = 'none';
    context.createMediaElementSource(this.music).connect(this.musicGain);
    this.applyVolumes();
    this.applyMusic();
    void this.loadRumble();
  }

  /** Whether the music bed should play; it starts once audio is unlocked. */
  setMusic(playing: boolean): void {
    this.musicWanted = playing;
    this.applyMusic();
  }

  play(cue: UiCue): void {
    const { context, effects } = this;
    if (!context || !effects || this.settings.values.muted) return;
    const now = context.currentTime;
    if (cue === 'launch') {
      if (!this.rumble) return;
      const source = context.createBufferSource();
      source.buffer = this.rumble;
      source.loop = true;
      // Low and slow: an engine heard from the control room.
      source.playbackRate.value = 0.6;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.6);
      gain.gain.linearRampToValueAtTime(0, now + LAUNCH_SECONDS);
      source.connect(gain).connect(effects);
      source.start(now);
      source.stop(now + LAUNCH_SECONDS);
      return;
    }
    for (const tone of TONES[cue]) {
      const oscillator = context.createOscillator();
      oscillator.type = tone.shape;
      const start = now + tone.at;
      oscillator.frequency.setValueAtTime(tone.from, start);
      oscillator.frequency.linearRampToValueAtTime(tone.to, start + tone.length);
      const gain = context.createGain();
      // A few milliseconds of attack and a full release: no clicks.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.level, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.length);
      oscillator.connect(gain).connect(effects);
      oscillator.start(start);
      oscillator.stop(start + tone.length + 0.02);
    }
  }

  private applyVolumes(): void {
    const { context, master, effects, musicGain } = this;
    if (!context || !master || !effects || !musicGain) return;
    const v = this.settings.values;
    const now = context.currentTime;
    master.gain.setTargetAtTime(v.muted ? 0 : v.masterVolume, now, 0.05);
    effects.gain.setTargetAtTime(v.effectsVolume, now, 0.05);
    musicGain.gain.setTargetAtTime(v.musicVolume * MUSIC_BED_LEVEL, now, 0.3);
    this.applyMusic();
  }

  private applyMusic(): void {
    if (!this.music) return;
    if (this.musicWanted && !this.settings.values.muted) {
      // A refused play (no gesture yet, file missing) leaves the screens silent, which is fine.
      this.music.play().catch(() => undefined);
    } else this.music.pause();
  }

  private async loadRumble(): Promise<void> {
    if (!this.context) return;
    try {
      const response = await fetch(this.url('sfx-thruster'));
      if (response.ok) this.rumble = await this.context.decodeAudioData(await response.arrayBuffer());
    } catch {
      // Without the recording the launch is silent.
    }
  }

  private url(file: string): string {
    return `${import.meta.env.BASE_URL}audio/${file}.mp3`;
  }

  dispose(): void {
    this.unsubscribe.dispose();
    this.music?.pause();
    this.music = null;
    void this.context?.close();
    this.context = null;
  }
}
