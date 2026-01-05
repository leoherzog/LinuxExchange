import fs from 'fs';
import Parser from 'rss-parser';
import parseTorrent, { remote } from 'parse-torrent';

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Manjaro');

const desiredEditions = [
  { edition: 'gnome', desktopEnvironment: 'Gnome' },
  { edition: 'kde', desktopEnvironment: 'KDE' },
  { edition: 'xfce', desktopEnvironment: 'Xfce' },
];

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; LinuxExchange/1.0)'
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
    ]
  }
});

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Attempt ${i + 1} to fetch RSS feed from ${url}`);
      const feed = await parser.parseURL(url);
      console.log('Successfully fetched RSS feed');
      return feed;
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

async function fetchTorrentWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`  Attempt ${i + 1} to fetch torrent from ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const torrentBuffer = await response.arrayBuffer();
      const parsedTorrent = parseTorrent(Buffer.from(torrentBuffer));
      console.log('  Successfully parsed torrent');
      return parsedTorrent;
    } catch (error) {
      console.error(`  Attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) {
        throw error;
      }
      const waitTime = Math.min(1000 * Math.pow(2, i), 10000);
      console.log(`  Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

function parseFilename(title) {
  // Title format: /edition/version/manjaro-edition-version-date-kernel.iso
  // Example: /kde/26.0/manjaro-kde-26.0-260104-linux618.iso
  const match = title.match(/^\/([^/]+)\/([^/]+)\/(manjaro-[^/]+\.iso)$/);
  if (!match) return null;

  const [, edition, version, filename] = match;

  // Skip minimal editions - we only want full editions
  if (edition.includes('-minimal') || filename.includes('-minimal')) {
    return null;
  }

  return { edition: edition.toLowerCase(), version, filename };
}

async function updateManjaro() {
  try {
    const feed = await fetchWithRetry('https://sourceforge.net/projects/manjarolinux/rss');

    if (!feed || !feed.items || feed.items.length === 0) {
      console.log('No items found in RSS feed');
      return;
    }

    // Filter for ISO files and parse their info
    const isoItems = feed.items
      .filter(item => item.title && item.title.endsWith('.iso'))
      .map(item => {
        const parsed = parseFilename(item.title);
        if (!parsed) return null;

        // Extract filesize from media:content
        let fileSize = null;
        if (item.mediaContent && item.mediaContent.$) {
          fileSize = parseInt(item.mediaContent.$.filesize, 10) || null;
        }

        return {
          ...parsed,
          link: item.link,
          pubDate: new Date(item.pubDate),
          fileSize,
        };
      })
      .filter(item => item !== null);

    console.log(`Found ${isoItems.length} ISO files in feed`);

    // Group by edition and find latest version for each desired edition
    const latestByEdition = {};

    for (const item of isoItems) {
      const matchingEdition = desiredEditions.find(e => e.edition === item.edition);
      if (!matchingEdition) continue;

      if (!latestByEdition[item.edition] || item.pubDate > latestByEdition[item.edition].pubDate) {
        latestByEdition[item.edition] = {
          ...item,
          desktopEnvironment: matchingEdition.desktopEnvironment,
        };
      }
    }

    console.log(`Processing ${Object.keys(latestByEdition).length} editions...`);

    // Process each edition
    for (const [edition, item] of Object.entries(latestByEdition)) {
      console.log(`\nProcessing ${edition} v${item.version} (${item.filename})`);

      try {
        // Construct torrent URL - torrents are at download.manjaro.org, not SourceForge
        const torrentUrl = `https://download.manjaro.org/${edition}/${item.version}/${item.filename}.torrent`;

        const parsedTorrent = await fetchTorrentWithRetry(torrentUrl);

        const magnetUrl = 'magnet:?xt=urn:btih:' + parsedTorrent.infoHash + '&dn=' + encodeURIComponent(parsedTorrent.name);
        const directDownloadUrl = `https://download.manjaro.org/${edition}/${item.version}/${item.filename}`;

        // Find or create the version entry
        let versionEntry = distros['distros'][distroIndex]['versions'].find(
          v => v['desktop-environment'] === item.desktopEnvironment && v['arch'] === 'amd64'
        );

        if (!versionEntry) {
          console.log(`  Creating new entry for ${item.desktopEnvironment}`);
          versionEntry = {
            arch: 'amd64',
            version: item.version,
            'desktop-environment': item.desktopEnvironment,
            'magnet-url': magnetUrl,
            'direct-download-url': directDownloadUrl,
            'file-size': item.fileSize,
          };
          distros['distros'][distroIndex]['versions'].push(versionEntry);
        } else if (versionEntry['version'] !== item.version) {
          console.log(`  Updating from v${versionEntry['version']} to v${item.version}`);
          versionEntry['version'] = item.version;
          versionEntry['magnet-url'] = magnetUrl;
          versionEntry['direct-download-url'] = directDownloadUrl;
          versionEntry['file-size'] = item.fileSize;
        } else {
          console.log(`  Already up to date at v${item.version}`);
        }

      } catch (error) {
        console.error(`  Error processing ${edition}:`, error.message);
      }
    }

    // Write updated distros.json
    fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
    console.log('\nSuccessfully updated distros.json');

  } catch (error) {
    console.error('Failed to update Manjaro information:', error);
    process.exit(1);
  }
}

updateManjaro();
