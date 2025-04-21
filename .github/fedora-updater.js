import fs from 'fs';
import * as cheerio from 'cheerio';
import parseTorrent, { remote } from 'parse-torrent';

(async function() {
  var distros = JSON.parse(fs.readFileSync('distros.json'));

  const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Fedora');

  const desiredSpins = [
    { name: 'Fedora Budgie Live', desktopEnvironment: 'Budgie', arch: 'amd64' },
    { name: 'Fedora Cinnamon Live', desktopEnvironment: 'Cinnamon', arch: 'amd64' },
    { name: 'Fedora i3 Live', desktopEnvironment: 'i3', arch: 'amd64' },
    { name: 'Fedora KDE Live', desktopEnvironment: 'KDE', arch: 'amd64' },
    { name: 'Fedora LXDE Live', desktopEnvironment: 'LXDE', arch: 'amd64' },
    { name: 'Fedora LXQt Live', desktopEnvironment: 'LXQt', arch: 'amd64' },
    { name: 'Fedora MATE_Compiz Live', desktopEnvironment: 'MATE', arch: 'amd64' },
    { name: 'Fedora Server dvd', desktopEnvironment: 'No Desktop Environment', arch: 'amd64' },
    { name: 'Fedora Server dvd', desktopEnvironment: 'No Desktop Environment', arch: 'arm' },
    { name: 'Fedora SoaS Live', desktopEnvironment: 'Sugar', arch: 'amd64' },
    { name: 'Fedora Workstation Live', desktopEnvironment: 'Gnome', arch: 'amd64' },
    { name: 'Fedora Xfce Live', desktopEnvironment: 'Xfce', arch: 'amd64' },
  ];

  // Fetch the webpage
  const response = await fetch('https://torrent.fedoraproject.org/');
  const body = await response.text();

  const $ = cheerio.load(body);

  const torrentRows = $('table tr');

  let torrentsToProcess = [];

  let currentVersionGroup = '';

  torrentRows.each(function() {
    const tds = $(this).find('td');
    if (tds.length == 1 && $(tds[0]).hasClass('torrent')) {
      // This is a version group header
      currentVersionGroup = $(tds[0]).text().trim();
    } else if (tds.length == 5) {
      const link = $(tds[0]).find('a').attr('href');
      const fileName = $(tds[0]).text().trim();
      const description = $(tds[1]).text().trim();
      const size = $(tds[2]).text().trim();
      const date = $(tds[4]).text().trim();

      if (fileName.toLowerCase().includes('beta')) return;

      // Extract spin, arch, version from description
      const descriptionParts = description.split(' '); // e.g., ['Fedora', 'Cinnamon', 'Live', 'x86_64', '41']

      // Build a spinName, e.g., 'Fedora Cinnamon Live'
      const spinName = descriptionParts.slice(0, -2).join(' '); // Remove last two elements (arch and version)

      const archStr = descriptionParts[descriptionParts.length - 2]; // e.g., 'x86_64' or 'aarch64' or 'ppc64le', etc.
      const version = descriptionParts[descriptionParts.length - 1]; // e.g., '41' or '41_Beta'

      // Map archStr to 'amd64' or 'arm'
      const archMap = {
        'x86_64': 'amd64',
        'aarch64': 'arm',
      };

      const arch = archMap[archStr] || archStr;

      // Now, see if spinName and arch match any of our desiredSpins
      const matchingSpin = desiredSpins.find(spin => spin.name === spinName && spin.arch === arch);

      if (matchingSpin) {
        // Get the torrent URL
        const torrentUrl = link.startsWith('http') ? link : 'https://torrent.fedoraproject.org/' + link;

        // Save this info to process later
        torrentsToProcess.push({
          desktopEnvironment: matchingSpin.desktopEnvironment,
          arch,
          version: version,
          torrentUrl,
          date,
          description,
          fileName,
          archStr, // original arch string (e.g., x86_64, aarch64)
          spinName,
        });
      }
    }
  });

  // Now, process the torrents
  for (let torrentInfo of torrentsToProcess) {
    try {
      // Fetch the torrent file
      const torrentResponse = await fetch(torrentInfo.torrentUrl);
      if (!torrentResponse.ok) {
        throw new Error(`Failed to fetch torrent file: ${torrentResponse.statusText}`);
      }
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

  correspondingVersion['version'] = version;
  correspondingVersion['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + encodeURIComponent(parsedTorrent['name']);


  let spinDir;
  if (desktopEnvironment === 'Gnome') {
    spinDir = 'Workstation';
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
