import { ERROR_ID } from './dict.js';

const U16_MAX = 65535;

/**
 * Node in the frequency trie.
 */
export class TrieNode {
  /**
   * @param {number} symbolId
   */
  constructor(symbolId) {
    /** @type {number} Symbol ID. */
    this.symbol = symbolId;

    /** @type {number} Total count of all child observations. */
    this.usage = 0;

    /** @type {number} Observation count of this symbol in its parent's context. */
    this.count = 0;

    /** @type {number[]} References to child nodes in the arena. */
    this.children = [];
  }
}

/**
 * Arena-based frequency trie.
 */
export class Trie {
  constructor() {
    /** @type {TrieNode[]} Arena storing all trie nodes (root at index 0). */
    this.nodes = [new TrieNode(ERROR_ID)];
  }

  /**
   * Get the root node reference (always index 0).
   * @returns {number}
   */
  root() {
    return 0;
  }

  /**
   * Helper to perform binary search on a parent node's children list.
   * @private
   * @param {number} parentRef - The index of the parent node in nodes.
   * @param {number} symbolId - The symbol ID to search for.
   * @returns {{ found: boolean, index: number }}
   */
  _findChildIndex(parentRef, symbolId) {
    const parentNode = this.nodes[parentRef];
    const childrenRefs = parentNode.children;

    let low = 0;
    let high = childrenRefs.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const childRef = childrenRefs[mid];
      const childSym = this.nodes[childRef].symbol;

      if (childSym < symbolId) {
        low = mid + 1;
      } else if (childSym > symbolId) {
        high = mid - 1;
      } else {
        return { found: true, index: mid };
      }
    }

    return { found: false, index: low };
  }

  /**
   * Find an existing child node of parent matching symbolId.
   * Returns undefined if no such child exists.
   * @param {number} parentRef
   * @param {number} symbolId
   * @returns {number|undefined}
   */
  findChild(parentRef, symbolId) {
    const { found, index } = this._findChildIndex(parentRef, symbolId);
    if (found) {
      return this.nodes[parentRef].children[index];
    }
    return undefined;
  }

  /**
   * Find or create a child node of parent matching symbolId, incrementing counts.
   * @param {number} parentRef
   * @param {number} symbolId
   * @returns {number} NodeRef (index in nodes arena)
   */
  addChild(parentRef, symbolId) {
    const { found, index } = this._findChildIndex(parentRef, symbolId);

    if (found) {
      const childRef = this.nodes[parentRef].children[index];
      const child = this.nodes[childRef];
      if (child.count < U16_MAX) {
        child.count++;
        this.nodes[parentRef].usage++;
      }
      return childRef;
    }

    const childRef = this.nodes.length;
    const newChild = new TrieNode(symbolId);
    newChild.count = 1;
    this.nodes.push(newChild);

    this.nodes[parentRef].usage++;
    this.nodes[parentRef].children.splice(index, 0, childRef);
    return childRef;
  }

  /**
   * Get the children node references for a node.
   * @param {number} parentRef
   * @returns {number[]}
   */
  children(parentRef) {
    return this.nodes[parentRef].children;
  }

  /**
   * Get the number of children of a node.
   * @param {number} parentRef
   * @returns {number}
   */
  branchCount(parentRef) {
    return this.nodes[parentRef].children.length;
  }

  /**
   * Access a node by its reference index.
   * @param {number} ref
   * @returns {TrieNode}
   */
  node(ref) {
    if (ref < 0 || ref >= this.nodes.length) {
      throw new RangeError(`Node reference ${ref} is out of bounds`);
    }
    return this.nodes[ref];
  }

  /**
   * Total number of nodes in the trie (including root).
   * @returns {number}
   */
  get size() {
    return this.nodes.length;
  }

  /**
   * Whether the trie contains only the root node.
   * @returns {boolean}
   */
  isEmpty() {
    return this.nodes.length <= 1;
  }
}
