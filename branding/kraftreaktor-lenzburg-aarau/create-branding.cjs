const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const sourceRoot = path.join(root, 'sources');
const headerCompositePath = path.join(sourceRoot, 'kraftreaktor-header-composite-ai.png');
const wordmarkPath = path.join(sourceRoot, 'kraftreaktor-wordmark.svg');
const dynoforcePath = path.join(root, '..', '..', 'public', 'dynoforce-icon.png');

const BLACK = '#1D1D1D';
const OFF_WHITE = '#F5F5F5';
const CONCRETE = '#B9B8B4';

function svg(width, height, content) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`);
}

function whiteWordmarkSvg() {
  return Buffer.from(fs.readFileSync(wordmarkPath, 'utf8').replaceAll('<path ', `<path fill="${OFF_WHITE}" `));
}

async function contain(input, width, height) {
  return sharp(input, { density: 600 }).resize(width, height, {
    fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 },
  }).png().toBuffer();
}

async function createHeader() {
  const background = await sharp(headerCompositePath).resize(2400, 600, { fit: 'cover' }).png().toBuffer();
  const wordmark = await contain(whiteWordmarkSvg(), 610, 278);
  const overlay = svg(2400, 600, `
    <defs><linearGradient id="black" x1="0" x2="1"><stop stop-color="#101010"/><stop offset="1" stop-color="${BLACK}"/></linearGradient></defs>
    <path d="M0 0 H780 L1010 300 L780 600 H0 Z" fill="url(#black)"/>
    <path d="M720 0 H775 L1005 300 L775 600 H720 L925 300 Z" fill="${CONCRETE}" fill-opacity=".75"/>
  `);
  await sharp(background)
    .composite([{ input: overlay, top: 0, left: 0 }, { input: wordmark, top: 161, left: 70 }])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'header-banner-2400x600.jpg'));
}

async function createEventLogo() {
  await sharp(dynoforcePath).resize(1000, 1000, {
    fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 },
  }).png().toFile(path.join(root, 'eventlogo-df-1000x1000.png'));
}

async function createSponsorFooter() {
  const wordmark = await contain(whiteWordmarkSvg(), 880, 400);
  const dfLogo = await contain(dynoforcePath, 240, 240);
  const base = svg(2500, 500, `
    <rect width="2500" height="500" fill="${BLACK}"/>
    <path d="M1170 0 H1410 L1700 500 H1460 Z" fill="${CONCRETE}" fill-opacity=".8"/>
    <path d="M1435 0 H1515 L1805 500 H1725 Z" fill="#fff" fill-opacity=".08"/>
    <rect x="2070" y="90" width="320" height="320" rx="52" fill="#fff"/>
  `);
  await sharp(base)
    .composite([{ input: wordmark, top: 50, left: 105 }, { input: dfLogo, top: 130, left: 2110 }])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'sponsor-footer-2500x500.jpg'));
}

Promise.all([createHeader(), createEventLogo(), createSponsorFooter()]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
