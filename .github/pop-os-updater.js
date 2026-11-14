import { readCatalog, writeCatalog } from './catalog.js';

const DISTRO_NAME = 'Pop!_OS';
// System76 publishes builds through a small JSON API; there are no torrents, so
// magnet-url stays null and we only refresh the direct download URL and size.
const API_URL = 'https://api.pop-os.org/builds/{version}/{channel}';

// Map the parenthetical in each version label to an API channel.
const channelFor = (version) => {
  if (/nvidia/i.test(version)) return 'nvidia';
  if (/raspberry|raspi|pi/i.test(version)) return 'raspi';
  return 'intel';
};

async function fetchBuild(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Wget/' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = (await res.text()).trim();
  if (!text) return null; // some channels (e.g. raspi) have no published build
  const data = JSON.parse(text);
  if (data.errors || !data.url) return null;
  return data;
};

async function run() {
  const distros = readCatalog();
  const distroIndex = distros.distros.findIndex((d) => d.name === DISTRO_NAME);
  if (distroIndex === -1) throw new Error(`${DISTRO_NAME} not found in the catalog`);

  for (const entry of distros.distros[distroIndex].versions) {
    const baseVersion = (entry.version.match(/^(\d+\.\d+)/) || [])[1];
    if (!baseVersion) {
      console.warn(`Skipping entry with unparseable version "${entry.version}".`);
      continue;
    }

    const channel = channelFor(entry.version);
    const url = API_URL.replace('{version}', baseVersion).replace('{channel}', channel);

    let build;
    try {
      build = await fetchBuild(url);
    } catch (err) {
      console.warn(`Skipping ${entry.version} (${channel}): ${err.message}`);
      continue;
    }
    if (!build) {
      console.warn(`Skipping ${entry.version} (${channel}): no build published at ${url}`);
      continue;
    }

    entry['direct-download-url'] = build.url;
    entry['file-size'] = build.size || null;
  }

  writeCatalog(distros, 'Update Pop!_OS');
}

run().catch((err) => {
  console.error('Failed to update Pop!_OS entries:', err);
  process.exit(1);
});
