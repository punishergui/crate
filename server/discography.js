const { findArtistByName, fetchArtistAlbums } = require('./musicbrainz');
const { normalizeTitle } = require('./normalize');

const MUSICBRAINZ_SYNC_TIMEOUT_MS = 15000;

function withTimeout(promise, label, timeoutMs = MUSICBRAINZ_SYNC_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.statusCode = 504;
      setTimeout(() => reject(error), timeoutMs);
    })
  ]);
}

function createDiscographyService(db) {
  function getExpectedArtist(artistId) {
    return db.prepare('SELECT id, artistId, mbid, name, updatedAt FROM expected_artists WHERE artistId = ?').get(artistId);
  }

  function syncExpectedForArtist(artistId) {
    const artist = db.prepare('SELECT id, name FROM artists WHERE id = ? AND deleted = 0').get(artistId);
    if (!artist) {
      const error = new Error('Artist not found');
      error.statusCode = 404;
      throw error;
    }

    const now = Date.now();
    let expectedArtist = getExpectedArtist(artistId);
    let mbid = expectedArtist?.mbid || null;
    let mbName = expectedArtist?.name || artist.name;

    return (async () => {
      if (!mbid) {
        let found;
        try {
          found = await withTimeout(findArtistByName(artist.name), 'MusicBrainz artist lookup');
        } catch (error) {
          const wrapped = new Error(`MusicBrainz artist lookup failed for "${artist.name}": ${error.message}`);
          wrapped.statusCode = error.statusCode || 502;
          wrapped.details = error.details || null;
          throw wrapped;
        }
        if (!found || !found.mbid) {
          const error = new Error(`No MusicBrainz artist found for "${artist.name}"`);
          error.statusCode = 404;
          throw error;
        }
        mbid = found.mbid;
        mbName = found.name || artist.name;
      }

      if (expectedArtist) {
        db.prepare('UPDATE expected_artists SET mbid = ?, name = ?, updatedAt = ? WHERE id = ?')
          .run(mbid, mbName, now, expectedArtist.id);
      } else {
        const inserted = db.prepare('INSERT INTO expected_artists (artistId, mbid, name, updatedAt) VALUES (?, ?, ?, ?)')
          .run(artistId, mbid, mbName, now);
        expectedArtist = { id: Number(inserted.lastInsertRowid), artistId, mbid, name: mbName, updatedAt: now };
      }

      let albums;
      try {
        albums = await withTimeout(fetchArtistAlbums(mbid), 'MusicBrainz release-group lookup');
      } catch (error) {
        const wrapped = new Error(`MusicBrainz release-group lookup failed for MBID ${mbid}: ${error.message}`);
        wrapped.statusCode = error.statusCode || 502;
        wrapped.details = error.details || null;
        throw wrapped;
      }
      const upsertWithReleaseGroup = db.prepare(`
        INSERT INTO expected_albums (expectedArtistId, mb_release_group_id, title, year, type, normalizedTitle, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(expectedArtistId, mb_release_group_id)
        DO UPDATE SET title = excluded.title,
                      year = excluded.year,
                      type = excluded.type,
                      normalizedTitle = excluded.normalizedTitle,
                      updatedAt = excluded.updatedAt
      `);
      const insertWithoutReleaseGroup = db.prepare(`
        INSERT INTO expected_albums (expectedArtistId, mb_release_group_id, title, year, type, normalizedTitle, updatedAt)
        VALUES (?, NULL, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        for (const album of albums) {
          const normalized = normalizeTitle(album.title);
          if (album.mbReleaseGroupId) {
            upsertWithReleaseGroup.run(expectedArtist.id, album.mbReleaseGroupId, album.title, album.year, album.type, normalized, now);
          } else {
            insertWithoutReleaseGroup.run(expectedArtist.id, album.title, album.year, album.type, normalized, now);
          }
        }
        db.prepare('DELETE FROM expected_albums WHERE expectedArtistId = ? AND updatedAt < ?').run(expectedArtist.id, now);
      });
      tx();

      return computeSummary(artistId);
    })();
  }

  function computeSummary(artistId) {
    const artist = db.prepare('SELECT id, name FROM artists WHERE id = ? AND deleted = 0').get(artistId);
    if (!artist) {
      const error = new Error('Artist not found');
      error.statusCode = 404;
      throw error;
    }

    const expectedAlbums = db.prepare(`
      SELECT ea.id, ea.title, ea.year, ea.type, ea.normalizedTitle
      FROM expected_albums ea
      JOIN expected_artists er ON er.id = ea.expectedArtistId
      WHERE er.artistId = ?
      ORDER BY ea.year ASC, ea.title ASC
    `).all(artistId);

    const ownedAlbums = db.prepare(`
      SELECT id, title
      FROM albums
      WHERE artistId = ? AND deleted = 0 AND owned = 1
    `).all(artistId);

    const overrides = db.prepare(`
      SELECT expectedAlbumId, ownedAlbumId
      FROM album_match_overrides
      WHERE expectedAlbumId IN (
        SELECT ea.id
        FROM expected_albums ea
        JOIN expected_artists er ON er.id = ea.expectedArtistId
        WHERE er.artistId = ?
      )
    `).all(artistId);

    const ownedByNormalized = new Map();
    for (const album of ownedAlbums) {
      const normalized = normalizeTitle(album.title);
      if (!ownedByNormalized.has(normalized)) {
        ownedByNormalized.set(normalized, []);
      }
      ownedByNormalized.get(normalized).push(album);
    }

    const overrideMap = new Map(overrides.map((row) => [row.expectedAlbumId, row.ownedAlbumId]));
    const expectedNormalizedTitles = new Set(expectedAlbums.map((album) => album.normalizedTitle));
    const overrideOwnedIds = new Set(
      overrides
        .map((row) => row.ownedAlbumId)
        .filter((ownedAlbumId) => Number.isInteger(ownedAlbumId) && ownedAlbumId > 0)
    );

    let matchedCount = 0;
    const missingAlbums = [];
    for (const expected of expectedAlbums) {
      const overrideOwnedId = overrideMap.get(expected.id);
      const normalizedMatches = ownedByNormalized.get(expected.normalizedTitle) || [];
      const hasMatch = Boolean(overrideOwnedId) || normalizedMatches.length > 0;
      if (hasMatch) {
        matchedCount += 1;
      } else {
        missingAlbums.push(expected);
      }
    }

    const expectedCount = expectedAlbums.length;
    const missingCount = missingAlbums.length;
    const completionPct = expectedCount === 0 ? null : Math.round((matchedCount / expectedCount) * 100);

    const matchedOwnedAlbums = ownedAlbums.filter((ownedAlbum) => {
      const normalizedOwnedTitle = normalizeTitle(ownedAlbum.title);
      return overrideOwnedIds.has(ownedAlbum.id) || expectedNormalizedTitles.has(normalizedOwnedTitle);
    });
    const unmatchedOwnedAlbums = ownedAlbums.filter((ownedAlbum) => {
      const normalizedOwnedTitle = normalizeTitle(ownedAlbum.title);
      return !overrideOwnedIds.has(ownedAlbum.id) && !expectedNormalizedTitles.has(normalizedOwnedTitle);
    });

    return {
      artist,
      ownedCount: ownedAlbums.length,
      expectedCount,
      missingCount,
      completionPct,
      missingAlbums,
      matchedOwnedCount: matchedOwnedAlbums.length,
      matchedOwnedAlbums,
      unmatchedOwnedAlbums
    };
  }

  function getMissingAlbums(artistId) {
    return computeSummary(artistId).missingAlbums;
  }

  return { syncExpectedForArtist, computeSummary, getMissingAlbums };
}

module.exports = { createDiscographyService };
