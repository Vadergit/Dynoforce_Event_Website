const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const sourceRoot = path.join(root, 'sources');
const headerCompositePath = path.join(sourceRoot, 'grindelboulder-header-composite-ai.png');
const grindelLogoPath = path.join(sourceRoot, 'grindelboulder-logo-white.svg');
const dynoforcePath = path.join(root, '..', '..', 'public', 'dynoforce-icon.png');

const CHARCOAL = '#303030';
const MINT = '#0ABE8F';
const LIME = '#D2D814';

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
  const grindelLogo = await contain(grindelLogoPath, 610, 350);
  const overlay = svg(2400, 600, `
    <defs>
      <linearGradient id="dark" x1="0" x2="1"><stop stop-color="#151716"/><stop offset="1" stop-color="${CHARCOAL}"/></linearGradient>
      <linearGradient id="mint" x1="0" x2="1"><stop stop-color="${MINT}"/><stop offset="1" stop-color="${LIME}"/></linearGradient>
    </defs>
    <path d="M0 0 H710 L930 300 L710 600 H0 Z" fill="url(#dark)"/>
    <path d="M660 0 H715 L935 300 L715 600 H660 L880 300 Z" fill="url(#mint)" fill-opacity=".96"/>
    <path d="M80 0 L360 0 L80 280 Z M350 600 L650 600 L650 300 Z" fill="#fff" fill-opacity=".035"/>
  `);

  await sharp(background)
    .composite([
      { input: overlay, top: 0, left: 0 },
      { input: grindelLogo, top: 125, left: 65 },
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
  const grindelLogo = await contain(grindelLogoPath, 840, 320);
  const dfLogo = await contain(dynoforcePath, 240, 240);
  const base = svg(2500, 500, `
    <defs>
      <linearGradient id="bg" x1="0" x2="1"><stop stop-color="#171918"/><stop offset=".74" stop-color="${CHARCOAL}"/><stop offset="1" stop-color="#222624"/></linearGradient>
      <linearGradient id="brand" x1="0" x2="1"><stop stop-color="${MINT}"/><stop offset="1" stop-color="${LIME}"/></linearGradient>
    </defs>
    <rect width="2500" height="500" fill="url(#bg)"/>
    <path d="M1120 0 H1330 L1620 500 H1410 Z" fill="url(#brand)" fill-opacity=".92"/>
    <path d="M1370 0 H1450 L1740 500 H1660 Z" fill="#fff" fill-opacity=".08"/>
    <rect x="2070" y="90" width="320" height="320" rx="52" fill="#fff"/>
  `);

  await sharp(base)
    .composite([
      { input: grindelLogo, top: 90, left: 145 },
      { input: dfLogo, top: 130, left: 2110 },
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'sponsor-footer-2500x500.jpg'));
}

Promise.all([createHeader(), createEventLogo(), createSponsorFooter()]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
