import fs from 'fs'
import Parser from 'rss-parser';
import {remote} from 'parse-torrent';

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Arch');

const parser = new Parser();
parser.parseURL('https://www.archlinux.org/feeds/releases/', function(err, feed) {

  if (err) throw err;

  remote(feed['items'][0]['enclosure']['url'], function(err, parsedTorrent) {

    if (err) throw err;

    var version = distros['distros'][distroIndex]['versions'][0];

    if (version['version'] != feed['items'][0]['title']) {

      version['version'] = feed['items'][0]['title'];
      version['magnet-url'] = 'magnet:?xt=urn:btih:' + parsedTorrent['infoHash'] + '&dn=' + parsedTorrent['name'];
      version['direct-download-url'] = 'https://mirrors.kernel.org/archlinux/iso/' + feed['items'][0]['title'] + '/' + parsedTorrent['name'];
      version['file-size'] = null;
      
      fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));

    }

  });

});
