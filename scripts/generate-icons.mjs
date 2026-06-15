// One-off icon generator for the PWA manifest. No image libraries are
// available in this environment, so PNGs are encoded by hand (raw RGBA
// scanlines -> zlib deflate -> minimal PNG chunks).
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [8, 12, 20]; // #080c14 (matches --bg)
const FG = [99, 102, 241]; // #6366f1 (brand)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  // Prefix each scanline with a filter byte (0 = none).
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = chunk('IDAT', deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Draws a centered "T" glyph (two rects) at the given scale (0-1 of canvas size).
function paintIcon(size, { glyphScale, cornerRadius = 0 }) {
  const rgba = Buffer.alloc(size * size * 4);

  const radius = cornerRadius * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let inside = true;
      if (radius > 0) {
        // Check the four corner regions against the rounded-rect radius.
        const cx = x < radius ? radius : x > size - radius ? size - radius : x;
        const cy = y < radius ? radius : y > size - radius ? size - radius : y;
        if ((x < radius || x > size - radius) && (y < radius || y > size - radius)) {
          const dx = x - cx;
          const dy = y - cy;
          inside = dx * dx + dy * dy <= radius * radius;
        }
      }
      if (inside) {
        rgba[idx] = BG[0];
        rgba[idx + 1] = BG[1];
        rgba[idx + 2] = BG[2];
        rgba[idx + 3] = 255;
      } else {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      }
    }
  }

  // "T" glyph made of a horizontal bar + vertical stem, centered.
  const glyph = size * glyphScale;
  const offset = (size - glyph) / 2;
  const barHeight = glyph * 0.2;
  const stemWidth = glyph * 0.24;

  const fill = (x0, y0, x1, y1) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      for (let x = Math.round(x0); x < Math.round(x1); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const idx = (y * size + x) * 4;
        rgba[idx] = 255;
        rgba[idx + 1] = 255;
        rgba[idx + 2] = 255;
        rgba[idx + 3] = 255;
      }
    }
  };

  // Top bar.
  fill(offset, offset, offset + glyph, offset + barHeight);
  // Vertical stem.
  fill(offset + (glyph - stemWidth) / 2, offset, offset + (glyph + stemWidth) / 2, offset + glyph);

  return rgba;
}

const targets = [
  { name: 'icon-192.png', size: 192, glyphScale: 0.5, cornerRadius: 0.18 },
  { name: 'icon-512.png', size: 512, glyphScale: 0.5, cornerRadius: 0.18 },
  { name: 'maskable-512.png', size: 512, glyphScale: 0.36, cornerRadius: 0 },
  { name: 'apple-touch-icon.png', size: 180, glyphScale: 0.5, cornerRadius: 0.18 },
];

for (const t of targets) {
  const rgba = paintIcon(t.size, t);
  const png = encodePNG(t.size, t.size, rgba);
  writeFileSync(join(outDir, t.name), png);
  console.log(`wrote ${t.name} (${png.length} bytes)`);
}

// Simple SVG favicon (vector, scales cleanly).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#080c14"/>
  <rect x="16" y="14" width="32" height="6.4" fill="#ffffff"/>
  <rect x="28.32" y="14" width="7.36" height="32" fill="#ffffff"/>
</svg>`;
writeFileSync(join(__dirname, '..', 'public', 'favicon.svg'), svg);
console.log('wrote favicon.svg');
