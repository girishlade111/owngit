// Build a multi-size favicon.ico (PNG-compressed entries, valid ICO container).
'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const sizes = [16, 32, 48, 256];

const pngs = sizes.map((s) => ({
  size: s,
  png: fs.readFileSync(path.join(PUB, s === 256 ? 'icon-256.png' : `favicon-${s}.png`)),
}));

const count = pngs.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(count, 4);

let offset = 6 + 16 * count;
const dirs = [];
const blobs = [];
for (const { size, png } of pngs) {
  const d = Buffer.alloc(16);
  d.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
  d.writeUInt8(size >= 256 ? 0 : size, 1); // height
  d.writeUInt8(0, 2); // palette
  d.writeUInt8(0, 3); // reserved
  d.writeUInt16LE(1, 4); // color planes
  d.writeUInt16LE(32, 6); // bits per pixel
  d.writeUInt32LE(png.length, 8);
  d.writeUInt32LE(offset, 12);
  dirs.push(d);
  blobs.push(png);
  offset += png.length;
}

const ico = Buffer.concat([header, ...dirs, ...blobs]);
fs.writeFileSync(path.join(PUB, 'favicon.ico'), ico);
console.log('favicon.ico written:', ico.length, 'bytes,', count, 'sizes');
