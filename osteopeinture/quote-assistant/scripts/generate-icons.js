#!/usr/bin/env node
/**
 * Generate PWA icons for OP Hub and OP Quote from the OP house logo source.
 *
 * - Source: /Users/loric/OSTEOPEINTURE/LOGO design/OP HOUSE.png
 *   (4000×4000 brown house on transparent background, lots of whitespace)
 * - Active set (OP Hub) goes to public/
 * - Parked set (OP Quote) goes to public/icons-op-quote/ for the future split
 *
 * Same house, same dark background, same brown — differentiated only by
 * "HUB" vs "QUOTE" text baked under the house. iOS/Android home screens
 * don't show enough of the app name caption to tell them apart otherwise.
 *
 * Run: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = '/Users/loric/OSTEOPEINTURE/LOGO design/OP HOUSE.png';
const REPO_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const OP_QUOTE_DIR = path.join(PUBLIC_DIR, 'icons-op-quote');

const BG_HEX = '#0F0D0B';
const TEXT_COLOR = '#FFFFFF';
const CANVAS = 512;
const HOUSE_SIZE = 260;
const HOUSE_Y = 85;
const TEXT_BASELINE_Y = 440;

async function buildIconSet(label, fontSize, letterSpacing, outputs) {
  // 1. Trim the transparent whitespace from the source, then resize the
  //    house into a HOUSE_SIZE × HOUSE_SIZE square, preserving aspect.
  const house = await sharp(SOURCE)
    .trim()
    .resize(HOUSE_SIZE, HOUSE_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  // 2. SVG text overlay at the bottom of the canvas.
  const textSvg = Buffer.from(`<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
  <text x="50%" y="${TEXT_BASELINE_Y}" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="700"
        letter-spacing="${letterSpacing}"
        fill="${TEXT_COLOR}">${label}</text>
</svg>`);

  // 3. Compose: solid background → house → text
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
      { input: textSvg, top: 0, left: 0 },
    ])
    .png()
    .toBuffer();

  // 4. Write each requested output size, downscaling from the 512 master.
  for (const { size, outPath } of outputs) {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await sharp(composed).resize(size, size).png().toFile(outPath);
    const { size: bytes } = fs.statSync(outPath);
    console.log(`  ${label.padEnd(6)} ${size}×${size}  ${path.relative(REPO_ROOT, outPath)}  (${bytes} bytes)`);
  }
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Source icon not found: ${SOURCE}`);
    process.exit(1);
  }
  console.log(`Source: ${SOURCE}`);
  console.log('');

  console.log('OP Hub (active → public/)');
  await buildIconSet('HUB', 96, 10, [
    { size: 192, outPath: path.join(PUBLIC_DIR, 'icon-192.png') },
    { size: 512, outPath: path.join(PUBLIC_DIR, 'icon-512.png') },
    { size: 180, outPath: path.join(PUBLIC_DIR, 'apple-touch-icon.png') },
  ]);
  console.log('');

  console.log('OP Quote (parked → public/icons-op-quote/)');
  await buildIconSet('QUOTE', 76, 6, [
    { size: 192, outPath: path.join(OP_QUOTE_DIR, 'icon-192.png') },
    { size: 512, outPath: path.join(OP_QUOTE_DIR, 'icon-512.png') },
    { size: 180, outPath: path.join(OP_QUOTE_DIR, 'apple-touch-icon.png') },
  ]);
  console.log('');
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
