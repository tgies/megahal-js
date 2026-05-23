
/**
 * Perspective-swapping substitution table.
 */
export class SwapTable {
  constructor() {
    /** @type {[string, string][]} Array of [from, to] swap pairs. */
    this.pairs = [];
  }

  /**
   * Apply swap substitutions to a token.
   * Returns all matching "to" values. If no match, returns [token].
   * @param {string} token
   * @returns {string[]}
   */
  apply(token) {
    const upperTok = token.toUpperCase();
    /** @type {string[]} */
    const results = [];

    for (const [from, to] of this.pairs) {
      if (from.toUpperCase() === upperTok) {
        results.push(to.toUpperCase());
      }
    }

    if (results.length === 0) {
      return [upperTok];
    }
    return results;
  }
}

/**
 * Configuration for keyword extraction.
 */
export class KeywordConfig {
  constructor() {
    /** @type {Set<string>} Banned words (uppercase). */
    this.banned = new Set();

    /** @type {Set<string>} Auxiliary words (uppercase). */
    this.auxiliary = new Set();

    /** @type {SwapTable} Perspective-swapping table. */
    this.swap = new SwapTable();
  }
}

/**
 * Checks if a candidate is eligible for keyword selection.
 * @param {string} candidate
 * @param {import('./dict.js').SymbolDict} dict
 * @param {KeywordConfig} config
 * @param {boolean} auxPass
 * @returns {boolean}
 */
function isKeywordEligible(candidate, dict, config, auxPass) {
  if (!candidate || candidate.length === 0) {
    return false;
  }

  const firstChar = candidate[0];
  if (!/^[A-Z0-9]$/.test(firstChar)) {
    return false;
  }

  if (dict.find(candidate) === undefined) {
    return false;
  }

  const upper = candidate.toUpperCase();

  if (auxPass) {
    return config.auxiliary.has(upper);
  } else {
    if (config.banned.has(upper)) {
      return false;
    }
    if (config.auxiliary.has(upper)) {
      return false;
    }
    return true;
  }
}

/**
 * Extract keywords from tokens based on MegaHAL's two-pass algorithm.
 * @param {string[]} tokens
 * @param {import('./dict.js').SymbolDict} dict
 * @param {KeywordConfig} config
 * @returns {Set<string>}
 */
export function extractKeywords(tokens, dict, config) {
  /** @type {Set<string>} */
  const keywords = new Set();

  const candidates = tokens.map(tok => config.swap.apply(tok));

  // Primary keyword selection pass.
  for (const group of candidates) {
    for (const candidate of group) {
      if (isKeywordEligible(candidate, dict, config, false)) {
        keywords.add(candidate);
      }
    }
  }

  // Auxiliary keyword selection pass (only if primary pass found matches).
  if (keywords.size > 0) {
    for (const group of candidates) {
      for (const candidate of group) {
        if (isKeywordEligible(candidate, dict, config, true)) {
          keywords.add(candidate);
        }
      }
    }
  }

  return keywords;
}
