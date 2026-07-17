const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const sourceRoot = path.join(root, 'sources');
const headerCompositePath = path.join(sourceRoot, 'bouba-header-composite-ai.png');
const boubaLogoPath = path.join(sourceRoot, 'bouba-logo.png');
const dynoforcePath = path.join(root, '..', '..', 'public', 'dynoforce-icon.png');

const INK = '#2D2A20';
const TEAL = '#345F6B';
const PAPER = '#E4E3E0';

function svg(width, height, content) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`);
}

async function contain(input, width, height) {
  return sharp(input, { density: 600 }).resize(width, height, {
    fit: 'contain',
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  }).png().toBuffer();
}

async function boubaLogo(width, height) {
  return sharp(boubaLogoPath)
    .resize(width, height, { fit: 'contain' })
    .png()
    .toBuffer();
}

async function createHeader() {
  const background = await sharp(headerCompositePath).resize(2400, 600, { fit: 'cover' }).png().toBuffer();
  const logo = await boubaLogo(690, 191);
  const overlay = svg(2400, 600, `
    <path d="M0 0 H760 L980 300 L760 600 H0 Z" fill="${PAPER}"/>
    <path d="M680 0 H760 L980 300 L760 600 H680 L900 300 Z" fill="${TEAL}" fill-opacity=".9"/>
    <path d="M0 0 L340 0 L0 340 Z M360 600 L680 600 L680 320 Z" fill="${INK}" fill-opacity=".055"/>
  `);
  await sharp(background)
    .composite([{ input: overlay, top: 0, left: 0 }, { input: logo, top: 205, left: 42 }])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'header-banner-2400x600.jpg'));
}

async function createEventLogo() {
  await sharp(dynoforcePath).resize(1000, 1000, {
    fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 },
  }).png().toFile(path.join(root, 'eventlogo-df-1000x1000.png'));
}

async function createSponsorFooter() {
  const logo = await boubaLogo(950, 264);
  const dfLogo = await contain(dynoforcePath, 240, 240);
  const base = svg(2500, 500, `
    <rect width="2500" height="500" fill="${PAPER}"/>
    <path d="M1150 0 H1380 L1650 500 H1420 Z" fill="${TEAL}"/>
    <path d="M1390 0 H1490 L1760 500 H1660 Z" fill="${INK}" fill-opacity=".85"/>
    <path d="M0 0 L300 0 L0 300 Z" fill="${INK}" fill-opacity=".045"/>
    <rect x="2070" y="90" width="320" height="320" rx="52" fill="#fff"/>
  `);
  await sharp(base)
    .composite([{ input: logo, top: 118, left: 110 }, { input: dfLogo, top: 130, left: 2110 }])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'sponsor-footer-2500x500.jpg'));
}

Promise.all([createHeader(), createEventLogo(), createSponsorFooter()]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
