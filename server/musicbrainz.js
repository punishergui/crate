const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');

const BASE_URL = 'https://musicbrainz.org/ws/2';
const MIN_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;
const MAX_ERROR_BODY_LENGTH = 500;

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const USER_AGENT = `crate/${pkg.version} (selfhosted)`;

dns.setDefaultResultOrder('ipv4first');

let queue = Promise.resolve();
let lastRequestAt = 0;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHttpError(message, statusCode, details = {}) {
  const error = new Error(message);
  if (statusCode) {
    error.statusCode = statusCode;
  }
  error.details = details;
  return error;
}

async function scheduleRequest(url) {
  queue = queue.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestAt));
    if (waitMs > 0) {
      await wait(waitMs);
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const attemptText = `${attempt + 1}/${MAX_RETRIES + 1}`;

      try {
        lastRequestAt = Date.now();
        console.info(`[musicbrainz] request ${attemptText}: ${url}`);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT
          }
        });
        console.info(`[musicbrainz] response ${response.status} ${response.statusText}: ${url}`);

        if (!response.ok) {
          const body = (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH);
          console.error(`[musicbrainz] non-2xx response body (first ${MAX_ERROR_BODY_LENGTH} chars): ${body}`);

          if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
            const retryAfterHeader = Number(response.headers.get('retry-after'));
            const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
              ? retryAfterHeader * 1000
              : 500 * (2 ** attempt);
            await wait(retryAfterMs);
            continue;
          }

          throw createHttpError(
            `MusicBrainz request failed (${response.status}) for ${url}`,
            response.status,
            { url, responseBody: body }
          );
        }

        return await response.json();
      } catch (error) {
        const isAbort = error?.name === 'AbortError';
        const message = isAbort
          ? `MusicBrainz request timed out after ${REQUEST_TIMEOUT_MS}ms for ${url}`
          : `MusicBrainz request error for ${url}: ${error.message}`;

        if (attempt < MAX_RETRIES && (error.statusCode === 429 || error.statusCode === 503)) {
          await wait(500 * (2 ** attempt));
          continue;
        }

        if (attempt < MAX_RETRIES && !isAbort && /fetch failed/i.test(String(error.message || ''))) {
          await wait(500 * (2 ** attempt));
          continue;
        }

        if (error.statusCode) {
          throw error;
        }

        throw createHttpError(message, isAbort ? 504 : 502, { url, cause: error.message });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw createHttpError(`MusicBrainz request exhausted retries for ${url}`, 502, { url });
  });

  return queue;
}

function isTrackedReleaseGroup(releaseGroup) {
  const primaryType = String(releaseGroup['primary-type'] || '').toLowerCase();
  return primaryType === 'album' || primaryType === 'compilation';
}

async function findArtistByName(name) {
  const query = encodeURIComponent(`artist:"${name}"`);
  const url = `${BASE_URL}/artist?query=${query}&limit=5&fmt=json`;
  const payload = await scheduleRequest(url);
  const artists = Array.isArray(payload.artists) ? payload.artists : [];
  if (!artists.length) return null;

  const normalizedTarget = String(name || '').toLowerCase().trim();
  const ranked = artists
    .map((artist, index) => {
      const normalizedName = String(artist.name || '').toLowerCase().trim();
      const score = Number(artist.score || 0) + (normalizedName === normalizedTarget ? 20 : 0) - index;
      return { ...artist, _score: score };
    })
    .sort((a, b) => b._score - a._score);

  const best = ranked[0];
  return best ? { mbid: best.id, name: best.name, score: best._score } : null;
}

async function fetchArtistAlbums(mbid) {
  const releaseGroups = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${BASE_URL}/release-group?artist=${encodeURIComponent(mbid)}&limit=${limit}&offset=${offset}&fmt=json`;
    const payload = await scheduleRequest(url);
    const page = Array.isArray(payload['release-groups']) ? payload['release-groups'] : [];

    for (const item of page) {
      if (!isTrackedReleaseGroup(item)) continue;
      const firstDate = String(item['first-release-date'] || '');
      const year = /^\d{4}/.test(firstDate) ? Number(firstDate.slice(0, 4)) : null;
      const primaryType = item['primary-type'] || 'Album';
      const secondaryTypes = Array.isArray(item['secondary-types']) ? item['secondary-types'].filter((value) => typeof value === 'string') : [];
      releaseGroups.push({
        mbReleaseGroupId: item.id,
        title: item.title,
        year,
        type: primaryType,
        primaryType,
        secondaryTypes
      });
    }

    offset += page.length;
    if (!page.length || offset >= Number(payload['release-group-count'] || 0)) {
      break;
    }
  }

  return releaseGroups;
}

module.exports = { findArtistByName, fetchArtistAlbums, USER_AGENT };
