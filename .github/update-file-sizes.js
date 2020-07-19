const fs = require('fs');
const fetch = require('node-fetch');

var node;
var distros = JSON.parse(fs.readFileSync('distros.json'));
var timeInBase64 = new Buffer(new Date().getTime().toString()).toString('base64');

async function downloadFiles() {
  for (let distro of distros.distros) {
    for (let version of distro.versions) {
      var url = version['direct-download-url'].replace('{{base64time}}', timeInBase64);
      if (!version['file-size']) {
        await addFileSize(version, url);
      }
    }
  }
  return;
}

async function addFileSize(version, url) {
  try {
    var res = await fetch(url, {"timeout": 60 * 1000, "headers": {"user-agent": "Wget/"}});
    version['file-size'] = await res.headers.get('content-length');
    fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
  }
  catch(e) {
    console.log("Problem adding file size on " + url.substring(url.lastIndexOf('/') + 1) + ": " + e.toString());
  }
}

async function addHash(version, url) {
  try {
    for await (const file of node.add(urlSource(url, {"timeout": 60 * 1000, "headers": {"user-agent": "Wget/"}}), {"pin": false})) {
      version['ipfs-hash'] = file.cid.toString();
      fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
      console.log('Added hash for ' + url.substring(url.lastIndexOf('/') + 1));
      await node.repo.gc();
      return;
    }
  }
  catch(e) {
    console.error("Problem adding hash on " + url.substring(url.lastIndexOf('/') + 1) + ": " + e.toString());
  }
}

downloadFiles();