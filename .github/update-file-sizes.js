const fs = require('fs');
const http = require('http');
const https = require('https');

var distros = JSON.parse(fs.readFileSync('distros.json'));
var timeInBase64 = new Buffer.from(new Date().getTime().toString()).toString('base64');

function downloadFiles() {
  for (let distro of distros.distros) {
    for (let version of distro.versions) {
      var url = version['direct-download-url'].replace('{{base64time}}', timeInBase64);
      if (!version['file-size'] || version['file-size'] === '0') {
        addFileSize(version, url);
      }
    }
  }
  return;
}

function addFileSize(version, url) {
  if (url.toLowerCase().includes('https')) {
    https.get(url, function(res) {
      version['file-size'] = res.headers['content-length'];
      fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
    });
  } else {
    http.get(url, function(res) {
      version['file-size'] = res.headers['content-length'];
      fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
    });
  }
}

downloadFiles();