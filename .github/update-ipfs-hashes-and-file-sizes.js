const fs = require('fs');
const ipfs = require('ipfs');
const { urlSource } = ipfs;
const fetch = require('node-fetch');

var node;
var distros = JSON.parse(fs.readFileSync('distros.json'));
var timeInBase64 = new Buffer(new Date().getTime().toString()).toString('base64');

async function startNode () {
  node = await ipfs.create();
  await downloadFiles(node);
  process.exit();
}

async function downloadFiles() {
  for (let distro of distros.distros) {
    for (let version of distro.versions) {
      var url = version['direct-download-url'].replace('{{base64time}}', timeInBase64);
      if (!version['file-size']) {
        try {
          var res = await fetch(url, {"timeout": 60 * 1000, "headers": {"user-agent": "Wget/"}});
          version['file-size'] = res.headers.get('content-length');
          fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
        }
        catch(e) {
          console.log("Trouble downloading " + url.substring(url.lastIndexOf('/') + 1) + ": " + e.toString());
        }
      }
      if (!version['ipfs-hash']) {
        await addHash(version, url);
      }
    }
  }
  return;
}

async function addHash(version, url) {
  try {
    for await (const file of node.add(urlSource(url, {"timeout": 60 * 1000, "headers": {"user-agent": "Wget/"}}), {"pin": false})) {
      version['ipfs-hash'] = file.cid.toString();
      fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
      console.log('Added hash for ' + url.substring(url.lastIndexOf('/') + 1));
      await node.pin.rm(file.cid.toString());
      await node.repo.gc();
      return;
    }
  }
  catch(e) {
    console.error('Problem downloading: ' + e.toString());
  }
}

startNode();
