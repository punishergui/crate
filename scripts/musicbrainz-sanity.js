const { findArtistByName, fetchArtistAlbums, USER_AGENT } = require('../server/musicbrainz');

async function run() {
  const artistName = process.argv[2] || 'New Found Glory';
  console.log(`[sanity] using User-Agent: ${USER_AGENT}`);
  console.log(`[sanity] searching artist: ${artistName}`);

  const artist = await findArtistByName(artistName);
  if (!artist?.mbid) {
    console.log('[sanity] no artist match found');
    process.exitCode = 1;
    return;
  }

  console.log(`[sanity] matched MBID: ${artist.mbid} (${artist.name})`);
  const albums = await fetchArtistAlbums(artist.mbid);
  console.log(`[sanity] album release-group count: ${albums.length}`);
}

run().catch((error) => {
  console.error('[sanity] failed:', error.message);
  if (error.details) {
    console.error('[sanity] details:', error.details);
  }
  process.exitCode = 1;
});
