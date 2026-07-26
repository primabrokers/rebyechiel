// Generates the PWA icons (pure Node, no deps): the app mark from the Rov Console design —
// a white ר on the single indigo accent, full bleed so Android's maskable crop can't clip it.
// Rerun with: node scripts/gen-icons.cjs
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Signed distance to a thick line segment — the two strokes a ר is made of. */
function sdSegment(px, py, ax, ay, bx, by, halfWidth) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - vx * t, wy - vy * t) - halfWidth;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const INDIGO = [0x5b, 0x4b, 0xe8], INDIGO_DEEP = [0x45, 0x36, 0xcc];
  const WHITE = [0xff, 0xff, 0xff];

  // ר: a top bar running right-to-left, and a stem descending from its right end. Kept inside
  // the central 60% so a maskable crop never bites into it.
  const x0 = size * 0.315, x1 = size * 0.655;
  const yTop = size * 0.345, yBot = size * 0.685;
  const half = size * 0.058;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // A quiet diagonal in the accent, so the tile has some depth at 512px.
      const t = (x + y) / (2 * size);
      let r = lerp(INDIGO[0], INDIGO_DEEP[0], t);
      let g = lerp(INDIGO[1], INDIGO_DEEP[1], t);
      let b = lerp(INDIGO[2], INDIGO_DEEP[2], t);

      const d = Math.min(
        sdSegment(x, y, x0, yTop, x1, yTop, half), // the bar
        sdSegment(x, y, x1, yTop, x1, yBot, half), // the stem
      );
      if (d < 0) {
        r = WHITE[0]; g = WHITE[1]; b = WHITE[2];
      } else if (d < 1.2) {
        const a = 1 - d / 1.2;
        r = lerp(r, WHITE[0], a); g = lerp(g, WHITE[1], a); b = lerp(b, WHITE[2], a);
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return encodePng(size, px);
}

const out = path.join(__dirname, '..', 'public');
fs.mkdirSync(out, { recursive: true });
for (const size of [192, 512, 180]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(out, name), drawIcon(size));
  console.log('wrote', name);
}
