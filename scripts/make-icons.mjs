// Рисует иконки приложения (тёмный фон, светлое кольцо и буква «П») без внешних библиотек: свой PNG-кодировщик на zlib.
import fs from 'node:fs';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BG = [15, 17, 21], FG = [143, 184, 222];
// Геометрия в долях от размера (как в icon.svg, холст 512).
const inShape = (u, v) => {
  const dx = u - 0.5, dy = v - 0.5, r = Math.hypot(dx, dy);
  if (r <= 0.332 + 0.043 && r >= 0.332 - 0.043) return true; // кольцо
  const bar = u >= 0.36 && u <= 0.64 && v >= 0.345 && v <= 0.4; // верх «П»
  const l = u >= 0.395 && u <= 0.45 && v >= 0.345 && v <= 0.65;
  const rr = u >= 0.55 && u <= 0.605 && v >= 0.345 && v <= 0.65;
  return bar || l || rr;
};
fs.mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [180, 192, 512]) {
  const buf = png(size, (x, y) => {
    let hit = 0; // 3x3 сглаживание
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (inShape((x + (i + 0.5) / 3) / size, (y + (j + 0.5) / 3) / size)) hit++;
    const a = hit / 9;
    return BG.map((c, k) => Math.round(c + (FG[k] - c) * a));
  });
  fs.writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), buf);
}
console.log('иконки готовы');
