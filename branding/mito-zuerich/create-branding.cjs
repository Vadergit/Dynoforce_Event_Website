const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const sourceRoot = path.join(root, 'sources');
const headerCompositePath = path.join(sourceRoot, 'mito-header-composite-ai.png');
const mitoLogoPath = path.join(sourceRoot, 'mito-logo-white.svg');
const dynoforcePath = path.join(root, '..', '..', 'public', 'dynoforce-icon.png');

const CHARCOAL = '#101010';
const WINE = '#7d1413';

function svg(width, height, content) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`);
}

async function contain(input, width, height) {
  return sharp(input, { density: 600 }).resize(width, height, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  }).png().toBuffer();
}

async function createHeader() {
  const background = await sharp(headerCompositePath)
    .resize(2400, 600, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const mitoLogo = await contain(mitoLogoPath, 640, 200);
  const overlay = svg(2400, 600, `
    <defs><linearGradient id="red" x1="0" x2="1"><stop stop-color="#32100f"/><stop offset=".55" stop-color="${WINE}"/><stop offset="1" stop-color="#32100f"/></linearGradient></defs>
    <path d="M0 0 H760 L980 300 L760 600 H0 Z" fill="${CHARCOAL}"/>
    <path d="M700 0 H835 L1045 300 L835 600 H700 L910 300 Z" fill="url(#red)" fill-opacity=".96"/>
  `);

  await sharp(background)
    .composite([
      { input: overlay, top: 0, left: 0 },
      { input: mitoLogo, top: 200, left: 80 },
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'header-banner-2400x600.jpg'));
}

async function createEventLogo() {
  await sharp(dynoforcePath)
    .resize(1000, 1000, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(path.join(root, 'eventlogo-df-1000x1000.png'));
}

async function createSponsorFooter() {
  const mitoLogo = await contain(mitoLogoPath, 980, 300);
  const dfLogo = await contain(dynoforcePath, 240, 240);
  const base = svg(2500, 500, `
    <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#080808"/><stop offset=".72" stop-color="${CHARCOAL}"/><stop offset="1" stop-color="#242424"/></linearGradient></defs>
    <rect width="2500" height="500" fill="url(#bg)"/>
    <path d="M1180 0 H1390 L1690 500 H1480 Z" fill="${WINE}" fill-opacity=".9"/>
    <path d="M1420 0 H1500 L1800 500 H1720 Z" fill="#fff" fill-opacity=".08"/>
    <rect x="2070" y="90" width="320" height="320" rx="52" fill="#fff"/>
  `);

  await sharp(base)
    .composite([
      { input: mitoLogo, top: 100, left: 150 },
      { input: dfLogo, top: 130, left: 2110 },
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'sponsor-footer-2500x500.jpg'));
}

Promise.all([createHeader(), createEventLogo(), createSponsorFooter()]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
