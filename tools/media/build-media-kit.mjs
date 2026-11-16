// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Builds the media kit under media/ (logos, the animated banner, the social card, icons, the
// screenshot set) and the site's favicon and link-preview image under public/. Runs inside the
// `capture` compose service, which has Chromium for rasterising:
//   docker compose run --rm capture node tools/media/build-media-kit.mjs
// The GIFs are encoded afterwards from the frames it leaves in .cache/media (see media/README.md).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fontFaces, textPath } from './glyphs.mjs';

const C = {
  space: '#04070d',
  panel: '#0a1220',
  fg: '#eef4fb',
  dim: '#8fa3b8',
  accent: '#6fd3ff',
  deep: '#1d5e9e',
  warn: '#ffb454',
  ok: '#5fe0a8',
  ink: '#0b1420',
};
const OUT = 'media';
const FRAMES = '.cache/media/banner-frames';
for (const dir of [OUT, `${OUT}/logo`, `${OUT}/banners`, `${OUT}/screenshots`, `${OUT}/icons`])
  mkdirSync(dir, { recursive: true });

/** Deterministic pseudo-random numbers, so the stars are the same on every build. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const f = (value) => Number(value.toFixed(2));

// --- the mark: a world, its orbit, and a spacecraft on it -----------------------------------------

/** The mark's drawing at 64 × 64, with ids prefixed so several marks can share one document. */
function markBody(id) {
  return `<defs>
<radialGradient id="${id}p" cx="36%" cy="32%" r="72%"><stop offset="0" stop-color="#d4f5ff"/><stop offset=".32" stop-color="${C.accent}"/><stop offset=".72" stop-color="${C.deep}"/><stop offset="1" stop-color="#0b2240"/></radialGradient>
<linearGradient id="${id}n" x1="0" y1="0" x2="1" y2="1"><stop offset=".45" stop-color="${C.space}" stop-opacity="0"/><stop offset="1" stop-color="${C.space}" stop-opacity=".75"/></linearGradient>
</defs>
<g transform="rotate(-18 32 32)" fill="none" stroke-linecap="round"><path d="M4 32A28 9 0 0 1 60 32" stroke="${C.accent}" stroke-opacity=".42" stroke-width="2.2"/></g>
<circle cx="32" cy="32" r="17" fill="url(#${id}p)"/>
<circle cx="32" cy="32" r="17" fill="url(#${id}n)"/>
<g transform="rotate(-18 32 32)" fill="none" stroke-linecap="round"><path d="M60 32A28 9 0 0 1 4 32" stroke="${C.accent}" stroke-width="2.6"/>
<circle cx="50" cy="38.9" r="3.4" fill="${C.warn}" stroke="${C.space}" stroke-width="1.4"/></g>`;
}

const markSvg = (size = 64) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Gen Worlds">${markBody('m')}</svg>\n`;

function wordmarkSvg(textColour, tagColour) {
  const name = textPath('Gen Worlds', { face: 'display', size: 44, x: 78, y: 47, tracking: 0.005 });
  const tag = textPath('SPACE MISSION DESIGN GAME', {
    face: 'medium',
    size: 11.5,
    x: 79,
    y: 66,
    tracking: 0.2,
  });
  const width = Math.ceil(Math.max(78 + name.width, 79 + tag.width) + 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="76" viewBox="0 0 ${width} 76" role="img" aria-label="Gen Worlds: Space Mission Design Game">
<g transform="translate(2 6)">${markBody('w')}</g>
<path fill="${textColour}" d="${name.d}"/>
<path fill="${tagColour}" d="${tag.d}"/>
</svg>\n`;
}

// --- the animated banner ---------------------------------------------------------------------------

// One drawing in two frames: the wide header, and a 16:9 YouTube thumbnail (1280 × 720, the size
// YouTube recommends). The globe, its orbit and their line weights scale with the globe's radius `r`
// (148 in the header); `texture` is the width of the Earth map wrapped onto it, in pixels.
const BANNER = {
  width: 1280,
  height: 360,
  cx: 1012,
  cy: 186,
  r: 148,
  loop: 12,
  stars: 170,
  texture: 768,
  haze: { cx: 260, cy: 40, r: 520 },
  label: 'Gen Worlds: design a space mission, then fly it. NASA Space Apps Challenge 2026, Calgary.',
  lines: [
    {
      text: 'NASA SPACE APPS CHALLENGE 2026 · CALGARY',
      face: 'medium',
      size: 14,
      x: 74,
      y: 86,
      tracking: 0.22,
      fill: C.accent,
    },
    { text: 'Gen Worlds', face: 'display', size: 92, x: 68, y: 170, tracking: -0.01, fill: C.fg },
    {
      text: 'Design a space mission. Then fly it.',
      face: 'medium',
      size: 27,
      x: 72,
      y: 214,
      fill: '#b9c7d8',
    },
  ],
  budgets: { x: 74, bar: 150, length: 236, height: 5, y: 254, step: 24, size: 11.5, labelDy: 5 },
  rocket: true,
};
// Sized to read at the few hundred pixels YouTube shows it at: a bigger title, the tagline on two
// lines, and the game's descriptor in place of the event line. A still, so its globe is projected
// pixel by pixel (`still`: the longitude at its centre, degrees, the header still's view) rather
// than by the displacement filter, whose 8-bit map steps the coastlines at this size.
const THUMBNAIL = {
  width: 1280,
  height: 720,
  cx: 1000,
  cy: 372,
  r: 250,
  loop: 12,
  stars: 340,
  texture: 2048,
  still: -65.25,
  haze: { cx: 300, cy: 70, r: 760 },
  label: 'Gen Worlds: design a space mission, then fly it.',
  lines: [
    {
      text: 'SPACE MISSION DESIGN GAME',
      face: 'medium',
      size: 22,
      x: 74,
      y: 170,
      tracking: 0.22,
      fill: C.accent,
    },
    { text: 'Gen Worlds', face: 'display', size: 124, x: 66, y: 290, tracking: -0.01, fill: C.fg },
    { text: 'Design a space mission.', face: 'medium', size: 46, x: 71, y: 370, fill: '#b9c7d8' },
    { text: 'Then fly it.', face: 'medium', size: 46, x: 71, y: 426, fill: C.accent },
  ],
  budgets: { x: 74, bar: 200, length: 330, height: 8, y: 500, step: 36, size: 17, labelDy: 6 },
  rocket: false,
};

/** `maps` comes from globeMaps: a turning globe (earth + sphere) or a still one (disc). */
function bannerSvg(layout, maps) {
  const { width, height, cx, cy, r, loop } = layout;
  const s = r / BANNER.r; // line weights and the orbit follow the globe's size
  const random = lcg(2026);
  const stars = [];
  for (let index = 0; index < layout.stars; index++) {
    const x = f(random() * width);
    const y = f(random() * height);
    const size = f(0.35 + random() ** 3 * 1.25);
    const alpha = f(0.25 + random() * 0.65);
    const warm = random() < 0.2;
    const colour = warm ? '#ffe4c4' : random() < 0.3 ? '#cfe6ff' : '#ffffff';
    if (random() < 0.22) {
      // Twinkle periods divide the loop, so the GIF (one loop long) repeats without a jump.
      const dur = [2, 3, 4, 6][Math.floor(random() * 4)];
      const begin = f(random() * 5);
      stars.push(
        `<circle cx="${x}" cy="${y}" r="${size}" fill="${colour}" opacity="${alpha}"><animate attributeName="opacity" values="${alpha};${f(alpha * 0.15)};${alpha}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`,
      );
    } else stars.push(`<circle cx="${x}" cy="${y}" r="${size}" fill="${colour}" opacity="${alpha}"/>`);
  }

  // Text, converted to outlines.
  const text = layout.lines
    .map(({ fill, ...line }) => `<path fill="${fill}" d="${textPath(line.text, line).d}"/>`)
    .join('\n');
  // Three live budgets: they fill as a design comes together, and power runs short for a moment.
  // Fill widths are in the header's units (a 236-wide track) and scale to this layout's track.
  const rows = [
    { label: 'MASS', values: '0;0;168;168;176;176;0', colour: null },
    { label: 'POWER', values: '0;0;0;206;206;150;150;0', colour: true },
    { label: 'DATA', values: '0;0;0;132;132;132;0', colour: null },
  ];
  const b = layout.budgets;
  const bars = rows
    .map((row, index) => {
      const y = b.y + index * b.step;
      const label = textPath(row.label, {
        face: 'mono',
        size: b.size,
        x: b.x,
        y: y + b.labelDy,
        tracking: 0.14,
      });
      const values = row.values
        .split(';')
        .map((value) => f((value * b.length) / 236))
        .join(';');
      const count = row.values.split(';').length;
      const times = Array.from({ length: count }, (_, i) =>
        i === count - 1 ? 1 : f(Math.min(0.9, (i / (count - 1)) * 0.9 + index * 0.03)),
      );
      times[0] = 0;
      const fill = row.colour
        ? `<animate attributeName="fill" values="${C.accent};${C.accent};${C.warn};${C.warn};${C.accent};${C.accent}" keyTimes="0;.4;.46;.62;.68;1" dur="${loop}s" repeatCount="indefinite"/>`
        : '';
      return `<path fill="${C.dim}" d="${label.d}"/>
<rect x="${b.bar}" y="${y - (b.height - 1) / 2}" width="${b.length}" height="${b.height}" rx="${b.height / 2}" fill="${C.accent}" fill-opacity=".14"/>
<rect x="${b.bar}" y="${y - (b.height - 1) / 2}" width="0" height="${b.height}" rx="${b.height / 2}" fill="${C.accent}"><animate attributeName="width" values="${values}" keyTimes="${times.join(';')}" dur="${loop}s" repeatCount="indefinite" calcMode="spline" keySplines="${Array(
        count - 1,
      )
        .fill('.4 0 .2 1')
        .join(';')}"/>${fill}</rect>`;
    })
    .join('\n');

  // The orbit, drawn as a back half (behind the world) and a front half.
  const orbit = { rx: f(262 * s), ry: f(54 * s), tilt: -13 };
  const back = `M${cx - orbit.rx} ${cy}A${orbit.rx} ${orbit.ry} 0 0 1 ${cx + orbit.rx} ${cy}`;
  const front = `M${cx + orbit.rx} ${cy}A${orbit.rx} ${orbit.ry} 0 0 1 ${cx - orbit.rx} ${cy}`;
  const lap = `${front}A${orbit.rx} ${orbit.ry} 0 0 1 ${cx + orbit.rx} ${cy}`;
  const craft = (visibility) =>
    `<g>${visibility}<animateMotion path="${lap}" dur="${loop}s" repeatCount="indefinite"/><circle r="${f(9 * s)}" fill="${C.warn}" opacity=".18"/><circle r="${f(3.4 * s)}" fill="${C.warn}"/><circle r="${f(1.4 * s)}" fill="#fff6e6"/></g>`;
  // The rocket's climb is drawn for the header's frame only.
  const rocket = layout.rocket
    ? `<g opacity="0"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.03;.2;.25;1" dur="${loop}s" repeatCount="indefinite"/><animateMotion path="M690 392Q712 170 860 -40" rotate="auto" keyPoints="0;1;1" keyTimes="0;.25;1" calcMode="linear" dur="${loop}s" repeatCount="indefinite"/><rect x="-96" y="-1.3" width="96" height="2.6" rx="1.3" fill="url(#trail)"/><circle r="7" fill="#ffcf8a" opacity=".35"/><circle r="2.6" fill="#fff"/></g>\n`
    : '';
  const globe = maps.disc
    ? `<image href="${maps.disc}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}"/>`
    : `<g filter="url(#sphere)"><g><animateTransform attributeName="transform" type="translate" from="0 0" to="${-4 * r} 0" dur="96s" repeatCount="indefinite"/>
<image href="${maps.earth}" xlink:href="${maps.earth}" x="${cx - r}" y="${cy - r}" width="${4 * r}" height="${2 * r}" preserveAspectRatio="none"/>
<image href="${maps.earth}" xlink:href="${maps.earth}" x="${cx + 3 * r}" y="${cy - r}" width="${4 * r}" height="${2 * r}" preserveAspectRatio="none"/>
</g></g>`;

  const box = { x: cx - r, y: cy - r, size: 2 * r };
  const sphereScale = f(1.4 * r);
  const { haze } = layout;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${layout.label}">
<defs>
<radialGradient id="glow" cx="${cx}" cy="${cy}" r="${f(430 * s)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1b4a7a" stop-opacity=".55"/><stop offset=".45" stop-color="#132a4a" stop-opacity=".25"/><stop offset="1" stop-color="${C.space}" stop-opacity="0"/></radialGradient>
<radialGradient id="haze" cx="${haze.cx}" cy="${haze.cy}" r="${haze.r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2a1d4a" stop-opacity=".35"/><stop offset="1" stop-color="${C.space}" stop-opacity="0"/></radialGradient>
<clipPath id="disc"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
<filter id="sphere" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" color-interpolation-filters="sRGB">
<feImage href="${maps.sphere}" xlink:href="${maps.sphere}" x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" preserveAspectRatio="none" result="map"/>
<feDisplacementMap in="SourceGraphic" in2="map" scale="${sphereScale}" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<radialGradient id="limb" cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 1.45}" gradientUnits="userSpaceOnUse"><stop offset=".35" stop-color="#ffffff" stop-opacity=".08"/><stop offset=".62" stop-color="${C.space}" stop-opacity="0"/><stop offset="1" stop-color="${C.space}" stop-opacity=".92"/></radialGradient>
<linearGradient id="night" x1="${cx - r * 0.55}" y1="${cy - r * 0.35}" x2="${cx + r}" y2="${cy + r * 0.45}" gradientUnits="userSpaceOnUse"><stop offset=".38" stop-color="${C.space}" stop-opacity="0"/><stop offset=".72" stop-color="${C.space}" stop-opacity=".78"/><stop offset="1" stop-color="${C.space}" stop-opacity=".96"/></linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${f(7 * s)}"/></filter>
<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd9a8" stop-opacity="0"/><stop offset=".75" stop-color="#ffd9a8" stop-opacity=".55"/><stop offset="1" stop-color="#fff"/></linearGradient>
</defs>
<rect width="${width}" height="${height}" fill="${C.space}"/>
<rect width="${width}" height="${height}" fill="url(#haze)"/>
<rect width="${width}" height="${height}" fill="url(#glow)"/>
<g>${stars.join('')}</g>
<g transform="rotate(${orbit.tilt} ${cx} ${cy})" fill="none"><path d="${back}" stroke="${C.accent}" stroke-opacity=".28" stroke-width="${f(1.6 * s)}" stroke-dasharray="${f(2 * s)} ${f(7 * s)}" stroke-linecap="round"/>${craft('')}</g>
<circle cx="${cx}" cy="${cy}" r="${f(r + 5 * s)}" fill="none" stroke="${C.accent}" stroke-opacity=".55" stroke-width="${f(10 * s)}" filter="url(#soft)"/>
<g clip-path="url(#disc)">
<rect x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" fill="#0b2a4a"/>
${globe}
<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#night)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#limb)"/>
</g>
<circle cx="${cx}" cy="${cy}" r="${f(r - 0.8 * s)}" fill="none" stroke="#9fdcff" stroke-opacity=".5" stroke-width="${f(1.6 * s)}"/>
<g transform="rotate(${orbit.tilt} ${cx} ${cy})" fill="none"><path d="${front}" stroke="${C.accent}" stroke-opacity=".75" stroke-width="${f(1.8 * s)}" stroke-linecap="round"/>${craft(`<animate attributeName="opacity" values="1;0" keyTimes="0;.5" calcMode="discrete" dur="${loop}s" repeatCount="indefinite"/>`)}</g>
${rocket}${text}
${bars}
</svg>\n`;
}

// --- rasterising --------------------------------------------------------------------------------

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ deviceScaleFactor: 1 });
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;

// A layout's globe, made with a canvas: the Earth texture and the sphere map for a turning globe, or
// for a still one (`layout.still`) the disc itself, projected pixel by pixel.
await page.setContent('<canvas></canvas>');
const globeMaps = (layout) =>
  page.evaluate(globeMapsInPage, {
    source: dataUrl('public/maps/earth_albedo_4k.jpg', 'image/jpeg'),
    radius: layout.r,
    texture: layout.texture,
    still: layout.still,
  });
async function globeMapsInPage({ source, radius, texture, still }) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.querySelector('canvas');
  const context = canvas.getContext('2d');
  canvas.width = texture;
  canvas.height = texture / 2;
  context.filter = 'saturate(1.12) brightness(1.08)';
  context.drawImage(image, 0, 0, texture, texture / 2);
  if (still !== undefined) {
    // Orthographic view centred on longitude `still`, bilinear samples, at twice the drawn size;
    // transparent outside the disc, with half a pixel of coverage at the rim.
    const map = context.getImageData(0, 0, texture, texture / 2);
    const [W, H] = [texture, texture / 2];
    const size = Math.round(radius * 4);
    const half = size / 2;
    canvas.width = size;
    canvas.height = size;
    const out = context.createImageData(size, size);
    const centre = (still * Math.PI) / 180;
    const at = (x, y, c) => map.data[(y * W + x) * 4 + c];
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const u = (px + 0.5 - half) / half;
        const v = (half - (py + 0.5)) / half;
        const rr = u * u + v * v;
        if (rr >= 1) continue;
        const latitude = Math.asin(v);
        const ring = Math.max(1e-6, Math.cos(latitude));
        const longitude = centre + Math.asin(Math.max(-1, Math.min(1, u / ring)));
        const x = ((((longitude / (2 * Math.PI) + 0.5) % 1) + 1) % 1) * W - 0.5;
        const y = Math.min(H - 1.001, Math.max(0, (0.5 - latitude / Math.PI) * H - 0.5));
        const [x0, y0] = [Math.floor(x), Math.floor(y)];
        const [fx, fy] = [x - x0, y - y0];
        const [xa, xb] = [(x0 + W) % W, (x0 + 1) % W];
        const o = (py * size + px) * 4;
        for (let c = 0; c < 3; c++) {
          const top = at(xa, y0, c) * (1 - fx) + at(xb, y0, c) * fx;
          const bottom = at(xa, y0 + 1, c) * (1 - fx) + at(xb, y0 + 1, c) * fx;
          out.data[o + c] = top * (1 - fy) + bottom * fy;
        }
        out.data[o + 3] = Math.round(255 * Math.min(1, (1 - Math.sqrt(rr)) * half));
      }
    }
    context.putImageData(out, 0, 0);
    return { disc: canvas.toDataURL('image/png') };
  }
  const earthUrl = canvas.toDataURL('image/jpeg', 0.74);
  // Displacement map: for each point of the disc, how far to reach into the flat map so that it
  // looks wrapped onto a sphere (orthographic view, longitude ±90° across the disc).
  const size = Math.round(radius * 2);
  canvas.width = size;
  canvas.height = size;
  context.filter = 'none';
  const pixels = context.createImageData(size, size);
  const scale = 1.4 * radius;
  const perRadian = (2 * radius) / Math.PI;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5 - radius) / radius;
      const v = (radius - (py + 0.5)) / radius;
      let dx = 0;
      let dy = 0;
      if (u * u + v * v < 1) {
        const latitude = Math.asin(v);
        const ring = Math.max(1e-6, Math.cos(latitude));
        const longitude = Math.asin(Math.max(-1, Math.min(1, u / ring)));
        dx = longitude * perRadian - u * radius;
        dy = -latitude * perRadian + v * radius;
      }
      const o = (py * size + px) * 4;
      pixels.data[o] = Math.round(Math.max(0, Math.min(255, (0.5 + dx / scale) * 255)));
      pixels.data[o + 1] = Math.round(Math.max(0, Math.min(255, (0.5 + dy / scale) * 255)));
      pixels.data[o + 2] = 128;
      pixels.data[o + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return { earth: earthUrl, sphere: canvas.toDataURL('image/png') };
}

const banner = bannerSvg(BANNER, await globeMaps(BANNER));
writeFileSync(`${OUT}/banners/banner-animated.svg`, banner);
writeFileSync(`${OUT}/logo/mark.svg`, markSvg());
writeFileSync(`${OUT}/logo/wordmark-light.svg`, wordmarkSvg(C.fg, C.dim));
writeFileSync(`${OUT}/logo/wordmark-dark.svg`, wordmarkSvg(C.ink, '#4a5d72'));
writeFileSync('public/favicon.svg', markSvg());

const css = `<style>${fontFaces()}html,body{margin:0;background:transparent}</style>`;
async function render(html, file, width, height, { transparent = false, scale = 1 } = {}) {
  await page.setViewportSize({ width, height });
  const shot = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await shot.setContent(`<!doctype html><meta charset="utf-8">${css}${html}`);
  await shot.evaluate(() => document.fonts.ready);
  await shot.waitForTimeout(250);
  await shot.screenshot({
    path: file,
    omitBackground: transparent,
    type: file.endsWith('.jpg') ? 'jpeg' : 'png',
    ...(file.endsWith('.jpg') ? { quality: 90 } : {}),
  });
  await shot.close();
}

// Icons.
const markImg = (size, background) =>
  `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${background};border-radius:${background === 'transparent' ? 0 : size * 0.22}px">${markSvg(Math.round(size * (background === 'transparent' ? 1 : 0.84)))}</div>`;
await render(markImg(512, 'transparent'), `${OUT}/icons/mark-512.png`, 512, 512, { transparent: true });
await render(markImg(512, C.space), `${OUT}/icons/app-icon-512.png`, 512, 512);
await render(markImg(180, C.space), 'public/apple-touch-icon.png', 180, 180);
await render(markImg(192, C.space), `${OUT}/icons/app-icon-192.png`, 192, 192);
for (const [name, colour] of [
  ['wordmark-light', C.space],
  ['wordmark-dark', '#ffffff'],
]) {
  const svg = readFileSync(`${OUT}/logo/${name}.svg`, 'utf8');
  await render(
    `<div style="display:inline-block;padding:0;background:transparent">${svg.replace(/width="(\d+)" height="76"/, (_, w) => `width="${w * 4}" height="304"`)}</div>`,
    `${OUT}/logo/${name}@4x.png`,
    Number(svg.match(/width="(\d+)"/)[1]) * 4,
    304,
    { transparent: true },
  );
  void colour;
}

// The banner as a still (for places that do not animate SVG) and as frames for the GIF, and the
// YouTube thumbnail. Stills are taken mid-loop, with the budgets filled and the rocket gone.
async function still(svg, layout, file, scale) {
  const shot = await browser.newPage({
    viewport: { width: layout.width, height: layout.height },
    deviceScaleFactor: scale,
  });
  await shot.setContent(`<!doctype html><style>html,body{margin:0;background:${C.space}}</style>${svg}`);
  await shot.waitForTimeout(400);
  await shot.evaluate(() => {
    const element = document.querySelector('svg');
    element.pauseAnimations();
    element.setCurrentTime(6.6);
  });
  await shot.screenshot({ path: file });
  await shot.close();
}
await still(banner, BANNER, `${OUT}/banners/banner.png`, 2);
const thumbnail = bannerSvg(THUMBNAIL, await globeMaps(THUMBNAIL));
await still(thumbnail, THUMBNAIL, `${OUT}/banners/youtube-thumbnail.png`, 1);
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
{
  const framePage = await browser.newPage({ viewport: { width: BANNER.width, height: BANNER.height } });
  await framePage.setContent(
    `<!doctype html><style>html,body{margin:0;background:${C.space}}</style>${banner}`,
  );
  await framePage.waitForTimeout(500);
  // The globe turns once in 96 s, eight loops: in a one-loop GIF it would jump back at every repeat,
  // so the GIF's globe holds still.
  await framePage.evaluate(() => document.querySelector('animateTransform')?.remove());
  const fps = 15;
  for (let index = 0; index < BANNER.loop * fps; index++) {
    await framePage.evaluate((seconds) => {
      const svg = document.querySelector('svg');
      svg.pauseAnimations();
      svg.setCurrentTime(seconds);
    }, index / fps);
    await framePage.screenshot({ path: `${FRAMES}/${String(index).padStart(4, '0')}.png` });
  }
  await framePage.close();
}

// Screenshots: the 3D flight at twice the resolution (cut above its caption strip, which may already
// show the next line of the log), and the 2D screens from the demo video.
const pick = [
  ['01-title.jpg', '.cache/video/frames/0060.jpg', 640],
  ['02-hangar.jpg', '.cache/video/frames/0200.jpg', 640],
  ['03-trajectory.jpg', '.cache/video/frames/0300.jpg', 640],
  ['04-flight-launch.jpg', 'shots/hi-mars-4.png', 740],
  ['05-flight-cruise.jpg', 'shots/hi-mars-9.png', 740],
  ['06-flight-parachute.jpg', 'shots/th-mars-13.png', 370],
  ['07-flight-mars-rover.jpg', 'shots/hi-mars-24.png', 740],
  ['08-flight-moon-rover.jpg', 'shots/hi-moon-14.png', 740],
  ['09-flight-earth-orbit.jpg', 'shots/hi-earth-18.png', 740],
  ['10-flight-mission-log.jpg', '.cache/video/frames/0640.jpg', 640],
  ['11-debrief.jpg', '.cache/video/frames/0790.jpg', 640],
  ['12-galaxy-map.png', 'shots/kit-map.png'],
];
for (const [name, source, cropHeight] of pick) {
  if (!existsSync(source)) {
    console.log(`missing ${source}`);
    continue;
  }
  if (!cropHeight) {
    copyFileSync(source, `${OUT}/screenshots/${name}`);
    continue;
  }
  const crop = await browser.newPage({ viewport: { width: 2400, height: 1200 } });
  await crop.setContent(`<style>body{margin:0}</style><img src="${dataUrl(source, 'image/png')}">`);
  const width = await crop.evaluate(() => document.querySelector('img').naturalWidth);
  // Two pixels in from each edge: the stage's own border is not part of the picture.
  await crop.screenshot({
    path: `${OUT}/screenshots/${name}`,
    type: 'jpeg',
    quality: 90,
    clip: { x: 2, y: 2, width: width - 4, height: cropHeight - 2 },
  });
  await crop.close();
}

// Social card (GitHub social preview, Open Graph and X/Twitter): 1280 × 640.
const hero = dataUrl(`${OUT}/screenshots/07-flight-mars-rover.jpg`, 'image/jpeg');
const wordmark = readFileSync(`${OUT}/logo/wordmark-light.svg`, 'utf8');
const card = `<div style="position:relative;width:1280px;height:640px;overflow:hidden;background:${C.space};font-family:'Space Grotesk';color:${C.fg}">
<img src="${hero}" style="position:absolute;left:60px;top:-30px;height:700px;width:auto">
<div style="position:absolute;inset:0;background:linear-gradient(90deg,${C.space} 34%,rgba(4,7,13,.82) 46%,rgba(4,7,13,.1) 64%,rgba(4,7,13,0))"></div>
<div style="position:absolute;inset:auto 0 0 0;height:120px;background:linear-gradient(0deg,rgba(4,7,13,.85),rgba(4,7,13,0))"></div>
<div style="position:absolute;left:72px;top:64px">${wordmark.replace(/width="(\d+)" height="76"/, (_, w) => `width="${w * 1.25}" height="95"`)}</div>
<div style="position:absolute;left:76px;top:206px;width:660px">
<div style="font:600 56px/1.08 'Space Grotesk';letter-spacing:-.01em">Design a space mission.<br><span style="color:${C.accent}">Then fly it.</span></div>
<div style="margin-top:26px;font:500 25px/1.45 'Space Grotesk';color:#b9c7d8">Nine live budgets explain every trade-off. Real NASA data sets the windows. One to four players, in your browser.</div>
</div>
<div style="position:absolute;left:76px;bottom:58px;display:flex;gap:14px;align-items:center;font:500 19px 'JetBrains Mono';letter-spacing:.04em">
<span style="color:${C.accent}">gen-worlds.surf</span><span style="color:#4a5d72">/</span><span style="color:${C.dim}">NASA Space Apps Challenge 2026 · Calgary</span></div>
</div>`;
await render(card, `${OUT}/banners/social-preview.png`, 1280, 640);
copyFileSync(`${OUT}/banners/social-preview.png`, 'public/og-image.png');

await browser.close();
console.log('media kit built');
