// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// The trailer's recording runs (see record.mjs): each opens the game, sets up a scene and records its
// clips. Camera moves are small scripts run inside the page on every frame, with `app` (the 3D
// sandbox) and `t` (clip seconds) in scope, and the helpers of `CAMERA_KIT` under `kit`.
import { clipSeconds } from './plan.mjs';

/** The descent pilot falls at this share of the fastest speed it could still stop from. */
const PILOT_MARGIN = 0.9;

/** Hides everything but the 3D view. */
const NO_HUD = '#ui-root, #shell-root, .demo-caption, .demo-bar { display: none !important; }';

/** Installed once per sandbox page: helpers for the camera scripts, and the per-frame hook. */
function installCameraKit() {
  const app = window.__app;
  const V = app.cameraPosition.constructor;
  const Q = app.flight.orientation.constructor;
  const axis = new V();
  const turnQ = new Q();
  const kit = {
    V,
    ease: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x)),
    lerp: (a, b, x) => a + (b - a) * x,
    /** Turns the view about its own axes (radians): pitch up, yaw left, roll. */
    turn(pitch = 0, yaw = 0, roll = 0) {
      const o = app.flight.orientation;
      if (yaw) o.multiply(turnQ.setFromAxisAngle(axis.set(0, 1, 0), yaw));
      if (pitch) o.multiply(turnQ.setFromAxisAngle(axis.set(1, 0, 0), pitch));
      if (roll) o.multiply(turnQ.setFromAxisAngle(axis.set(0, 0, 1), roll));
    },
    body(kind) {
      return app.system.bodies.find((b) => b.desc.kind === kind) ?? app.system.bodies[0];
    },
    /** The sunlit direction `angleRad` from the sub-solar point, swung `aroundRad` about the Sun. */
    sunward(body, angleRad, aroundRad) {
      const side = new V(0, 1, 0).cross(body.sunDir).normalize();
      return body.sunDir.clone().applyAxisAngle(side, angleRad).applyAxisAngle(body.sunDir, aroundRad);
    },
  };
  window.__trailer = { t: 0, cam: null, kit };
  app.setControlsEnabled(false);
  app.onFrame(() => {
    const state = window.__trailer;
    if (state.cam) state.cam(app, state.t, state.kit);
  });
}

/** Opens the 3D sandbox with `query`, without its HUD, and waits for the engine. */
async function openSandbox(rec, query) {
  const page = await rec.open(`/?${query}&cockpit&nostart`);
  await page.waitForFunction(() => window.__status === 'running' || window.__status === 'failed', null, {
    timeout: 300000,
    polling: 500,
  });
  if ((await page.evaluate(() => window.__status)) !== 'running') throw new Error(`sandbox failed: ${query}`);
  await rec.css(NO_HUD);
  await page.evaluate(installCameraKit);
  return page;
}

/** Sets the camera script and puts it at clip time 0, then waits for the terrain there to load. */
async function aim(rec, script) {
  await rec.page.evaluate((source) => {
    window.__trailer.t = 0;
    window.__trailer.cam = new Function('app', 't', 'kit', source);
  }, script);
  for (let guard = 0; guard < 200; guard++) {
    await rec.page.clock.runFor(40);
    await rec.page.waitForTimeout(400);
    const idle = await rec.page.evaluate(() => {
      const body = window.__app.flight.telemetry.body;
      return !body?.view || (body.view.terrain.ready && body.view.terrain.stats.pending === 0);
    });
    if (idle && guard > 6) return;
  }
  console.log('terrain still loading; recording anyway');
}

/** Records a sandbox clip whose camera follows `script`. */
async function sandboxClip(rec, name, script) {
  await aim(rec, script);
  await rec.clip(name, (t) => rec.page.evaluate((value) => (window.__trailer.t = value), t));
}

const stage = (phase) => (rec) => rec.page.evaluate((value) => window.stagePhase(value), phase);

// --- The 2D screens -----------------------------------------------------------------------------

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a, b, x) => a + (b - a) * x;

/** Installed on each page of the 2D screens: a drawn pointer (headless shots have none). */
function installUiKit() {
  const style = document.createElement('style');
  style.textContent = `
    .trailer-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 28px; height: 28px;
      pointer-events: none; opacity: 0; filter: drop-shadow(0 3px 5px rgba(0,0,0,.55)); }
    .trailer-ring { position: fixed; z-index: 2147483646; width: 34px; height: 34px; margin: -17px 0 0 -17px;
      border-radius: 50%; border: 3px solid #6fd3ff; pointer-events: none; opacity: 0; }
    html { scroll-behavior: auto !important; }`;
  document.head.append(style);
  const cursor = document.createElement('div');
  cursor.className = 'trailer-cursor';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2.5v17l4.4-4 3 6.6 3-1.3-3-6.5H18z" ' +
    'fill="#fff" stroke="#04070d" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const ring = document.createElement('div');
  ring.className = 'trailer-ring';
  document.body.append(ring, cursor);
}

/**
 * Finds a target on the page: `{ text, sel }` is the first visible element under `sel` whose text
 * contains `text`; `{ css }` a selector; `fx`/`fy` pick a point inside it (default its centre).
 * Returns the point in viewport pixels and whether the element exists.
 */
function locate(target) {
  const visible = (el) => el && el.getClientRects().length > 0;
  let el = null;
  if (target.css) el = [...document.querySelectorAll(target.css)].find(visible) ?? null;
  else {
    const sel = target.sel ?? 'button, summary, a, label, .tree-row, .part-card, .scenario-card';
    el =
      [...document.querySelectorAll(sel)].find(
        (node) => visible(node) && node.textContent.replace(/\s+/g, ' ').includes(target.text),
      ) ?? null;
  }
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width * (target.fx ?? 0.5), y: box.top + box.height * (target.fy ?? 0.5) };
}

/** Acts on a target found by `locate`: a click, or typing `text` (all of it, or its first `n` letters). */
function act({ target, type, n }) {
  const visible = (el) => el && el.getClientRects().length > 0;
  let el = null;
  if (target.css) el = [...document.querySelectorAll(target.css)].find(visible) ?? null;
  else {
    const sel = target.sel ?? 'button, summary, a, label, .tree-row, .part-card, .scenario-card';
    el = [...document.querySelectorAll(sel)].find(
      (node) => visible(node) && node.textContent.replace(/\s+/g, ' ').includes(target.text),
    );
  }
  if (!el) return false;
  if (type !== undefined) {
    el.focus();
    el.value = type.slice(0, n ?? type.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else el.click();
  return true;
}

/**
 * The choreography of a 2D clip, as a per-frame callback for `rec.clip`: a slow push-in of the
 * whole screen (`zoom: [from, to, originX, originY]`, origin as a share of the viewport), an eased
 * scroll (`scroll: { from, to, start, end, css? }`, css scrolls an element instead of the page) and
 * pointer actions (`{ at, target, type?, mouse? }`): the pointer glides to the target over the
 * `move` seconds before `at`, then clicks it (or types into it; `mouse` clicks with the real mouse).
 */
function choreography(rec, { zoom = null, scroll = null, actions = [], pointer = [0.7, 0.86] } = {}) {
  let pos = { x: 1280 * pointer[0], y: 720 * pointer[1] };
  let from = null;
  let index = 0;
  let clickT = -9;
  let shown = false;
  let typing = null;
  return async (t, total) => {
    const page = rec.page;
    if (scroll) {
      const k = ease((t - (scroll.start ?? 0)) / ((scroll.end ?? total) - (scroll.start ?? 0)));
      await page.evaluate(
        ([y, css]) => {
          if (css) document.querySelector(css)?.scrollTo(0, y);
          else document.querySelector('.shell main')?.scrollTo(0, y);
        },
        [lerp(scroll.from, scroll.to, k), scroll.css ?? null],
      );
    }
    if (zoom) {
      const s = lerp(zoom[0], zoom[1], ease(t / total));
      await page.evaluate(
        ([scale, ox, oy]) => {
          const root = document.getElementById('shell-root');
          root.style.transformOrigin = `${ox * 100}% ${oy * window.innerHeight}px`;
          root.style.transform = `scale(${scale})`;
        },
        [s, zoom[2], zoom[3]],
      );
    }
    const next = actions[index];
    if (next) {
      const start = next.at - (next.move ?? 0.8);
      if (t >= start) {
        const target = await page.evaluate(locate, next.target);
        if (target) {
          if (!from) from = { ...pos };
          shown = true;
          const k = ease((t - start) / (next.at - start));
          pos = { x: lerp(from.x, target.x, k), y: lerp(from.y, target.y, k) };
          await page.mouse.move(pos.x, pos.y);
        }
        if (t >= next.at) {
          if (next.type !== undefined) typing = { action: next, t };
          else if (next.mouse) await page.mouse.click(pos.x, pos.y);
          else if (!next.hover && !(await page.evaluate(act, { target: next.target })))
            console.log(`no target ${JSON.stringify(next.target)}`);
          if (!next.hover && next.type === undefined) clickT = t;
          index++;
          from = null;
        }
      }
    }
    if (typing) {
      const { action } = typing;
      const n = Math.min(action.type.length, Math.ceil((t - typing.t) / (action.perLetter ?? 0.09)));
      await page.evaluate(act, { target: action.target, type: action.type, n });
      if (n >= action.type.length) typing = null;
    }
    const since = t - clickT;
    await page.evaluate(
      ([x, y, visible, ring]) => {
        const cursor = document.querySelector('.trailer-cursor');
        cursor.style.transform = `translate(${x - 4}px, ${y - 3}px)`;
        cursor.style.opacity = visible ? '1' : '0';
        const halo = document.querySelector('.trailer-ring');
        halo.style.left = `${x}px`;
        halo.style.top = `${y}px`;
        halo.style.opacity = String(Math.max(0, 1 - ring / 0.4));
        halo.style.transform = `scale(${0.6 + ring * 2.2})`;
      },
      [pos.x, pos.y, shown, since < 0.4 ? since : 1],
    );
  };
}

/** Clicks a button (or any `sel`) by its text, unrecorded, and lets the screen settle. */
async function press(rec, text, sel = 'button') {
  const done = await rec.page.evaluate(
    ([label, selector]) => {
      const el = [...document.querySelectorAll(selector)].find(
        (node) => node.textContent.includes(label) && !node.disabled && node.getClientRects().length > 0,
      );
      el?.click();
      return Boolean(el);
    },
    [text, sel],
  );
  if (!done) throw new Error(`no ${sel} "${text}" on the page`);
  await rec.settle(700, 4);
}

/** Puts the screen back to rest between clips: no push-in, scrolled to the top. */
const resetView = (rec) =>
  rec.page.evaluate(() => {
    const root = document.getElementById('shell-root');
    root.style.transform = '';
    document.querySelector('.shell main')?.scrollTo(0, 0);
  });

/** Opens the game's 2D shell. */
async function openGame(rec, path = '/') {
  const page = await rec.open(path);
  await page.waitForFunction(() => window.__status === 'running', null, { timeout: 120000, polling: 300 });
  await page.evaluate(installUiKit);
  await rec.settle(1500, 4);
  return page;
}

/** From the title to the Mars mission's briefing, unrecorded. */
async function toBriefing(rec, card = 2) {
  await press(rec, 'New mission');
  await rec.page.evaluate((nth) => document.querySelectorAll('.scenario-card')[nth].click(), card);
  await rec.settle(700, 4);
  const onBriefing = await rec.page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Start the design')),
  );
  if (!onBriefing) await press(rec, 'Open the briefing');
}

/** From the briefing to a launched mission's debrief with the reference design, unrecorded. */
async function flyToDebrief(rec) {
  await press(rec, 'Plan the trajectory');
  await press(rec, 'Call the Go/No-Go poll');
  await press(rec, 'All four roles');
  await press(rec, 'Launch');
  const auto = await rec.page.evaluate(() =>
    [...document.querySelectorAll('button')].some((b) => b.textContent.includes('guidance computer land')),
  );
  if (auto) await press(rec, 'guidance computer land');
  await press(rec, 'Skip to the end');
  await rec.settle(1500, 6);
  await press(rec, 'Open the debrief');
  await rec.settle(1500, 4);
}

export const RUNS = {
  /** The real Earth: the cold open's approach and the closing view over the limb. */
  async 'real-earth'(rec, wanted) {
    await openSandbox(rec, 'sol&at=earth&date=2027-03-20T10:30:00Z&alt=30000000');
    await rec.page.evaluate(() => (window.__app.timeWarp = 0));
    if (wanted('earth'))
      await sandboxClip(
        rec,
        'earth',
        `const k = kit.ease(t / 21.3);
         app.placeOver('earth', kit.lerp(26, 12, k), kit.lerp(-22, 6, k), kit.lerp(32e6, 8.6e6, k));`,
      );
    if (wanted('earth-limb'))
      await sandboxClip(
        rec,
        'earth-limb',
        `app.placeTowardSun('earth', 72, 30 + t * 0.9, kit.lerp(900e3, 700e3, kit.ease(t / 12)));
         kit.turn(-0.26, 0.5);`,
      );
  },

  /** The real Moon: the whole disc, then down over the south pole. */
  async 'real-moon'(rec, wanted) {
    await openSandbox(rec, 'sol&at=moon&date=2027-09-08T00:00:00Z&alt=2600000');
    await rec.page.evaluate(() => (window.__app.timeWarp = 0));
    if (wanted('moon'))
      await sandboxClip(rec, 'moon', `app.placeTowardSun('moon', 50, 10 + t * 4.8, 2.6e6);`);
    if (wanted('moonpole'))
      await sandboxClip(rec, 'moonpole', `app.placeOver('moon', -78, t * 0.5, 60000 - 1700 * t);`);
  },

  /** The real Mars: the disc, the approach from deep space, Jezero crater. */
  async 'real-mars'(rec, wanted) {
    await openSandbox(rec, 'sol&at=mars&date=2027-02-01T12:00:00Z&alt=6500000');
    await rec.page.evaluate(() => (window.__app.timeWarp = 0));
    if (wanted('mars')) await sandboxClip(rec, 'mars', `app.placeOver('mars', 0, -90 + 1.4 * t, 6.5e6);`);
    if (wanted('mars-approach'))
      await sandboxClip(
        rec,
        'mars-approach',
        `app.placeOver('mars', 8, -70 + 0.8 * t, kit.lerp(48e6, 9e6, kit.ease(t / 7.5)));`,
      );
    if (wanted('jezero')) {
      await rec.page.evaluate(() => {
        // The landing season of the Mars mission puts the Sun over Jezero.
        window.__app.simJd = 2461723.5;
      });
      // Low and oblique: the global map is about 5 km a pixel, so the view stays near the ground,
      // where the terrain's own detail carries the picture.
      await sandboxClip(
        rec,
        'jezero',
        `app.placeOver('mars', 18.4, 76.4 + 0.01 * t, 5200 - 120 * t);
         kit.turn(-0.14, 0);`,
      );
    }
  },

  /** Generated worlds: a ringed giant in the dark, an alien globe, a low pass, a ringed world. */
  async gen(rec, wanted) {
    if (wanted('space')) {
      await openSandbox(rec, 'kind=gasGiant&rings');
      await sandboxClip(
        rec,
        'space',
        `const b = kit.body('gasGiant');
         const k = kit.ease(t / 9.3);
         app.flight.placeAbove(b, kit.sunward(b, 0.95, 0.4 + t * 0.012), b.desc.radius * kit.lerp(7, 4.2, k));
         kit.turn(kit.lerp(0.12, 0.02, k), kit.lerp(0.55, 0.12, k));`,
      );
    }
    if (wanted('alien')) {
      await openSandbox(rec, 'kind=desert');
      await sandboxClip(
        rec,
        'alien',
        `const b = kit.body('desert');
         app.flight.placeAbove(b, kit.sunward(b, 0.85, 0.2 + t * 0.03), b.desc.radius * (1.25 - t * 0.04));`,
      );
    }
    if (wanted('alien-low')) {
      // Low over a generated ocean, flying toward the Sun's glint.
      await openSandbox(rec, 'kind=terra&alt=2000');
      await rec.page.evaluate(() => {
        // The start direction and the way ahead, kept fixed for the whole pass.
        const app = window.__app;
        const b = app.system.bodies.find((body) => body.desc.kind === 'terra');
        const up = app.flight.position.clone().sub(b.position).normalize();
        const ahead = b.sunDir.clone().addScaledVector(up, -b.sunDir.dot(up)).normalize();
        window.__trailer.pass = { b, up, axis: up.clone().cross(ahead).normalize() };
      });
      await sandboxClip(
        rec,
        'alien-low',
        `const p = window.__trailer.pass;
         const dir = p.up.clone().applyAxisAngle(p.axis, (300 * t) / p.b.desc.radius);
         app.flight.placeAbove(p.b, dir, 1800 + 40 * t);
         kit.turn(0.02, 0, 0.03 * Math.sin(t * 0.6));`,
      );
    }
    if (wanted('rings')) {
      await openSandbox(rec, 'rings&alt=400000');
      await rec.page.evaluate(() => {
        const app = window.__app;
        const b = app.system.bodies.find((body) => body.desc.kind === 'terra' && body.desc.rings);
        window.__trailer.pass = { b, up: app.flight.position.clone().sub(b.position).normalize() };
      });
      await sandboxClip(
        rec,
        'rings',
        `const p = window.__trailer.pass;
         app.flight.placeAbove(p.b, p.up.clone().applyAxisAngle(p.b.sunDir, t * 0.004), 400000 + 9000 * t);
         kit.turn(-0.16 + t * 0.006, 0.25);`,
      );
    }
  },

  /** The flight theatre, full screen, with the NASA-style reference designs. */
  async theatre(rec, wanted) {
    const page = await rec.open('/tools/trailer/stage.html');
    await page.waitForFunction(() => window.stageReady === true, null, { timeout: 120000 });
    const mission = async (id, phase) => {
      await page.evaluate((value) => window.stageMission(value), id);
      await stage(phase)(rec);
      await rec.settle(9000, 9);
    };
    if (['th-pad', 'th-launch', 'th-cruise', 'th-arrival', 'th-rover'].some(wanted)) {
      await mission('mars_jezero_survey', 'standby');
      if (wanted('th-pad')) await rec.clip('th-pad');
      await stage('launch')(rec);
      if (wanted('th-launch')) await rec.clip('th-launch');
      await stage('cruise')(rec);
      if (wanted('th-cruise')) await rec.clip('th-cruise');
      await stage('arrival')(rec);
      if (wanted('th-arrival')) await rec.clip('th-arrival');
      await stage('operations')(rec);
      await rec.settle(1500, 6);
      if (wanted('th-rover')) await rec.clip('th-rover');
    }
    if (wanted('th-sat')) {
      await mission('earth_observation', 'operations');
      await rec.clip('th-sat');
    }
    if (wanted('th-moonrover')) {
      await mission('lunar_ice_prospector', 'operations');
      await rec.clip('th-moonrover');
    }
  },

  /** The design loop on the Mars mission: title, missions, briefing, hangar, trajectory, poll. */
  async ui(rec, wanted) {
    const page = await openGame(rec);
    await page
      .waitForSelector('.title-hero[data-ready]', { timeout: 90000 })
      .catch(() => console.log('no globe'));
    await rec.settle(2500, 6);
    if (wanted('title')) await rec.clip('title', choreography(rec, { zoom: [1, 1.07, 0.5, 0.45] }));
    await resetView(rec);
    await press(rec, 'New mission');
    await rec.settle(1500, 4);
    if (wanted('missions'))
      await rec.clip(
        'missions',
        choreography(rec, {
          zoom: [1.02, 1.08, 0.5, 0.4],
          actions: [
            { at: 1.6, move: 1.2, target: { css: '.scenario-card' }, hover: true },
            {
              at: 3.6,
              move: 1.2,
              target: { css: '.scenario-card:nth-of-type(2), .scenario-card ~ .scenario-card' },
              hover: true,
            },
            { at: 6.2, move: 1.4, target: { text: 'Mars', sel: '.scenario-card' }, hover: true },
            { at: 9.0, move: 1.6, target: { text: 'Open the galaxy map', sel: 'button' }, hover: true },
          ],
        }),
      );
    await resetView(rec);
    await page.evaluate(() => document.querySelectorAll('.scenario-card')[2].click());
    await rec.settle(700, 4);
    if (!(await page.evaluate(() => document.body.textContent.includes('Start the design'))))
      await press(rec, 'Open the briefing');
    await rec.settle(1200, 4);
    if (wanted('briefing'))
      await rec.clip(
        'briefing',
        choreography(rec, { zoom: [1.0, 1.06, 0.5, 0.3], scroll: { from: 0, to: 360 } }),
      );
    await resetView(rec);
    await press(rec, 'Start the design');
    await press(rec, 'Load the NASA-style baseline');
    await rec.settle(5000, 8);
    if (wanted('hangar-systems'))
      await rec.clip(
        'hangar-systems',
        choreography(rec, {
          zoom: [1.0, 1.05, 0.3, 0.45],
          pointer: [0.45, 0.6],
          actions: [
            { at: 0.9, move: 0.8, target: { text: 'Power source', sel: '.slot' } },
            { at: 2.4, move: 0.7, target: { text: 'Communications', sel: '.slot' } },
            { at: 3.9, move: 0.7, target: { text: 'Battery', sel: '.slot' } },
            { at: 5.5, move: 0.8, target: { text: 'Frame', sel: '.slot' } },
          ],
        }),
      );
    await resetView(rec);
    await page.evaluate(() => document.querySelector('.slot')?.click());
    await rec.settle(500, 2);
    if (wanted('hangar-budgets'))
      await rec.clip(
        'hangar-budgets',
        choreography(rec, {
          zoom: [1.18, 1.3, 0.92, 0.35],
          pointer: [0.6, 0.75],
          actions: [
            { at: 1.3, move: 1.0, target: { text: 'Why', sel: '.budget-more summary' } },
            { at: 3.9, move: 1.0, target: { css: '.budget-line:nth-child(4) .budget-more summary' } },
            { at: 6.2, move: 0.9, target: { css: '.budget-line:nth-child(6) .budget-more summary' } },
          ],
        }),
      );
    await resetView(rec);
    await page.evaluate(() => {
      for (const details of document.querySelectorAll('.budget-more')) details.open = false;
    });
    if (wanted('hangar-mass'))
      await rec.clip(
        'hangar-mass',
        choreography(rec, {
          zoom: [1.06, 1.12, 0.62, 0.3],
          pointer: [0.5, 0.8],
          actions: [
            { at: 1.0, move: 0.9, target: { text: 'Heavy-duty frame', sel: '.part-card' } },
            { at: 3.2, move: 0.8, target: { text: 'Power source', sel: '.slot' } },
            { at: 5.0, move: 0.9, target: { text: 'Sun-tracking mast array', sel: '.part-card' } },
          ],
        }),
      );
    await resetView(rec);
    await press(rec, 'Load the NASA-style baseline');
    await rec.settle(3000, 6);
    if (wanted('vehicle')) {
      const big = await rec.css(
        // The hangar view draws on a transparent canvas: full screen it needs a backdrop of its own.
        '.vehicle-3d canvas { position: fixed !important; inset: 0 !important; width: 100vw !important; ' +
          'height: 100vh !important; z-index: 9000 !important; ' +
          'background: radial-gradient(ellipse 60% 55% at 50% 42%, #10233a, #04070d 72%) !important; } ' +
          '.vehicle-hint { display: none !important; }',
      );
      await rec.settle(2500, 6);
      // The vehicle changes as parts go on: a mast array, then the active suspension.
      const change = async (slot, part) => {
        await page.evaluate(
          ([s, p]) => {
            const find = (sel, text) =>
              [...document.querySelectorAll(sel)].find((n) => n.textContent.includes(text));
            find('.slot', s)?.click();
            setTimeout(() => find('.part-card', p)?.click(), 0);
          },
          [slot, part],
        );
      };
      let step = 0;
      await rec.clip('vehicle', async (t) => {
        if (step === 0 && t >= 5.2) {
          step = 1;
          await change('Power source', 'Sun-tracking mast array');
        }
        if (step === 1 && t >= 8.0) {
          step = 2;
          await change('Mobility', 'Four-wheel steering');
        }
      });
      await big.evaluate((node) => node.remove());
      await press(rec, 'Load the NASA-style baseline');
    }
    await press(rec, 'Plan the trajectory');
    await rec.settle(3000, 6);
    if (wanted('trajectory')) {
      const chart = await page.evaluate(() => {
        const node = document.querySelector('.porkchop');
        return node
          ? node.getBoundingClientRect().top + document.querySelector('.shell main').scrollTop - 120
          : 400;
      });
      await rec.clip(
        'trajectory',
        choreography(rec, {
          zoom: [1.0, 1.06, 0.5, 0.5],
          scroll: { from: 0, to: chart, start: 0.3, end: 3.6 },
          actions: [
            {
              at: 5.4,
              move: 1.2,
              target: { css: '.porkchop svg, .porkchop canvas, .porkchop', fx: 0.58, fy: 0.42 },
              mouse: true,
            },
          ],
        }),
      );
    }
    await resetView(rec);
    await press(rec, 'Call the Go/No-Go poll');
    await rec.settle(1500, 4);
    if (wanted('poll'))
      await rec.clip(
        'poll',
        choreography(rec, {
          zoom: [1.04, 1.1, 0.5, 0.4],
          actions: [{ at: 1.7, move: 1.2, target: { text: 'All four roles', sel: 'button' } }],
        }),
      );
    if (wanted('forecast')) {
      const top = await page.evaluate(() => {
        const node = [...document.querySelectorAll('button')].find((b) =>
          b.textContent.includes('Simulate 200'),
        );
        return node
          ? Math.max(
              0,
              node.getBoundingClientRect().top + document.querySelector('.shell main').scrollTop - 160,
            )
          : 0;
      });
      await page.evaluate((y) => document.querySelector('.shell main')?.scrollTo(0, y), top);
      let ran = false;
      await rec.clip('forecast', async (t, total) => {
        if (!ran && t >= 0.4) {
          ran = true;
          await page.evaluate(() =>
            [...document.querySelectorAll('button')]
              .find((b) => b.textContent.includes('Simulate 200'))
              ?.click(),
          );
          // The forecast runs in a worker in real time: wait for its result before the next frame.
          await page
            .waitForFunction(() => document.body.textContent.includes('Typical score'), null, {
              timeout: 120000,
            })
            .catch(() => console.log('forecast never finished'));
        }
        await page.evaluate(
          ([scale]) => {
            const root = document.getElementById('shell-root');
            root.style.transformOrigin = `86% ${0.45 * window.innerHeight}px`;
            root.style.transform = `scale(${scale})`;
          },
          [lerp(1.05, 1.1, t / total)],
        );
      });
    }
  },

  /** The debrief after two flights with one change between them, then the daily mission. */
  async debrief(rec, wanted) {
    await openGame(rec);
    await toBriefing(rec);
    await press(rec, 'Start the design');
    await press(rec, 'Load the NASA-style baseline');
    await flyToDebrief(rec);
    // Change one thing (a smaller battery) and fly again, so the debrief can compare the runs.
    await rec.page.evaluate(() => {
      location.hash = '#/design';
    });
    await rec.settle(1500, 4);
    await press(rec, 'Battery', '.slot');
    await press(rec, 'Lithium-ion battery, 2 kWh', '.part-card');
    await flyToDebrief(rec);
    await rec.page.evaluate(() => document.querySelector('.shell main')?.scrollTo(0, 0));
    if (wanted('debrief')) {
      const runs = await rec.page.evaluate(() => {
        const table = document.querySelector('.run-table');
        return table
          ? table.getBoundingClientRect().top + document.querySelector('.shell main').scrollTop - 260
          : 900;
      });
      await rec.clip(
        'debrief',
        choreography(rec, {
          zoom: [1.0, 1.06, 0.5, 0.4],
          scroll: { from: 0, to: runs, start: 2.5, end: 11.5 },
          actions: [
            { at: 14.2, move: 1.4, target: { css: '.run-table tr.current td:last-child' }, hover: true },
          ],
        }),
      );
    }
  },

  /** Playing together: the crew screen, its roles, and the room code. */
  async crew(rec, wanted) {
    await openGame(rec);
    await press(rec, 'Play together');
    await rec.settle(1200, 4);
    if (wanted('crew')) {
      const seat = (n) => ({ css: `.crew-option:first-child label:nth-of-type(${n}) input` });
      await rec.clip(
        'crew',
        choreography(rec, {
          zoom: [1.04, 1.1, 0.35, 0.45],
          pointer: [0.3, 0.8],
          actions: [
            { at: 0.6, move: 0.5, target: seat(1), type: 'Ana' },
            { at: 1.4, move: 0.4, target: seat(2), type: 'Kai' },
            { at: 2.2, move: 0.4, target: seat(3), type: 'Mo' },
            { at: 3.0, move: 0.4, target: seat(4), type: 'Sam' },
            { at: 4.4, move: 0.8, target: { text: 'Start with this crew', sel: 'button' } },
          ],
        }),
      );
      await resetView(rec);
    }
    if (wanted('room')) {
      await openGame(rec);
      await press(rec, 'Play together');
      await rec.settle(1200, 4);
      await rec.clip(
        'room',
        choreography(rec, {
          zoom: [1.06, 1.12, 0.66, 0.5],
          pointer: [0.6, 0.85],
          actions: [{ at: 0.9, move: 0.8, target: { css: '.code-input' }, type: 'ORBIT7', perLetter: 0.12 }],
        }),
      );
    }
  },

  /** The daily mission: one seed for everyone, shown on the Go/No-Go poll. */
  async daily(rec) {
    await openGame(rec);
    await press(rec, 'Daily mission');
    await rec.settle(1200, 4);
    if (!(await rec.page.evaluate(() => document.body.textContent.includes('Start the design'))))
      await press(rec, 'Open the briefing');
    await press(rec, 'Start the design');
    await press(rec, 'Load the NASA-style baseline');
    await press(rec, 'Plan the trajectory');
    await press(rec, 'Call the Go/No-Go poll');
    const top = await rec.page.evaluate(() => {
      const node = [...document.querySelectorAll('p, div')].find(
        (n) => n.children.length < 3 && n.textContent.startsWith('Daily mission:'),
      );
      return node
        ? Math.max(
            0,
            node.getBoundingClientRect().top + document.querySelector('.shell main').scrollTop - 300,
          )
        : 0;
    });
    await rec.page.evaluate((y) => document.querySelector('.shell main')?.scrollTo(0, y), top);
    await rec.clip('daily', choreography(rec, { zoom: [1.06, 1.14, 0.18, 0.5] }));
  },

  /** The galaxy map: turning the 3D chart, opening a system, picking a world. */
  async map(rec, wanted) {
    const page = await openGame(rec);
    await press(rec, 'New mission');
    await press(rec, 'Open the galaxy map');
    await rec.settle(6000, 10);
    const chart = await page.evaluate(() => {
      const box = document.querySelector('.map-stage canvas').getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, w: box.width };
    });
    if (wanted('map-galaxy')) {
      // A slow drag turns the chart; part way through, a star system opens from the list.
      let dragging = false;
      let opened = false;
      await rec.clip('map-galaxy', async (t) => {
        if (t < 6.4) {
          const x = chart.x - chart.w * 0.18 + chart.w * 0.36 * ease(t / 6.4);
          if (!dragging) {
            await page.mouse.move(x, chart.y);
            await page.mouse.down();
            dragging = true;
          } else await page.mouse.move(x, chart.y + 20 * Math.sin(t));
        } else if (dragging) {
          await page.mouse.up();
          dragging = false;
        }
        if (!opened && t >= 6.8) {
          opened = true;
          await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.tree-row')];
            rows[1]?.click();
          });
          await page.waitForTimeout(400);
          await page.evaluate(() =>
            [...document.querySelectorAll('.map-info button')].find((b) => b.textContent.length > 0)?.click(),
          );
        }
        if (t > 7.4) await page.mouse.move(chart.x, chart.y);
      });
    }
    if (wanted('map-world')) {
      await rec.clip(
        'map-world',
        choreography(rec, {
          zoom: [1.0, 1.08, 0.82, 0.45],
          pointer: [0.3, 0.7],
          actions: [{ at: 1.1, move: 1.0, target: { text: 'rock', sel: '.tree-row' } }],
        }),
      );
    }
  },

  /**
   * The hand-flown landing at Jezero, as a time-lapse. A simple pilot holds the keys a player would:
   * Space when sinking faster than a safe profile for the height, and the side thrusters against
   * any drift, so the clip ends on a touchdown.
   */
  async descent(rec) {
    await openGame(rec);
    await toBriefing(rec);
    await press(rec, 'Start the design');
    await press(rec, 'Load the NASA-style baseline');
    await press(rec, 'Plan the trajectory');
    await press(rec, 'Call the Go/No-Go poll');
    await press(rec, 'All four roles');
    await press(rec, 'Launch');
    const page = rec.page;
    // Run the mission log on until the landing is handed over.
    for (let guard = 0; ; guard++) {
      if (guard > 900) throw new Error('the landing was never handed over');
      const ready = await page.evaluate(() =>
        [...document.querySelectorAll('button')].some((b) =>
          b.textContent.includes('Fly the landing yourself'),
        ),
      );
      if (ready) break;
      await page.clock.runFor(200);
    }
    await press(rec, 'Fly the landing yourself');
    // The 3D engine starts in real time, then holds the craft until the ground below exists.
    for (let guard = 0; ; guard++) {
      if (guard > 600) throw new Error('the descent never started');
      if (await page.evaluate(() => Boolean(window.__app?.flight?.descent))) break;
      await page.clock.runFor(40);
      await page.waitForTimeout(500);
    }
    const held = new Set();
    const hold = async (key, on) => {
      if (on && !held.has(key)) {
        held.add(key);
        await page.keyboard.down(key);
      } else if (!on && held.has(key)) {
        held.delete(key);
        await page.keyboard.up(key);
      }
    };
    /** Reads the craft, holds the keys for this frame; returns the flight state or null once down. */
    const pilot = async () => {
      const state = await page.evaluate(() => {
        // After the touchdown and its hold the game closes the 3D view: the app is gone.
        const flight = window.__app?.flight;
        if (!flight) return null;
        const d = flight.descent;
        const body = flight.telemetry.body;
        if (!d || !body || d.outcome) return null;
        const up = flight.position.clone().sub(body.position).normalize();
        const forward = up.clone().set(0, 0, -1).applyQuaternion(flight.orientation);
        forward.addScaledVector(up, -forward.dot(up)).normalize();
        const right = forward.clone().cross(up);
        const v = flight.velocity;
        return {
          h: flight.telemetry.altitude,
          vs: d.verticalSpeed,
          brake: Math.max(0.3, d.thrustAcceleration - d.gravity),
          left: d.availableDeltaV - d.deltaVUsed,
          ahead: v.dot(forward),
          side: v.dot(right),
        };
      });
      if (!state) {
        for (const key of [...held]) await hold(key, false);
        return null;
      }
      // Fall on a stopping curve a little inside the engine's limit; creep in over the last metres.
      const height = Math.max(0, state.h - 2);
      state.target = -Math.max(1.2, PILOT_MARGIN * Math.sqrt(2 * state.brake * height));
      await hold('Space', state.vs < state.target);
      await hold('KeyS', state.ahead > 0.5);
      await hold('KeyW', state.ahead < -0.5);
      await hold('KeyA', state.side > 0.5);
      await hold('KeyD', state.side < -0.5);
      return state;
    };
    const report = (label, s) =>
      console.log(
        `${label} h ${s.h.toFixed(0)} m, vs ${s.vs.toFixed(1)} (target ${s.target.toFixed(1)}), ` +
          `drift ${Math.hypot(s.ahead, s.side).toFixed(1)}, dv left ${s.left.toFixed(0)} m/s`,
      );
    // Time-lapse at 3x, one render per video frame. Fly the first part off camera so the 3D view,
    // which closes 3.5 s (game time) after the touchdown, lasts to the end of the clip. The
    // stopping-curve estimate runs about 2 s long against the real flight.
    const SPEED = 3;
    await rec.pace(SPEED);
    const clipFlight = clipSeconds().descent * SPEED;
    for (let step = 0; step < 600; step++) {
      const state = await pilot();
      if (!state) break;
      if (step % 10 === 0) report('pre-roll', state);
      const remaining = Math.sqrt((2 * Math.max(0, state.h - 2)) / state.brake) / PILOT_MARGIN;
      if (remaining <= clipFlight - 2.5) break;
      await page.clock.runFor(100);
    }
    let frame = 0;
    await rec.clip(
      'descent',
      async () => {
        const state = await pilot();
        if (state && frame % 10 === 0) report('clip', state);
        frame++;
      },
      { speed: SPEED },
    );
  },
};
