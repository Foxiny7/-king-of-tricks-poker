// Draws the red dry-brush 千王 that sits behind the white title, from Ma Shan Zheng
// (SIL OFL 1.1) outlines, so the page ships one small SVG and no font.
// Usage: npm i --no-save opentype.js@2 && node scripts/gen-title-brush.mjs <MaShanZheng-Regular.ttf>
// Font source: https://github.com/google/fonts/tree/main/ofl/mashanzheng
import opentype from 'opentype.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/textures/title-brush.svg', import.meta.url));
const buf = fs.readFileSync(process.argv[2]);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// One glyph, centred on (cx, cy) before its own rotation.
function glyph(ch, size, cx, cy, rotate) {
  const g = font.charToGlyph(ch);
  const box = g.getPath(0, 0, size).getBoundingBox();
  const d = g.getPath(-(box.x1 + box.x2) / 2, -(box.y1 + box.y2) / 2, size).toPathData(1);
  return `<path d="${d}" transform="translate(${cx} ${cy}) rotate(${rotate})"/>`;
}

// Ink flicked off the brush: a few droplets and one long dry streak.
const r = rng(17);
let splatter = '';
for (let i = 0; i < 22; i++) {
  const x = 40 + r() * 920;
  const y = 30 + r() * 440;
  const rad = 1.5 + r() * r() * 9;
  splatter += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}"/>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500">
  <defs>
    <filter id="dry" x="-6%" y="-6%" width="112%" height="112%">
      <feTurbulence type="fractalNoise" baseFrequency=".022 .38" numOctaves="3" seed="6" result="grain"/>
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -7 5.9" result="bristles"/>
      <feComposite in="SourceGraphic" in2="bristles" operator="in" result="brushed"/>
      <feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="3" seed="21" result="wobble"/>
      <feDisplacementMap in="brushed" in2="wobble" scale="12" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g fill="#d3001c" stroke="#d3001c" stroke-width="18" stroke-linejoin="round" filter="url(#dry)">
    ${glyph('千', 520, 285, 250, -7)}
    ${glyph('王', 500, 725, 262, 5)}
  </g>
  <g fill="#d3001c" opacity=".9">${splatter}<path d="M40 430C260 404 520 420 960 380L962 386C540 430 280 418 42 438Z"/></g>
</svg>
`;
fs.writeFileSync(out, svg);
console.log('title-brush.svg', fs.statSync(out).size, 'bytes');
