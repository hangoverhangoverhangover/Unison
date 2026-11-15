/**
 * Ordered migrations. Index + 1 is the schema version stored in PRAGMA user_version.
 * Never edit a shipped migration; append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1: initial schema */ `
  CREATE TABLE tracks (
    id            TEXT PRIMARY KEY,               -- provider:nativeId
    provider      TEXT NOT NULL CHECK (provider IN ('spotify', 'soundcloud', 'local')),
    native_id     TEXT NOT NULL,
    title         TEXT NOT NULL,
    artists       TEXT NOT NULL DEFAULT '[]',     -- JSON array of names
    album         TEXT,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    artwork_url   TEXT,
    isrc          TEXT,
    local_path    TEXT,
    source_sc_id  TEXT,                           -- downloads: original SoundCloud track id
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (provider, native_id)
  );
  CREATE INDEX tracks_isrc ON tracks (isrc) WHERE isrc IS NOT NULL;
  CREATE UNIQUE INDEX tracks_local_path ON tracks (local_path) WHERE local_path IS NOT NULL;
  CREATE INDEX tracks_source_sc_id ON tracks (source_sc_id) WHERE source_sc_id IS NOT NULL;

  -- Mirror of likes on the real services. No local-only likes (see Decision Log).
  CREATE TABLE likes (
    track_id   TEXT PRIMARY KEY REFERENCES tracks (id) ON DELETE CASCADE,
    provider   TEXT NOT NULL CHECK (provider IN ('spotify', 'soundcloud')),
    liked_at   TEXT NOT NULL,                     -- ISO 8601 from the service
    synced_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX likes_liked_at ON likes (liked_at DESC);

  CREATE TABLE playlists (
    id           TEXT PRIMARY KEY,                -- source:nativeId
    source       TEXT NOT NULL CHECK (source IN ('spotify', 'soundcloud', 'app')),
    native_id    TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    artwork_url  TEXT,
    owner_name   TEXT,
    track_count  INTEGER,
    can_edit     INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source, native_id)
  );

  CREATE TABLE playlist_items (
    playlist_id  TEXT NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    track_id     TEXT NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
    added_at     TEXT,
    PRIMARY KEY (playlist_id, position)
  );
  CREATE INDEX playlist_items_track ON playlist_items (track_id);

  CREATE TABLE downloads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sc_track_id  TEXT NOT NULL,                   -- SoundCloud native id being downloaded
    track_id     TEXT REFERENCES tracks (id) ON DELETE SET NULL,  -- resulting local track
    method       TEXT CHECK (method IN ('official', 'ytdlp')),
    status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'done', 'failed')),
    progress     REAL NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
    file_path    TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at  TEXT
  );
  CREATE INDEX downloads_status ON downloads (status);

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL                          -- JSON
  );
  `,
  /* 2: local library scan state */ `
  ALTER TABLE tracks ADD COLUMN track_no INTEGER;
  ALTER TABLE tracks ADD COLUMN disc_no INTEGER;
  ALTER TABLE tracks ADD COLUMN file_mtime_ms INTEGER;
  ALTER TABLE tracks ADD COLUMN file_size INTEGER;
  ALTER TABLE tracks ADD COLUMN art_hash TEXT;
  `,
  /* 3: unified library (Phase 4) */ `
  ALTER TABLE tracks ADD COLUMN availability TEXT
    CHECK (availability IS NULL OR availability IN ('full', 'preview', 'blocked', 'drm'));
  ALTER TABLE playlists ADD COLUMN created_at TEXT;
  CREATE INDEX likes_provider ON likes (provider);
  `,
  /* 4: Discord cover art lookups for local files */ `
  CREATE TABLE cover_art_cache (
    key         TEXT PRIMARY KEY,                 -- normalized "artist|title"
    url         TEXT,                             -- NULL = nothing found
    checked_at  INTEGER NOT NULL                  -- epoch ms
  );
  `,
  /* 5: retry cover art misses now that Spotify/SoundCloud search is a fallback */ `
  DELETE FROM cover_art_cache WHERE url IS NULL;
  `,
  /* 6: downloader lookups by SoundCloud track (Phase 7) */ `
  CREATE INDEX downloads_sc_track ON downloads (sc_track_id);
  `,
  /* 7: artist and album links (Phase 7b) */ `
  ALTER TABLE tracks ADD COLUMN url TEXT;
  ALTER TABLE tracks ADD COLUMN artist_refs TEXT;   -- JSON EntityRef[]
  ALTER TABLE tracks ADD COLUMN album_ref TEXT;     -- JSON EntityRef
  `,
  /* 8: user-chosen covers for app playlists (QoL round) */ `
  -- 1 = artwork_url was picked by the user; automatic covers never replace it.
  ALTER TABLE playlists ADD COLUMN custom_artwork INTEGER NOT NULL DEFAULT 0
    CHECK (custom_artwork IN (0, 1));
  `,
  /* 9: play history (QoL round 2) */ `
  CREATE TABLE plays (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id    TEXT NOT NULL,                    -- app track id (provider:nativeId)
    provider    TEXT NOT NULL CHECK (provider IN ('spotify', 'soundcloud', 'local')),
    played_at   TEXT NOT NULL,                    -- ISO 8601 start time
    played_ms   INTEGER NOT NULL CHECK (played_ms >= 0)
  );
  CREATE INDEX plays_played_at ON plays (played_at DESC);
  CREATE INDEX plays_track ON plays (track_id);
  `
]
