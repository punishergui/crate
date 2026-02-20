const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTitle, stripTrailingYearSuffix } = require('../server/normalize');
const { deriveAlbumTitleFromFolderName } = require('../server/scanner');

test('normalizeTitle strips trailing wrapped and dash year suffixes', () => {
  assert.equal(normalizeTitle('Waiting (1998)'), normalizeTitle('Waiting'));
  assert.equal(normalizeTitle('Waiting [1998]'), normalizeTitle('Waiting'));
  assert.equal(normalizeTitle('Waiting - 1998'), normalizeTitle('Waiting'));
  assert.equal(normalizeTitle('Waiting 1998'), normalizeTitle('Waiting'));
});

test('normalizeTitle keeps legitimate numeric titles and names', () => {
  assert.equal(normalizeTitle('1984'), '1984');
  assert.equal(normalizeTitle('Blink-182'), 'blink 182');
  assert.equal(normalizeTitle('The 1975'), 'the 1975');
  assert.equal(normalizeTitle('Live 1998'), 'live 1998');
});

test('stripTrailingYearSuffix is conservative', () => {
  assert.equal(stripTrailingYearSuffix('Waiting (1998)'), 'Waiting');
  assert.equal(stripTrailingYearSuffix('Waiting [1998]'), 'Waiting');
  assert.equal(stripTrailingYearSuffix('Waiting - 1998'), 'Waiting');
  assert.equal(stripTrailingYearSuffix('Waiting 1998'), 'Waiting');
  assert.equal(stripTrailingYearSuffix('1984'), '1984');
  assert.equal(stripTrailingYearSuffix('Live 1998'), 'Live 1998');
});

test('deriveAlbumTitleFromFolderName strips/derives common year wrappers', () => {
  assert.equal(deriveAlbumTitleFromFolderName('Waiting (1998)'), 'Waiting');
  assert.equal(deriveAlbumTitleFromFolderName('The Album [2002]'), 'The Album');
  assert.equal(deriveAlbumTitleFromFolderName('2002 - The Album'), 'The Album');
  assert.equal(deriveAlbumTitleFromFolderName('The 1975'), 'The 1975');
});
