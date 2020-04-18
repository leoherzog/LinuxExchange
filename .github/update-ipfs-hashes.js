const fs = require('fs');
const ipfs = require('ipfs');
const { urlSource } = ipfs;

var node;
var distros = JSON.parse(fs.readFileSync('distros.json'));
var timeInBase64 = new Buffer(new Date().getTime().toString()).toString('base64');

async function startNode () {
  node = await ipfs.create();
  await downloadFiles(node);
  node.repo.gc();
  process.exit();
}

async function downloadFiles() {
  for (var i in distros.distros) {
    for (var j in distros.distros[i].versions) {
      var version = distros.distros[i].versions[j];
      if (!version['ipfs-hash']) {
        await addHash(version, version['direct-download-url'].replace('{{base64time}}', timeInBase64));
      }
    }
  }
  return;
}

async function addHash(version, url) {
  try {
    for await (const file of node.add(urlSource(url, {"headers": {"user-agent": "Wget/"}}), {"pin": false})) {
      version['ipfs-hash'] = file.cid.toString();
      fs.writeFileSync('distros.json', JSON.stringify(distros, null, 2));
      console.log('Added hash for ' + url.substring(url.lastIndexOf('/') + 1));
      return;
    }
  }
  catch(e) {
    console.error('Problem downloading: ' + e.toString());
  }
}

startNode();