import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const cwd = process.cwd();
const sourceDir = path.resolve(cwd, 'desktop', 'pet', 'assets', 'source');
const outputDir = path.resolve(cwd, 'desktop', 'pet', 'assets', 'processed');
const petSources = [
  { id: 'red-swords', source: 'red-swords.png' },
  { id: 'pink-sword', source: 'pink-sword.webp' }
];

const transparentThreshold = 58;
const softThreshold = 110;

function colorDistance(a, b) {
  const red = a[0] - b[0];
  const green = a[1] - b[1];
  const blue = a[2] - b[2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

function sampleBackground(data, width, height) {
  const samples = [];
  const margin = Math.max(1, Math.floor(Math.min(width, height) * 0.08));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isEdge = x < margin || y < margin || x >= width - margin || y >= height - margin;
      if (!isEdge) {
        continue;
      }

      const offset = (y * width + x) * 4;
      samples.push([data[offset], data[offset + 1], data[offset + 2]]);
    }
  }

  samples.sort((a, b) => luminance(a) - luminance(b));
  return samples[Math.floor(samples.length * 0.35)] ?? [0, 0, 0];
}

function luminance(color) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function markReachableBackground(data, width, height, background) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const index = y * width + x;
    if (visited[index]) {
      return;
    }

    const offset = index * 4;
    const color = [data[offset], data[offset + 1], data[offset + 2]];
    if (colorDistance(color, background) > softThreshold) {
      return;
    }

    visited[index] = 1;
    queue.push(index);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  return visited;
}

function applyAlphaMatte(data, width, height) {
  const background = sampleBackground(data, width, height);
  const backgroundMask = markReachableBackground(data, width, height, background);

  for (let index = 0; index < width * height; index += 1) {
    if (!backgroundMask[index]) {
      continue;
    }

    const offset = index * 4;
    const color = [data[offset], data[offset + 1], data[offset + 2]];
    const distance = colorDistance(color, background);

    if (distance <= transparentThreshold) {
      data[offset + 3] = 0;
    } else {
      const progress = Math.min(1, (distance - transparentThreshold) / (softThreshold - transparentThreshold));
      data[offset + 3] = Math.round(progress * 255);
    }
  }
}

async function processAsset(asset) {
  const inputPath = path.join(sourceDir, asset.source);
  const outputPath = path.join(outputDir, `${asset.id}.png`);

  const image = sharp(inputPath).ensureAlpha();
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error(`Cannot read dimensions for ${inputPath}`);
  }

  const data = await image.raw().toBuffer();
  applyAlphaMatte(data, width, height);

  fs.mkdirSync(outputDir, { recursive: true });
  await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outputPath);
  console.log(`Processed ${inputPath} -> ${outputPath}`);
}

for (const asset of petSources) {
  await processAsset(asset);
}
