// news-image-20261123 — "THE WORLD TODAY", Monday 23 November 2026.
// A procedurally drawn 1024x1024 newspaper front page summing up the
// day's world news. Own rasterizer, own 5x7 bitmap font, own PNG
// encoder (zlib). Node 22 standard library only, no network.
// Fully deterministic: fixed seed, no Date.now, no Math.random.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

// ---------- palette ----------
const PAPER: RGB = [245, 240, 225];
const INK: RGB = [26, 26, 26];
const RED: RGB = [163, 22, 33];
const GREY: RGB = [120, 112, 96];
const WHITE: RGB = [240, 240, 230];
const SKY_TOP: RGB = [7, 11, 28];
const SKY_BOT: RGB = [26, 40, 70];
const SEA_TOP: RGB = [16, 38, 56];
const SEA_BOT: RGB = [4, 13, 23];
const FLAME_RED: RGB = [217, 4, 41];
const FLAME_ORANGE: RGB = [255, 123, 0];
const FLAME_YELLOW: RGB = [255, 210, 63];

// ---------- seeded PRNG (mulberry32) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261123);

// ---------- CRC32 + PNG encoder ----------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(img: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    raw.set(img.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- framebuffer ----------
const px = new Uint8Array(W * H * 3);
function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      i += 3;
    }
  }
}
function hline(x: number, y: number, w: number, c: RGB): void {
  fillRect(x, y, w, 1, c);
}
function vline(x: number, y: number, h: number, c: RGB): void {
  fillRect(x, y, 1, h, c);
}
function rectBorder(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
  }
}
function circle(cx: number, cy: number, r: number, c: RGB): void {
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    setPixel(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c);
  }
}
function fillTriangle(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB,
): void {
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  const edges: [number, number, number, number][] = [
    [x0, y0, x1, y1],
    [x1, y1, x2, y2],
    [x2, y2, x0, y0],
  ];
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    if (xs.length >= 2) {
      const xa = Math.round(Math.min(...xs));
      const xb = Math.round(Math.max(...xs));
      fillRect(xa, y, xb - xa + 1, 1, c);
    }
  }
}
function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
function vgrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB): void {
  for (let yy = 0; yy < h; yy++) {
    fillRect(x, y + yy, w, 1, lerp(top, bot, yy / Math.max(1, h - 1)));
  }
}

// ---------- 5x7 bitmap font ----------
// Each glyph is 7 rows of 5 cells; "#" is ink, "." is blank.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "&": [".##..", "#..#.", "#..#.", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.##.", "#..##"],
  "+": [".....", "..#..", "..#..", ".###.", "..#..", "..#..", "....."],
  "=": [".....", ".....", ".###.", ".....", ".###.", ".....", "....."],
  "*": [".....", ".#.#.", ".###.", "#####", ".###.", ".#.#.", "....."],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "•": [".....", ".###.", ".###.", ".###.", ".....", ".....", "....."],
  "[": [".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."],
  "]": [".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."],
};

const CHAR_ADV = 6; // 5 glyph cells + 1 spacing, in font units

function glyphFor(ch: string): string[] {
  const g = FONT[ch];
  if (g) return g;
  const up = FONT[ch.toUpperCase()];
  if (up) return up;
  return FONT[" "];
}
function textWidth(text: string, s: number): number {
  if (text.length === 0) return 0;
  return text.length * CHAR_ADV * s - s;
}
function drawChar(ch: string, x: number, y: number, s: number, c: RGB): void {
  const g = glyphFor(ch);
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row[col] === "#") fillRect(x + col * s, y + r * s, s, s, c);
    }
  }
}
function drawText(text: string, x: number, y: number, s: number, c: RGB): number {
  let cx = x;
  for (const ch of text) {
    drawChar(ch, cx, y, s, c);
    cx += CHAR_ADV * s;
  }
  return textWidth(text, s);
}
function drawTextCentered(text: string, cx: number, y: number, s: number, c: RGB): void {
  drawText(text, cx - Math.floor(textWidth(text, s) / 2), y, s, c);
}
function drawTextRight(text: string, right: number, y: number, s: number, c: RGB): void {
  drawText(text, right - textWidth(text, s), y, s, c);
}
function wrapText(text: string, maxW: number, s: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, s) <= maxW || cur === "") {
      cur = test;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}
function drawPara(
  text: string, x: number, y: number, maxW: number, s: number, c: RGB, lh: number,
): number {
  const lines = wrapText(text, maxW, s);
  for (let i = 0; i < lines.length; i++) {
    drawText(lines[i], x, y + i * lh, s, c);
  }
  return y + lines.length * lh;
}

// ---------- illustrations ----------
// A flame rising from base (x, y); w wide, h tall.
function flame(x: number, y: number, w: number, h: number): void {
  const layers: [RGB, number][] = [
    [FLAME_RED, 1.0],
    [FLAME_ORANGE, 0.72],
    [FLAME_YELLOW, 0.45],
  ];
  for (const [col, f] of layers) {
    const fw = Math.round(w * f);
    const fh = Math.round(h * f);
    const fx = x + Math.round((w - fw) / 2) + Math.round((rnd() - 0.5) * 6);
    fillTriangle(
      fx, y,
      fx + fw, y,
      fx + Math.round(fw / 2) + Math.round((rnd() - 0.5) * 8), y - fh,
      col,
    );
  }
}

// A burning oil tanker. (bx, by) is the waterline under the hull.
function tanker(bx: number, by: number, bw: number, bh: number): void {
  const hullH = Math.round(bh * 0.42);
  const hull: RGB = [16, 16, 20];
  fillRect(bx, by - hullH, bw, hullH, hull);
  fillTriangle(
    bx + bw, by - hullH, bx + bw, by,
    bx + bw + Math.round(bw * 0.18), by - Math.round(hullH * 0.4), hull,
  );
  fillRect(
    bx + Math.round(bw * 0.12), by - hullH - Math.round(bh * 0.22),
    Math.round(bw * 0.2), Math.round(bh * 0.22), [28, 28, 34],
  );
  fillRect(
    bx + Math.round(bw * 0.62), by - hullH - Math.round(bh * 0.3),
    Math.round(bw * 0.1), Math.round(bh * 0.3), [40, 26, 22],
  );
  line(
    bx + Math.round(bw * 0.45), by - hullH,
    bx + Math.round(bw * 0.45), by - hullH - Math.round(bh * 0.3), [90, 90, 90],
  );
  for (let i = 0; i < 5; i++) {
    fillRect(
      bx + 8 + i * Math.round(bw / 6), by - Math.round(hullH * 0.6),
      3, 3, [255, 200, 90],
    );
  }
  flame(bx + Math.round(bw * 0.2), by - hullH, Math.round(bw * 0.22), Math.round(bh * 0.55));
  flame(bx + Math.round(bw * 0.68), by - hullH, Math.round(bw * 0.26), Math.round(bh * 0.7));
  for (let i = 0; i < 5; i++) {
    const sx = bx + Math.round(bw * 0.3) + Math.round(rnd() * 30) - 10 + i * 6;
    const sy = by - hullH - Math.round(bh * 0.5) - i * 14;
    const g = 70 + i * 8;
    fillCircle(sx, sy, 10 + i * 3, [g, g, g + 4]);
  }
}

// Lead visual: night sea in the Strait of Hormuz, two tankers ablaze.
function drawHormuz(x: number, y: number, w: number, h: number): void {
  const horizon = Math.round(h * 0.52);
  vgrad(x, y, w, horizon, SKY_TOP, SKY_BOT);
  for (let i = 0; i < 80; i++) {
    const sx = x + Math.floor(rnd() * w);
    const sy = y + Math.floor(rnd() * (horizon - 30));
    const b = 150 + Math.floor(rnd() * 105);
    setPixel(sx, sy, [b, b, b]);
    if (rnd() > 0.7) setPixel(sx + 1, sy, [b, b, b]);
  }
  fillCircle(x + Math.round(w * 0.8), y + 42, 26, [40, 48, 70]);
  fillCircle(x + Math.round(w * 0.8), y + 42, 20, [232, 226, 196]);
  vgrad(x, y + horizon, w, h - horizon, SEA_TOP, SEA_BOT);
  hline(x, y + horizon, w, [90, 120, 140]);
  for (let i = 0; i < 46; i++) {
    const wx = x + Math.floor(rnd() * w);
    const wy = y + horizon + 6 + Math.floor(rnd() * (h - horizon - 12));
    const wl = 8 + Math.floor(rnd() * 26);
    hline(wx, wy, wl, [52, 92, 122]);
  }
  tanker(x + 30, y + horizon + 62, 170, 120);
  tanker(x + 250, y + horizon + 84, 150, 104);
  for (let i = 0; i < 26; i++) {
    const rx = x + 40 + Math.floor(rnd() * 150);
    const ry = y + horizon + 66 + Math.floor(rnd() * 40);
    vline(rx, ry, 6 + Math.floor(rnd() * 18), [255, 140, 40]);
  }
  for (let i = 0; i < 18; i++) {
    const rx = x + 255 + Math.floor(rnd() * 130);
    const ry = y + horizon + 88 + Math.floor(rnd() * 34);
    vline(rx, ry, 5 + Math.floor(rnd() * 14), [255, 140, 40]);
  }
  fillRect(x, y + h - 24, w, 24, [8, 8, 10]);
  drawTextCentered("BURNING TANKERS IN THE STRAIT OF HORMUZ", x + Math.floor(w / 2), y + h - 17, 1, WHITE);
}

// COP31 visual: a cracked globe, "NO DEAL AT COP31".
function drawGlobe(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, [214, 228, 238]);
  const cx = x + Math.floor(w / 2) - 40;
  const cy = y + Math.floor(h / 2);
  const r = 26;
  fillCircle(cx, cy, r, [42, 109, 176]);
  fillCircle(cx - 8, cy - 8, 9, [74, 160, 90]);
  fillCircle(cx + 10, cy + 6, 11, [74, 160, 90]);
  fillCircle(cx + 2, cy - 14, 6, [74, 160, 90]);
  circle(cx, cy, r, [20, 40, 70]);
  line(cx - 18, cy - 22, cx - 4, cy - 2, RED);
  line(cx - 4, cy - 2, cx + 8, cy + 10, RED);
  line(cx + 8, cy + 10, cx + 20, cy + 24, RED);
  drawText("NO DEAL AT COP31", cx + 34, cy - 4, 1, RED);
}

// Russian ship visual: small cargo ship on fire at dusk.
function drawMiniShip(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, Math.round(h * 0.55), [18, 24, 40], [30, 44, 66]);
  fillRect(x, y + Math.round(h * 0.55), w, h - Math.round(h * 0.55), [12, 34, 52]);
  const bx = x + Math.floor(w * 0.2);
  const bw = Math.floor(w * 0.55);
  const by = y + Math.round(h * 0.68);
  fillRect(bx, by - 14, bw, 14, [14, 14, 18]);
  fillRect(bx + 12, by - 26, 26, 12, [24, 24, 30]);
  flame(bx + Math.round(bw * 0.55), by - 14, 30, 28);
  for (let i = 0; i < 3; i++) {
    const g = 80 + i * 8;
    fillCircle(bx + Math.round(bw * 0.6) + i * 5, by - 30 - i * 7, 6 + i * 2, [g, g, g + 4]);
  }
  for (let i = 0; i < 8; i++) {
    const rx = bx + Math.floor(rnd() * bw);
    vline(rx, by + 2, 4 + Math.floor(rnd() * 10), [255, 140, 40]);
  }
}

// Kyiv visual: skyline at night, one building hit, a drone above.
function drawKyiv(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [28, 30, 46], [52, 48, 52]);
  const dx = x + Math.floor(w * 0.72);
  const dy = y + 12;
  fillRect(dx - 6, dy, 12, 2, [10, 10, 12]);
  fillRect(dx, dy - 6, 2, 12, [10, 10, 12]);
  fillRect(dx - 10, dy - 2, 4, 2, [200, 200, 200]);
  fillRect(dx + 6, dy - 2, 4, 2, [200, 200, 200]);
  const b1 = 40;
  const b2 = 52;
  const b3 = 34;
  fillRect(x + 16, y + h - b1, 52, b1, [16, 16, 20]);
  fillRect(x + 84, y + h - b2, 60, b2, [20, 20, 24]);
  fillRect(x + 160, y + h - b3, 48, b3, [16, 16, 20]);
  for (let i = 0; i < 4; i++) {
    const wx = x + 24 + Math.floor(rnd() * 36);
    const wy = y + h - b1 + 6 + Math.floor(rnd() * 24);
    fillRect(wx, wy, 4, 5, [255, 210, 90]);
  }
  for (let i = 0; i < 5; i++) {
    const wx = x + 92 + Math.floor(rnd() * 44);
    const wy = y + h - b2 + 6 + Math.floor(rnd() * 34);
    fillRect(wx, wy, 4, 5, [255, 210, 90]);
  }
  for (let i = 0; i < 3; i++) {
    const wx = x + 168 + Math.floor(rnd() * 32);
    const wy = y + h - b3 + 6 + Math.floor(rnd() * 20);
    fillRect(wx, wy, 4, 5, [255, 210, 90]);
  }
  fillTriangle(x + 100, y + h - b2, x + 128, y + h - b2, x + 114, y + h - b2 - 16, [255, 150, 40]);
  fillCircle(x + 114, y + h - b2 - 8, 8, [120, 120, 120]);
  fillCircle(x + 118, y + h - b2 - 20, 11, [140, 140, 140]);
}

// ---------- page composition ----------
function panel(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, PAPER);
  rectBorder(x, y, w, h, 2, INK);
}

function midPanel(
  x: number, y: number, w: number, h: number,
  title: string, body: string, art: (ax: number, ay: number, aw: number, ah: number) => void,
): void {
  panel(x, y, w, h);
  drawText(title, x + 12, y + 10, 2, INK);
  hline(x + 12, y + 30, w - 24, INK);
  art(x + 12, y + 38, w - 24, 68);
  drawPara(body, x + 12, y + 114, w - 24, 1, INK, 11);
}

function main(): void {
  fillRect(0, 0, W, H, PAPER);

  // ----- masthead -----
  fillRect(24, 28, 976, 3, INK);
  drawTextCentered("THE WORLD TODAY", 512, 40, 5, INK);
  drawTextCentered("MONDAY 23 NOVEMBER 2026", 512, 86, 2, INK);
  drawText("VOL. CXII - NO. 327", 24, 88, 1, INK);
  drawTextRight("WORLD EDITION", 1000, 88, 1, INK);
  fillRect(24, 112, 976, 3, INK);
  fillRect(24, 118, 976, 1, INK);
  drawTextCentered(
    "IRAN WAR  •  CLIMATE TALKS COLLAPSE  •  KYIV HIT  •  EBOLA IN CONGO",
    512, 128, 1, RED,
  );

  // ----- lead panel: Iran / Hormuz -----
  panel(24, 150, 976, 396);
  drawHormuz(36, 162, 452, 360);
  const tx = 508;
  const tw = 480;
  drawText("LEAD STORY - IRAN WAR", tx, 168, 2, RED);
  drawText("TANKERS ABLAZE", tx, 196, 5, INK);
  drawText("IN HORMUZ", tx, 238, 5, INK);
  fillRect(tx, 284, tw, 2, INK);
  drawPara(
    "IRAN'S NAVY SETS FIRE TO TANKERS BREAKING ITS RULES IN THE STRAIT",
    tx, 296, tw, 2, INK, 17,
  );
  drawPara(
    "Iran's navy says tankers breaking its rules were set ablaze in the " +
    "Strait of Hormuz. The IRGC warns of an unrest threat. An Iran strike " +
    "wounded two in Bahrain. Saudi Arabia condemns the 'criminal' attacks.",
    tx, 342, tw, 2, INK, 17,
  );
  fillRect(tx, 458, tw, 70, [235, 228, 205]);
  rectBorder(tx, 458, tw, 70, 1, INK);
  drawText("TWO WOUNDED IN BAHRAIN", tx + 12, 468, 2, INK);
  drawText("IRGC WARNS OF UNREST THREAT", tx + 12, 494, 2, INK);

  // ----- mid row 1: COP31, Russian ship, Kyiv -----
  midPanel(
    24, 558, 317, 192,
    "COP31 COLLAPSE",
    "Climate talks fail with no deal. The final draft omits the words " +
    "'fossil fuels'. Australian PM Albanese calls the failure a sign of " +
    "'difficult geopolitical times'.",
    drawGlobe,
  );
  midPanel(
    353, 558, 317, 192,
    "RUSSIAN SHIP ABLAZE",
    "A Russian cargo ship is still on fire off Finland after an attack. " +
    "Ten port workers were wounded in an assault on a Russian ship in " +
    "Libya's Benghazi.",
    drawMiniShip,
  );
  midPanel(
    682, 558, 318, 192,
    "KYIV DRONE STRIKE",
    "At least 14 people are missing after a Russian drone hit a building " +
    "in the Kyiv region, President Zelenskiy says.",
    drawKyiv,
  );

  // ----- mid row 2: Sudan, Ebola -----
  panel(24, 762, 482, 104);
  fillRect(24, 762, 6, 104, RED);
  drawText("SUDAN", 42, 772, 2, INK);
  drawPara(
    "Drone strikes hit homes and a UN building in Khartoum. The army " +
    "accuses Ethiopia of involvement in the attacks.",
    42, 794, 448, 1, INK, 11,
  );
  drawText("MORE ON PAGE 3", 42, 846, 1, GREY);
  panel(518, 762, 482, 104);
  fillRect(518, 762, 6, 104, RED);
  drawText("EBOLA", 536, 772, 2, INK);
  drawPara(
    "The WHO pleads for peace as fighting rages near a hospital in " +
    "Ebola-hit DR Congo.",
    536, 794, 448, 1, INK, 11,
  );
  drawText("MORE ON PAGE 3", 536, 846, 1, GREY);

  // ----- IN BRIEF strip -----
  panel(24, 878, 976, 122);
  drawText("IN BRIEF", 36, 888, 2, INK);
  hline(36, 908, 952, INK);
  const brief: string[] = [
    "INDONESIA FACTORY FIRE: 24 DEAD, MANY MISSING",
    "NEPAL PM BALENDRA SHAH IN TALKS WITH MODI IN DELHI",
    "S. KOREA EDUCATION MINISTER RESIGNS OVER AI CHEATING",
    "INDIA POSTS RECORD 720/9D IN WELLINGTON TEST",
    "N. KOREA'S KIM: SECURITY, NOT SUPREMACY",
    "UN NATIONS TO KEEP TALKING ON LETHAL-AI RULES",
    "KOSPI TUMBLES 3% ON AI-BUBBLE FEARS",
    "EL CHAPO ISIDRO CAPTURED AFTER SINALOA FIREFIGHT",
  ];
  for (let i = 0; i < 4; i++) {
    drawText("• " + brief[i], 36, 918 + i * 22, 1, INK);
    drawText("• " + brief[i + 4], 516, 918 + i * 22, 1, INK);
  }

  // ----- footer -----
  drawTextCentered("LATE EDITION - PRINTED 23 NOVEMBER 2026", 512, 1006, 1, GREY);

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG(px, W, H);
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

main();
