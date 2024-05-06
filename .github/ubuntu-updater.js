import fs from 'fs';
import * as cheerio from 'cheerio';
import * as parseTorrent from 'parse-torrent';

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
  ubuntu: 'Gnome',
  kubuntu: 'KDE',
  lubuntu: 'LXQt',
  'ubuntu-mate': 'Mate',
  xubuntu: 'Xfce',
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
    let de = desktopEnvironments[name.split('-')[0]];
    let magnetUrl = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + name;
    let directDownloadUrl = new URL(name.replace('.torrent', ''), sourceUrl).href;
    let fileSize = parsedTorrent['length'];
    return { arch, version, 'desktop-environment': de, 'magnet-url': magnetUrl, 'direct-download-url': directDownloadUrl, 'file-size': fileSize };
  });

  // console.log(torrentFiles);

  distros['distros'][distroIndex]['versions'] = distroVersions;

  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
}

function calculateCurrentVersions() {
  const currentDate = new Date();
  // currentDate.setMonth(currentDate.getMonth() - 3);
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const ltsYear = (currentMonth < 4 ? currentYear - 2 : currentYear - (currentYear % 2)) % 100; // two digits
  const ltsVersion = ltsYear + '.04';

  let nonLtsYear = currentYear;
  let nonLtsMonth;
  if (currentMonth < 4) {
    nonLtsMonth = 10; // Last non-LTS was in the previous year, October
    nonLtsYear -= 1;
  } else if (currentMonth < 10) {
    nonLtsMonth = 4; // Most recent non-LTS was this year, April
  } else {
    nonLtsMonth = 10; // Most recent non-LTS is this year, October
  }
  nonLtsYear = nonLtsYear % 100; // two digits
  const nonLtsVersion = nonLtsYear + '.' + nonLtsMonth.toString().padStart(2, '0');

  let versions = [...new Set([ltsVersion, nonLtsVersion])];
  // console.log(versions);
  return versions;
}

run();
