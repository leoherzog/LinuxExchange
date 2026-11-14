import { readCatalog, writeCatalog } from './catalog.js';

var distros = readCatalog();
var timeInBase64 = new Buffer.from(new Date().getTime().toString()).toString('base64');

var headers = new Headers({
  "User-Agent": "Wget/"
});

var lookups = [];

for (let distro of distros.distros) {
  for (let version of distro.versions) {
    var url = version['direct-download-url'].replace('{{base64time}}', timeInBase64);
    if (!version['file-size'] || version['file-size'] === '0') {
      lookups.push(addFileSize(version, url));
    }
  }
}

await Promise.all(lookups);
writeCatalog(distros, 'Add Missing File Sizes');

async function addFileSize(version, url) {
  try {
    let filesize = await fetch(url, { headers }).then(r => r.headers.get('content-length'));
    version['file-size'] = filesize ? new Number(filesize) : null;
  } catch (err) {
    console.error(`Failed to look up the size of ${url}:`, err);
    process.exitCode = 1;
  }
}
