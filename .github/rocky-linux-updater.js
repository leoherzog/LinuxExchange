import fs from 'fs';
import * as cheerio from 'cheerio';
import { remote } from 'parse-torrent';

const DISTRO_NAME = 'Rocky Linux';
// The /<major>/ directory is a symlink to the latest point release. Each ISO has
// its own single-file .torrent; we track the full DVD image (dvd1 on 10+, dvd on 9).
const ISOS_URL = 'https://download.rockylinux.org/pub/rocky/{major}/isos/{arch}/';

const repoArch = (arch) => (arch === 'arm' ? 'aarch64' : 'x86_64');

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Wget/' } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

function parseTorrentRemote(url) {
  return new Promise((resolve, reject) => {
    remote(url, (err, parsedTorrent) => (err ? reject(err) : resolve(parsedTorrent)));
  });
}

async function run() {
  const distros = JSON.parse(fs.readFileSync('distros.json'));
  const distroIndex = distros.distros.findIndex((d) => d.name === DISTRO_NAME);
  if (distroIndex === -1) throw new Error(`${DISTRO_NAME} not found in distros.json`);

  for (const entry of distros.distros[distroIndex].versions) {
    const major = parseInt(entry.version, 10);
    if (!major) {
      console.warn(`Skipping entry with unparseable version "${entry.version}".`);
      continue;
    }

    const dirUrl = ISOS_URL.replace('{major}', major).replace('{arch}', repoArch(entry.arch));
    let torrentName;
    try {
      const $ = cheerio.load(await fetchPage(dirUrl));
      torrentName = $('a')
        .toArray()
        .map((el) => $(el).attr('href'))
        // -dvd1.torrent (Rocky 10+) or -dvd.torrent (Rocky 9)
        .find((href) => href && /-dvd1?\.torrent$/.test(href));
    } catch (err) {
      console.warn(`Skipping ${entry.arch} (major ${major}): ${err.message}`);
      continue;
    }
    if (!torrentName) {
      console.warn(`Skipping ${entry.arch} (major ${major}): no DVD .torrent found at ${dirUrl}`);
      continue;
    }

    // e.g. Rocky-10.2-x86_64-dvd1.torrent -> version "10.2"
    const versionMatch = torrentName.match(/^Rocky-(\d+\.\d+)-/);
    const parsedTorrent = await parseTorrentRemote(new URL(torrentName, dirUrl).href);
    // Rocky's torrent "name" field omits the extension, so derive the ISO from the
    // torrent filename instead (Rocky-10.2-x86_64-dvd1.torrent -> ...-dvd1.iso).
    const isoName = torrentName.replace(/\.torrent$/, '.iso');

    if (versionMatch) entry.version = versionMatch[1];
    entry['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent.infoHash + '&dn=' + isoName;
    entry['direct-download-url'] = new URL(isoName, dirUrl).href;
    entry['file-size'] = parsedTorrent.length || null;
  }

  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
}

run().catch((err) => {
  console.error('Failed to update Rocky Linux entries:', err);
  process.exit(1);
});
