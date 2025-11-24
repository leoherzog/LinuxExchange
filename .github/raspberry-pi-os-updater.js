import fs from 'fs';
import parseTorrent, { remote } from 'parse-torrent';

const DISTRO_NAME = 'Raspberry Pi OS';
const SOURCE_URL = 'https://downloads.raspberrypi.org/operating-systems-categories.json';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function loadDistros() {
  return JSON.parse(fs.readFileSync('distros.json'));
}

function isVersion32bit(versionObj) {
  const url = versionObj['direct-download-url'] || '';
  return url.includes('armhf') || versionObj.version.includes('(32-Bit)');
}

function isRecommended(versionObj) {
  return versionObj.version.includes('with Recommended Software');
}

function buildVersionString(image) {
  const isFull = image.title.includes('Full');
  const is32 = image.system.includes('32');

  let version = image.releaseDate;
  if (isFull) version += ' with Recommended Software';
  if (is32) version += ' (32-Bit)';
  return version;
}

function imageDescriptor(image) {
  const isLite = image.title.toLowerCase().includes('lite');
  const isFull = image.title.includes('Full');
  const is32 = image.system.includes('32');

  return {
    desktopEnvironment: isLite ? 'No Desktop Environment' : 'PIXEL',
    is32,
    isRecommended: isFull,
  };
}

async function torrentToMagnet(url) {
  const parsedTorrent = await new Promise((resolve, reject) => {
    remote(url, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  return {
    magnet: 'magnet:?xt=urn:btih:' + parsedTorrent.infoHash + '&dn=' + parsedTorrent.name,
    fileSize: parsedTorrent.length,
  };
}

async function run() {
  const distros = loadDistros();
  const distroIndex = distros.distros.findIndex((d) => d.name === DISTRO_NAME);
  if (distroIndex === -1) throw new Error(`${DISTRO_NAME} not found in distros.json`);

  const data = await fetchJson(SOURCE_URL);
  const images = data
    .filter((cat) => cat.title.startsWith('Raspberry Pi OS') && !cat.title.includes('Legacy'))
    .flatMap((cat) => cat.images);

  for (const image of images) {
    const desc = imageDescriptor(image);
    const target = distros.distros[distroIndex].versions.find((v) => {
      return (
        v['desktop-environment'] === desc.desktopEnvironment &&
        isVersion32bit(v) === desc.is32 &&
        isRecommended(v) === desc.isRecommended
      );
    });

    if (!target) {
      console.warn(`No matching version entry for ${image.title} (${image.system})`);
      continue;
    }

    const { magnet, fileSize } = await torrentToMagnet(image.urlTorrent);

    target.version = buildVersionString(image);
    target['magnet-url'] = magnet;
    target['direct-download-url'] = image.urlHttp;
    target['file-size'] = fileSize || image.size || null;
  }

  const recommended = distros.distros[distroIndex].versions.findIndex(
    (v) => v['desktop-environment'] === 'PIXEL' && !isVersion32bit(v) && !isRecommended(v)
  );
  if (recommended !== -1) {
    distros.distros[distroIndex]['recommended-version-index'] = recommended;
  }

  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
}

run().catch((err) => {
  console.error('Failed to update Raspberry Pi OS entries:', err);
  process.exit(1);
});
