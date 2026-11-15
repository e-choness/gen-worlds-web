// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Turns text into SVG path data with the brand fonts, so the media kit's SVGs look the same
// everywhere: an SVG shown as an image cannot load web fonts, and system fonts differ per machine.
import { readFileSync } from 'node:fs';
import * as opentypeModule from 'opentype.js';

const opentype = opentypeModule.parse ? opentypeModule : opentypeModule.default;

const FONT_FILES = {
  display: 'node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff',
  medium: 'node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff',
  mono: 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff',
};

const cache = new Map();
function font(name) {
  if (!cache.has(name)) {
    const bytes = readFileSync(FONT_FILES[name]);
    cache.set(
      name,
      opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    );
  }
  return cache.get(name);
}

/** The font files as data URIs, for HTML pages rendered by the browser (social card, icons). */
export function fontFaces() {
  return Object.entries(FONT_FILES)
    .map(([name, file]) => {
      const family = name === 'mono' ? 'JetBrains Mono' : 'Space Grotesk';
      const weight = name === 'display' ? 600 : 500;
      const data = readFileSync(file).toString('base64');
      return `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff;base64,${data}) format("woff")}`;
    })
    .join('\n');
}

/**
 * A glyph's outline as path data, placed with its origin at (x, y). Built from the glyph's own
 * commands in font units: opentype.js 2.0's `getPath` drops some coordinates as NaN.
 */
function outline(glyph, x, y, scale) {
  const n = (value) => Number(value.toFixed(2));
  const px = (value) => n(x + value * scale);
  const py = (value) => n(y - value * scale);
  return glyph.path.commands
    .map((c) => {
      if (c.type === 'M' || c.type === 'L') return `${c.type}${px(c.x)} ${py(c.y)}`;
      if (c.type === 'Q') return `Q${px(c.x1)} ${py(c.y1)} ${px(c.x)} ${py(c.y)}`;
      if (c.type === 'C') return `C${px(c.x1)} ${py(c.y1)} ${px(c.x2)} ${py(c.y2)} ${px(c.x)} ${py(c.y)}`;
      return 'Z';
    })
    .join('');
}

/**
 * Lays out one line of text. `tracking` is extra space between letters in em (0.1 = 10 %).
 * Returns the path data and the advance width, in the same units as `size`.
 */
export function textPath(text, { face = 'display', size, x = 0, y = 0, tracking = 0, anchor = 'start' }) {
  const f = font(face);
  const scale = size / f.unitsPerEm;
  const glyphs = f.stringToGlyphs(text);
  const advances = glyphs.map((glyph, index) => {
    const next = glyphs[index + 1];
    const kern = next ? f.getKerningValue(glyph, next) : 0;
    return (glyph.advanceWidth + kern) * scale + (next ? tracking * size : 0);
  });
  const width = advances.reduce((sum, value) => sum + value, 0);
  let pen = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const parts = [];
  glyphs.forEach((glyph, index) => {
    parts.push(outline(glyph, pen, y, scale));
    pen += advances[index];
  });
  return { d: parts.filter(Boolean).join(''), width };
}
