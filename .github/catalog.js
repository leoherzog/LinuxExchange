// Reads and writes distros.db, the only store of the images linux.exchange offers and has offered.
// Callers work on a plain object in the distros.json shape; each write that changes the database appends one revision.

import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const schema = readFileSync(new URL('schema.sql', import.meta.url), 'utf8');
const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Returns the current catalog in the distros.json shape.
 * @returns {object} architectures, desktop-environments, distros, recommended-distro-index, and trackers
 */
export function readCatalog() {
  const db = openForReading();
  try {
    const trackers = db.prepare('SELECT url FROM tracker WHERE distro_id IS ? ORDER BY position');
    const images = db.prepare(`SELECT i.*, l.is_recommended FROM listing AS l JOIN image AS i ON i.id = l.image_id
      WHERE i.distro_id = ? AND l.removed_rev IS NULL ORDER BY l.position`);
    const rows = db.prepare('SELECT * FROM current_distro ORDER BY position').all();
    const distros = rows.map(distro => {
      const listed = images.all(distro.id);
      return {
        name: distro.name,
        'full-name': distro.full_name,
        'primary-color': distro.primary_color,
        url: distro.url,
        'torrent-download-page-url': distro.torrent_download_page_url,
        description: distro.description,
        'font-logos-icon': distro.font_logos_icon,
        'recommended-version-index': listed.findIndex(image => image.is_recommended === 1),
        versions: listed.map(toVersion),
        trackers: trackers.all(distro.id).map(tracker => tracker.url),
      };
    });
    const architectures = db.prepare('SELECT name, description FROM architecture ORDER BY rowid').all();
    const desktopEnvironments = db.prepare('SELECT * FROM desktop_environment ORDER BY rowid').all();
    return {
      architectures: Object.fromEntries(architectures.map(arch => [arch.name, arch.description])),
      'desktop-environments': Object.fromEntries(desktopEnvironments.map(de =>
        [de.key, { name: de.name, description: de.description, url: de.url }])),
      distros,
      'recommended-distro-index': rows.findIndex(distro => distro.is_recommended === 1),
      trackers: trackers.all(null).map(tracker => tracker.url),
    };
  } finally {
    db.close();
  }
}

/**
 * Makes the database's current state equal to `catalog`, recording one revision if anything changed.
 * Throws when distros.db is missing, since only import-history.js may create it.
 * @param {object} catalog in the shape readCatalog returns
 * @param {string} subject what made the change, such as "Update Arch"
 * @returns {boolean} whether anything changed; when false the file is left untouched
 */
export function writeCatalog(catalog, subject) {
  if (typeof subject !== 'string' || !subject.trim()) throw new TypeError('writeCatalog needs a subject');
  // The round trip unwraps values such as new Number(...) and drops undefined before comparing.
  const normalized = JSON.parse(JSON.stringify(catalog));
  assertCatalog(normalized);
  return recordRevisions([{ catalog: normalized, subject, recordedAt: Math.floor(Date.now() / 1000) }]) > 0;
}

/**
 * Applies catalogs in order, recording a revision for each one that changes the database.
 * Only import-history.js calls this directly; it does not validate the catalogs.
 * @param {{catalog: object, subject: string, recordedAt: number, commitSha?: string}[]} revisions
 * @param {{fresh?: boolean}} options fresh builds from an empty database and replaces the file; nothing else creates it
 * @returns {number} how many revisions were recorded; the file is untouched when this is 0
 */
export function recordRevisions(revisions, { fresh = false } = {}) {
  const target = databasePath();
  const exists = existsSync(target);
  if (!fresh && !exists) throw missing(target);
  if (fresh && exists) assertNoDirectWrites(target);
  const work = `${target}.tmp`;
  const discard = () => ['', '-journal'].forEach(suffix => rmSync(work + suffix, { force: true }));
  discard();
  if (!fresh) copyFileSync(target, work);
  let db;
  let recorded = 0;
  try {
    db = new DatabaseSync(work);
    // The page opens the file with sqlite3_deserialize, which cannot read a WAL-mode database.
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('BEGIN');
    if (fresh) db.exec(schema);
    const statements = prepare(db);
    for (const revision of revisions) {
      if (record(db, statements, revision)) recorded++;
    }
    db.exec(recorded ? 'COMMIT' : 'ROLLBACK');
    // Only a fresh build is vacuumed, because vacuuming every write roughly doubles the pages each git commit rewrites.
    if (recorded && fresh) db.exec('VACUUM');
    db.close();
  } catch (error) {
    if (db?.isOpen) db.close();
    discard();
    throw error;
  }
  if (recorded) renameSync(work, target);
  else discard();
  return recorded;
}

/**
 * Resolves the database file, which CATALOG_DB overrides for tests.
 * @returns {string}
 */
function databasePath() {
  return process.env.CATALOG_DB || fileURLToPath(new URL('../distros.db', import.meta.url));
}

/**
 * Opens the existing database read-only.
 * @returns {DatabaseSync}
 */
function openForReading() {
  const path = databasePath();
  if (!existsSync(path)) throw missing(path);
  return new DatabaseSync(path, { readOnly: true });
}

/**
 * @param {string} path
 * @returns {Error} the error for a database file that does not exist
 */
function missing(path) {
  return new Error(`${path} does not exist. Check CATALOG_DB and the working directory; only import-history.js creates the file.`);
}

/**
 * Throws unless the file's revisions all come from imported history, so a rebuild cannot discard direct writes.
 * @param {string} path
 */
function assertNoDirectWrites(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('SELECT 1 FROM revision WHERE commit_sha IS NULL LIMIT 1').get()) {
      throw new Error(`${path} holds revisions written after the import; refusing to replace it`);
    }
  } finally {
    db.close();
  }
}

/**
 * Throws with every problem found unless the catalog has the full distros.json shape.
 * A malformed object would otherwise delist distros, images, or trackers without anyone noticing.
 * @param {unknown} catalog JSON-normalized input
 */
function assertCatalog(catalog) {
  const problems = [];
  const expect = (ok, message) => ok || problems.push(message);
  if (!isObject(catalog)) throw new TypeError('Rejected catalog: not an object');
  expect(isObject(catalog.architectures) && Object.values(catalog.architectures).every(value => typeof value === 'string'),
    'architectures must map names to description strings');
  expect(isObject(catalog['desktop-environments']) &&
    Object.values(catalog['desktop-environments']).every(de => isObject(de) && typeof de.name === 'string'),
    'desktop-environments must map keys to objects with a name');
  // With no distro flagged the page cannot pick a default and fails to load.
  const distroIndex = catalog['recommended-distro-index'];
  expect(Number.isInteger(distroIndex) && distroIndex >= 0 && distroIndex < catalog.distros?.length,
    'recommended-distro-index must be the index of one of the distros');
  expect(isStringArray(catalog.trackers), 'trackers must be an array of strings');
  expect(Array.isArray(catalog.distros) && catalog.distros.length > 0, 'distros must be a non-empty array');
  (Array.isArray(catalog.distros) ? catalog.distros : []).forEach((distro, index) => {
    const at = `distros[${index}]`;
    if (!isObject(distro)) return expect(false, `${at} must be an object`);
    expect(typeof distro.name === 'string' && distro.name !== '', `${at}.name must be a non-empty string`);
    expect(Object.entries(distro).every(([key, value]) => key === 'versions' || key === 'trackers' || isScalar(value)),
      `${at} metadata must be strings, numbers, or null`);
    expect(Number.isInteger(distro['recommended-version-index']), `${at}.recommended-version-index must be an integer`);
    expect(isStringArray(distro.trackers), `${at}.trackers must be an array of strings`);
    expect(Array.isArray(distro.versions) &&
      distro.versions.every(version => isObject(version) && Object.values(version).every(isScalar)),
      `${at}.versions must be an array of objects with string, number, or null values`);
  });
  if (problems.length) throw new TypeError(`Rejected catalog: ${problems.join('; ')}`);
}

/**
 * Applies one catalog as a revision inside a savepoint, rolling it back when no row changed.
 * @param {DatabaseSync} db open inside a transaction
 * @param {Record<string, import('node:sqlite').StatementSync>} s prepared statements
 * @param {{catalog: object, subject: string, recordedAt: number, commitSha?: string}} revision
 * @returns {boolean} whether the revision was kept
 */
function record(db, s, { catalog, subject, recordedAt, commitSha = null }) {
  db.exec('SAVEPOINT revision');
  const before = s.totalChanges.get().n;
  const rev = Number(s.revision.run(recordedAt, subject, commitSha).lastInsertRowid);
  apply(s, rev, catalog);
  // The revision insert is one change; every statement in apply skips rows it would not alter.
  const changed = s.totalChanges.get().n - before > 1;
  if (!changed) db.exec('ROLLBACK TO revision');
  db.exec('RELEASE revision');
  return changed;
}

/**
 * Prepares every statement a write runs. Upserts carry a WHERE so unchanged rows count as no change.
 * @param {DatabaseSync} db
 * @returns {Record<string, import('node:sqlite').StatementSync>}
 */
function prepare(db) {
  const sql = {
    totalChanges: 'SELECT total_changes() AS n',
    revision: 'INSERT INTO revision (recorded_at, subject, commit_sha) VALUES (?, ?, ?)',
    architecture: `INSERT INTO architecture (name, description) VALUES (?, ?)
      ON CONFLICT (name) DO UPDATE SET description = excluded.description WHERE description IS NOT excluded.description`,
    desktopEnvironment: `INSERT INTO desktop_environment (key, name, description, url) VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET name = excluded.name, description = excluded.description, url = excluded.url
      WHERE (name, description, url) IS NOT (excluded.name, excluded.description, excluded.url)`,
    distro: `INSERT INTO distro (name, full_name, primary_color, url, torrent_download_page_url, description,
        font_logos_icon, position, is_recommended, added_rev)
      VALUES (:name, :full_name, :primary_color, :url, :torrent_download_page_url, :description,
        :font_logos_icon, :position, :is_recommended, :rev)
      ON CONFLICT (name) DO UPDATE SET full_name = excluded.full_name, primary_color = excluded.primary_color,
        url = excluded.url, torrent_download_page_url = excluded.torrent_download_page_url,
        description = excluded.description, font_logos_icon = excluded.font_logos_icon,
        position = excluded.position, is_recommended = excluded.is_recommended, removed_rev = NULL
      WHERE (full_name, primary_color, url, torrent_download_page_url, description, font_logos_icon, position,
        is_recommended, removed_rev)
        IS NOT (excluded.full_name, excluded.primary_color, excluded.url, excluded.torrent_download_page_url,
        excluded.description, excluded.font_logos_icon, excluded.position, excluded.is_recommended, NULL)`,
    distroId: 'SELECT id FROM distro WHERE name = ?',
    listedDistros: 'SELECT id FROM distro WHERE position IS NOT NULL ORDER BY id',
    delistDistro: 'UPDATE distro SET position = NULL, is_recommended = 0, removed_rev = ? WHERE id = ?',
    closeDistroListings: `UPDATE listing SET removed_rev = ?
      WHERE removed_rev IS NULL AND image_id IN (SELECT id FROM image WHERE distro_id = ?)`,
    trackers: 'SELECT position, url FROM tracker WHERE distro_id IS ? ORDER BY position',
    deleteTrackers: 'DELETE FROM tracker WHERE distro_id IS ?',
    tracker: 'INSERT INTO tracker (distro_id, position, url) VALUES (?, ?, ?)',
    image: `INSERT INTO image (distro_id, identity, version, arch, desktop_environment, info_hash, magnet_url,
        direct_download_url, download_page_url, ipfs_hash, file_size)
      VALUES (:distro_id, :identity, :version, :arch, :desktop_environment, :info_hash, :magnet_url,
        :direct_download_url, :download_page_url, :ipfs_hash, :file_size)
      ON CONFLICT (distro_id, identity) DO UPDATE SET version = excluded.version, arch = excluded.arch,
        desktop_environment = excluded.desktop_environment, info_hash = excluded.info_hash,
        magnet_url = excluded.magnet_url, direct_download_url = excluded.direct_download_url,
        download_page_url = excluded.download_page_url, ipfs_hash = excluded.ipfs_hash, file_size = excluded.file_size
      WHERE (version, arch, desktop_environment, info_hash, magnet_url, direct_download_url, download_page_url,
        ipfs_hash, file_size)
        IS NOT (excluded.version, excluded.arch, excluded.desktop_environment, excluded.info_hash, excluded.magnet_url,
        excluded.direct_download_url, excluded.download_page_url, excluded.ipfs_hash, excluded.file_size)`,
    imageId: 'SELECT id FROM image WHERE distro_id = ? AND identity = ?',
    listing: `INSERT INTO listing (image_id, added_rev, position, is_recommended)
      VALUES (:image_id, :rev, :position, :is_recommended)
      ON CONFLICT (image_id) WHERE removed_rev IS NULL
      DO UPDATE SET position = excluded.position, is_recommended = excluded.is_recommended
      WHERE (position, is_recommended) IS NOT (excluded.position, excluded.is_recommended)`,
    openListings: `SELECT l.id, l.image_id FROM listing AS l JOIN image AS i ON i.id = l.image_id
      WHERE i.distro_id = ? AND l.removed_rev IS NULL ORDER BY l.id`,
    closeListing: 'UPDATE listing SET removed_rev = ? WHERE id = ?',
  };
  return Object.fromEntries(Object.entries(sql).map(([name, text]) => [name, db.prepare(text)]));
}

/**
 * Applies one catalog on top of the current state. Missing optional parts count as empty.
 * @param {Record<string, import('node:sqlite').StatementSync>} s prepared statements
 * @param {number} rev revision id the changes belong to
 * @param {{distros: {name: string, versions: object[]}[]}} catalog
 */
function apply(s, rev, catalog) {
  for (const [name, description] of entries(catalog.architectures)) {
    if (typeof description === 'string') s.architecture.run(name, description);
  }
  for (const [key, de] of entries(catalog['desktop-environments'])) {
    if (isObject(de)) s.desktopEnvironment.run(key, text(de.name) ?? key, text(de.description), text(de.url));
  }
  setTrackers(s, null, catalog.trackers);

  const recommended = pick(catalog.distros, catalog['recommended-distro-index'])?.name;
  const present = new Map();
  catalog.distros.forEach((entry, position) => {
    if (present.has(entry.name)) return;
    s.distro.run({
      name: entry.name,
      full_name: text(entry['full-name']),
      primary_color: text(entry['primary-color']),
      url: text(entry.url),
      torrent_download_page_url: text(entry['torrent-download-page-url']),
      description: text(entry.description),
      font_logos_icon: text(entry['font-logos-icon']),
      position,
      is_recommended: entry.name === recommended ? 1 : 0,
      rev,
    });
    const { id } = s.distroId.get(entry.name);
    present.set(entry.name, id);
    setTrackers(s, id, entry.trackers);
    applyVersions(s, rev, id, entry);
  });

  const presentIds = new Set(present.values());
  for (const { id } of s.listedDistros.all()) {
    if (presentIds.has(id)) continue;
    s.delistDistro.run(rev, id);
    s.closeDistroListings.run(rev, id);
  }
}

/**
 * Upserts a distro's images and opens, refreshes, or closes their listings.
 * @param {Record<string, import('node:sqlite').StatementSync>} s prepared statements
 * @param {number} rev revision id the changes belong to
 * @param {number} distroId
 * @param {{versions: object[], 'recommended-version-index'?: number}} entry
 */
function applyVersions(s, rev, distroId, entry) {
  const images = entry.versions.map(toImage);
  const recommended = pick(images, entry['recommended-version-index'])?.identity;
  const kept = new Set();
  const listed = new Set();
  images.forEach((image, position) => {
    // A repeated identity is dropped so the first occurrence keeps its attributes and position.
    if (kept.has(image.identity)) return;
    kept.add(image.identity);
    s.image.run({ distro_id: distroId, ...image });
    const { id } = s.imageId.get(distroId, image.identity);
    listed.add(id);
    s.listing.run({ image_id: id, rev, position, is_recommended: image.identity === recommended ? 1 : 0 });
  });
  for (const { id, image_id } of s.openListings.all(distroId)) {
    if (!listed.has(image_id)) s.closeListing.run(rev, id);
  }
}

/**
 * Replaces the tracker list of one distro, or the global list when distroId is null, if it differs.
 * @param {Record<string, import('node:sqlite').StatementSync>} s prepared statements
 * @param {number|null} distroId
 * @param {unknown} trackers the catalog's array, treated as empty when missing
 */
function setTrackers(s, distroId, trackers) {
  const wanted = (Array.isArray(trackers) ? trackers : [])
    .map((url, position) => ({ position, url }))
    .filter(tracker => typeof tracker.url === 'string');
  const current = s.trackers.all(distroId).map(tracker => ({ position: tracker.position, url: tracker.url }));
  if (isDeepStrictEqual(current, wanted)) return;
  s.deleteTrackers.run(distroId);
  for (const { position, url } of wanted) s.tracker.run(distroId, position, url);
}

/**
 * Maps one versions entry to image columns, including its identity.
 * @param {object} version
 * @returns {object} named parameters for the image upsert, without distro_id
 */
function toImage(version) {
  const image = {
    version: text(version.version),
    arch: text(version.arch),
    desktop_environment: text(version['desktop-environment']),
    info_hash: infoHash(version['magnet-url']),
    magnet_url: text(version['magnet-url']),
    direct_download_url: text(version['direct-download-url'] ?? version.url),
    download_page_url: text(version['download-page-url'] ?? version['torrent-download-page-url']),
    ipfs_hash: text(version['ipfs-hash']),
    file_size: fileSize(version['file-size']),
  };
  const identity = image.info_hash ? `btih:${image.info_hash}`
    : image.direct_download_url ? `url:${image.direct_download_url}`
    : `label:${image.version ?? ''}|${image.arch ?? ''}|${image.desktop_environment ?? ''}`;
  return { identity, ...image };
}

/**
 * Maps an image row back to a versions entry.
 * @param {object} row image columns
 * @returns {object} the six current keys, plus legacy keys only when set so a read-then-write keeps them
 */
function toVersion(row) {
  const version = {
    arch: row.arch,
    version: row.version,
    'desktop-environment': row.desktop_environment,
    'magnet-url': row.magnet_url,
    'direct-download-url': row.direct_download_url,
    'file-size': row.file_size,
  };
  if (row.download_page_url !== null) version['download-page-url'] = row.download_page_url;
  if (row.ipfs_hash !== null) version['ipfs-hash'] = row.ipfs_hash;
  return version;
}

/**
 * Extracts the BitTorrent v1 info hash from a magnet link.
 * @param {unknown} magnet
 * @returns {string|null} 40 lowercase hex characters, or null without a well-formed btih
 */
function infoHash(magnet) {
  const hash = typeof magnet === 'string' ? /[?&]xt=urn:btih:([^&]*)/i.exec(magnet)?.[1] : undefined;
  if (/^[0-9a-f]{40}$/i.test(hash)) return hash.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(hash)) return null;
  const bits = [...hash.toUpperCase()].map(char => base32.indexOf(char).toString(2).padStart(5, '0')).join('');
  return bits.match(/.{4}/g).map(nibble => parseInt(nibble, 2).toString(16)).join('');
}

/**
 * Coerces a file-size value to whole bytes.
 * @param {unknown} value
 * @returns {number|null} an integer, or null for anything that is not an integer or a string of digits
 */
function fileSize(value) {
  const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * Coerces a scalar to text.
 * @param {unknown} value
 * @returns {string|null} strings unchanged, finite numbers stringified, anything else null
 */
function text(value) {
  if (typeof value === 'string') return value;
  return Number.isFinite(value) ? String(value) : null;
}

/**
 * Indexes an array only with an integer, so -1 and non-numbers select nothing.
 * @param {Array} array
 * @param {unknown} index
 * @returns {*} the element, or undefined
 */
function pick(array, index) {
  return Number.isInteger(index) ? array[index] : undefined;
}

/**
 * Lists an object's entries, or none for anything that is not a plain object.
 * @param {unknown} value
 * @returns {[string, unknown][]}
 */
function entries(value) {
  return isObject(value) ? Object.entries(value) : [];
}

/**
 * @param {unknown} value
 * @returns {boolean} whether value is a non-array object
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean} whether value is a JSON string, number, boolean, or null
 */
function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * @param {unknown} value
 * @returns {boolean} whether value is an array of strings
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * Identifies the newest revision, so an import can tell whether the database moved on since the export.
 * @returns {{revision: number, 'recorded-at': number}|null}
 */
function newestRevision() {
  const db = openForReading();
  try {
    const row = db.prepare('SELECT id, recorded_at FROM revision ORDER BY id DESC LIMIT 1').get();
    return row ? { revision: row.id, 'recorded-at': row.recorded_at } : null;
  } finally {
    db.close();
  }
}

/**
 * Lists each current distro's recommended image.
 * @returns {Map<string, {identity: string|null, label: string}>} keyed by distro name
 */
function recommendedImages() {
  const db = openForReading();
  try {
    const rows = db.prepare(`SELECT d.name, i.identity, i.version, i.arch, i.desktop_environment FROM current_distro AS d
      LEFT JOIN current_image AS c ON c.distro_id = d.id AND c.is_recommended = 1 LEFT JOIN image AS i ON i.id = c.id`).all();
    return new Map(rows.map(row => [row.name, {
      identity: row.identity,
      label: row.identity ? `${row.version} ${row.arch} ${row.desktop_environment}` : 'nothing',
    }]));
  } finally {
    db.close();
  }
}

/**
 * Runs the export and import commands used for hand edits.
 * The exported file wraps the catalog with the revision it came from, and import refuses a file from any other revision.
 * @param {string[]} args command, file, and for import the subject
 */
function runCli([command, file, subject]) {
  if (command === 'export' && file) {
    const exported = { 'based-on': newestRevision(), catalog: readCatalog() };
    writeFileSync(file, `${JSON.stringify(exported, null, 2)}\n`);
    console.log(`Exported revision ${exported['based-on']?.revision} to ${file}`);
  } else if (command === 'import' && file && subject) {
    const exported = JSON.parse(readFileSync(file, 'utf8'));
    if (!isObject(exported) || !('based-on' in exported) || !('catalog' in exported)) {
      throw new Error(`${file} was not written by "catalog.js export". Export again and redo the edit.`);
    }
    const newest = newestRevision();
    if (!isDeepStrictEqual(exported['based-on'], newest)) {
      throw new Error(`${file} was exported at revision ${exported['based-on']?.revision}, but the database is now at ` +
        `revision ${newest?.revision}. Importing it would undo the newer changes. Export again and redo the edit.`);
    }
    const before = recommendedImages();
    const changed = writeCatalog(exported.catalog, subject);
    console.log(changed ? `Recorded "${subject}" as revision ${newestRevision().revision}` : 'No changes');
    for (const [name, now] of recommendedImages()) {
      const was = before.get(name);
      if (was && was.identity !== now.identity) {
        console.warn(`Warning: the recommended ${name} image changed from ${was.label} to ${now.label}`);
      }
    }
  } else {
    console.error('Usage: node .github/catalog.js export <file>\n       node .github/catalog.js import <file> <subject>');
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
