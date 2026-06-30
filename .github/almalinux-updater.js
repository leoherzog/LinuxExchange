import fs from 'fs';
import * as cheerio from 'cheerio';
import { remote } from 'parse-torrent';

const DISTRO_NAME = 'AlmaLinux';
// The /<major>/ directory is a symlink to the latest point release, and holds a
// single multi-file .torrent (boot + dvd + minimal) for that release.
const ISOS_URL = 'https://repo.almalinux.org/almalinux/{major}/isos/{arch}/';

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
        .find((href) => href && href.endsWith('.torrent'));
    } catch (err) {
      console.warn(`Skipping ${entry.arch} (major ${major}): ${err.message}`);
      continue;
    }
    if (!torrentName) {
      console.warn(`Skipping ${entry.arch} (major ${major}): no .torrent found at ${dirUrl}`);
      continue;
    }

    // e.g. AlmaLinux-10.2-x86_64.torrent -> version "10.2"
    const versionMatch = torrentName.match(/^AlmaLinux-(\d+\.\d+)-/);
    const parsedTorrent = await parseTorrentRemote(new URL(torrentName, dirUrl).href);
    const dn = torrentName.replace(/\.torrent$/, '');

    if (versionMatch) entry.version = versionMatch[1];
    entry['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent.infoHash + '&dn=' + dn;
    entry['direct-download-url'] = dirUrl;
    entry['file-size'] = parsedTorrent.length || null;
  }

  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
}

run().catch((err) => {
  console.error('Failed to update AlmaLinux entries:', err);
  process.exit(1);
});
