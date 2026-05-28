import fs from 'fs';
import * as cheerio from 'cheerio';
import parseTorrent, { remote } from 'parse-torrent';

const currentDate = new Date();
const currentYear = currentDate.getFullYear();
const currentMonth = currentDate.getMonth() + 1;

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex((distro) => distro['name'] == 'Ubuntu');

var urls = [
  'https://cdimage.ubuntu.com/ubuntu-budgie/releases/{v}/release/',
  'https://releases.ubuntu.com/{v}/',
  'https://cdimage.ubuntu.com/kubuntu/releases/{v}/release/',
  'https://cdimage.ubuntu.com/lubuntu/releases/{v}/release/',
  'https://cdimage.ubuntu.com/xubuntu/releases/{v}/release/',
];

var desktopEnvironments = {
  "ubuntu-budgie": "Budgie",
  "kubuntu": "KDE",
  "lubuntu": "LXQt",
  "xubuntu": "Xfce",
  "live-server": "No Desktop Environment",
  "ubuntu": "Gnome",
};

// Canonical's mirrors intermittently throttle CI egress, so every network call
// is retried with backoff and bounded by an explicit timeout. A request that
// still fails after retries is skipped rather than aborting the whole run.
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(label, fn) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err.noRetry) throw err; // definitive response (e.g. 404) — retrying won't help
      if (attempt < MAX_ATTEMPTS) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        console.warn(`${label} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`);
}

function fetchPage(url) {
  return withRetry(`Fetch ${url}`, async () => {
    let response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      let err = new Error(`HTTP ${response.status}`);
      // 4xx (except 429 rate-limit) are definitive — e.g. a flavor without this release yet
      err.noRetry = response.status >= 400 && response.status < 500 && response.status !== 429;
      throw err;
    }
    return await response.text();
  });
}

function parseTorrentRemote(torrentUrl) {
  return withRetry(`Torrent ${torrentUrl}`, () => new Promise((resolve, reject) => {
    let settled = false;
    let timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Request timed out')); }
    }, REQUEST_TIMEOUT_MS);
    remote(torrentUrl, (err, parsedTorrent) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(parsedTorrent);
    });
  }));
}

async function run() {
  let versions = calculateCurrentVersions();
  let torrentFileLinks = [];

  // for each url and version, fetch the page, parse it, and extract the torrent links with their source URLs
  for (let url of urls) {
    for (let version of versions) {
      let versionUrl = url.replace('{v}', version);
      let body;
      try {
        body = await fetchPage(versionUrl);
      } catch (err) {
        console.warn(`Skipping mirror ${versionUrl}: ${err.message}`);
        continue;
      }
      let $ = cheerio.load(body);
      let links = $('a')
        .toArray()
        .filter((el) => $(el).text().includes('.torrent'))
        .map((el) => ({
          torrentUrl: new URL($(el).attr('href'), versionUrl).href,
          sourceUrl: versionUrl,
          version: version,
        }));

      torrentFileLinks.push(...links);
    }
  }

  // console.log(torrentFileLinks.map((link) => link.torrentUrl));

  // turn those torrent file urls into parsed torrent objects; a single torrent
  // that stays unreachable is skipped instead of aborting the whole run
  let settledTorrents = await Promise.allSettled(
    torrentFileLinks.map(async (link) => ({
      parsedTorrent: await parseTorrentRemote(link.torrentUrl),
      sourceUrl: link.sourceUrl,
      version: link.version,
    }))
  );

  let parsedTorrents = [];
  settledTorrents.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      parsedTorrents.push(result.value);
    } else {
      console.warn(`Skipping torrent ${torrentFileLinks[i].torrentUrl}: ${result.reason?.message}`);
    }
  });

  // console.log(parsedTorrents.length);

  // turn those parsed torrent objects into the format we want to store in the distros.json file
  let distroVersions = parsedTorrents.map(({ parsedTorrent, sourceUrl }) => {
    let name = parsedTorrent['name'];
    let nameParts = name.replace('.iso', '').split('-');
    let version = nameParts.find(part => /^\d+\.\d+(\.\d+)?$/.test(part));
    let arch = nameParts[nameParts.length - 1];
    let de = desktopEnvironments[Object.keys(desktopEnvironments).find((key) => name.includes(key))];
    let magnetUrl = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + name;
    let directDownloadUrl = new URL(name, sourceUrl).href;
    let fileSize = parsedTorrent['length'];
    return { arch, version, 'desktop-environment': de, 'magnet-url': magnetUrl, 'direct-download-url': directDownloadUrl, 'file-size': fileSize };
  });

  // console.log(torrentFiles);

  // bail out rather than overwrite good data with an empty list if every mirror/torrent failed
  if (distroVersions.length === 0) {
    throw new Error('No Ubuntu versions could be retrieved; leaving distros.json unchanged.');
  }

  distros['distros'][distroIndex]['versions'] = distroVersions;

  let ltsVersion = calculateLtsVersion();
  const ltsIndex = distroVersions.findIndex((v) => {
    return v.version.startsWith(ltsVersion) &&
      v.arch === 'amd64' &&
      v['desktop-environment'] === 'Gnome' &&
      !v.version.includes('daily');
  });
  if (ltsIndex === -1) {
    console.warn(`Warning: Could not find LTS version ${ltsVersion} for amd64 with Gnome desktop. Using latest version instead.`);
    const latestVersion = distroVersions
      .filter(v => v.arch === 'amd64' && v['desktop-environment'] === 'Gnome' && !v.version.includes('daily'))
      .sort((a, b) => parseFloat(b.version) - parseFloat(a.version))[0];
    distros['distros'][distroIndex]['recommended-version-index'] = distroVersions.indexOf(latestVersion);
  } else {
    distros['distros'][distroIndex]['recommended-version-index'] = ltsIndex;
  }

  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
}

function calculateCurrentVersions() {
  let versions = [calculateLtsVersion(), calculateNonLtsVersion()];
  versions = [...new Set(versions)];
  return versions;
}

function calculateLtsVersion() {
  const ltsYear = (currentMonth < 4 ? currentYear - 2 : currentYear - (currentYear % 2)) % 100; // two digits
  return ltsYear + '.04';
}

function calculateNonLtsVersion() {
  let nonLtsYear = currentYear;
  let nonLtsMonth = currentMonth < 4 ? 10 : currentMonth < 10 ? 4 : 10;
  // Only adjust year down if we're before April and referring to last year's October
  nonLtsYear = (nonLtsYear - (currentMonth < 4 ? 1 : 0)) % 100;
  return nonLtsYear + '.' + nonLtsMonth.toString().padStart(2, '0');
}

run();
