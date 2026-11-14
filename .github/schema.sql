-- Linux Exchange catalog: the images the site offers now, and every image it has listed and when.
-- catalog.js applies this file to an empty database. The page reads the current_* views and the architecture, desktop_environment, and tracker tables.

PRAGMA user_version = 1;

-- One row per write that changed the catalog, in order.
CREATE TABLE revision (
  id          INTEGER PRIMARY KEY,
  recorded_at INTEGER NOT NULL,   -- unix seconds
  subject     TEXT    NOT NULL,   -- what made the change, such as "Update Arch"
  commit_sha  TEXT    UNIQUE      -- distros.json commit for imported history, NULL for direct writes
) STRICT;

-- Lookup tables hold the latest known definition and are never pruned, so delisted images still resolve.
CREATE TABLE architecture (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL
) STRICT;

CREATE TABLE desktop_environment (
  key         TEXT PRIMARY KEY,   -- the value stored in image.desktop_environment
  name        TEXT NOT NULL,
  description TEXT,
  url         TEXT
) STRICT;

-- Metadata is the latest known value. position is NULL once a distro leaves the catalog.
CREATE TABLE distro (
  id                        INTEGER PRIMARY KEY,
  name                      TEXT    NOT NULL UNIQUE,
  full_name                 TEXT,
  primary_color             TEXT,
  url                       TEXT,
  torrent_download_page_url TEXT,
  description               TEXT,
  font_logos_icon           TEXT,
  position                  INTEGER,                                   -- index in the current catalog
  is_recommended            INTEGER NOT NULL DEFAULT 0 CHECK (is_recommended IN (0, 1)),
  added_rev                 INTEGER NOT NULL REFERENCES revision (id),  -- first appearance
  removed_rev               INTEGER REFERENCES revision (id)            -- latest removal, NULL while listed
) STRICT;

-- distro_id NULL marks a tracker appended to every download. Rows are the latest known list per distro.
CREATE TABLE tracker (
  distro_id INTEGER REFERENCES distro (id),
  position  INTEGER NOT NULL,
  url       TEXT    NOT NULL
) STRICT;

CREATE INDEX tracker_distro ON tracker (distro_id, position);

-- One row per distinct downloadable image. Attributes are updated in place by the latest write that lists it.
CREATE TABLE image (
  id                  INTEGER PRIMARY KEY,
  distro_id           INTEGER NOT NULL REFERENCES distro (id),
  identity            TEXT    NOT NULL,   -- 'btih:<40 hex>', else 'url:<direct url>', else 'label:<version>|<arch>|<de>'
  version             TEXT,
  arch                TEXT,               -- not constrained to architecture.name
  desktop_environment TEXT,               -- not constrained to desktop_environment.key
  info_hash           TEXT,               -- lowercase hex, NULL when the image has no torrent
  magnet_url          TEXT,               -- verbatim as written
  direct_download_url TEXT,
  download_page_url   TEXT,               -- legacy per-version field
  ipfs_hash           TEXT,               -- legacy per-version field
  file_size           INTEGER,            -- bytes
  UNIQUE (distro_id, identity)
) STRICT;

-- One row per continuous stretch during which an image is listed. removed_rev NULL means listed now.
CREATE TABLE listing (
  id             INTEGER PRIMARY KEY,
  image_id       INTEGER NOT NULL REFERENCES image (id),
  added_rev      INTEGER NOT NULL REFERENCES revision (id),
  removed_rev    INTEGER REFERENCES revision (id),
  position       INTEGER NOT NULL,   -- index in the distro's versions array at the listing's last write
  is_recommended INTEGER NOT NULL DEFAULT 0 CHECK (is_recommended IN (0, 1))
) STRICT;

CREATE UNIQUE INDEX listing_open ON listing (image_id) WHERE removed_rev IS NULL;
CREATE INDEX listing_image ON listing (image_id);

CREATE VIEW current_distro AS
SELECT id, name, full_name, primary_color, url, torrent_download_page_url, description, font_logos_icon,
       position, is_recommended
FROM distro
WHERE position IS NOT NULL;

CREATE VIEW current_image AS
SELECT i.id, i.distro_id, i.version, i.arch, i.desktop_environment, i.info_hash, i.magnet_url,
       i.direct_download_url, i.file_size, l.position, l.is_recommended
FROM listing AS l
JOIN image AS i ON i.id = l.image_id
JOIN distro AS d ON d.id = i.distro_id
WHERE l.removed_rev IS NULL AND d.position IS NOT NULL;

CREATE VIEW listing_history AS
SELECT d.name AS distro, i.id AS image_id, i.version, i.arch, i.desktop_environment, i.info_hash, i.magnet_url,
       i.direct_download_url, i.file_size, a.recorded_at AS listed_at, r.recorded_at AS delisted_at
FROM listing AS l
JOIN image AS i ON i.id = l.image_id
JOIN distro AS d ON d.id = i.distro_id
JOIN revision AS a ON a.id = l.added_rev
LEFT JOIN revision AS r ON r.id = l.removed_rev;
