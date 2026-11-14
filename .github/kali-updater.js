import * as cheerio from 'cheerio';
import parseTorrent from 'parse-torrent';
import { readCatalog, writeCatalog } from './catalog.js';

const DISTRO_NAME = 'Kali';
const LISTING_URL = 'https://cdimage.kali.org/current/';
// kali.download mirrors the same images and is what the existing entries link to.
const BASE_DOWNLOAD_URL = 'https://kali.download/base-images/kali-{v}/';

// Each version entry we maintain, keyed to the installer torrent it tracks.
// Kali ships the arm64 installer as its Apple Silicon image, so we keep that label.
const targets = [
  { arch: 'amd64', isoArch: 'amd64', versionSuffix: '' },
  { arch: 'arm', isoArch: 'arm64', versionSuffix: ' Apple Silicon' },
];

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Wget/' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (error) {
      console.error(`Attempt ${i + 1} to fetch ${url} failed:`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i));
    }
  }
}

async function fetchPage(url) {
  return (await fetchWithRetry(url)).text();
}

// Fetch from kali.download rather than cdimage.kali.org, which redirects to a random
// mirror that occasionally serves a non-torrent response. Retry if the body isn't bencoded.
async function fetchTorrent(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetchWithRetry(url);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer[0] !== 0x64 /* 'd' */) {
        throw new Error(`Response from ${res.url} is not a torrent (content-type: ${res.headers.get('content-type')})`);
      }
      return await parseTorrent(buffer);
    } catch (error) {
      console.error(`Attempt ${i + 1} to parse torrent ${url} failed:`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i));
    }
  }
}

async function run() {
  const distros = readCatalog();
  const distroIndex = distros.distros.findIndex((d) => d.name === DISTRO_NAME);
  if (distroIndex === -1) throw new Error(`${DISTRO_NAME} not found in the catalog`);

  const body = await fetchPage(LISTING_URL);
  const $ = cheerio.load(body);
  const torrentNames = $('a')
    .toArray()
    .map((el) => $(el).attr('href'))
    .filter((href) => href && href.endsWith('.iso.torrent'));

  // All torrents in a release share the same version, e.g. kali-linux-2026.2-installer-amd64.iso.torrent
  const versionMatch = torrentNames
    .map((name) => name.match(/^kali-linux-(\d{4}\.\d+[a-z]?)-/))
    .find(Boolean);
  if (!versionMatch) throw new Error('Could not determine Kali version from torrent listing.');
  const version = versionMatch[1];

  for (const target of targets) {
    const torrentName = `kali-linux-${version}-installer-${target.isoArch}.iso.torrent`;
    if (!torrentNames.includes(torrentName)) {
      console.warn(`Skipping ${target.arch}: ${torrentName} not found in listing.`);
      continue;
    }

    const entry = distros.distros[distroIndex].versions.find((v) => v.arch === target.arch);
    if (!entry) {
      console.warn(`Skipping ${target.arch}: no matching version entry in the catalog.`);
      continue;
    }

    const parsedTorrent = await fetchTorrent(BASE_DOWNLOAD_URL.replace('{v}', version) + torrentName);
    const isoName = parsedTorrent.name;

    entry.version = version + target.versionSuffix;
    entry['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent.infoHash + '&dn=' + isoName;
    entry['direct-download-url'] = BASE_DOWNLOAD_URL.replace('{v}', version) + isoName;
    entry['file-size'] = parsedTorrent.length || null;
  }

  writeCatalog(distros, 'Update Kali');
}

run().catch((err) => {
  console.error('Failed to update Kali entries:', err);
  process.exit(1);
});
