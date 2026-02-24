const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('CoverTile styles clamp title/subtitle and keep square sharp art', () => {
  const css = fs.readFileSync('web/src/styles.css', 'utf8');
  assert.match(css, /\.cover-tile-v2__overlay strong[^]*-webkit-line-clamp:\s*2/);
  assert.match(css, /\.cover-tile-v2__overlay span[^]*-webkit-line-clamp:\s*2/);
  assert.match(css, /\.cover-tile-v2 \.artwork[^]*border-radius:\s*0/);
});
