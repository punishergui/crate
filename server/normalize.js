const SUFFIX_PATTERNS = [
  /\bdeluxe\b/g,
  /\bremaster(?:ed)?\b/g,
  /\banniversary\b/g,
  /\bexpanded\b/g,
  /\bspecial edition\b/g,
  /\bbonus tracks?\b/g,
  /\bedition\b/g
];

function normalizeTitle(input) {
  let value = String(input || '').toLowerCase();
  value = value.replace(/[.,:;'"()\[\]{}!?/_-]/g, ' ');
  for (const pattern of SUFFIX_PATTERNS) {
    value = value.replace(pattern, ' ');
  }
  value = value.replace(/\s+/g, ' ').trim();
  return value;
}

module.exports = { normalizeTitle };
