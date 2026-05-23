import { Trie, TrieNode } from './trie.js';
import { SymbolDict } from './dict.js';

const COOKIE = 'MegaHALv8';

class BinaryWriter {
  constructor() {
    this.buffer = new Uint8Array(4096);
    this.offset = 0;
    this.view = new DataView(this.buffer.buffer);
  }

  /**
   * Ensure the internal buffer is large enough.
   * @private
   * @param {number} size
   */
  _ensure(size) {
    const requiredLength = this.offset + size;
    if (requiredLength > this.buffer.byteLength) {
      const newLength = Math.max(this.buffer.byteLength * 2, requiredLength);
      const newBuffer = new Uint8Array(newLength);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer.buffer);
    }
  }

  /**
   * Write a uint8 byte.
   * @param {number} val
   */
  writeUint8(val) {
    this._ensure(1);
    this.view.setUint8(this.offset, val);
    this.offset += 1;
  }

  /**
   * Write a uint16 word.
   * @param {number} val
   */
  writeUint16(val) {
    this._ensure(2);
    this.view.setUint16(this.offset, val, true);
    this.offset += 2;
  }

  /**
   * Write a uint32 double word.
   * @param {number} val
   */
  writeUint32(val) {
    this._ensure(4);
    this.view.setUint32(this.offset, val, true);
    this.offset += 4;
  }

  /**
   * Write a raw byte array.
   * @param {Uint8Array} bytes
   */
  writeBytes(bytes) {
    this._ensure(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  /**
   * Get the written contents as a Uint8Array.
   * @returns {Uint8Array}
   */
  getUint8Array() {
    return this.buffer.subarray(0, this.offset);
  }
}

class BinaryReader {
  /**
   * @param {ArrayBuffer|Uint8Array} buffer
   */
  constructor(buffer) {
    this.buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    this.offset = 0;
  }

  /**
   * Read a uint8 byte.
   * @returns {number}
   */
  readUint8() {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  /**
   * Read a uint16 word.
   * @returns {number}
   */
  readUint16() {
    const val = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return val;
  }

  /**
   * Read a uint32 double word.
   * @returns {number}
   */
  readUint32() {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  /**
   * Read raw bytes.
   * @param {number} length
   * @returns {Uint8Array}
   */
  readBytes(length) {
    if (this.offset + length > this.buffer.byteLength) {
      throw new Error('Unexpected end of file while reading bytes');
    }
    const bytes = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  /**
   * Read a UTF-8 string.
   * @param {number} length
   * @returns {string}
   */
  readString(length) {
    const bytes = this.readBytes(length);
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

}

/**
 * Serialize a Trie node recursively.
 * @param {Trie} trie
 * @param {number} ref
 * @param {BinaryWriter} writer
 * @param {boolean} use64Bit
 */
function serializeNode(trie, ref, writer, use64Bit) {
  const node = trie.node(ref);
  writer.writeUint16(node.symbol);
  if (use64Bit) {
    writer.writeUint32(node.usage);
    writer.writeUint32(0); // High 4 bytes
  } else {
    writer.writeUint32(node.usage);
  }
  writer.writeUint16(node.count);
  writer.writeUint16(node.children.length);

  for (const childRef of node.children) {
    serializeNode(trie, childRef, writer, use64Bit);
  }
}

/**
 * Deserialize a Trie node recursively.
 * @param {Trie} trie
 * @param {BinaryReader} reader
 * @param {number} byte4Size
 * @returns {number} NodeRef
 */
function deserializeNode(trie, reader, byte4Size) {
  const symbol = reader.readUint16();
  const usage = reader.readUint32();
  if (byte4Size === 8) {
    reader.readUint32(); // Skip high 4 bytes
  }
  const count = reader.readUint16();
  const branch = reader.readUint16();

  const node = new TrieNode(symbol);
  node.usage = usage;
  node.count = count;

  const ref = trie.nodes.length;
  trie.nodes.push(node);

  for (let i = 0; i < branch; i++) {
    const childRef = deserializeNode(trie, reader, byte4Size);
    node.children.push(childRef);
  }

  return ref;
}

/**
 * Serialize a BidirectionalModel into a binary buffer.
 *
 * @param {import('./model.js').BidirectionalModel} model
 * @param {{ use64Bit?: boolean }} [options] - Options for serialization
 * @returns {Uint8Array}
 */
export function serializeBrain(model, options = {}) {
  const use64Bit = !!options.use64Bit;
  const writer = new BinaryWriter();

  const cookieBytes = new TextEncoder().encode(COOKIE);
  writer.writeBytes(cookieBytes);

  writer.writeUint8(model.order);

  serializeNode(model.forward, model.forward.root(), writer, use64Bit);

  serializeNode(model.backward, model.backward.root(), writer, use64Bit);

  const dict = model.dictionary;
  if (dict.entries.length > 65536) {
    throw new RangeError(
      `Dictionary size (${dict.entries.length}) exceeds maximum of 65536 symbols supported by the binary format`
    );
  }

  if (use64Bit) {
    writer.writeUint32(dict.entries.length);
    writer.writeUint32(0); // High 4 bytes
  } else {
    writer.writeUint32(dict.entries.length);
  }

  for (let i = 0; i < dict.entries.length; i++) {
    const word = dict.entries[i];
    const wordBytes = new TextEncoder().encode(word);
    if (wordBytes.length > 255) {
      throw new Error(`Symbol '${word}' exceeds maximum byte size of 255`);
    }
    writer.writeUint8(wordBytes.length);
    writer.writeBytes(wordBytes);
  }

  return writer.getUint8Array();
}

/**
 * Deserialize binary brain data into a BidirectionalModel.
 *
 * @param {Uint8Array|ArrayBuffer} data
 * @param {import('./model.js').BidirectionalModel} model
 */
export function deserializeBrain(data, model) {
  const reader = new BinaryReader(data);

  const cookie = reader.readString(9);
  if (cookie !== COOKIE) {
    throw new Error('Invalid brain file: Magic cookie mismatch');
  }

  const order = reader.readUint8();
  model.order = order;

  // Auto-detect byte4Size (4 or 8 bytes) by inspecting the root node of the forward tree.
  let byte4Size = 4;
  if (data.byteLength >= 24) {
    const buffer = data instanceof Uint8Array ? data.buffer : data;
    const byteOffset = data instanceof Uint8Array ? data.byteOffset : 0;
    const byteLength = data.byteLength;
    const view = new DataView(buffer, byteOffset, byteLength);
    const branch4 = view.getUint16(18, true);
    const branch8 = view.getUint16(22, true);
    if (branch4 === 0 && branch8 > 0) {
      byte4Size = 8;
    }
  }

  model.forward = new Trie();
  model.forward.nodes = []; // Clear default root
  deserializeNode(model.forward, reader, byte4Size);

  model.backward = new Trie();
  model.backward.nodes = []; // Clear default root
  deserializeNode(model.backward, reader, byte4Size);

  const dictSize = reader.readUint32();
  if (byte4Size === 8) {
    reader.readUint32(); // Skip high 4 bytes of dictionary size
  }

  const dict = new SymbolDict();
  dict.entries = [];
  dict.sortedIndex = [];

  for (let i = 0; i < dictSize; i++) {
    const len = reader.readUint8();
    const word = reader.readString(len);
    dict.entries.push(word);

    // Reconstruct sorted index using binary search insert position.
    const { index } = dict._binarySearch(word);
    dict.sortedIndex.splice(index, 0, i);
  }

  model.dictionary = dict;
}
