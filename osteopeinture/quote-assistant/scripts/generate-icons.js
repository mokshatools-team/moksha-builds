#!/usr/bin/env node
/**
 * Generate PWA icon for OP Hub from the OP house logo source.
 * White background, house logo centered, no text.
 * "OP Hub" name comes from the manifest/PWA caption, not the icon itself.
 *
 * Run: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = '/Users/loric/OSTEOPEINTURE/LOGO design/OP HOUSE.png';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const BG_HEX = '#FFFFFF';
const CANVAS = 512;
const HOUSE_SIZE = 300; // house fills ~60% of canvas
const HOUSE_Y = 106; // vertically centered

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Source not found: ${SOURCE}`);
    process.exit(1);
  }

  // Trim whitespace from source, resize house
  const house = await sharp(SOURCE)
    .trim()
    .resize(HOUSE_SIZE, HOUSE_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  // Compose: white background + house centered
  const composed = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: BG_HEX,
    },
  })
    .composite([
      { input: house, top: HOUSE_Y, left: Math.round((CANVAS - HOUSE_SIZE) / 2) },
    ])
    .png()
    .toBuffer();

  // Write each size
  const sizes = [
    { size: 512, name: 'icon-512.png' },
    { size: 192, name: 'icon-192.png' },
    { size: 180, name: 'apple-touch-icon.png' },
  ];

  for (const { size, name } of sizes) {
    const outPath = path.join(PUBLIC_DIR, name);
    await sharp(composed).resize(size, size).png().toFile(outPath);
    const { size: bytes } = fs.statSync(outPath);
    console.log(`  ${size}×${size}  ${name}  (${bytes} bytes)`);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
