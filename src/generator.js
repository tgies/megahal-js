import { ERROR_ID, FIN_ID } from './dict.js';
import { evaluateReply } from './evaluator.js';

/**
 * @typedef {import('./model.js').BidirectionalModel} BidirectionalModel
 * @typedef {import('./model.js').ContextWindow} ContextWindow
 */

/**
 * Pick a random integer in [min, max) using the provided RNG.
 * @param {any} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomRange(rng, min, max) {
  if (rng && typeof rng.randomRange === 'function') {
    return rng.randomRange(min, max);
  }
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Select a seed symbol ID for forward generation.
 *
 * @param {BidirectionalModel} model
 * @param {Set<string>} keywords
 * @param {Set<string>} auxSet
 * @param {any} rng
 * @returns {number}
 */
function seed(model, keywords, auxSet, rng) {
  const root = model.forward.root();
  const children = model.forward.children(root);

  if (children.length === 0) {
    return ERROR_ID;
  }

  // If keywords exist, try to find a non-auxiliary keyword as seed.
  if (keywords.size > 0) {
    const keywordList = Array.from(keywords).sort();
    const start = randomRange(rng, 0, keywordList.length);

    for (let offset = 0; offset < keywordList.length; offset++) {
      const idx = (start + offset) % keywordList.length;
      const kw = keywordList[idx];

      const id = model.dictionary.find(kw);
      if (id !== undefined && !auxSet.has(kw)) {
        return id;
      }
    }
  }

  // Default: pick a random child of the forward root.
  const idx = randomRange(rng, 0, children.length);
  return model.forward.node(children[idx]).symbol;
}

/**
 * Keyword-biased random symbol selection (the "babble" function).
 *
 * @param {import('./trie.js').Trie} trie
 * @param {ContextWindow} ctx
 * @param {import('./dict.js').SymbolDict} dict
 * @param {Set<string>} keywords
 * @param {Set<string>} auxSet
 * @param {number[]} reply - Array of symbol IDs currently in the reply
 * @param {{ val: boolean }} usedKey - Object wrapper for usedKey boolean reference
 * @param {any} rng
 * @returns {number} Symbol ID
 */
function babble(trie, ctx, dict, keywords, auxSet, reply, usedKey, rng) {
  const nodeRef = ctx.deepest();
  if (nodeRef === null || nodeRef === undefined) {
    return ERROR_ID;
  }

  const node = trie.node(nodeRef);
  const children = trie.children(nodeRef);

  if (children.length === 0 || node.usage === 0) {
    return ERROR_ID;
  }

  const branch = children.length;
  let i = randomRange(rng, 0, branch);
  let count = randomRange(rng, 0, node.usage);

  for (let step = 0; step < branch; step++) {
    const childRef = children[i];
    const child = trie.node(childRef);
    const sym = child.symbol;

    const word = dict.resolve(sym);
    const isKeyword = keywords.has(word);
    const isAux = auxSet.has(word);
    const alreadyInReply = reply.includes(sym);

    if (isKeyword && (usedKey.val || !isAux) && !alreadyInReply) {
      usedKey.val = true;
      return sym;
    }

    count -= child.count;
    if (count < 0) {
      return sym;
    }

    i = (i + 1) % branch;
  }

  return ERROR_ID;
}

/**
 * Generate a single candidate reply (forward + backward phases).
 *
 * @param {BidirectionalModel} model
 * @param {Set<string>} keywords
 * @param {Set<string>} auxSet
 * @param {any} rng
 * @returns {string[]}
 */
export function generateOneReply(model, keywords, auxSet, rng) {
  /** @type {number[]} */
  const replyIds = [];
  const usedKey = { val: false };

  // Forward generation phase.
  const fwdCtx = model.forwardContext();
  const seedId = seed(model, keywords, auxSet, rng);

  if (seedId !== ERROR_ID && seedId !== FIN_ID) {
    replyIds.push(seedId);
    fwdCtx.advance(model.forward, seedId);

    while (true) {
      const sym = babble(
        model.forward,
        fwdCtx,
        model.dictionary,
        keywords,
        auxSet,
        replyIds,
        usedKey,
        rng
      );
      if (sym === ERROR_ID || sym === FIN_ID) {
        break;
      }
      replyIds.push(sym);
      fwdCtx.advance(model.forward, sym);
    }
  }

  // Backward generation phase.
  const bwdCtx = model.backwardContext();
  if (replyIds.length > 0) {
    const start = Math.min(replyIds.length - 1, model.order);
    for (let i = start; i >= 0; i--) {
      bwdCtx.advance(model.backward, replyIds[i]);
    }
  }

  while (true) {
    const sym = babble(
      model.backward,
      bwdCtx,
      model.dictionary,
      keywords,
      auxSet,
      replyIds,
      usedKey,
      rng
    );
    if (sym === ERROR_ID || sym === FIN_ID) {
      break;
    }
    replyIds.unshift(sym);
    bwdCtx.advance(model.backward, sym);
  }

  return replyIds.map(id => model.dictionary.resolve(id));
}

/**
 * Check if two token lists are equal (case-insensitive for MegaHAL comparison).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function tokensEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].toUpperCase() !== b[i].toUpperCase()) {
      return false;
    }
  }
  return true;
}

/**
 * Generate the best reply for given input tokens and keywords.
 * Runs the candidate generation loop for up to TIMEOUT milliseconds or ITERATIONS.
 *
 * @param {BidirectionalModel} model
 * @param {string[]} inputTokens
 * @param {Set<string>} keywords
 * @param {Set<string>} auxSet
 * @param {{ timeout?: number, maxIterations?: number }} limit
 * @param {any} rng
 * @returns {string[]}
 */
export function generateReply(model, inputTokens, keywords, auxSet, limit, rng) {
  const emptyKeywords = new Set();
  const emptyAux = new Set();

  // Establish a baseline reply without keyword bias.
  let best = generateOneReply(model, emptyKeywords, emptyAux, rng);
  if (tokensEqual(best, inputTokens)) {
    best = [];
  }

  let maxSurprise = -1.0;
  const start = Date.now();
  let iterations = 0;

  const timeout = limit.timeout !== undefined ? limit.timeout : 1000;
  const maxIterations = limit.maxIterations !== undefined ? limit.maxIterations : 0;

  while (true) {
    if (timeout > 0 && Date.now() - start >= timeout) {
      break;
    }
    if (maxIterations > 0 && iterations >= maxIterations) {
      break;
    }

    const candidate = generateOneReply(model, keywords, auxSet, rng);
    const surprise = evaluateReply(model, candidate, keywords);

    if (surprise > maxSurprise && !tokensEqual(candidate, inputTokens)) {
      maxSurprise = surprise;
      best = candidate;
    }

    iterations++;

    // If no limits are specified, perform at least one iteration.
    if (timeout === 0 && maxIterations === 0) {
      break;
    }
  }

  return best;
}

/**
 * Capitalize a token sequence per MegaHAL sentence-case rules.
 *
 * @param {string[]} tokens
 * @returns {string}
 */
export function capitalize(tokens) {
  const raw = tokens.join('');
  /** @type {string[]} */
  const result = [];
  let start = true;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (/^[a-zA-Z]$/.test(char)) {
      if (start) {
        result.push(char.toUpperCase());
      } else {
        result.push(char.toLowerCase());
      }
      start = false;
    } else {
      result.push(char);
    }

    if (i > 2 && /^\s$/.test(char)) {
      const prev = raw[i - 1];
      if (prev === '!' || prev === '.' || prev === '?') {
        start = true;
      }
    }
  }

  return result.join('');
}
