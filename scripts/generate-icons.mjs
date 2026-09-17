/**
 * Generates the extension icons as PNGs with no image-library dependency.
 *
 * A flat navy rounded square with a white "A" glyph, drawn pixel by pixel and
 * written as a minimal PNG (zlib deflate + CRC32). Run: npm run icons
 *
 * With --inttra: the INTTRA Helper's icons, a teal square with a white "I",
 * into inttra-extension/icons. Run: npm run icons:inttra
 *
 * With --quickfill: the Quickfill Helper's icons, an amber square with a white
 * "Q", into quickfill-extension/icons. Run: npm run icons:quickfill
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inttra = process.argv.includes('--inttra');
const quickfill = process.argv.includes('--quickfill');
const outDir = quickfill
  ? join(here, '..', 'quickfill-extension', 'icons')
  : inttra
    ? join(here, '..', 'inttra-extension', 'icons')
    : join(here, '..', 'extension', 'icons');

const NAVY = quickfill ? [146, 64, 14] : inttra ? [15, 92, 99] : [18, 58, 92];
const WHITE = [255, 255, 255];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Distance from a point to a rounded-rectangle, for anti-aliased corners. */
function insideRoundedRect(x, y, size, radius) {
  const margin = 0;
  const min = margin;
  const max = size - 1 - margin;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  const dx = x - cx;
  const dy = y - cy;
  return Math.hypot(dx, dy) <= radius + 0.5;
}

/** The "I" glyph: a stem with serifs top and bottom, scaled to the icon size. */
function insideGlyphI(x, y, size) {
  const unit = size / 16;
  const top = 3.2 * unit;
  const bottom = 12.6 * unit;
  if (y < top || y > bottom) return false;
  const centre = size / 2;
  const stroke = Math.max(unit * 1.6, 1.4);
  const serif = Math.max(unit * 1.2, 1.2);
  const halfSerif = 2.6 * unit;
  const stem = Math.abs(x - centre) <= stroke / 2;
  const topSerif = y <= top + serif && Math.abs(x - centre) <= halfSerif;
  const bottomSerif = y >= bottom - serif && Math.abs(x - centre) <= halfSerif;
  return stem || topSerif || bottomSerif;
}

/** The "Q" glyph: a ring with a tail across its lower right, scaled to the icon size. */
function insideGlyphQ(x, y, size) {
  const unit = size / 16;
  const centre = size / 2;
  const radius = 4.2 * unit;
  const stroke = Math.max(unit * 1.5, 1.4);
  const dx = x - centre;
  const dy = y - centre;
  const ring = Math.abs(Math.hypot(dx, dy) - radius) <= stroke / 2;
  // The tail: a short diagonal from the ring's lower right, outward.
  const tail = dx >= 0.8 * unit && dy >= 0.8 * unit && Math.abs(dx - dy) <= stroke / 2 && Math.hypot(dx, dy) <= radius + 2.2 * unit;
  return ring || tail;
}

/** The "A" glyph: two legs and a crossbar, scaled to the icon size. */
function insideGlyph(x, y, size) {
  if (quickfill) return insideGlyphQ(x, y, size);
  if (inttra) return insideGlyphI(x, y, size);
  const unit = size / 16;
  const top = 3.2 * unit;
  const bottom = 12.6 * unit;
  if (y < top || y > bottom) return false;

  const progress = (y - top) / (bottom - top);
  const halfWidth = (1.1 + 3.6 * progress) * unit;
  const stroke = Math.max(unit * 1.15, 1.2);
  const centre = size / 2;

  const leftLeg = Math.abs(x - (centre - halfWidth)) <= stroke / 2;
  const rightLeg = Math.abs(x - (centre + halfWidth)) <= stroke / 2;

  const barY = top + (bottom - top) * 0.66;
  const bar = Math.abs(y - barY) <= stroke / 2 && Math.abs(x - centre) <= halfWidth;

  return leftLeg || rightLeg || bar;
}

function renderIcon(size) {
  const radius = Math.max(2, Math.round(size * 0.18));
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const offset = 1 + x * 4;
      if (!insideRoundedRect(x, y, size, radius)) {
        row[offset] = 0;
        row[offset + 1] = 0;
        row[offset + 2] = 0;
        row[offset + 3] = 0;
        continue;
      }
      const color = insideGlyph(x, y, size) ? WHITE : NAVY;
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = 255;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, renderIcon(size));
  console.log(`wrote ${file}`);
}
