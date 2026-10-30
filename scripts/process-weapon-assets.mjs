import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'desktop/pet/assets/source/weapons.png');
const output = path.join(root, 'desktop/pet/assets/processed/weapons');
fs.mkdirSync(output, { recursive: true });
const { width, height } = await sharp(input).metadata();
const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
const rows = [0];
// Generated atlases are visually gridded, but not always pixel-exact. Split at transparent gutters.
for (let row = 1; row < 5; row++) {
  let best = Math.round(row * height / 5);
  let minimum = Infinity;
  for (let y = Math.floor(row * height / 5 - height * .025); y < row * height / 5 + height * .025; y++) {
    let occupied = 0;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * info.channels + 3] > 32) occupied++;
    if (occupied < minimum) { minimum = occupied; best = y; }
  }
  if (minimum !== 0) throw new Error('No transparent gutter found for weapon row ' + row);
  rows.push(best);
}
rows.push(height);
for (let row = 0; row < 5; row++) {
  for (const [column, kind] of ['sword', 'saber', 'spear'].entries()) {
    const left = Math.round(column * width / 3);
    const top = rows[row];
    const tile = await sharp(input).extract({
      left, top, width: Math.round((column + 1) * width / 3) - left,
      height: rows[row + 1] - top
    }).png().toBuffer();
    await sharp(tile).trim().resize(192, 224, { fit: 'contain', background: '#00000000' })
      .webp({ quality: 94 }).toFile(path.join(output, 'w' + (row + 1) + '-' + kind + '.webp'));
  }
}
console.log('Prepared 15 transparent weapon sprites.');
