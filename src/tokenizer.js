/**
 * MegaHAL Tokenizer.
 * Splits input text into an alternating sequence of word tokens and separator tokens.
 */

/**
 * Checks if a character is ASCII alphabetic.
 * @param {string} char
 * @returns {boolean}
 */
function isAlpha(char) {
  return typeof char === 'string' && char.length === 1 && /^[A-Z]$/.test(char);
}

/**
 * Checks if a character is ASCII digit.
 * @param {string} char
 * @returns {boolean}
 */
function isDigit(char) {
  return typeof char === 'string' && char.length === 1 && /^[0-9]$/.test(char);
}

/**
 * Checks if a character is ASCII alphanumeric.
 * @param {string} char
 * @returns {boolean}
 */
function isAlphanumeric(char) {
  return typeof char === 'string' && char.length === 1 && /^[A-Z0-9]$/.test(char);
}

/**
 * Determine if position `pos` in the uppercase `input` string is a word boundary.
 *
 * Rules (from MEGAHAL_SPEC.md Section 4.1):
 * 1. pos == 0: never a boundary
 * 2. pos == len: always a boundary
 * 3. Apostrophe rule: if char at pos is `'` and both neighbors are alpha, no boundary.
 *    If char at pos-1 is `'` and both pos-2 and pos are alpha, no boundary.
 * 4. Alpha transition: exactly one of pos and pos-1 is alphabetic -> boundary
 * 5. Digit transition: digit status differs between pos and pos-1 -> boundary
 *
 * @param {string} input - Uppercase string
 * @param {number} pos - 0-indexed position to test
 * @returns {boolean}
 */
function isBoundary(input, pos) {
  if (pos === 0) {
    return false;
  }
  if (pos === input.length) {
    return true;
  }

  const curr = input[pos];
  const prev = input[pos - 1];

  // Apostrophe rule.
  if (curr === '\'' && pos + 1 < input.length && isAlpha(prev) && isAlpha(input[pos + 1])) {
    return false;
  }
  if (prev === '\'' && pos >= 2 && isAlpha(input[pos - 2]) && isAlpha(curr)) {
    return false;
  }

  // Alpha transition.
  const currAlpha = isAlpha(curr);
  const prevAlpha = isAlpha(prev);
  if (currAlpha !== prevAlpha) {
    return true;
  }

  // Digit transition.
  const currDigit = isDigit(curr);
  const prevDigit = isDigit(prev);
  if (currDigit !== prevDigit) {
    return true;
  }

  return false;
}

/**
 * Tokenize input text per MegaHAL rules.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function tokenize(input) {
  if (!input || input.trim() === '') {
    return ['.'];
  }

  const upper = input.toUpperCase();
  /** @type {string[]} */
  const tokens = [];
  let start = 0;

  for (let pos = 1; pos <= upper.length; pos++) {
    if (isBoundary(upper, pos)) {
      if (pos > start) {
        tokens.push(upper.substring(start, pos));
      }
      start = pos;
    }
  }

  if (tokens.length === 0) {
    return ['.'];
  }

  // Sentence-terminal normalization.
  const last = tokens[tokens.length - 1];
  const firstChar = last[0];
  const lastChar = last[last.length - 1];

  if (isAlphanumeric(firstChar)) {
    tokens.push('.');
  } else if (lastChar !== '!' && lastChar !== '.' && lastChar !== '?') {
    tokens[tokens.length - 1] = '.';
  }

  return tokens;
}
