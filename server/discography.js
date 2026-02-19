const { findArtistByName, fetchArtistAlbums } = require('./musicbrainz');
const { normalizeTitle } = require('./normalize');

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
        const found = await findArtistByName(artist.name);
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

      const albums = await fetchArtistAlbums(mbid);
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

    return {
      artist,
      ownedCount: ownedAlbums.length,
      expectedCount,
      missingCount,
      completionPct,
      missingAlbums
    };
  }

  function getMissingAlbums(artistId) {
    return computeSummary(artistId).missingAlbums;
  }

  return { syncExpectedForArtist, computeSummary, getMissingAlbums };
}

module.exports = { createDiscographyService };
