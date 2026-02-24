const test = require('node:test');
const assert = require('node:assert/strict');
const { rankFolderImages } = require('../server/artwork');

test('rankFolderImages prefers exact cover filename', () => {
  const picked = rankFolderImages([
    { lower: 'zzz.jpg', size: 900 },
    { lower: 'front.png', size: 200 },
    { lower: 'cover.jpg', size: 100 }
  ]);
  assert.equal(picked.lower, 'cover.jpg');
});

test('rankFolderImages prefers cover/front keyword when no exact names', () => {
  const picked = rankFolderImages([
    { lower: 'booklet.png', size: 1500 },
    { lower: 'my-front-alt.jpg', size: 700 }
  ]);
  assert.equal(picked.lower, 'my-front-alt.jpg');
});
