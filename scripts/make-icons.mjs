// 의존성 없이 PWA 아이콘 PNG를 생성한다: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'icons');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const BG = hex(0x0b0f1a);
const GOLD = hex(0xf5c542);
const CYAN = hex(0x4cc9f0);
const NAVY = hex(0x2b2f4a);

function coverage(dist, radius) {
  return Math.max(0, Math.min(1, radius - dist + 0.5));
}

function blend(px, color, a) {
  px[0] += (color[0] - px[0]) * a;
  px[1] += (color[1] - px[1]) * a;
  px[2] += (color[2] - px[2]) * a;
}

function render(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const corner = maskable ? 0 : size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = [...BG];
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      // 바깥 링(시안), 몸통(남색), 머리(금색), 조준 방향 총구 액센트
      blend(px, CYAN, coverage(d, size * 0.42) - coverage(d, size * 0.36));
      blend(px, NAVY, coverage(d, size * 0.3));
      const hx = dx - size * 0.04;
      const hy = dy - size * 0.02;
      blend(px, GOLD, coverage(Math.hypot(hx, hy), size * 0.15));
      const gx = dx - size * 0.24;
      const gy = dy + size * 0.06;
      blend(px, CYAN, coverage(Math.hypot(gx * 0.6, gy), size * 0.045));

      let alpha = 1;
      if (corner > 0) {
        const ex = Math.max(0, Math.abs(dx) - (c - corner));
        const ey = Math.max(0, Math.abs(dy) - (c - corner));
        alpha = coverage(Math.hypot(ex, ey), corner);
      }
      const i = (y * size + x) * 4;
      rgba[i] = px[0];
      rgba[i + 1] = px[1];
      rgba[i + 2] = px[2];
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), render(size, false));
  writeFileSync(join(outDir, `maskable-${size}.png`), render(size, true));
}
writeFileSync(join(outDir, 'apple-touch-icon.png'), render(180, true));
console.log(`icons written to ${outDir}`);
