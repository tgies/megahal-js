import { Trie } from './trie.js';
import { SymbolDict, FIN_ID } from './dict.js';

/**
 * A sliding context window tracking position in an n-gram trie.
 */
export class ContextWindow {
  /**
   * @param {number} order - Markov model order
   */
  constructor(order) {
    this.order = order;
    /** @type {(number|null)[]} Context slots matching the model order. */
    this.slots = new Array(order + 2).fill(null);
  }

  /**
   * Reset the context window using the specified root reference.
   * @param {number} rootRef
   */
  initialize(rootRef) {
    this.slots.fill(null);
    this.slots[0] = rootRef;
  }

  /**
   * Update the context window without creating new trie nodes.
   * @param {Trie} trie
   * @param {number} symbolId
   */
  advance(trie, symbolId) {
    for (let d = this.order + 1; d >= 1; d--) {
      const parent = this.slots[d - 1];
      if (parent !== null && parent !== undefined) {
        const child = trie.findChild(parent, symbolId);
        this.slots[d] = child !== undefined ? child : null;
      } else {
        this.slots[d] = null;
      }
    }
  }

  /**
   * Update the context window, creating new trie nodes if necessary.
   * @param {Trie} trie
   * @param {number} symbolId
   */
  advanceAndLearn(trie, symbolId) {
    for (let d = this.order + 1; d >= 1; d--) {
      const parent = this.slots[d - 1];
      if (parent !== null && parent !== undefined) {
        this.slots[d] = trie.addChild(parent, symbolId);
      } else {
        this.slots[d] = null;
      }
    }
  }

  /**
   * Get the context node at depth j.
   * @param {number} j
   * @returns {number|null}
   */
  atDepth(j) {
    if (j < 0 || j >= this.slots.length) {
      return null;
    }
    return this.slots[j];
  }

  /**
   * Get the deepest non-null context node.
   * Scans from slot 0 up to slot `order` (inclusive), returning the last non-null.
   * @returns {number|null}
   */
  deepest() {
    let best = null;
    for (let d = 0; d <= this.order; d++) {
      if (this.slots[d] !== null && this.slots[d] !== undefined) {
        best = this.slots[d];
      }
    }
    return best;
  }
}

/**
 * Bidirectional Markov model: forward trie + backward trie + shared dictionary.
 */
export class BidirectionalModel {
  /**
   * @param {number} order - Markov model order (default: 5)
   */
  constructor(order = 5) {
    this.order = order;
    this.forward = new Trie();
    this.backward = new Trie();
    this.dictionary = new SymbolDict();
  }

  /**
   * Learn from a sequence of token strings.
   * Skips learning if tokens.length <= order.
   * @param {string[]} tokens
   */
  learn(tokens) {
    if (tokens.length <= this.order) {
      return;
    }

    // Forward pass: learn the sequence in the forward trie.
    const fwdCtx = new ContextWindow(this.order);
    fwdCtx.initialize(this.forward.root());

    /** @type {number[]} */
    const symbolIds = [];
    for (const tok of tokens) {
      const id = this.dictionary.intern(tok);
      symbolIds.push(id);
      fwdCtx.advanceAndLearn(this.forward, id);
    }
    fwdCtx.advanceAndLearn(this.forward, FIN_ID);

    // Backward pass: learn the reverse sequence in the backward trie.
    const bwdCtx = new ContextWindow(this.order);
    bwdCtx.initialize(this.backward.root());

    for (let i = symbolIds.length - 1; i >= 0; i--) {
      const id = symbolIds[i];
      bwdCtx.advanceAndLearn(this.backward, id);
    }
    bwdCtx.advanceAndLearn(this.backward, FIN_ID);
  }

  /**
   * Create a context window initialized to the forward root.
   * @returns {ContextWindow}
   */
  forwardContext() {
    const ctx = new ContextWindow(this.order);
    ctx.initialize(this.forward.root());
    return ctx;
  }

  /**
   * Create a context window initialized to the backward root.
   * @returns {ContextWindow}
   */
  backwardContext() {
    const ctx = new ContextWindow(this.order);
    ctx.initialize(this.backward.root());
    return ctx;
  }
}
