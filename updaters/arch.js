const fs = require('fs');
const Parser = require('rss-parser');
const parseTorrent = require('parse-torrent');

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(function(distro) {
  return distro['name'] == "Arch";
});

const parser = new Parser();
parser.parseURL('https://www.archlinux.org/feeds/releases/', function(err, feed) {
  
  if (err) throw err;

  parseTorrent.remote(feed['items'][0]['enclosure']['url'], function(err, parsedTorrent) {

    if (err) throw err;

    var version = distros['distros'][distroIndex]['versions'][0];

    version['version'] = feed['items'][0]['title'];
    version['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + parsedTorrent['name'];
    version['direct-download-url'] = 'https://mirrors.kernel.org/archlinux/iso/' + feed['items'][0]['title'] + '/' + parsedTorrent['name'];

    fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));

  });
  
});