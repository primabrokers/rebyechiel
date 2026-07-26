// Generates the PWA icons (pure Node, no deps): a brass open sefer on midnight blue, with
// enough padding to survive Android's maskable crop. Rerun with: node scripts/gen-icons.cjs
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

// Signed distance of a rounded rectangle centred at (cx, cy).
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const BG = [0x0F, 0x1E, 0x33], BG2 = [0x27, 0x4B, 0x7E];
  const PAGE = [0xF3, 0xE8, 0xCF], EDGE = [0xB9, 0x8A, 0x2F];
  const c = size / 2;
  // Open-sefer geometry (relative to size): two page panels with a spine gap.
  const pageHW = size * 0.185, pageHH = size * 0.21, pageR = size * 0.035;
  const gap = size * 0.022;
  const leftCx = c - pageHW - gap, rightCx = c + pageHW + gap;
  const pageCy = c + size * 0.01;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Diagonal midnight gradient background (full bleed for maskable).
      const t = (x + y) / (2 * size);
      let r = lerp(BG[0], BG2[0], t), g = lerp(BG[1], BG2[1], t), b = lerp(BG[2], BG2[2], t);

      // Brass base under the pages (the binding), drawn first.
      const dBind = sdRoundRect(x, y, c, pageCy + pageHH * 0.55, pageHW * 2 + gap + size * 0.02, pageHH * 0.52, pageR);
      if (dBind < 0) { r = EDGE[0]; g = EDGE[1]; b = EDGE[2]; }

      // Pages.
      const dL = sdRoundRect(x, y, leftCx, pageCy, pageHW, pageHH, pageR);
      const dR = sdRoundRect(x, y, rightCx, pageCy, pageHW, pageHH, pageR);
      const d = Math.min(dL, dR);
      if (d < 0) {
        r = PAGE[0]; g = PAGE[1]; b = PAGE[2];
        // Text lines on each page: darker rules.
        const lineH = Math.max(1, size * 0.016);
        const lineGap = size * 0.062;
        for (let li = -2; li <= 2; li++) {
          const ly = pageCy + li * lineGap - size * 0.01;
          const inLeft = Math.abs(y - ly) < lineH && Math.abs(x - leftCx) < pageHW * 0.68;
          const inRight = Math.abs(y - ly) < lineH && Math.abs(x - rightCx) < pageHW * 0.68;
          if (inLeft || inRight) { r = 0x8A; g = 0x76; b = 0x4A; }
        }
      }
      // Soft anti-alias at page edges.
      if (d >= 0 && d < 1.2) {
        const a = 1 - d / 1.2;
        r = lerp(r, PAGE[0], a * 0.6); g = lerp(g, PAGE[1], a * 0.6); b = lerp(b, PAGE[2], a * 0.6);
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
