import fs from 'fs';
import * as cheerio from 'cheerio';
import parseTorrent from 'parse-torrent';

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Linux Mint');

const editions = [
  { edition: 'cinnamon', desktopEnvironment: 'Cinnamon' },
  { edition: 'mate', desktopEnvironment: 'MATE' },
  { edition: 'xfce', desktopEnvironment: 'Xfce' },
];

const MIRROR_URL = 'https://mirrors.edge.kernel.org/linuxmint/stable/';
const TORRENT_BASE_URL = 'https://www.linuxmint.com/torrents/';

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Attempt ${i + 1} to fetch ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) {
        throw error;
      }
      const waitTime = Math.min(1000 * Math.pow(2, i), 10000);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

function compareVersions(a, b) {
  // Compare semantic versions like "22.2" vs "22.1" vs "21.3"
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }
  return 0;
}

async function getLatestVersion() {
  const response = await fetchWithRetry(MIRROR_URL);
  const html = await response.text();
  const $ = cheerio.load(html);

  // Parse directory listing for version folders
  // Links look like "22.2/" or "21.3/"
  const versions = $('a')
    .map((i, el) => $(el).attr('href'))
    .get()
    .filter(href => /^\d+(\.\d+)?\/?$/.test(href))
    .map(href => href.replace('/', ''));

  if (versions.length === 0) {
    throw new Error('No version directories found in mirror listing');
  }

  // Sort and get the latest
  versions.sort(compareVersions);
  const latest = versions[versions.length - 1];

  console.log(`Found ${versions.length} versions, latest is ${latest}`);
  return latest;
}

async function fetchTorrent(version, edition) {
  const filename = `linuxmint-${version}-${edition}-64bit.iso`;
  const torrentUrl = `${TORRENT_BASE_URL}${filename}.torrent`;

  console.log(`  Fetching torrent from ${torrentUrl}`);

  const response = await fetchWithRetry(torrentUrl);
  const torrentBuffer = await response.arrayBuffer();
  const parsed = parseTorrent(Buffer.from(torrentBuffer));

  console.log(`  Successfully parsed torrent: ${parsed.name}`);

  return {
    magnetUrl: 'magnet:?xt=urn:btih:' + parsed.infoHash + '&dn=' + encodeURIComponent(parsed.name),
    fileSize: parsed.length,
    filename: parsed.name,
  };
}

async function updateLinuxMint() {
  try {
    const latestVersion = await getLatestVersion();

    console.log(`\nProcessing Linux Mint ${latestVersion}...`);

    for (const { edition, desktopEnvironment } of editions) {
      console.log(`\nProcessing ${desktopEnvironment} edition...`);

      try {
        const torrentData = await fetchTorrent(latestVersion, edition);

        const directDownloadUrl = `https://mirrors.kernel.org/linuxmint/stable/${latestVersion}/linuxmint-${latestVersion}-${edition}-64bit.iso`;

        // Find or create the version entry
        let versionEntry = distros['distros'][distroIndex]['versions'].find(
          v => v['desktop-environment'] === desktopEnvironment && v['arch'] === 'amd64'
        );

        if (!versionEntry) {
          console.log(`  Creating new entry for ${desktopEnvironment}`);
          versionEntry = {
            arch: 'amd64',
            version: latestVersion,
            'desktop-environment': desktopEnvironment,
            'magnet-url': torrentData.magnetUrl,
            'direct-download-url': directDownloadUrl,
            'file-size': torrentData.fileSize,
          };
          distros['distros'][distroIndex]['versions'].push(versionEntry);
        } else if (versionEntry['version'] !== latestVersion) {
          console.log(`  Updating from v${versionEntry['version']} to v${latestVersion}`);
          versionEntry['version'] = latestVersion;
          versionEntry['magnet-url'] = torrentData.magnetUrl;
          versionEntry['direct-download-url'] = directDownloadUrl;
          versionEntry['file-size'] = torrentData.fileSize;
        } else {
          console.log(`  Already up to date at v${latestVersion}`);
        }

      } catch (error) {
        console.error(`  Error processing ${desktopEnvironment}:`, error.message);
      }
    }

    // Write updated distros.json
    fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
    console.log('\nSuccessfully updated distros.json');

  } catch (error) {
    console.error('Failed to update Linux Mint information:', error);
    process.exit(1);
  }
}

updateLinuxMint();
