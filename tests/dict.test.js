import { describe, test, expect } from 'vitest';
import { SymbolDict, ERROR_ID, FIN_ID } from '../src/dict.js';

describe('SymbolDict', () => {
  test('new dict has sentinels', () => {
    const dict = new SymbolDict();
    expect(dict.size).toBe(2);
    expect(dict.resolve(ERROR_ID)).toBe('<ERROR>');
    expect(dict.resolve(FIN_ID)).toBe('<FIN>');
  });

  test('intern returns sequential IDs', () => {
    const dict = new SymbolDict();
    const idHello = dict.intern('HELLO');
    const idWorld = dict.intern('WORLD');

    expect(idHello).toBe(2); // 0 and 1 are sentinels
    expect(idWorld).toBe(3);
    expect(dict.size).toBe(4);
  });

  test('intern deduplicates and case-insensitively', () => {
    const dict = new SymbolDict();
    const first = dict.intern('hello');
    const second = dict.intern('HELLO');
    const third = dict.intern('Hello');

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(dict.size).toBe(3); // 2 sentinels + 1 word
  });

  test('find existing and missing', () => {
    const dict = new SymbolDict();
    const id = dict.intern('TEST');

    expect(dict.find('TEST')).toBe(id);
    expect(dict.find('test')).toBe(id);
    expect(dict.find('NOPE')).toBeUndefined();
  });

  test('resolve out of bounds throws RangeError', () => {
    const dict = new SymbolDict();
    expect(() => dict.resolve(99)).toThrow(RangeError);
  });

  test('is empty check', () => {
    const dict = new SymbolDict();
    expect(dict.isEmpty()).toBe(true);
    dict.intern('A');
    expect(dict.isEmpty()).toBe(false);
  });

  test('sorted index is maintained alphabetically', () => {
    const dict = new SymbolDict();
    dict.intern('ZEBRA');
    dict.intern('APPLE');
    dict.intern('MANGO');

    const sortedWords = dict.sortedIndex.map(id => dict.resolve(id));
    // '<ERROR>' and '<FIN>' are sentinels.
    // Alphabetical order: '<ERROR>', '<FIN>', 'APPLE', 'MANGO', 'ZEBRA'
    // Let's verify this order.
    expect(sortedWords).toEqual(['<ERROR>', '<FIN>', 'APPLE', 'MANGO', 'ZEBRA']);
  });
});
