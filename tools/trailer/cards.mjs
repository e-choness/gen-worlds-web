// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
// Renders the trailer's text as transparent 1920 × 1080 PNGs (feature captions, data credits, the
// title and the end card) with the brand fonts and logo, for ffmpeg to lay over the footage. Runs in
// the `capture` compose service:  node tools/trailer/cards.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fontFaces } from '../media/glyphs.mjs';
import { CARDS } from './plan.mjs';

const outDir = '.cache/trailer/cards';
mkdirSync(outDir, { recursive: true });

const C = {
  space: '#04070d',
  accent: '#6fd3ff',
  thruster: '#ffb454',
  fg: '#eef4fb',
  dust: '#8fa3b8',
};
const mark = readFileSync('media/logo/mark.svg', 'utf8');

const css = `${fontFaces()}
html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
body { position: relative; color: ${C.fg}; font-family: 'Space Grotesk'; }
.scrim-low { position: absolute; left: 0; right: 0; bottom: 0; height: 480px;
  background: linear-gradient(to top, rgba(4,7,13,.95), rgba(4,7,13,.9) 58%, rgba(4,7,13,.62) 80%, rgba(4,7,13,0)); }
.feature { position: absolute; left: 112px; bottom: 104px; max-width: 1300px; }
.feature.top { top: 96px; bottom: auto; }
.scrim-top { position: absolute; left: 0; right: 0; top: 0; height: 480px;
  background: linear-gradient(to bottom, rgba(4,7,13,.9), rgba(4,7,13,.82) 58%, rgba(4,7,13,.5) 80%, rgba(4,7,13,0)); }
.eyebrow { font: 500 26px/1 'JetBrains Mono'; letter-spacing: .16em; text-transform: uppercase;
  color: ${C.accent}; display: flex; align-items: center; gap: 18px; }
.eyebrow::before { content: ''; width: 44px; height: 2px; background: ${C.accent}; }
.line { margin-top: 22px; font: 600 64px/1.1 'Space Grotesk'; letter-spacing: -.01em;
  text-shadow: 0 2px 24px rgba(0,0,0,.55); }
.sub { margin-top: 16px; font: 500 32px/1.35 'Space Grotesk'; color: #c7d4e3; text-shadow: 0 2px 16px rgba(0,0,0,.6); }
.credit { position: absolute; right: 96px; bottom: 72px; font: 500 22px/1 'JetBrains Mono';
  letter-spacing: .08em; color: rgba(238,244,251,.82); text-shadow: 0 1px 8px rgba(0,0,0,.8); }
.place { position: absolute; left: 112px; top: 96px; }
.place .name { font: 600 72px/1 'Space Grotesk'; letter-spacing: .01em; text-shadow: 0 2px 30px rgba(0,0,0,.6); }
.place .eyebrow { margin-bottom: 20px; }
.title { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 30px;
  text-align: center; }
.wordmark { display: flex; align-items: center; gap: 40px; }
.wordmark svg { width: 150px; height: 150px; }
.wordmark span { font: 600 168px/1 'Space Grotesk'; letter-spacing: .1em; padding-left: .1em;
  text-shadow: 0 4px 60px rgba(0,0,0,.65); }
.tagline { font: 500 46px/1.3 'Space Grotesk'; color: #dbe6f2; text-shadow: 0 2px 24px rgba(0,0,0,.7); }
.tagline b { color: ${C.accent}; font-weight: 600; }
.scrim-mid { position: absolute; inset: 0;
  background: radial-gradient(ellipse 70% 55% at 50% 50%, rgba(4,7,13,.62), rgba(4,7,13,0) 75%); }
.end { position: absolute; inset: 0; background: ${C.space}; display: grid; place-content: center;
  justify-items: center; gap: 34px; text-align: center; }
.end .wordmark svg { width: 120px; height: 120px; }
.end .wordmark span { font-size: 132px; }
.end .url { font: 600 60px/1 'JetBrains Mono'; color: ${C.accent}; letter-spacing: .04em; margin-top: 18px; }
.end .facts { font: 500 30px/1 'JetBrains Mono'; color: ${C.dust}; letter-spacing: .1em; text-transform: uppercase; }
.end .glow { position: absolute; inset: 0;
  background: radial-gradient(ellipse 50% 40% at 50% 46%, rgba(29,94,158,.35), rgba(4,7,13,0) 70%); }
`;

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wordmark = () => `<div class="wordmark">${mark}<span>GEN WORLDS</span></div>`;

/** The HTML of one card; the card kinds are listed in plan.mjs. */
function html(card) {
  switch (card.kind) {
    case 'feature':
      return `<div class="scrim-${card.top ? 'top' : 'low'}"></div><div class="feature${card.top ? ' top' : ''}">
        ${card.eyebrow ? `<div class="eyebrow">${escapeHtml(card.eyebrow)}</div>` : ''}
        <div class="line">${escapeHtml(card.text)}</div>
        ${card.sub ? `<div class="sub">${escapeHtml(card.sub)}</div>` : ''}</div>`;
    case 'credit':
      return `<div class="credit">${escapeHtml(card.text)}</div>`;
    case 'place':
      return `<div class="place"><div class="eyebrow">${escapeHtml(card.eyebrow)}</div>
        <div class="name">${escapeHtml(card.text)}</div></div>
        ${card.credit ? `<div class="credit">${escapeHtml(card.credit)}</div>` : ''}`;
    case 'title':
      return `<div class="scrim-mid"></div><div class="title">${wordmark()}
        ${card.text ? `<div class="tagline">${card.text}</div>` : ''}</div>`;
    case 'end':
      return `<div class="end"><div class="glow"></div>${wordmark()}
        <div class="tagline">Design a space mission. <b>Then fly it.</b></div>
        <div class="url">gen-worlds.surf</div>
        <div class="facts">Free · In your browser · 1 to 4 players</div></div>`;
    default:
      throw new Error(`unknown card kind ${card.kind}`);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const card of CARDS) {
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body>${html(card)}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${outDir}/${card.id}.png`, omitBackground: true });
  console.log(card.id);
}
await browser.close();
