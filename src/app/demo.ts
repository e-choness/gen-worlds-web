/**
 * `?demo`: a scripted tour of the real bodies the missions fly to, for the submission video and as
 * an attract mode. The camera sweeps slowly over each view; R records the 3D view to a WebM file
 * with `canvas.captureStream`, so footage can be taken on any machine without a screen recorder.
 * Captions are page elements and are not part of the recording.
 *
 * Like the sandbox, this module pulls in the whole engine and is only reached by dynamic import.
 */
import { App } from '@/app/app';
import { jdFromUnixMs } from '@/astro/time';
import { TEXT } from '@/ui/text';

interface Shot {
  caption: keyof typeof TEXT.demo.shots;
  body: 'earth' | 'moon' | 'mars';
  /** ISO date (UTC) that puts the Sun where the view needs it. */
  date: string;
  /** Where the camera hangs: over a place, or at an angle from the sub-solar point (always lit). */
  latitudeDeg?: number;
  longitudeDeg?: number;
  sunAngleDeg?: number;
  altitudeM: number;
  /** Camera sweep in longitude, degrees per second, and climb, metres per second. */
  sweepDegS: number;
  climbMS: number;
  seconds: number;
}

/**
 * The tour. Dates are chosen so each view is sunlit; altitudes run from a whole disc down to the
 * landing sites of the lunar and Mars missions.
 */
const SHOTS: readonly Shot[] = [
  {
    caption: 'earth',
    body: 'earth',
    date: '2027-03-20T10:30:00Z',
    latitudeDeg: 15,
    longitudeDeg: 5,
    altitudeM: 11_000_000,
    sweepDegS: 1.6,
    climbMS: 0,
    seconds: 14,
  },
  {
    caption: 'moon',
    body: 'moon',
    date: '2027-09-08T00:00:00Z',
    sunAngleDeg: 50,
    altitudeM: 2_600_000,
    sweepDegS: 1.2,
    climbMS: 0,
    seconds: 12,
  },
  {
    caption: 'pole',
    body: 'moon',
    date: '2027-09-08T00:00:00Z',
    latitudeDeg: -78,
    longitudeDeg: 0,
    altitudeM: 60_000,
    sweepDegS: 0.5,
    climbMS: -1500,
    seconds: 12,
  },
  {
    caption: 'mars',
    body: 'mars',
    date: '2027-02-01T12:00:00Z',
    latitudeDeg: 0,
    longitudeDeg: -90,
    altitudeM: 6_500_000,
    sweepDegS: 1.4,
    climbMS: 0,
    seconds: 14,
  },
  {
    caption: 'jezero',
    body: 'mars',
    date: '2027-11-14T00:00:00Z',
    latitudeDeg: 18.4,
    longitudeDeg: 76.6,
    altitudeM: 90_000,
    sweepDegS: 0.012,
    climbMS: -5500,
    seconds: 13,
  },
];

const RECORDING_FILE = 'gen-worlds-demo.webm';
const RECORDING_BITS_PER_SECOND = 16_000_000;

/** Records the canvas to a WebM file; null where the browser cannot. */
function startRecording(canvas: HTMLCanvasElement, onSaved: () => void): MediaRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const recorder = new MediaRecorder(canvas.captureStream(60), {
    videoBitsPerSecond: RECORDING_BITS_PER_SECOND,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.onstop = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
    link.download = RECORDING_FILE;
    link.click();
    URL.revokeObjectURL(link.href);
    onSaved();
  };
  recorder.start();
  return recorder;
}

/** Starts the tour on `canvas`; it loops until the page is left. */
export async function startDemo(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<App> {
  const first = SHOTS[0];
  const app = await App.create({
    canvas,
    start: {
      solarSystem: true,
      cockpit: true,
      dateJd: jdFromUnixMs(Date.parse(first.date)),
      altitude: first.altitudeM,
    },
  });
  window.__app = app;
  app.setControlsEnabled(false);

  const overlay = document.createElement('div');
  overlay.className = 'demo-caption';
  const title = document.createElement('h1');
  const source = document.createElement('p');
  const status = document.createElement('p');
  status.className = 'demo-status';
  status.textContent = TEXT.demo.hint;
  overlay.append(title, source, status);
  uiRoot.append(overlay);

  let recorder: MediaRecorder | null = null;
  const toggleRecording = (): void => {
    if (recorder) {
      recorder.stop();
      recorder = null;
      return;
    }
    recorder = startRecording(canvas, () => {
      status.textContent = TEXT.demo.saved;
    });
    if (recorder) status.textContent = TEXT.demo.recording;
  };
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyR') toggleRecording();
    // Back to the game's title screen; the engine has no warm shutdown, so this is a page load.
    if (event.code === 'Escape') location.href = location.pathname;
  });

  let index = -1;
  let elapsed = 0;
  const begin = (next: number): void => {
    index = next % SHOTS.length;
    elapsed = 0;
    const shot = SHOTS[index];
    app.simJd = jdFromUnixMs(Date.parse(shot.date));
    // The sky must hold still within a shot: the sweep is the camera's, not the planet's.
    app.timeWarp = 0;
    const caption = TEXT.demo.shots[shot.caption];
    title.textContent = caption.title;
    source.textContent = caption.source;
  };
  begin(0);
  app.onFrame((dt) => {
    const shot = SHOTS[index];
    elapsed += dt;
    if (elapsed > shot.seconds) {
      begin(index + 1);
      return;
    }
    const altitude = Math.max(2000, shot.altitudeM + shot.climbMS * elapsed);
    const sweep = shot.sweepDegS * elapsed;
    if (shot.sunAngleDeg !== undefined) app.placeTowardSun(shot.body, shot.sunAngleDeg, sweep * 4, altitude);
    else app.placeOver(shot.body, shot.latitudeDeg ?? 0, (shot.longitudeDeg ?? 0) + sweep, altitude);
  });
  return app;
}
