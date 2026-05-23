/**
 * Symbol ID constants.
 */
export const ERROR_ID = 0;
export const FIN_ID = 1;

/**
 * Interning Dictionary mapping symbols (strings) to compact integer IDs.
 */
export class SymbolDict {
  constructor() {
    /** @type {string[]} Symbols in insertion order (index is the Symbol ID). */
    this.entries = ['<ERROR>', '<FIN>'];

    /** @type {number[]} Sorted indices into entries, ordered alphabetically. */
    this.sortedIndex = [];

    const err = this.entries[ERROR_ID];
    const fin = this.entries[FIN_ID];
    if (err <= fin) {
      this.sortedIndex.push(ERROR_ID, FIN_ID);
    } else {
      this.sortedIndex.push(FIN_ID, ERROR_ID);
    }
  }

  /**
   * Helper to perform binary search on the sorted index.
   * @param {string} symbol - The symbol to search for (assumed to be uppercase).
   * @returns {{ found: boolean, index: number }}
   */
  _binarySearch(symbol) {
    let low = 0;
    let high = this.sortedIndex.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const midId = this.sortedIndex[mid];
      const midSym = this.entries[midId];

      if (midSym < symbol) {
        low = mid + 1;
      } else if (midSym > symbol) {
        high = mid - 1;
      } else {
        return { found: true, index: mid };
      }
    }

    return { found: false, index: low };
  }

  /**
   * Intern a symbol (uppercase string), returning its unique ID.
   * If it already exists, returns the existing ID.
   * @param {string} symbol
   * @returns {number}
   */
  intern(symbol) {
    const sym = symbol.toUpperCase();
    const { found, index } = this._binarySearch(sym);

    if (found) {
      return this.sortedIndex[index];
    }

    const newId = this.entries.length;
    this.entries.push(sym);
    this.sortedIndex.splice(index, 0, newId);
    return newId;
  }

  /**
   * Find the ID of an existing symbol without inserting it.
   * Returns undefined if the symbol does not exist.
   * @param {string} symbol
   * @returns {number|undefined}
   */
  find(symbol) {
    const sym = symbol.toUpperCase();
    const { found, index } = this._binarySearch(sym);
    if (found) {
      return this.sortedIndex[index];
    }
    return undefined;
  }

  /**
   * Resolve a symbol ID back to its string value.
   * @param {number} id
   * @returns {string}
   */
  resolve(id) {
    if (id < 0 || id >= this.entries.length) {
      throw new RangeError(`Symbol ID ${id} is out of bounds`);
    }
    return this.entries[id];
  }

  /**
   * Number of symbols in the dictionary (including sentinels).
   * @returns {number}
   */
  get size() {
    return this.entries.length;
  }

  /**
   * Whether the dictionary contains only the default sentinels.
   * @returns {boolean}
   */
  isEmpty() {
    return this.entries.length <= 2;
  }
}
