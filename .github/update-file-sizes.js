import fs from 'fs';

var distros = JSON.parse(fs.readFileSync('distros.json'));
var timeInBase64 = new Buffer.from(new Date().getTime().toString()).toString('base64');

var headers = new Headers({
  "User-Agent": "Wget/"
});

for (let distro of distros.distros) {
  for (let version of distro.versions) {
    var url = version['direct-download-url'].replace('{{base64time}}', timeInBase64);
    if (!version['file-size'] || version['file-size'] === '0') {
      addFileSize(version, url);
    }
  }
}

async function addFileSize(version, url) {
  let filesize = await fetch(url, headers).then(r => r.headers.get('content-length'));
  version['file-size'] = filesize ? new Number(filesize) : null;
  fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
}