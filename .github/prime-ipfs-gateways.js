const fs = require('fs');
const fetch = require('node-fetch');

gateways = [
  'ipfs.io',
  'gateway.ipfs.io',
  'cf-ipfs.com',
  'cloudflare-ipfs.com',
  'gateway.pinata.cloud',
  'ipfs.eternum.io',
  'gateway.temporal.cloud',
  'dweb.link'
]
var distros = JSON.parse(fs.readFileSync('distros.json'));

async function makeRequests() {
  for (let distro of distros.distros) {
    for (let version of distro.versions) {
      if (!version['ipfs-hash']) {
        continue;
      }
      console.log("Requesting " + version['direct-download-url'].substring(version['direct-download-url'].lastIndexOf('/') + 1) + "...");
      for (let gateway of gateways) {
        await makeRequest(gateway, version['ipfs-hash']);
      }
    }
  }
  return;
}

async function makeRequest(gateway, hash) {
  let url = 'https://' + gateway + '/ipfs/' + hash;
  try {
    var res = await fetch(url, {"timeout": 15 * 1000, "headers": {"user-agent": "Wget/"}});
    console.log("Got response from " + gateway + ". Size: " + res.headers.get('content-length'));
  }
  catch(e) {
    console.error("No response from " + gateway);
  }
  return;
}

makeRequests();