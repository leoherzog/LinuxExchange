const fs = require('fs');
const get = require('simple-get')
const cheerio = require('cheerio');
const parseTorrent = require('parse-torrent');

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(function(distro) {
  return distro['name'] == "Debian";
});

var urls = ["https://cdimage.debian.org/debian-cd/current-live/i386/bt-hybrid/", "https://cdimage.debian.org/debian-cd/current-live/amd64/bt-hybrid/"]

for (var url of urls) {
  get.concat(url, parseWebpage);
}

function parseWebpage(err, res, body) {

  if (err) throw err;

  let url = res.req.agent.protocol + '//' + res.req.socket.servername + res.req.path;

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
    correspondingVersion['ipfs-hash'] = '';
    correspondingVersion['file-size'] = '';

    fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));

  }

}