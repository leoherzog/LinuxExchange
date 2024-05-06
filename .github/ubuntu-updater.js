import fs from 'fs';
import * as cheerio from 'cheerio';
import * as parseTorrent from 'parse-torrent';

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
          parseTorrent.remote(link.torrentUrl, (err, parsedTorrent) => {
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
  let distroVersions = parsedTorrents.map(({ parsedTorrent, sourceUrl, version }) => {
    let name = parsedTorrent['name'];
    let afterVersion = name
      .replace('-live', '')
      .replace('.torrent', '')
      .split(version + '-')[1]
      .split('-');
    let arch = afterVersion[1].replace('.iso', '');
    let de = desktopEnvironments[Object.keys(desktopEnvironments).find((key) => name.includes(key))];
    let magnetUrl = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + name;
    let directDownloadUrl = new URL(name.replace('.torrent', ''), sourceUrl).href;
    let fileSize = parsedTorrent['length'];
    return { arch, version, 'desktop-environment': de, 'magnet-url': magnetUrl, 'direct-download-url': directDownloadUrl, 'file-size': fileSize };
  });

  // console.log(torrentFiles);

  distros['distros'][distroIndex]['versions'] = distroVersions;

  let ltsVersion = calculateLtsVersion();
  console.log(ltsVersion);
  const ltsIndex = distroVersions.findIndex((v) => v.version === ltsVersion && v.arch === 'amd64' && v['desktop-environment'] === 'Gnome');
  distros['distros'][distroIndex]['recommended-version-index'] = ltsIndex;

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
  nonLtsYear = (nonLtsYear - (nonLtsMonth === 10 ? 1 : 0)) % 100; // Adjust year for October releases
  return nonLtsYear + '.' + nonLtsMonth.toString().padStart(2, '0');
}

run();
