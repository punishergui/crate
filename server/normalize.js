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
const TRAILING_YEAR_PAREN_PATTERN = /\s*\((19\d{2}|20\d{2})\)\s*$/;
const TRAILING_YEAR_BRACKET_PATTERN = /\s*\[(19\d{2}|20\d{2})\]\s*$/;
const TRAILING_YEAR_DASH_PATTERN = /\s+[-–—]\s+(19\d{2}|20\d{2})\s*$/;
const TRAILING_YEAR_TOKEN_PATTERN = /\s+(19\d{2}|20\d{2})\s*$/;
const CONSERVATIVE_BARE_YEAR_EXCLUSIONS = new Set(['live', 'the']);

function toTokenSet(normalizedTitle) {
  return new Set(String(normalizedTitle || '').split(' ').filter(Boolean));
}

function stripTrailingYearSuffix(input) {
  let value = String(input || '').trim();
  if (!value) return value;

  value = value
    .replace(TRAILING_YEAR_PAREN_PATTERN, '')
    .replace(TRAILING_YEAR_BRACKET_PATTERN, '')
    .replace(TRAILING_YEAR_DASH_PATTERN, '')
    .trim();

  const bareYearMatch = value.match(TRAILING_YEAR_TOKEN_PATTERN);
  if (!bareYearMatch) return value;

  const withoutYear = value.replace(TRAILING_YEAR_TOKEN_PATTERN, '').trim();
  if (!withoutYear) return value;

  const normalizedBase = withoutYear
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (CONSERVATIVE_BARE_YEAR_EXCLUSIONS.has(normalizedBase)) {
    return value;
  }

  return withoutYear;
}

function normalizeTitle(input) {
  let value = stripTrailingYearSuffix(input).normalize('NFKD');
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

module.exports = { normalizeTitle, stripTrailingYearSuffix, isStrongTitleAliasMatch };
