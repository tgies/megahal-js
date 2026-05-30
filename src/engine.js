import { BidirectionalModel } from './model.js';
import { tokenize } from './tokenizer.js';
import { extractKeywords, KeywordConfig } from './keywords.js';
import { generateReply, capitalize } from './generator.js';
import { serializeBrain, deserializeBrain } from './binary.js';

const DEFAULT_FALLBACK_REPLY = "I don't know enough to answer you yet!";
const DEFAULT_FALLBACK_GREETING = 'Hello!';

/**
 * Helper to pick a random value in [0, max).
 * @param {any} rng
 * @param {number} max
 * @returns {number}
 */
function randomRange(rng, max) {
  if (rng && typeof rng.randomRange === 'function') {
    return rng.randomRange(0, max);
  }
  return Math.floor(Math.random() * max);
}

/**
 * Main MegaHAL engine class.
 */
export class MegaHal {
  /**
   * @param {number} [order=5] - Markov model order
   * @param {any} [rng=null] - Optional custom random number generator
   */
  constructor(order = 5, rng = null) {
    this.model = new BidirectionalModel(order);
    this.rng = rng;
    this.keywordConfig = new KeywordConfig();
    /** @type {string[]} */
    this.greetings = [];
    this.limit = { timeout: 1000, maxIterations: 0 };
    this.fallbackReply = DEFAULT_FALLBACK_REPLY;
    this.fallbackGreeting = DEFAULT_FALLBACK_GREETING;
  }

  /**
   * Override fallback message when respond() cannot produce output.
   * @param {string} msg
   */
  setFallbackReply(msg) {
    this.fallbackReply = msg;
  }

  /**
   * Override fallback greeting when greet() cannot produce output.
   * @param {string} msg
   */
  setFallbackGreeting(msg) {
    this.fallbackGreeting = msg;
  }

  /**
   * Set reply generation limits.
   * @param {{ timeout?: number, maxIterations?: number }} limit
   */
  setLimit(limit) {
    this.limit = { ...this.limit, ...limit };
  }

  /**
   * Set keyword configuration (banned words, auxiliary words, and swap table).
   * @param {KeywordConfig} config
   */
  setKeywordConfig(config) {
    this.keywordConfig = config;
  }

  /**
   * Set greeting keywords.
   * @param {string[]} greetings
   */
  setGreetings(greetings) {
    this.greetings = greetings.map(g => g.toUpperCase());
  }

  /**
   * Learn from input text without generating a reply.
   * @param {string} input
   */
  learn(input) {
    const tokens = tokenize(input);
    this.model.learn(tokens);
  }

  /**
   * Learn from input and generate a reply.
   * @param {string} input
   * @returns {string}
   */
  respond(input) {
    const tokens = tokenize(input);

    // Learn from the input first.
    this.model.learn(tokens);

    const keywords = extractKeywords(tokens, this.model.dictionary, this.keywordConfig);

    const replyTokens = generateReply(
      this.model,
      tokens,
      keywords,
      this.keywordConfig.auxiliary,
      this.limit,
      this.rng
    );

    if (replyTokens.length === 0) {
      return this.fallbackReply;
    }

    return capitalize(replyTokens);
  }

  /**
   * Generate a reply without learning from the input.
   * Returns null if no reply can be generated.
   * @param {string} input
   * @returns {string|null}
   */
  generate(input) {
    const tokens = tokenize(input);

    const keywords = extractKeywords(tokens, this.model.dictionary, this.keywordConfig);

    const replyTokens = generateReply(
      this.model,
      tokens,
      keywords,
      this.keywordConfig.auxiliary,
      this.limit,
      this.rng
    );

    if (replyTokens.length === 0) {
      return null;
    }

    return capitalize(replyTokens);
  }

  /**
   * Generate an initial greeting before user input.
   * @returns {string}
   */
  greet() {
    if (this.greetings.length === 0) {
      return this.fallbackGreeting;
    }

    const idx = randomRange(this.rng, this.greetings.length);
    const greetingWord = this.greetings[idx];

    const greetTokens = tokenize(greetingWord);
    const keywords = extractKeywords(greetTokens, this.model.dictionary, this.keywordConfig);

    const replyTokens = generateReply(
      this.model,
      greetTokens,
      keywords,
      this.keywordConfig.auxiliary,
      this.limit,
      this.rng
    );

    if (replyTokens.length === 0) {
      return this.fallbackGreeting;
    }

    return capitalize(replyTokens);
  }

  /**
   * Export the model state as a binary Uint8Array.
   * Works in both Node and Browser.
   * @param {{ use64Bit?: boolean }} [options] - Options for serialization
   * @returns {Uint8Array}
   */
  exportBrain(options) {
    return serializeBrain(this.model, options);
  }

  /**
   * Import the model state from binary brain data.
   * Returns false if the data has a bad magic cookie (model is left unchanged);
   * throws on other structural errors. Matches the C load_model() contract.
   * Works in both Node and Browser.
   * @param {Uint8Array|ArrayBuffer} data
   * @returns {boolean} true on success, false on magic cookie mismatch
   */
  importBrain(data) {
    return deserializeBrain(data, this.model);
  }

  /**
   * Train from a text string containing multiple lines of sentences.
   * @param {string} content
   */
  trainFromContent(content) {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      this.learn(trimmed);
    }
  }

  /**
   * Node-only: Save the model to a binary brain file.
   * @param {string} path
   * @param {{ use64Bit?: boolean }} [options] - Options for serialization
   * @returns {Promise<void>}
   */
  async saveBrain(path, options) {
    if (typeof window !== 'undefined' || typeof process === 'undefined') {
      throw new Error('saveBrain is only supported in Node.js environment');
    }
    const fs = await import('node:fs/promises');
    const data = this.exportBrain(options);
    await fs.writeFile(path, data);
  }

  /**
   * Node-only: Load the model from a binary brain file.
   * Returns false if the file has a bad magic cookie; throws on other errors.
   * @param {string} path
   * @returns {Promise<boolean>} true on success, false on magic cookie mismatch
   */
  async loadBrain(path) {
    if (typeof window !== 'undefined' || typeof process === 'undefined') {
      throw new Error('loadBrain is only supported in Node.js environment');
    }
    const fs = await import('node:fs/promises');
    const data = await fs.readFile(path);
    return this.importBrain(data);
  }

  /**
   * Node-only: Train from a text file.
   * @param {string} path
   * @returns {Promise<void>}
   */
  async trainFromFile(path) {
    if (typeof window !== 'undefined' || typeof process === 'undefined') {
      throw new Error('trainFromFile is only supported in Node.js environment');
    }
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(path, 'utf8');
    this.trainFromContent(content);
  }
}

/**
 * Universal helper to parse a plain word list.
 * @param {string} text
 * @returns {string[]}
 */
export function parseWordList(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .map(line => line.toUpperCase());
}

/**
 * Universal helper to parse a swap table file content.
 * @param {string} text
 * @returns {[string, string][]}
 */
export function parseSwapFile(text) {
  /** @type {[string, string][]} */
  const pairs = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    // C initialize_swap (megahal.c:2811-2812): from = strtok(buffer, "\t "),
    // to = strtok(NULL, "\t \n#"). The to field also breaks on '#', so an inline
    // comment after the substitution word is dropped; the from field does not.
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }
    const hash = parts[1].indexOf('#');
    const to = hash === -1 ? parts[1] : parts[1].slice(0, hash);
    if (to === '') {
      continue;
    }
    pairs.push([parts[0].toUpperCase(), to.toUpperCase()]);
  }
  return pairs;
}

/**
 * Node-only helper to load a plain word list from a file.
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function loadWordList(path) {
  if (typeof window !== 'undefined' || typeof process === 'undefined') {
    throw new Error('loadWordList is only supported in Node.js environment');
  }
  const fs = await import('node:fs/promises');
  const content = await fs.readFile(path, 'utf8');
  return parseWordList(content);
}

/**
 * Node-only helper to load a swap table from a file.
 * @param {string} path
 * @returns {Promise<[string, string][]>}
 */
export async function loadSwapFile(path) {
  if (typeof window !== 'undefined' || typeof process === 'undefined') {
    throw new Error('loadSwapFile is only supported in Node.js environment');
  }
  const fs = await import('node:fs/promises');
  const content = await fs.readFile(path, 'utf8');
  return parseSwapFile(content);
}
