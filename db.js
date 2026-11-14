// Reads the current catalog out of distros.db with SQLite compiled to WebAssembly.
// The database is fetched whole, opened in memory and read-only on the main thread, and returned to lx.js in the shape of distros.json.
import sqlite3InitModule from 'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.54.1-build1/dist/index.min.mjs';

var sqlite3Ready;

/**
 * Fetches distros.db and returns its current catalog.
 * @returns {Promise<object>} an object shaped like distros.json, where a recommended index is -1 when no row is flagged
 */
export async function loadCatalog() {
  let [api, bytes] = await Promise.all([init(), fetchDatabase()]);
  let db = open(api, bytes);
  try {
    return readCatalog(db);
  }
  finally {
    db.close();
  }
}

// A failed initialization is forgotten so that the retry in lx.js starts over.
function init() {
  sqlite3Ready ??= sqlite3InitModule().catch(e => {
    sqlite3Ready = null;
    throw e;
  });
  return sqlite3Ready;
}

async function fetchDatabase() {
  let res = await fetch('distros.db');
  if (!res.ok) throw new Error('Failed to fetch distros.db: ' + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Opens a read-only in-memory database over a copy of the given bytes.
 * @param {object} api the initialized sqlite3 namespace
 * @param {Uint8Array} bytes a complete SQLite database file in rollback-journal mode
 * @returns {object} an oo1.DB that frees the copy when closed
 */
function open(api, bytes) {
  let db = new api.oo1.DB();
  let pointer = api.wasm.allocFromTypedArray(bytes);
  // SQLite frees the pointer itself when this flag is set, even if deserializing fails.
  let flags = api.capi.SQLITE_DESERIALIZE_FREEONCLOSE | api.capi.SQLITE_DESERIALIZE_READONLY;
  try {
    db.checkRc(api.capi.sqlite3_deserialize(db.pointer, 'main', pointer, bytes.byteLength, bytes.byteLength, flags));
  }
  catch(e) {
    db.close();
    throw e;
  }
  return db;
}

// Preparing a statement costs milliseconds on a fresh page, so rows are read in bulk and grouped here.
function readCatalog(db) {
  let distros = db.selectObjects(`
    SELECT id, name, full_name AS "full-name", primary_color AS "primary-color", url,
           torrent_download_page_url AS "torrent-download-page-url", description, font_logos_icon AS "font-logos-icon", is_recommended
    FROM current_distro
    ORDER BY position`);
  let versions = Map.groupBy(db.selectObjects(`
    SELECT distro_id, arch, version, desktop_environment AS "desktop-environment", magnet_url AS "magnet-url",
           direct_download_url AS "direct-download-url", file_size AS "file-size", is_recommended
    FROM current_image
    ORDER BY position`), version => version.distro_id);
  let trackers = Map.groupBy(db.selectObjects('SELECT distro_id, url FROM tracker ORDER BY position'), tracker => tracker.distro_id);
  let urls = distroId => (trackers.get(distroId) || []).map(tracker => tracker.url);

  for (let distro of distros) {
    distro.versions = versions.get(distro.id) || [];
    distro['recommended-version-index'] = distro.versions.findIndex(version => version.is_recommended);
    distro.trackers = urls(distro.id);
  }

  return {
    'architectures': Object.fromEntries(db.selectArrays('SELECT name, description FROM architecture')),
    'desktop-environments': Object.fromEntries(db.selectObjects('SELECT key, name, description, url FROM desktop_environment')
      .map(({key, ...environment}) => [key, environment])),
    'distros': distros,
    'recommended-distro-index': distros.findIndex(distro => distro.is_recommended),
    'trackers': urls(null)
  };
}
