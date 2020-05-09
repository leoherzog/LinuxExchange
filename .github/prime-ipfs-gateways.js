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
      for (let gateway of gateways) {
        let url = 'https://' + gateway + '/ipfs/' + version['ipfs-hash'];
        await makeRequest(url);
      }
    }
  }
  return;
}

async function makeRequest(url) {
  console.log("Requesting " + url + "...");
  try {
    var res = await fetch(url, {"timeout": 15 * 1000});
    console.log("Got response. Size: " + res.headers.get('content-length'));
  }
  catch(e) {
    console.error("No response");
  }
  return;
}

makeRequests();