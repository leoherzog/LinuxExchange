import fs from 'fs';
import * as cheerio from 'cheerio';
import { remote } from 'parse-torrent';

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

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Wget/' } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

function parseTorrentRemote(url) {
  return new Promise((resolve, reject) => {
    remote(url, (err, parsedTorrent) => {
      if (err) reject(err);
      else resolve(parsedTorrent);
    });
  });
}

async function run() {
  const distros = JSON.parse(fs.readFileSync('distros.json'));
  const distroIndex = distros.distros.findIndex((d) => d.name === DISTRO_NAME);
  if (distroIndex === -1) throw new Error(`${DISTRO_NAME} not found in distros.json`);

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
      console.warn(`Skipping ${target.arch}: no matching version entry in distros.json.`);
      continue;
    }

    const parsedTorrent = await parseTorrentRemote(new URL(torrentName, LISTING_URL).href);
    const isoName = parsedTorrent.name;

    entry.version = version + target.versionSuffix;
    entry['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent.infoHash + '&dn=' + isoName;
    entry['direct-download-url'] = BASE_DOWNLOAD_URL.replace('{v}', version) + isoName;
    entry['file-size'] = parsedTorrent.length || null;
  }

  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
}

run().catch((err) => {
  console.error('Failed to update Kali entries:', err);
  process.exit(1);
});
