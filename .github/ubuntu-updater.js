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
  'https://cdimage.ubuntu.com/ubuntu-mate/releases/{v}/release/',
  'https://cdimage.ubuntu.com/xubuntu/releases/{v}/release/',
];

var desktopEnvironments = {
  'ubuntu-budgie': 'Budgie',
  kubuntu: 'KDE',
  lubuntu: 'LXQt',
  'ubuntu-mate': 'Mate',
  xubuntu: 'Xfce',
  ubuntu: 'Gnome',
};

async function run() {
  let versions = calculateCurrentVersions();
  let torrentFileLinks = [];

  // for each url and version, fetch the page, parse it, and extract the torrent links with their source URLs
  for (let url of urls) {
    for (let version of versions) {
      let versionUrl = url.replace('{v}', version);
      let response = await fetch(versionUrl);
      let body = await response.text();
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

  // turn those torrent file urls into parsed torrent objects
  let parsedTorrents = await Promise.all(
    torrentFileLinks.map(
      (link) =>
        new Promise((resolve, reject) => {
          remote(link.torrentUrl, (err, parsedTorrent) => {
            if (err) {
              reject(err);
            } else {
              resolve({
                parsedTorrent,
                sourceUrl: link.sourceUrl,
                version: link.version,
              });
            }
          });
        })
    )
  );

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
