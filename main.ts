'use strict';

/* One Day, Thirty Stories - news-image-20261122 entry (concept D).
 *
 * A deterministic Node 22 program using only the standard library.
 * It draws a 1024x1024 poster of thirty verified news stories from
 * Sunday 22 November 2026, grouped into seven region cards, and writes
 * exactly one PNG file to $MAKEFUN_OUTPUT_DIR/entry.png.
 *
 * Everything is drawn in code: a small framebuffer rasterizer plus a
 * hand-built 5x7 bitmap font. No embedded images, no network access,
 * no clock, no randomness - two runs produce byte-identical output.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ---------------- CRC32 (PNG chunks) ---------------- */

const CRC_TABLE = (function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------- PNG encoder (truecolor, filter 0) ---------------- */

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- Framebuffer and shapes ---------------- */

const W = 1024;
const H = 1024;
const fb = Buffer.alloc(W * H * 3);

function setPixel(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      fb[i] = c[0];
      fb[i + 1] = c[1];
      fb[i + 2] = c[2];
      i += 3;
    }
  }
}

function fillCircle(cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt(r * r - dy * dy));
    fillRect(cx - hw, cy + dy, hw * 2 + 1, 1, c);
  }
}

function fillHalfCircle(cx, cy, r, c) {
  for (let dy = -r; dy <= 0; dy++) {
    const hw = Math.floor(Math.sqrt(r * r - dy * dy));
    fillRect(cx - hw, cy + dy, hw * 2 + 1, 1, c);
  }
}

function fillTriangle(x0, y0, x1, y1, x2, y2, c) {
  const minX = Math.max(0, Math.min(x0, x1, x2));
  const maxX = Math.min(W - 1, Math.max(x0, x1, x2));
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
      const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
      const cc = 1 - a - b;
      if (a >= 0 && b >= 0 && cc >= 0) setPixel(x, y, c);
    }
  }
}

function fillRoundRect(x, y, w, h, r, c) {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, r, h - 2 * r, c);
  fillRect(x + w - r, y + r, r, h - 2 * r, c);
  fillCircle(x + r, y + r, r, c);
  fillCircle(x + w - r - 1, y + r, r, c);
  fillCircle(x + r, y + h - r - 1, r, c);
  fillCircle(x + w - r - 1, y + h - r - 1, r, c);
}

/* ---------------- 5x7 bitmap font ----------------
 * 7 rows per glyph, '.' off, '#' on. Capitals and ascenders span
 * rows 0-6; x-height lowercase spans rows 1-5; descenders use row 6.
 * Width is derived from the rightmost set pixel; space is 3 units.
 */

const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  a: ['.....', '.###.', '....#', '.####', '#...#', '.####', '.....'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  c: ['.....', '.####', '#....', '#....', '#....', '.####', '.....'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['.....', '.###.', '#...#', '#####', '#....', '.###.', '.....'],
  f: ['..##.', '.#...', '.#...', '####.', '.#...', '.#...', '.#...'],
  g: ['.....', '.####', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  i: ['..#..', '.....', '..#..', '..#..', '..#..', '..#..', '.###.'],
  j: ['...#.', '.....', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  l: ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  m: ['.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '.....'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  o: ['.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '####.', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  s: ['.....', '.####', '#....', '.###.', '....#', '####.', '.....'],
  t: ['.#...', '.#...', '####.', '.#...', '.#...', '.#...', '..##.'],
  u: ['.....', '#...#', '#...#', '#...#', '#...#', '.###.', '.....'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '.####', '....#'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.#...', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '####.', '.....', '.....', '.....'],
  '–': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '—': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  '·': ['.....', '.....', '.....', '.##..', '.....', '.....', '.....'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '#.##.', '#..##'],
  '(': ['...##', '..#..', '.#...', '.#...', '.#...', '..#..', '...##'],
  ')': ['##...', '..#..', '...#.', '...#.', '...#.', '..#..', '##...'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '.....', '..#..', '.###.', '..#..', '.....', '.....'],
  '=': ['.....', '.....', '.###.', '.....', '.###.', '.....', '.....'],
  '*': ['.....', '.....', '.#.#.', '.###.', '.#.#.', '.....', '.....'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  'é': ['...#.', '..#..', '.###.', '#...#', '#####', '#....', '.###.'],
  'í': ['...#.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  'ã': ['.#.#.', '#.#.#', '.###.', '....#', '.####', '#...#', '.####'],
  'ê': ['..#..', '.#.#.', '.###.', '#...#', '#####', '#....', '.###.'],
};

function glyphWidth(ch) {
  if (ch === ' ') return 3;
  const rows = FONT[ch] || FONT['?'];
  let w = 0;
  for (let r = 0; r < 7; r++) {
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '#' && i + 1 > w) w = i + 1;
    }
  }
  return w || 1;
}

function textWidth(text, scale, tracking) {
  const gap = tracking === undefined ? scale : tracking;
  let w = 0;
  for (const ch of text) w += glyphWidth(ch) * scale + gap;
  return text.length ? w - gap : 0;
}

function drawText(text, x, y, scale, color, tracking) {
  const gap = tracking === undefined ? scale : tracking;
  let cx = x;
  for (const ch of text) {
    const rows = FONT[ch] || FONT['?'];
    const gw = glyphWidth(ch);
    for (let r = 0; r < 7; r++) {
      const row = rows[r];
      for (let i = 0; i < gw; i++) {
        if (row[i] === '#') fillRect(cx + i * scale, y + r * scale, scale, scale, color);
      }
    }
    cx += gw * scale + gap;
  }
  return cx - gap;
}

function drawTextCentered(text, cx, y, scale, color, tracking) {
  const w = textWidth(text, scale, tracking);
  drawText(text, Math.round(cx - w / 2), y, scale, color, tracking);
}

/* ---------------- Poster data ---------------- */

const REGIONS = [
  {
    name: 'EUROPE',
    color: [29, 78, 216],
    icon: 'tower',
    stories: [
      'Drone destroys Dymer apartment block, Ukraine',
      "Theresa May tells PM Burnham: 'Brexit is done'",
      'Thousands march in Istanbul over media takeover',
      'Simeone breaks LaLiga wins record, Spain',
    ],
  },
  {
    name: 'MIDDLE EAST',
    color: [15, 118, 110],
    icon: 'dome',
    stories: [
      'Settlers torch Palestinian vehicles, West Bank',
      'Likud–Yashar talks end without deal, Israel',
      'Israeli strikes kill eight in Gaza, hospitals say',
      'Saudi coalition intercepts Houthi missile',
    ],
  },
  {
    name: 'AFRICA',
    color: [194, 65, 12],
    icon: 'pyramid',
    stories: [
      'Suspected drones hit Russian corvette, Benghazi',
      'Drone strikes damage UN building, Khartoum',
      'Fighting traps Ebola team in DR Congo',
      'Severe storm warnings cover eight provinces, South Africa',
    ],
  },
  {
    name: 'ASIA-PACIFIC',
    color: [21, 128, 61],
    icon: 'pagoda',
    stories: [
      'Education minister resigns over CSAT chaos, Seoul',
      'Rescuers search missing after Indonesia factory fire',
      'Shuri Castle hall restored, Okinawa ceremony',
      'China exchanges ease margin rules',
      'Hong Kong committee vote draws record turnout',
    ],
  },
  {
    name: 'NORTH AMERICA',
    color: [185, 28, 28],
    icon: 'skyscraper',
    stories: [
      'Democrats secure 258th House seat, North Carolina',
      'Delta flights delayed by Atlanta system failure',
      'Skubal agrees record $450M, 9-year Mets deal',
      'King tides threaten California coastal flooding',
    ],
  },
  {
    name: 'LATIN AMERICA',
    color: [126, 34, 206],
    icon: 'stepped',
    stories: [
      '49ers rout Vikings 35–10 in Mexico City',
      'Brazil storm toll rises to five, Tupancireta',
      'Magnitude 5.2 quake jolts central Peru',
      'Six killed in Chiloé head-on crash, Chile',
    ],
  },
  {
    name: 'GLOBAL',
    color: [30, 41, 59],
    icon: 'star',
    stories: [
      'COP31 climate talks collapse in Antalya',
      'Liverpool thrash ten-man United 4–0, Anfield',
      'Alcaraz wins first ATP Finals title, Turin',
      'New Hunger Games tops global box office',
      'ESA reports BepiColombo thruster glitch, Mercury',
    ],
  },
];

const SOURCES =
  'Sources: Reuters · AP · AFP · BBC · PA · CNN · Al Jazeera · Anadolu · DW · ESPN · Xinhua · Jiji · UN ReliefWeb · El País · USA Today · NBC Sports · UPI · Agência Brasil · regional outlets';

/* ---------------- Region icons (24x24 box, simple geometry) ---------------- */

function drawIcon(kind, x, y, fg, bg) {
  if (kind === 'tower') {
    // lattice tower: triangle with two slots cut out
    fillTriangle(x + 12, y + 1, x + 3, y + 23, x + 21, y + 23, fg);
    fillRect(x + 6, y + 9, 12, 2, bg);
    fillRect(x + 8, y + 16, 8, 2, bg);
  } else if (kind === 'dome') {
    // dome on a block, plus a minaret
    fillHalfCircle(x + 10, y + 15, 8, fg);
    fillRect(x + 2, y + 15, 16, 8, fg);
    fillRect(x + 20, y + 7, 2, 16, fg);
    fillTriangle(x + 21, y + 3, x + 19, y + 7, x + 23, y + 7, fg);
  } else if (kind === 'pyramid') {
    // pyramid with a sun
    fillTriangle(x + 11, y + 5, x + 1, y + 23, x + 21, y + 23, fg);
    fillCircle(x + 19, y + 4, 3, fg);
  } else if (kind === 'pagoda') {
    // three stacked roofs
    fillRect(x + 2, y + 2, 20, 2, fg);
    fillRect(x + 7, y + 4, 10, 4, fg);
    fillRect(x + 4, y + 8, 16, 2, fg);
    fillRect(x + 8, y + 10, 8, 4, fg);
    fillRect(x + 2, y + 14, 20, 2, fg);
    fillRect(x + 7, y + 16, 10, 7, fg);
  } else if (kind === 'skyscraper') {
    // tower with antenna and windows
    fillRect(x + 11, y + 0, 2, 2, fg);
    fillRect(x + 10, y + 2, 4, 3, fg);
    fillRect(x + 7, y + 5, 10, 18, fg);
    fillRect(x + 9, y + 8, 2, 2, bg);
    fillRect(x + 13, y + 8, 2, 2, bg);
    fillRect(x + 9, y + 13, 2, 2, bg);
    fillRect(x + 13, y + 13, 2, 2, bg);
    fillRect(x + 9, y + 18, 2, 2, bg);
    fillRect(x + 13, y + 18, 2, 2, bg);
  } else if (kind === 'stepped') {
    // stepped pyramid with a door
    fillRect(x + 2, y + 18, 20, 5, fg);
    fillRect(x + 5, y + 14, 14, 4, fg);
    fillRect(x + 8, y + 10, 8, 4, fg);
    fillRect(x + 9, y + 5, 6, 5, fg);
    fillRect(x + 11, y + 7, 2, 3, bg);
  } else if (kind === 'star') {
    // four-point compass star
    fillTriangle(x + 12, y + 0, x + 10, y + 12, x + 14, y + 12, fg);
    fillTriangle(x + 12, y + 24, x + 10, y + 12, x + 14, y + 12, fg);
    fillTriangle(x + 0, y + 12, x + 12, y + 10, x + 12, y + 14, fg);
    fillTriangle(x + 24, y + 12, x + 12, y + 10, x + 12, y + 14, fg);
    fillCircle(x + 12, y + 12, 2, bg);
  }
}

/* ---------------- Draw the poster ---------------- */

const PAPER = [250, 248, 242];
const NAVY = [15, 23, 42];
const INK = [51, 65, 85];
const WHITE = [255, 255, 255];
const SUBTITLE = [226, 232, 240];

fillRect(0, 0, W, H, PAPER);

// Header band
fillRect(0, 0, W, 100, NAVY);
drawTextCentered('THE WORLD IN ONE DAY', W / 2, 16, 6, WHITE);
drawTextCentered('30 stories · 7 regions · Sunday 22 November 2026', W / 2, 66, 3, SUBTITLE);

// Region cards: one full-width card per region, stacked.
const CARD_X = 24;
const CARD_W = W - 48;
const PAD = 9;
const TITLE_H = 21;
const TITLE_GAP = 5;
const LINE_H = 16;
const STORY_SCALE = 2;
const GAP = 8;

let cy = 112;
for (const region of REGIONS) {
  const cardH = PAD + TITLE_H + TITLE_GAP + region.stories.length * LINE_H + PAD;
  fillRoundRect(CARD_X, cy, CARD_W, cardH, 10, region.color);
  drawIcon(region.icon, CARD_X + 16, cy + PAD - 1, WHITE, region.color);
  drawText(region.name, CARD_X + 46, cy + PAD, 3, WHITE);
  let sy = cy + PAD + TITLE_H + TITLE_GAP;
  for (const story of region.stories) {
    fillCircle(CARD_X + 19, sy + 7, 3, WHITE);
    drawText(story, CARD_X + 30, sy, STORY_SCALE, WHITE);
    sy += LINE_H;
  }
  cy += cardH + GAP;
}

// Footer
fillRect(24, 954, W - 48, 2, NAVY);
drawTextCentered('All events: Sunday 22 November 2026', W / 2, 962, 2, INK);
// Sources footer in two lines at scale 2 (14 px glyphs) so it stays legible
// at 512 px; split after "Jiji" (792 px / 766 px at gap 0, both < W - 24).
// The seven region cards above are untouched.
const SOURCES_SPLIT = SOURCES.indexOf(' · UN ReliefWeb');
const SOURCES_LINE1 = SOURCES.slice(0, SOURCES_SPLIT);
const SOURCES_LINE2 = SOURCES.slice(SOURCES_SPLIT + 3);
drawTextCentered(SOURCES_LINE1, W / 2, 980, 2, INK, 0);
drawTextCentered(SOURCES_LINE2, W / 2, 997, 2, INK, 0);

/* ---------------- Guards: fail loudly instead of a broken poster ---------------- */

for (const region of REGIONS) {
  for (const story of region.stories) {
    const w = textWidth(story, STORY_SCALE);
    if (CARD_X + 30 + w > CARD_X + CARD_W - 16) {
      throw new Error('story line too wide for its card: ' + story);
    }
  }
}
if (textWidth(SOURCES_LINE1, 2, 0) > W - 24 || textWidth(SOURCES_LINE2, 2, 0) > W - 24) {
  throw new Error('sources footer line too wide');
}

/* ---------------- Write the single output file ---------------- */

const outDir = process.env.MAKEFUN_OUTPUT_DIR || 'out';
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'entry.png'), encodePNG(W, H, fb));
