// Draws the black-and-white comic art used across the game: the title backdrop layers,
// the matching card back and the table felt. Pure vector output, so it stays sharp at any size.
// Red appears only where poker already uses it: hearts, diamonds and one chip colour.
// Usage: node scripts/gen-comic-art.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/textures/', import.meta.url));
const RED = '#e5001e';
const INK = '#0b0b0b';
const PAPER = '#ffffff';
const PAPER_WARM = '#f3f1ec';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const f = (n) => Number(n.toFixed(1));

function spikyPath(cx, cy, n, outer, inner, jitter, seed) {
  const r = rng(seed);
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + (r() - 0.5) * 0.08;
    const rad = (i % 2 ? inner : outer) * (1 - jitter / 2 + r() * jitter);
    d += `${i ? 'L' : 'M'}${f(cx + rad * Math.cos(a))} ${f(cy + rad * Math.sin(a))}`;
  }
  return `${d}Z`;
}

// Halftone: dots on a 45° grid whose radius follows `weight(x, y)` in [0, 1].
function halftone(w, h, step, maxR, weight, fill, opacity = 1) {
  let d = '';
  for (let gy = -step; gy < h + step; gy += step * 0.7071) {
    const row = Math.round(gy / (step * 0.7071));
    for (let gx = (row % 2 ? step / 2 : 0) - step; gx < w + step; gx += step) {
      const rad = maxR * weight(gx, gy);
      if (rad < 0.7) continue;
      d += `M${f(gx - rad)} ${f(gy)}a${f(rad)} ${f(rad)} 0 1 0 ${f(rad * 2)} 0a${f(rad)} ${f(rad)} 0 1 0 ${f(-rad * 2)} 0`;
    }
  }
  return `<path d="${d}" fill="${fill}"${opacity < 1 ? ` opacity="${opacity}"` : ''}/>`;
}

const SUITS = {
  s: 'M0 -46C12 -30 46 -10 46 13C46 31 26 39 10 30C12 41 18 48 26 51H-26C-18 48 -12 41 -10 30C-26 39 -46 31 -46 13C-46 -10 -12 -30 0 -46Z',
  h: 'M0 46C-22 30 -48 12 -48 -12C-48 -32 -31 -44 -16 -44C-7 -44 0 -38 0 -29C0 -38 7 -44 16 -44C31 -44 48 -32 48 -12C48 12 22 30 0 46Z',
  d: 'M0 -50Q18 -22 36 0Q18 22 0 50Q-18 22 -36 0Q-18 -22 0 -50Z',
  c: 'M0 -46a21 21 0 0 1 16 35a21 21 0 1 1 7 38c-9 0 -15 -4 -19 -10l6 34h-20l6 -34c-4 6 -10 10 -19 10a21 21 0 1 1 7 -38a21 21 0 0 1 16 -35Z',
};
const suitTint = (s) => (s === 'h' || s === 'd' ? RED : INK);

// The game's own chip (the bet marker at the table): eight wedges alternating white and red,
// starting white at twelve o'clock, inside a heavy ink rim. `turn` rotates it in degrees.
function wedgeAngle(i, turn) { return ((i * 45 + turn - 90) * Math.PI) / 180; }

function gameChip(cx, cy, r, turn = 0) {
  let wedges = '';
  for (let i = 0; i < 8; i++) {
    const a0 = wedgeAngle(i, turn);
    const a1 = wedgeAngle(i + 1, turn);
    wedges += `<path d="M${cx} ${cy}L${f(cx + r * Math.cos(a0))} ${f(cy + r * Math.sin(a0))}A${r} ${r} 0 0 1 ${f(cx + r * Math.cos(a1))} ${f(cy + r * Math.sin(a1))}Z" fill="${i % 2 ? RED : PAPER}"/>`;
  }
  return `<g>${wedges}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="${f(r * 0.16)}"/></g>`;
}

// The same chip lying flat in a stack, seen from the front: its wedges reach the rim as red and
// white bands, and the top face shows the pinwheel squashed into an ellipse.
function stackedChip(cx, y, rx, ry, h, turn) {
  const edge = (phi, dy) => `${f(cx + rx * Math.cos(phi))} ${f(y + dy + ry * Math.sin(phi))}`;
  let rim = '';
  for (let i = 0; i < 16; i++) {
    const w = i % 8;
    let from = wedgeAngle(i, turn);
    let to = wedgeAngle(i + 1, turn);
    // Only the front half of the rim (angles 0..π) faces the viewer.
    from = Math.max(from, 0);
    to = Math.min(to, Math.PI);
    if (to <= from) continue;
    let d = `M${edge(from, 0)}`;
    for (let s = 1; s <= 8; s++) d += `L${edge(from + ((to - from) * s) / 8, 0)}`;
    for (let s = 8; s >= 0; s--) d += `L${edge(from + ((to - from) * s) / 8, h)}`;
    rim += `<path d="${d}Z" fill="${w % 2 ? RED : PAPER}"/>`;
  }
  const outline = `<path d="M${f(cx - rx)} ${y}V${y + h}A${rx} ${ry} 0 0 0 ${f(cx + rx)} ${y + h}V${y}" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
  let face = '';
  for (let i = 0; i < 8; i++) {
    const a0 = wedgeAngle(i, turn);
    const a1 = wedgeAngle(i + 1, turn);
    face += `<path d="M${cx} ${y}L${edge(a0, 0)}A${rx} ${ry} 0 0 1 ${edge(a1, 0)}Z" fill="${i % 2 ? RED : PAPER}"/>`;
  }
  return `${rim}${outline}${face}<ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-width="7"/>`;
}

// ---------- title backdrop: rotating focus lines (manga speed lines) ----------
{
  const r = rng(5);
  let d = '';
  const lines = 150;
  for (let i = 0; i < lines; i++) {
    const a = (i / lines) * Math.PI * 2 + (r() - 0.5) * 0.02;
    const width = 0.004 + r() * 0.014;
    const inner = 330 + r() * 260;
    d += `M${f(inner * Math.cos(a))} ${f(inner * Math.sin(a))}L${f(1500 * Math.cos(a - width))} ${f(1500 * Math.sin(a - width))}L${f(1500 * Math.cos(a + width))} ${f(1500 * Math.sin(a + width))}Z`;
  }
  fs.writeFileSync(`${out}comic-burst.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1000 -1000 2000 2000">
  <rect x="-1000" y="-1000" width="2000" height="2000" fill="${PAPER_WARM}"/>
  <path d="${d}" fill="${INK}"/>
</svg>
`);
}

// ---------- title backdrop: halftone corners, slabs, scattered suits and chips ----------
{
  const W = 1920;
  const H = 1080;
  const r = rng(11);
  const corner = (x, y) => {
    const dl = Math.hypot(x, H - y) / 820;
    const tr = Math.hypot(W - x, y) / 700;
    return Math.max(0, 1 - Math.min(dl, tr));
  };
  let scatter = '';
  const spots = [[1790, 130, 44, 's'], [1650, 330, 24, 'h'], [140, 150, 36, 'd'], [330, 80, 18, 'c'], [1470, 80, 20, 'd'], [990, 110, 28, 'h'], [1860, 560, 22, 'c'], [90, 520, 26, 's'], [1120, 270, 16, 's'], [1280, 980, 30, 'h'], [1540, 860, 20, 's']];
  for (const [x, y, s, suit] of spots) {
    const rot = f((r() - 0.5) * 50);
    const solid = r() > 0.45;
    scatter += `<path d="${SUITS[suit]}" transform="translate(${x} ${y}) rotate(${rot}) scale(${f(s / 50)})" fill="${solid ? suitTint(suit) : PAPER}" stroke="${INK}" stroke-width="${f(Math.max(5, 260 / s))}" stroke-linejoin="round"/>`;
  }
  let shards = '';
  for (let i = 0; i < 12; i++) {
    const x = 60 + r() * 1800;
    const y = 60 + r() * 760;
    const s = 10 + r() * 24;
    const a = r() * Math.PI * 2;
    shards += `M${f(x + s * Math.cos(a))} ${f(y + s * Math.sin(a))}L${f(x + s * Math.cos(a + 2.3))} ${f(y + s * Math.sin(a + 2.3))}L${f(x + s * 0.5 * Math.cos(a + 4))} ${f(y + s * 0.5 * Math.sin(a + 4))}Z`;
  }
  fs.writeFileSync(`${out}comic-scene.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  ${halftone(W, H, 24, 10, corner, INK)}
  <path d="M-40 ${H + 40}V${H - 300}L260 ${H - 420}L200 ${H - 360}L760 ${H - 620}L700 ${H - 560}L1180 ${H + 40}Z" fill="${INK}"/>
  <path d="M-40 ${H - 322}L744 ${H - 668}L752 ${H - 652}L-40 ${H - 300}Z" fill="${INK}"/>
  <path d="M${W + 40} -40H${W - 540}L${W - 486} 64L${W - 660} 158L${W + 40} 430Z" fill="${INK}"/>
  <path d="M${W - 560} -40L${W - 504} 66L${W - 690} 160L${W + 40} 452V470L${W - 718} 160L${W - 532} 66L${W - 590} -40Z" fill="${INK}"/>
  ${gameChip(1500, 1000, 70, 10)}${gameChip(1640, 1040, 56, -14)}${gameChip(250, 1010, 48, 22)}
  <path d="${shards}" fill="${INK}"/>
  ${scatter}
</svg>
`);
}

// ---------- title backdrop: comic burst plate, and the chips that sit in front of the hand ----------
// The hand itself is real <Card> elements, so it follows the chosen card theme.
{
  // Five chips, each a little out of line with the one below, like a real stack.
  let stack = '<ellipse cx="786" cy="890" rx="104" ry="36" fill="#000" opacity=".45"/>';
  [[0, 0], [4, 17], [-3, 31], [5, 9], [-2, 24]].forEach(([dx, turn], i) => {
    stack += stackedChip(780 + dx, 842 - i * 26, 96, 34, 26, turn);
  });
  fs.writeFileSync(`${out}comic-emblem.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <g transform="rotate(-7 500 520)">
    <path d="${spikyPath(516, 536, 17, 480, 372, 0.18, 3)}" fill="${INK}"/>
    <path d="${spikyPath(500, 520, 17, 470, 366, 0.18, 3)}" fill="${PAPER}" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
    <path d="${spikyPath(500, 520, 17, 410, 330, 0.2, 9)}" fill="${INK}"/>
    ${halftone(1000, 1000, 17, 6.2, (x, y) => Math.max(0, 1 - Math.hypot(x - 500, y - 480) / 400), PAPER)}
  </g>
</svg>
`);
  fs.writeFileSync(`${out}comic-chips.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <g transform="rotate(-7 500 520)">
    ${stack}
    ${gameChip(220, 800, 74, 12)}
  </g>
</svg>
`);
}

// ---------- card back ----------
fs.writeFileSync(`${out}comic-card.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" preserveAspectRatio="xMidYMid slice">
  <rect width="250" height="350" fill="${INK}"/>
  ${halftone(250, 350, 11, 4, (x, y) => Math.max(0, 1 - Math.hypot(x - 250, y) / 250), PAPER, 0.9)}
  ${halftone(250, 350, 11, 4, (x, y) => Math.max(0, 1 - Math.hypot(x, y - 350) / 250), PAPER, 0.9)}
  <path d="M-10 254L260 74V124L-10 304Z" fill="${PAPER}"/>
  <path d="M-10 242L260 62V67L-10 247Z" fill="${PAPER}"/>
  <rect x="12" y="12" width="226" height="326" rx="8" fill="none" stroke="${PAPER}" stroke-width="4"/>
  <circle cx="125" cy="175" r="52" fill="${INK}" stroke="${PAPER}" stroke-width="6"/>
  <path d="${SUITS.s}" transform="translate(125 172) scale(.62)" fill="${PAPER}"/>
</svg>
`);

// ---------- table felt ----------
{
  const W = 1600;
  const H = 900;
  const ring = (x, y) => {
    const d = Math.hypot((x - W / 2) / 1.6, y - H / 2);
    return Math.max(0, 1 - Math.abs(d - 330) / 115) * 0.8;
  };
  fs.writeFileSync(`${out}comic-table.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="felt" cx=".5" cy=".48" r=".72"><stop offset="0" stop-color="#2c2c2c"/><stop offset=".62" stop-color="#171717"/><stop offset="1" stop-color="#070707"/></radialGradient>
    <pattern id="stripe" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="7" height="18" fill="#ffffff" opacity=".02"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#felt)"/>
  <rect width="${W}" height="${H}" fill="url(#stripe)"/>
  ${halftone(W, H, 22, 6.5, ring, PAPER, 0.16)}
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="700" ry="372" fill="none" stroke="${PAPER}" stroke-opacity=".24" stroke-width="3" stroke-dasharray="26 12"/>
  <path d="${SUITS.s}" transform="translate(${W / 2} ${H / 2 + 6}) scale(2.7)" fill="none" stroke="${PAPER}" stroke-opacity=".12" stroke-width="3"/>
</svg>
`);
}

// ---------- page background for lobby, settings and table screens ----------
// Transparent, so the table theme's page colour shows through and sets the tone.
{
  const W = 1920;
  const H = 1080;
  const dots = (x, y) => Math.max(0, 1 - Math.hypot(x - W * 0.85, y - H * 0.1) / 900) * 0.9;
  const dots2 = (x, y) => Math.max(0, 1 - Math.hypot(x - W * 0.08, y - H) / 800) * 0.9;
  fs.writeFileSync(`${out}comic-page.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  ${halftone(W, H, 22, 7, dots, PAPER, 0.08)}
  ${halftone(W, H, 22, 7, dots2, PAPER, 0.08)}
  <path d="M-40 ${H - 180}L${W * 0.42} ${H + 40}H-40Z" fill="#000" opacity=".35"/>
  <path d="M${W + 40} 160L${W * 0.62} -40H${W + 40}Z" fill="#000" opacity=".35"/>
  <path d="M-40 ${H - 196}L${W * 0.42 + 24} ${H + 40}" stroke="${PAPER}" stroke-opacity=".12" stroke-width="3"/>
</svg>
`);
}

for (const name of ['comic-burst', 'comic-scene', 'comic-emblem', 'comic-chips', 'comic-card', 'comic-table', 'comic-page']) {
  console.log(name, fs.statSync(`${out}${name}.svg`).size);
}
