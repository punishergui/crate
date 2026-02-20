const SUFFIX_PATTERNS = [
  /\bdeluxe\b/g,
  /\bremaster(?:ed)?\b/g,
  /\banniversary\b/g,
  /\bexpanded\b/g,
  /\bspecial edition\b/g,
  /\bbonus tracks?\b/g,
  /\bedition\b/g
];

const CURLY_APOSTROPHES = /[\u2018\u2019\u201B\u2032]/g;
const CURLY_QUOTES = /[\u201C\u201D\u201F\u2033]/g;

function toTokenSet(normalizedTitle) {
  return new Set(String(normalizedTitle || '').split(' ').filter(Boolean));
}

function normalizeTitle(input) {
  let value = String(input || '').normalize('NFKD');
  value = value
    .replace(CURLY_APOSTROPHES, "'")
    .replace(CURLY_QUOTES, '"')
    .toLowerCase();
  value = value.replace(/[+&]/g, ' and ');
  value = value.replace(/\p{M}+/gu, '');
  value = value.replace(/[\p{P}\p{S}]/gu, ' ');
  for (const pattern of SUFFIX_PATTERNS) {
    value = value.replace(pattern, ' ');
  }
  value = value.replace(/\s+/g, ' ').trim();
  return value;
}

function isStrongTitleAliasMatch(normalizedOwnedTitle, normalizedExpectedTitle, minOverlap = 0.75) {
  if (!normalizedOwnedTitle || !normalizedExpectedTitle) return false;
  if (normalizedOwnedTitle === normalizedExpectedTitle) return true;

  const ownedContainsExpected = normalizedOwnedTitle.includes(normalizedExpectedTitle);
  const expectedContainsOwned = normalizedExpectedTitle.includes(normalizedOwnedTitle);
  if (!ownedContainsExpected && !expectedContainsOwned) return false;

  const ownedTokens = toTokenSet(normalizedOwnedTitle);
  const expectedTokens = toTokenSet(normalizedExpectedTitle);
  const smaller = ownedTokens.size <= expectedTokens.size ? ownedTokens : expectedTokens;
  const larger = ownedTokens.size <= expectedTokens.size ? expectedTokens : ownedTokens;

  if (smaller.size < 3) return false;

  let overlapCount = 0;
  for (const token of smaller) {
    if (larger.has(token)) {
      overlapCount += 1;
    }
  }

  return overlapCount / smaller.size >= minOverlap;
}

module.exports = { normalizeTitle, isStrongTitleAliasMatch };
