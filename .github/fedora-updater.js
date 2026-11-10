import fs from 'fs';
import * as cheerio from 'cheerio';
import parseTorrent, { remote } from 'parse-torrent';

(async function () {
  var distros = JSON.parse(fs.readFileSync('distros.json'));

  const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Fedora');

  const desiredSpins = [
    { name: 'Fedora Budgie Live', desktopEnvironment: 'Budgie', arch: 'amd64' },
    { name: 'Fedora Cinnamon Live', desktopEnvironment: 'Cinnamon', arch: 'amd64' },
    { name: 'Fedora i3 Live', desktopEnvironment: 'i3', arch: 'amd64' },
    { name: 'Fedora KDE Desktop Live', desktopEnvironment: 'KDE', arch: 'amd64' },
    { name: 'Fedora LXDE Live', desktopEnvironment: 'LXDE', arch: 'amd64' },
    { name: 'Fedora LXQt Live', desktopEnvironment: 'LXQt', arch: 'amd64' },
    { name: 'Fedora MATE_Compiz Live', desktopEnvironment: 'MATE', arch: 'amd64' },
    { name: 'Fedora Server dvd', desktopEnvironment: 'No Desktop Environment', arch: 'amd64' },
    { name: 'Fedora Server dvd', desktopEnvironment: 'No Desktop Environment', arch: 'arm' },
    { name: 'Fedora SoaS Live', desktopEnvironment: 'Sugar', arch: 'amd64' },
    { name: 'Fedora Workstation Live', desktopEnvironment: 'Gnome', arch: 'amd64' },
    { name: 'Fedora Xfce Live', desktopEnvironment: 'Xfce', arch: 'amd64' },
  ];

  // Fetch the torrent directory listing
  const listingUrl = 'https://torrent.fedoraproject.org/torrents/';
  const response = await fetchWithRetry(listingUrl);
  const body = await response.text();

  const $ = cheerio.load(body);

  // Map archStr to 'amd64' or 'arm'
  const archMap = {
    'x86_64': 'amd64',
    'aarch64': 'arm',
  };

  let torrentsToProcess = [];

  $('a[href$=".torrent"]').each(function () {
    const fileName = $(this).attr('href');

    // e.g., Fedora-KDE-Desktop-Live-x86_64-45.torrent (skips Beta and other non-numeric versions)
    const match = fileName.match(/^Fedora-(.+)-(x86_64|aarch64)-(\d+)\.torrent$/);
    if (!match) return;

    const [, spinSlug, archStr, version] = match;

    // Build a spinName, e.g., 'Fedora KDE Desktop Live'
    const spinName = 'Fedora ' + spinSlug.replaceAll('-', ' ');
    const arch = archMap[archStr];

    // Now, see if spinName and arch match any of our desiredSpins
    const matchingSpin = desiredSpins.find(spin => spin.name === spinName && spin.arch === arch);

    if (matchingSpin) {
      torrentsToProcess.push({
        desktopEnvironment: matchingSpin.desktopEnvironment,
        arch,
        version,
        torrentUrl: new URL(fileName, listingUrl).href,
        fileName,
        archStr, // original arch string (e.g., x86_64, aarch64)
        spinName,
      });
    }
  });

  if (torrentsToProcess.length === 0) {
    throw new Error(`No matching Fedora torrents found at ${listingUrl}; the page format may have changed.`);
  }

  // Find the latest version number
  const latestVersion = torrentsToProcess.reduce((maxVersion, torrent) => {
    const version = parseInt(torrent.version);
    return version > maxVersion ? version : maxVersion;
  }, 0).toString();

  // Filter to only process the latest version
  const latestTorrents = torrentsToProcess.filter(t => t.version === latestVersion);

  // Now, process the torrents
  console.log(`Processing ${latestTorrents.length} torrents for version ${latestVersion}...`);
  for (let torrentInfo of latestTorrents) {
    try {
      console.log(`  Processing: ${torrentInfo.spinName} ${torrentInfo.arch} v${torrentInfo.version}`);
      // Fetch the torrent file
      const torrentResponse = await fetchWithRetry(torrentInfo.torrentUrl);
      const torrentBuffer = await torrentResponse.arrayBuffer();

      // Parse the torrent buffer
      const parsedTorrent = parseTorrent(Buffer.from(torrentBuffer));

      await updateVersion(torrentInfo, parsedTorrent, distros['distros'][distroIndex]);

    } catch (err) {
      console.error('Error processing torrent:', torrentInfo.torrentUrl, err);
    }
  }

  // Write the updated distros.json
  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));

})();

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      console.error(`Attempt ${i + 1} to fetch ${url} failed:`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** i));
    }
  }
}

async function updateVersion(torrentInfo, parsedTorrent, distro) {

  const { desktopEnvironment, arch, version, archStr } = torrentInfo;

  var versions = distro['versions'];

  let correspondingVersion = versions.find(versionObj => {
    return versionObj['arch'] === arch && versionObj['desktop-environment'] === desktopEnvironment;
  });

  if (!correspondingVersion) {
    // If not found, skip
    console.warn(`Warning: No matching version found for desktop-environment: ${desktopEnvironment}, arch: ${arch}`);
    return;
  }

  console.log(`    Updating ${desktopEnvironment} ${arch} from v${correspondingVersion['version']} to v${version}`);
  correspondingVersion['version'] = version;
  correspondingVersion['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + encodeURIComponent(parsedTorrent['name']);


  let spinDir;
  if (desktopEnvironment === 'Gnome') {
    spinDir = 'Workstation';
  } else if (desktopEnvironment === 'KDE') {
    spinDir = 'KDE';
  } else if (desktopEnvironment === 'No Desktop Environment') {
    spinDir = 'Server';
  } else {
    spinDir = 'Spins';
  }

  // Filter files to those ending with '.iso'
  const isoFiles = parsedTorrent.files.filter(file => file.name.endsWith('.iso'));

  if (isoFiles.length === 0) {
    console.warn(`Warning: No ISO file found in the torrent for ${desktopEnvironment} ${arch}`);
    return;
  }

  const isoFile = isoFiles.reduce((largest, file) => {
    return file.length > largest.length ? file : largest;
  }, isoFiles[0]);

  // Construct the direct download URL
  const directDownloadUrl = `https://download.fedoraproject.org/pub/fedora/linux/releases/${version}/${spinDir}/${archStr}/iso/${encodeURIComponent(isoFile.name)}`;

  correspondingVersion['direct-download-url'] = directDownloadUrl;

  correspondingVersion['file-size'] = isoFile.length;

}
