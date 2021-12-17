const fs = require('fs');
const get = require('simple-get')
const cheerio = require('cheerio');
const parseTorrent = require('parse-torrent');

var distros = JSON.parse(fs.readFileSync('distros.json'));

const distroIndex = distros['distros'].findIndex(distro => distro['name'] == 'Elementary');

get.concat('https://elementary.io/', (err, res, body) => {

  if (err) throw err;

  let $ = cheerio.load(body);
  let parsed = parseTorrent($('.magnet')[0].attribs['href']);
  let version = distros.distros[distroIndex]['versions'][0];

  if (parsed['name'] !== version['magnet-url'].split('&dn=')[1]) {

    version['version'] = parsed['name'].split('-')[1];
    version['magnet-url'] = 'magnet:?xt=urn:btih:' + parsed['infoHash'] + '&dn=' + parsed['name'];
    let url = $('.http')[0].attribs['href'].split('/');
    url[4] = '{{base64time}}';
    version['direct-download-url'] = 'https:' + url.join('/');
    version['file-size'] = '';

    fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));

  }

  return;

});