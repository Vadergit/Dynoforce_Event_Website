const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const logoPath = path.join(root, 'boulderlounge-logo-original.png');
const dynoforcePath = path.join(root, '..', '..', 'public', 'dynoforce-icon.png');
const userHeaderPath = path.join(root, 'boulderlounge-header-user-v3.png');
const userHeaderLogoPath = path.join(root, 'boulderlounge-logo-user-v3.png');

const BLUE = '#071f78';
const ROYAL = '#1236b5';
const ORANGE = '#ff5a24';

function svg(width, height, content) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`);
}

async function contain(input, width, height) {
  return sharp(input).trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } }).resize(width, height, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  }).png().toBuffer();
}

async function createHeader() {
  const background = await sharp(userHeaderPath)
    .resize(2400, 600, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const venueLogo = await contain(userHeaderLogoPath, 340, 386);
  const logoCard = svg(2400, 600, `
    <defs><filter id="shadow"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-opacity=".24"/></filter></defs>
    <rect x="120" y="60" width="480" height="480" rx="36" fill="#fff" filter="url(#shadow)"/>
  `);

  await sharp(background)
    .composite([
      { input: logoCard, top: 0, left: 0 },
      { input: venueLogo, top: 107, left: 190 },
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'header-banner-logo-left-2400x600.jpg'));
}

async function createEventLogo() {
  const venueLogo = await contain(logoPath, 570, 650);
  const dfLogo = await contain(dynoforcePath, 190, 190);
  const base = svg(1000, 1000, `
    <defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#031345"/><stop offset="1" stop-color="${ROYAL}"/></linearGradient></defs>
    <rect width="1000" height="1000" rx="110" fill="url(#g)"/>
    <path d="M0 760 L360 430 L650 710 L1000 360 L1000 1000 L0 1000 Z" fill="#2450d1" fill-opacity=".34"/>
    <rect x="86" y="70" width="828" height="660" rx="72" fill="#fff"/>
    <rect x="690" y="590" width="230" height="230" rx="52" fill="#fff" stroke="${BLUE}" stroke-width="10"/>
    <rect x="110" y="790" width="80" height="8" rx="4" fill="${ORANGE}"/>
    <text x="110" y="865" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800" letter-spacing="2">CHALLENGE</text>
    <text x="110" y="922" fill="#cbd7ff" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" letter-spacing="4">SCHLIEREN × DYNOFORCE</text>
  `);
  await sharp(base).composite([
    { input: venueLogo, top: 78, left: 215 },
    { input: dfLogo, top: 610, left: 710 },
  ]).png().toFile(path.join(root, 'eventlogo-1000x1000.png'));
}

async function createVenueLogo() {
  const venueLogo = await contain(logoPath, 820, 900);
  const base = svg(1000, 1000, `<rect width="1000" height="1000" fill="#fff" fill-opacity="0"/>`);
  await sharp(base).composite([{ input: venueLogo, top: 50, left: 90 }]).png().toFile(path.join(root, 'hallenlogo-1000x1000.png'));
}

async function createSponsorBanner() {
  const venueLogo = await contain(logoPath, 300, 350);
  const dfLogo = await contain(dynoforcePath, 210, 210);
  const base = svg(2500, 500, `
    <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#ffffff"/><stop offset=".7" stop-color="#eef2ff"/><stop offset="1" stop-color="#dce5ff"/></linearGradient></defs>
    <rect width="2500" height="500" fill="url(#g)"/>
    <path d="M0 500 L460 40 L850 500 Z" fill="${ROYAL}" fill-opacity=".06"/>
    <path d="M1550 500 L2050 0 L2500 0 L2500 500 Z" fill="${ROYAL}" fill-opacity=".08"/>
    <rect x="490" y="76" width="3" height="348" fill="#d6dbee"/>
    <rect x="610" y="118" width="72" height="8" rx="4" fill="${ORANGE}"/>
    <text x="610" y="208" fill="${BLUE}" font-family="Arial, Helvetica, sans-serif" font-size="65" font-weight="800" letter-spacing="2">BOULDERLOUNGE SCHLIEREN</text>
    <text x="610" y="280" fill="#53608c" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="700" letter-spacing="5">DYNOFORCE EVENT PARTNER</text>
    <text x="610" y="352" fill="#7a829f" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="600" letter-spacing="3">MOVE &amp; CHILL · TRAINIEREN · MESSEN · VERGLEICHEN</text>
    <rect x="2160" y="105" width="290" height="290" rx="54" fill="#fff" stroke="#d8ddea" stroke-width="3"/>
  `);
  await sharp(base).composite([
    { input: venueLogo, top: 75, left: 110 },
    { input: dfLogo, top: 145, left: 2200 },
  ]).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(path.join(root, 'sponsor-banner-2500x500.jpg'));
}

Promise.all([createHeader(), createEventLogo(), createVenueLogo(), createSponsorBanner()]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
