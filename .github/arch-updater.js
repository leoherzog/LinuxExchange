import fs from 'fs'
import Parser from 'rss-parser';
import parseTorrent, { remote } from 'parse-torrent';

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Arch');

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; LinuxExchange/1.0)'
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
      // Wait before retrying (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, i), 10000);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

async function parseTorrentWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Attempt ${i + 1} to parse torrent from ${url}`);
      return await new Promise((resolve, reject) => {
        remote(url, (err, parsedTorrent) => {
          if (err) reject(err);
          else resolve(parsedTorrent);
        });
      });
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) {
        throw error;
      }
      // Wait before retrying
      const waitTime = Math.min(1000 * Math.pow(2, i), 10000);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

async function updateArch() {
  try {
    const feed = await fetchWithRetry('https://archlinux.org/feeds/releases/');
    
    if (!feed || !feed.items || feed.items.length === 0) {
      console.log('No items found in RSS feed');
      return;
    }

    const latestItem = feed.items[0];
    
    if (!latestItem.enclosure || !latestItem.enclosure.url) {
      console.log('No torrent URL found in latest release');
      return;
    }

    console.log(`Processing latest release: ${latestItem.title}`);
    
    const parsedTorrent = await parseTorrentWithRetry(latestItem.enclosure.url);
    
    var version = distros['distros'][distroIndex]['versions'][0];

    if (version['version'] != latestItem.title) {
      console.log(`Updating version from ${version['version']} to ${latestItem.title}`);
      
      version['version'] = latestItem.title;
      version['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent.infoHash + '&dn=' + parsedTorrent.name;
      version['direct-download-url'] = 'https://mirrors.kernel.org/archlinux/iso/' + latestItem.title + '/' + parsedTorrent.name;
      version['file-size'] = null;
      
      fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
      console.log('Successfully updated distros.json');
    } else {
      console.log('Version is already up to date');
    }
  } catch (error) {
    console.error('Failed to update Arch Linux information:', error);
    process.exit(1);
  }
}

updateArch();
