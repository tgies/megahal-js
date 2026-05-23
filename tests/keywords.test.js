import { describe, test, expect } from 'vitest';
import { SymbolDict } from '../src/dict.js';
import { SwapTable, KeywordConfig, extractKeywords } from '../src/keywords.js';

describe('Keyword Extractor', () => {
  test('SwapTable basic substitutions', () => {
    const swap = new SwapTable();
    swap.pairs = [
      ['I', 'YOU'],
      ['YOU', 'I'],
      ['YOU', 'ME']
    ];

    expect(swap.apply('I')).toEqual(['YOU']);
    expect(swap.apply('you')).toEqual(['I', 'ME']); // case insensitive, multiple matches
    expect(swap.apply('HELLO')).toEqual(['HELLO']); // no match returns original
  });

  test('extractKeywords skips words not in dict', () => {
    const dict = new SymbolDict();
    dict.intern('HELLO');
    dict.intern('WORLD');

    const config = new KeywordConfig();
    const keywords = extractKeywords(['HELLO', ' ', 'UNKNOWN'], dict, config);

    expect(keywords.has('HELLO')).toBe(true);
    expect(keywords.has('UNKNOWN')).toBe(false);
  });

  test('extractKeywords skips non-alphanumeric start symbols', () => {
    const dict = new SymbolDict();
    dict.intern('HELLO');
    dict.intern(' ');
    dict.intern('.');

    const config = new KeywordConfig();
    const keywords = extractKeywords(['HELLO', ' ', '.'], dict, config);

    expect(keywords.has('HELLO')).toBe(true);
    expect(keywords.has(' ')).toBe(false);
    expect(keywords.has('.')).toBe(false);
  });

  test('extractKeywords skips banned words', () => {
    const dict = new SymbolDict();
    dict.intern('THE');
    dict.intern('CAT');

    const config = new KeywordConfig();
    config.banned.add('THE');

    const keywords = extractKeywords(['THE', 'CAT'], dict, config);
    expect(keywords.has('THE')).toBe(false);
    expect(keywords.has('CAT')).toBe(true);
  });

  test('extractKeywords auxiliary passes', () => {
    const dict = new SymbolDict();
    dict.intern('MY');
    dict.intern('CAT');

    const config = new KeywordConfig();
    config.auxiliary.add('MY');

    // Case 1: No primary keyword found. Auxiliary pass should not run.
    const kws1 = extractKeywords(['MY'], dict, config);
    expect(kws1.has('MY')).toBe(false);

    // Case 2: Primary keyword present. Auxiliary pass should run.
    const kws2 = extractKeywords(['MY', 'CAT'], dict, config);
    expect(kws2.has('CAT')).toBe(true);
    expect(kws2.has('MY')).toBe(true);
  });

  test('extractKeywords with swap application', () => {
    const dict = new SymbolDict();
    dict.intern('YOU');
    dict.intern('CAT');

    const config = new KeywordConfig();
    config.swap.pairs = [['I', 'YOU']];

    const keywords = extractKeywords(['I', 'CAT'], dict, config);
    expect(keywords.has('YOU')).toBe(true);
    expect(keywords.has('CAT')).toBe(true);
    expect(keywords.has('I')).toBe(false);
  });
});
