import fs from 'fs';
import * as cheerio from 'cheerio';
import * as parseTorrent from 'parse-torrent';

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Debian');


var urls = ["https://cdimage.debian.org/debian-cd/current-live/amd64/bt-hybrid/"]

async function run() {
  for (var url of urls) {
    let body = await fetch(url).then(x => x.text());
    parseWebpage(url, body);
  }
}

function parseWebpage(url, body) {

  let $ = cheerio.load(body);

  let torrentLinks = [];
  $('td > a').each(function(index, element) {
    if ($(this).text().includes('.torrent')) {
      torrentLinks.push(url + $(this).text());
    }
  });

  for (var link of torrentLinks) {
    parseTorrent.remote(link, updateVersion);
  }

  return;

}

function updateVersion(err, parsedTorrent) {

  if (err) throw err;

  var namepieces = parsedTorrent['name'].split("-");
  var versionNumber = namepieces[2];
  var arch = namepieces[3];
  var de = namepieces[4].replace('.iso', '');

  let correspondingVersion = distros['distros'][distroIndex]['versions'].find(function(version) {
    if (arch == "i386") arch = 'x86';
    if (de == "standard") de = 'no desktop environment';
    return version['arch'] == arch && version['desktop-environment'].toLowerCase() == de;
  });

  if (arch == 'x86') arch = 'i386';
  if (de == 'no desktop environment') de = 'standard';

  if (correspondingVersion['version'] != versionNumber) {

    correspondingVersion['version'] = versionNumber;
    correspondingVersion['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + parsedTorrent['name'];
    correspondingVersion['direct-download-url'] = 'https://cdimage.debian.org/debian-cd/current-live/' + arch + '/iso-hybrid/' + parsedTorrent['name'];
    correspondingVersion['file-size'] = null;

    fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));

  }

}

run();