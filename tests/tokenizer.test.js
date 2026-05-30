import { describe, test, expect } from 'vitest';
import { tokenize } from '../src/tokenizer.js';

describe('Tokenizer', () => {
  test('empty input returns no tokens', () => {
    // C make_words returns immediately on empty input (megahal.c:2053): zero tokens.
    expect(tokenize('')).toEqual([]);
  });

  test('whitespace-only input collapses to a single period', () => {
    expect(tokenize('   ')).toEqual(['.']);
  });

  test('spec example "Don\'t you think so?"', () => {
    const tokens = tokenize("Don't you think so?");
    expect(tokens).toEqual(["DON'T", ' ', 'YOU', ' ', 'THINK', ' ', 'SO', '?']);
  });

  test('simple sentence', () => {
    const tokens = tokenize('Hello world');
    expect(tokens).toEqual(['HELLO', ' ', 'WORLD', '.']);
  });

  test('already terminated with period', () => {
    const tokens = tokenize('Hello.');
    expect(tokens).toEqual(['HELLO', '.']);
  });

  test('already terminated with exclamation', () => {
    const tokens = tokenize('Hello!');
    expect(tokens).toEqual(['HELLO', '!']);
  });

  test('contraction im', () => {
    const tokens = tokenize("I'm fine");
    expect(tokens).toEqual(["I'M", ' ', 'FINE', '.']);
  });

  test('digits split from words', () => {
    const tokens = tokenize('abc123def');
    expect(tokens).toEqual(['ABC', '123', 'DEF', '.']);
  });

  test('punctuation only', () => {
    const tokens = tokenize('...');
    expect(tokens).toEqual(['...']);
  });

  test('non-terminal punctuation replaced', () => {
    const tokens = tokenize('hello,');
    expect(tokens).toEqual(['HELLO', '.']);
  });

  test('multiple spaces preserved', () => {
    const tokens = tokenize('A  B');
    expect(tokens).toEqual(['A', '  ', 'B', '.']);
  });

  test('question mark preserved', () => {
    const tokens = tokenize('Why?');
    expect(tokens).toEqual(['WHY', '?']);
  });

  test('digit to punctuation boundary', () => {
    const tokens = tokenize('5,');
    expect(tokens).toEqual(['5', '.']);
  });

  test('tokenize(null) returns no tokens', () => {
    expect(tokenize(null)).toEqual([]);
  });

  test('tokenize(undefined) returns no tokens', () => {
    expect(tokenize(undefined)).toEqual([]);
  });

  test('single character input a', () => {
    expect(tokenize('a')).toEqual(['A', '.']);
  });

  test('single character input z', () => {
    expect(tokenize('z')).toEqual(['Z', '.']);
  });

  test('apostrophe in contraction it\'s', () => {
    const tokens = tokenize("it's");
    expect(tokens).toEqual(["IT'S", '.']);
  });

  test('trailing whitespace hello ', () => {
    // space is non-alpha non-digit, so 'HELLO' and ' ' are separate tokens
    // terminal normalization replaces trailing space token with '.'
    expect(tokenize('hello ')).toEqual(['HELLO', '.']);
  });

  test('input that is just comma space', () => {
    // ', ' is a single non-alpha/digit token, replaced by terminal normalization
    expect(tokenize(', ')).toEqual(['.']);
  });

  test('digits followed by alpha create boundary: 123abc', () => {
    const tokens = tokenize('123abc');
    expect(tokens).toEqual(['123', 'ABC', '.']);
  });

  test('digit and alpha boundary characters tokenize correctly', () => {
    expect(tokenize('0a9z')).toEqual(['0', 'A', '9', 'Z', '.']);
    expect(tokenize('09')).toEqual(['09', '.']);
    expect(tokenize('89')).toEqual(['89', '.']);
  });

  test('alpha followed by digits create boundary: abc123', () => {
    const tokens = tokenize('abc123');
    expect(tokens).toEqual(['ABC', '123', '.']);
  });

  test('mixed punctuation in middle of words', () => {
    // '-' is not alpha/digit, creates boundaries between HELLO, -, and WORLD
    expect(tokenize('hello-world')).toEqual(['HELLO', '-', 'WORLD', '.']);
    expect(tokenize('A[B')).toEqual(['A', '[', 'B', '.']);
  });

  test('apostrophe followed by non-alpha is a boundary', () => {
    expect(tokenize("A'[B")).toEqual(['A', "'[", 'B', '.']);
  });

  test('input with only a single period', () => {
    const tokens = tokenize('.');
    expect(tokens).toEqual(['.']);
  });

  test('exclamation in middle: wow!cool', () => {
    // '!' is non-alpha, creates boundary. Terminal normalization adds '.'
    expect(tokenize('wow!cool')).toEqual(['WOW', '!', 'COOL', '.']);
  });

  test('multiple terminal punctuation', () => {
    // '?' and '!' are both non-alpha non-digit, so no boundary between them
    // they form a single token '?!' which ends with terminal '!'
    expect(tokenize('Really?!')).toEqual(['REALLY', '?!']);
  });

  test('single digit input', () => {
    const tokens = tokenize('5');
    expect(tokens).toEqual(['5', '.']);
  });
});
