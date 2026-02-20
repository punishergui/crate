const { findArtistByName, fetchArtistAlbums } = require('./musicbrainz');
const { normalizeTitle, isStrongTitleAliasMatch } = require('./normalize');

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

  function getArtistSettings(artistId) {
    const row = db.prepare(`
      SELECT includeLive, includeCompilations
      FROM expected_artist_settings
      WHERE artistId = ?
    `).get(artistId);

    return {
      includeLive: Boolean(row?.includeLive),
      includeCompilations: Boolean(row?.includeCompilations)
    };
  }

  function shouldIncludeAlbum(expectedAlbum, settings) {
    const primaryType = String(expectedAlbum.primaryType || expectedAlbum.type || '').toLowerCase();
    const secondaryTypes = Array.isArray(expectedAlbum.secondaryTypes)
      ? expectedAlbum.secondaryTypes.map((entry) => String(entry || '').toLowerCase())
      : [];

    if (!settings.includeCompilations && primaryType === 'compilation') {
      return false;
    }
    if (!settings.includeLive && secondaryTypes.includes('live')) {
      return false;
    }
    return true;
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
        INSERT INTO expected_albums (expectedArtistId, mb_release_group_id, title, year, type, primaryType, secondaryTypesJson, normalizedTitle, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(expectedArtistId, mb_release_group_id)
        DO UPDATE SET title = excluded.title,
                      year = excluded.year,
                      type = excluded.type,
                      primaryType = excluded.primaryType,
                      secondaryTypesJson = excluded.secondaryTypesJson,
                      normalizedTitle = excluded.normalizedTitle,
                      updatedAt = excluded.updatedAt
      `);
      const insertWithoutReleaseGroup = db.prepare(`
        INSERT INTO expected_albums (expectedArtistId, mb_release_group_id, title, year, type, primaryType, secondaryTypesJson, normalizedTitle, updatedAt)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        for (const album of albums) {
          const normalized = normalizeTitle(album.title);
          const primaryType = album.primaryType || album.type || 'Album';
          const secondaryTypesJson = JSON.stringify(Array.isArray(album.secondaryTypes) ? album.secondaryTypes : []);
          if (album.mbReleaseGroupId) {
            upsertWithReleaseGroup.run(expectedArtist.id, album.mbReleaseGroupId, album.title, album.year, album.type, primaryType, secondaryTypesJson, normalized, now);
          } else {
            insertWithoutReleaseGroup.run(expectedArtist.id, album.title, album.year, album.type, primaryType, secondaryTypesJson, normalized, now);
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

    const settings = getArtistSettings(artistId);
    const ignoredIds = new Set(
      db.prepare('SELECT expectedAlbumId FROM expected_ignored WHERE artistId = ?').all(artistId).map((row) => row.expectedAlbumId)
    );

    const expectedAlbumsRaw = db.prepare(`
      SELECT ea.id, ea.title, ea.year, ea.type, ea.primaryType, ea.secondaryTypesJson, ea.normalizedTitle
      FROM expected_albums ea
      JOIN expected_artists er ON er.id = ea.expectedArtistId
      WHERE er.artistId = ?
      ORDER BY ea.year ASC, ea.title ASC
    `).all(artistId);

    const expectedAlbums = expectedAlbumsRaw.map((album) => ({
      ...album,
      secondaryTypes: JSON.parse(album.secondaryTypesJson || '[]')
    }));

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

    const ownedAlbumsWithNormalized = ownedAlbums.map((album) => ({
      ...album,
      normalizedTitle: normalizeTitle(album.title)
    }));

    const ownedByNormalized = new Map();
    for (const album of ownedAlbumsWithNormalized) {
      const normalized = album.normalizedTitle;
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
      const hasStrongAliasMatch = ownedAlbumsWithNormalized.some((ownedAlbum) => {
        return isStrongTitleAliasMatch(ownedAlbum.normalizedTitle, expected.normalizedTitle);
      });
      const hasMatch = Boolean(overrideOwnedId) || normalizedMatches.length > 0 || hasStrongAliasMatch;
      if (hasMatch) {
        matchedCount += 1;
      } else if (!ignoredIds.has(expected.id) && shouldIncludeAlbum(expected, settings)) {
        missingAlbums.push({
          id: expected.id,
          title: expected.title,
          year: expected.year,
          type: expected.type,
          primaryType: expected.primaryType,
          secondaryTypes: expected.secondaryTypes,
          normalizedTitle: expected.normalizedTitle
        });
      }
    }

    const expectedCount = expectedAlbums.length;
    const missingCount = missingAlbums.length;
    const ignoredCount = ignoredIds.size;
    const completionPct = expectedCount === 0 ? null : Math.round((matchedCount / expectedCount) * 100);

    const matchedOwnedAlbums = ownedAlbumsWithNormalized.filter((ownedAlbum) => {
      const normalizedOwnedTitle = ownedAlbum.normalizedTitle;
      const hasStrongAliasMatch = expectedAlbums.some((expectedAlbum) => {
        return isStrongTitleAliasMatch(normalizedOwnedTitle, expectedAlbum.normalizedTitle);
      });
      return overrideOwnedIds.has(ownedAlbum.id) || expectedNormalizedTitles.has(normalizedOwnedTitle) || hasStrongAliasMatch;
    });
    const unmatchedOwnedAlbums = ownedAlbumsWithNormalized.filter((ownedAlbum) => {
      const normalizedOwnedTitle = ownedAlbum.normalizedTitle;
      const hasStrongAliasMatch = expectedAlbums.some((expectedAlbum) => {
        return isStrongTitleAliasMatch(normalizedOwnedTitle, expectedAlbum.normalizedTitle);
      });
      return !overrideOwnedIds.has(ownedAlbum.id)
        && !expectedNormalizedTitles.has(normalizedOwnedTitle)
        && !hasStrongAliasMatch;
    });

    return {
      artist,
      settings,
      ownedCount: ownedAlbums.length,
      expectedCount,
      missingCount,
      ignoredCount,
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

  function ignoreExpectedAlbum(artistId, expectedAlbumId) {
    const artist = db.prepare('SELECT id FROM artists WHERE id = ? AND deleted = 0').get(artistId);
    if (!artist) {
      const error = new Error('Artist not found');
      error.statusCode = 404;
      throw error;
    }

    const album = db.prepare(`
      SELECT ea.id
      FROM expected_albums ea
      JOIN expected_artists er ON er.id = ea.expectedArtistId
      WHERE er.artistId = ? AND ea.id = ?
    `).get(artistId, expectedAlbumId);

    if (!album) {
      const error = new Error('Expected album not found');
      error.statusCode = 404;
      throw error;
    }

    db.prepare(`
      INSERT INTO expected_ignored (artistId, expectedAlbumId, createdAt)
      VALUES (?, ?, ?)
      ON CONFLICT(artistId, expectedAlbumId) DO NOTHING
    `).run(artistId, expectedAlbumId, new Date().toISOString());

    return { ok: true };
  }

  function updateArtistSettings(artistId, payload) {
    const artist = db.prepare('SELECT id FROM artists WHERE id = ? AND deleted = 0').get(artistId);
    if (!artist) {
      const error = new Error('Artist not found');
      error.statusCode = 404;
      throw error;
    }

    const includeLive = typeof payload?.includeLive === 'boolean' ? payload.includeLive : false;
    const includeCompilations = typeof payload?.includeCompilations === 'boolean' ? payload.includeCompilations : false;

    db.prepare(`
      INSERT INTO expected_artist_settings (artistId, includeLive, includeCompilations, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(artistId) DO UPDATE SET
        includeLive = excluded.includeLive,
        includeCompilations = excluded.includeCompilations,
        updatedAt = excluded.updatedAt
    `).run(artistId, includeLive ? 1 : 0, includeCompilations ? 1 : 0, new Date().toISOString());

    return getArtistSettings(artistId);
  }

  return { syncExpectedForArtist, computeSummary, getMissingAlbums, ignoreExpectedAlbum, getArtistSettings, updateArtistSettings };
}

module.exports = { createDiscographyService };
