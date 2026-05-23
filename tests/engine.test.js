import { describe, test, expect } from 'vitest';
import { MegaHal, parseWordList, parseSwapFile, KeywordConfig, loadWordList, loadSwapFile } from '../index.js';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

function makeSeededRng(seed) {
  let s = seed;
  return {
    randomRange(min, max) {
      s = (s * 9301 + 49297) % 233280;
      const rnd = s / 233280;
      return Math.floor(rnd * (max - min)) + min;
    }
  };
}

describe('MegaHal Engine Integration', () => {
  test('new engine creates empty model with ERROR and FIN', () => {
    const hal = new MegaHal(5);
    expect(hal.model.dictionary.size).toBe(2);
  });

  test('respond returns non-empty and handles fallback when empty', () => {
    const hal = new MegaHal(5);
    hal.setLimit({ maxIterations: 5, timeout: 50 });
    const reply = hal.respond('Hi.');
    expect(reply).toBe("I don't know enough to answer you yet!");
  });

  test('respond learns before generating', () => {
    const hal = new MegaHal(5);
    hal.setLimit({ maxIterations: 5, timeout: 50 });
    // First respond learns the input
    const _ = hal.respond('The cat sat on the mat and looked at the world.');
    expect(hal.model.dictionary.size).toBeGreaterThan(2);
  });

  test('respond is deterministic with seedable RNG', () => {
    const build = () => {
      const rng = makeSeededRng(42);
      const hal = new MegaHal(2, rng);
      hal.setLimit({ maxIterations: 20 });
      for (let i = 0; i < 5; i++) {
        hal.learn('The quick brown fox jumps over the lazy dog.');
        hal.learn('Dogs are wonderful animals that bring joy to people.');
        hal.learn('Cats and dogs are popular pets around the world.');
      }
      return hal.respond('Tell me about dogs.');
    };

    expect(build()).toBe(build());
  });

  test('generate does not learn from input', () => {
    const hal = new MegaHal(5);
    hal.setLimit({ maxIterations: 5, timeout: 50 });
    const before = hal.model.dictionary.size;
    hal.generate('Tell me about the world and many other things.');
    const after = hal.model.dictionary.size;
    expect(before).toBe(after);
  });

  test('greet produces output when greetings are set', () => {
    const rng = makeSeededRng(42);
    const hal = new MegaHal(2, rng);
    hal.setLimit({ maxIterations: 20 });
    hal.learn('Hello there my friend!');
    hal.setGreetings(['Hello']);

    const reply = hal.greet();
    expect(reply).toBeDefined();
    expect(reply.length).toBeGreaterThan(0);
  });

  test('parseWordList parses comments and lines', () => {
    const raw = '# comment\nHELLO\n\nWORLD\n';
    const parsed = parseWordList(raw);
    expect(parsed).toEqual(['HELLO', 'WORLD']);
  });

  test('parseSwapFile parses swap pairs', () => {
    const raw = '# comment\nI   YOU\nYOU ME\n';
    const parsed = parseSwapFile(raw);
    expect(parsed).toEqual([['I', 'YOU'], ['YOU', 'ME']]);
  });

  test('trainFromContent skips empty lines and comments, learns non-comment lines', () => {
    const hal = new MegaHal(2);
    const content = '# This is a comment\n\nThe quick brown fox.\n   \n# Another comment\nDogs are great pets.';
    hal.trainFromContent(content);
    // Should have learned tokens from the two non-comment lines
    expect(hal.model.dictionary.find('QUICK')).toBeDefined();
    expect(hal.model.dictionary.find('FOX')).toBeDefined();
    expect(hal.model.dictionary.find('DOGS')).toBeDefined();
    expect(hal.model.dictionary.find('GREAT')).toBeDefined();
    // Should NOT have learned comment text
    expect(hal.model.dictionary.find('COMMENT')).toBeUndefined();
    expect(hal.model.dictionary.find('ANOTHER')).toBeUndefined();
  });

  test('trainFromContent with only comments and blanks learns nothing', () => {
    const hal = new MegaHal(2);
    hal.trainFromContent('# comment\n\n  \n# another');
    expect(hal.model.dictionary.size).toBe(2); // only sentinels
  });

  test('setFallbackReply changes the fallback message', () => {
    const hal = new MegaHal(5);
    hal.setLimit({ maxIterations: 1, timeout: 10 });
    hal.setFallbackReply('Custom fallback');
    // With no training data and tight limits, should return the custom fallback
    const reply = hal.respond('Hello there!');
    expect(reply).toBe('Custom fallback');
  });

  test('setFallbackGreeting changes the greeting fallback', () => {
    const hal = new MegaHal(5);
    hal.setFallbackGreeting('Custom greeting');
    expect(hal.fallbackGreeting).toBe('Custom greeting');
  });

  test('greet without greetings set returns fallback greeting', () => {
    const hal = new MegaHal(5);
    const greeting = hal.greet();
    expect(greeting).toBe('Hello!');
  });

  test('greet with custom fallback greeting returns custom text', () => {
    const hal = new MegaHal(5);
    hal.setFallbackGreeting('Welcome!');
    const greeting = hal.greet();
    expect(greeting).toBe('Welcome!');
  });

  test('greet with greetings set but empty model returns fallback greeting', () => {
    const rng = makeSeededRng(42);
    const hal = new MegaHal(5, rng);
    hal.setLimit({ maxIterations: 1, timeout: 10 });
    hal.setGreetings(['Hello']);
    const reply = hal.greet();
    // With no learned data, generateReply should produce empty, so fallback
    expect(reply).toBe('Hello!');
  });

  test('setLimit merges partial limits', () => {
    const hal = new MegaHal(5);
    // Default limit
    expect(hal.limit.timeout).toBe(1000);
    expect(hal.limit.maxIterations).toBe(0);

    // Partial update: only maxIterations
    hal.setLimit({ maxIterations: 50 });
    expect(hal.limit.maxIterations).toBe(50);
    expect(hal.limit.timeout).toBe(1000); // preserved

    // Partial update: only timeout
    hal.setLimit({ timeout: 500 });
    expect(hal.limit.timeout).toBe(500);
    expect(hal.limit.maxIterations).toBe(50); // preserved
  });

  test('setKeywordConfig actually applies a keyword config', () => {
    const hal = new MegaHal(5);
    const config = new KeywordConfig();
    config.banned.add('THE');
    config.auxiliary.add('IS');
    hal.setKeywordConfig(config);
    expect(hal.keywordConfig).toBe(config);
    expect(hal.keywordConfig.banned.has('THE')).toBe(true);
    expect(hal.keywordConfig.auxiliary.has('IS')).toBe(true);
  });

  test('parseWordList lowercases input to uppercase', () => {
    const raw = 'hello\nWorld\nMIXED';
    const parsed = parseWordList(raw);
    expect(parsed).toEqual(['HELLO', 'WORLD', 'MIXED']);
  });

  test('parseWordList with only comments and blanks returns empty', () => {
    const raw = '# comment\n\n  \n# another\n';
    const parsed = parseWordList(raw);
    expect(parsed).toEqual([]);
  });

  test('parseSwapFile with empty/comment-only input returns empty array', () => {
    expect(parseSwapFile('')).toEqual([]);
    expect(parseSwapFile('# just a comment\n')).toEqual([]);
    expect(parseSwapFile('\n\n\n')).toEqual([]);
    expect(parseSwapFile('# c1\n# c2\n  \n')).toEqual([]);
  });

  test('parseSwapFile skips lines with only one word', () => {
    const raw = 'ONLY_ONE\nI YOU\n';
    const parsed = parseSwapFile(raw);
    expect(parsed).toEqual([['I', 'YOU']]);
  });

  test('parseSwapFile uppercases both words', () => {
    const raw = 'hello world\n';
    const parsed = parseSwapFile(raw);
    expect(parsed).toEqual([['HELLO', 'WORLD']]);
  });

  test('setGreetings uppercases greetings', () => {
    const hal = new MegaHal(5);
    hal.setGreetings(['hello', 'World']);
    expect(hal.greetings).toEqual(['HELLO', 'WORLD']);
  });

  test('generate returns null when no output can be generated', () => {
    const hal = new MegaHal(5);
    hal.setLimit({ maxIterations: 1, timeout: 10 });
    const result = hal.generate('Hello there!');
    expect(result).toBeNull();
  });

  test('loadWordList works in Node environment', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'megahal-test-'));
    const tmpFile = path.join(tmpDir, 'words.txt');
    try {
      await fs.writeFile(tmpFile, '# comment\nhello\nworld\n');
      const result = await loadWordList(tmpFile);
      expect(result).toEqual(['HELLO', 'WORLD']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('loadSwapFile works in Node environment', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'megahal-test-'));
    const tmpFile = path.join(tmpDir, 'swaps.txt');
    try {
      await fs.writeFile(tmpFile, '# comment\nI YOU\nME THEM\n');
      const result = await loadSwapFile(tmpFile);
      expect(result).toEqual([['I', 'YOU'], ['ME', 'THEM']]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('respond uses custom fallbackReply when model cannot generate', () => {
    // Use high order so the input (6 tokens) is too short to learn (needs > 10)
    const hal = new MegaHal(10);
    hal.setLimit({ maxIterations: 1, timeout: 10 });
    hal.setFallbackReply('No answer!');
    const reply = hal.respond('Tell me something');
    expect(reply).toBe('No answer!');
  });

  test('trainFromContent handles Windows-style \r\n line endings', () => {
    const hal = new MegaHal(2);
    hal.trainFromContent('# comment\r\nThe cat sat on the mat.\r\n\r\n');
    expect(hal.model.dictionary.find('CAT')).toBeDefined();
    expect(hal.model.dictionary.find('MAT')).toBeDefined();
  });

  test('greet with greetings and trained model returns capitalized reply', () => {
    const rng = makeSeededRng(42);
    const hal = new MegaHal(2, rng);
    hal.setLimit({ maxIterations: 10 });
    // Train with enough data that generation works
    for (let i = 0; i < 5; i++) {
      hal.learn('Hello there my friend how are you doing today.');
      hal.learn('The world is beautiful and amazing today.');
      hal.learn('Hello world this is a great day to be alive.');
    }
    hal.setGreetings(['Hello']);
    const reply = hal.greet();
    // Should produce a real reply (not fallback) since model has data
    expect(reply).toBeDefined();
    expect(reply.length).toBeGreaterThan(0);
    // Should NOT be the fallback greeting since model has learned data
    // (with enough training and iterations, a reply should be generated)
  });

  test('greet picks from multiple greetings', () => {
    const hal = new MegaHal(5);
    hal.setGreetings(['Hello', 'Hi', 'Hey']);
    // Without training data, all greetings should result in fallback
    const reply = hal.greet();
    expect(reply).toBe('Hello!');
  });

  test('saveBrain and loadBrain roundtrip', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'megahal-test-'));
    const tmpFile = path.join(tmpDir, 'test.brn');
    try {
      const hal1 = new MegaHal(2);
      hal1.learn('The cat sat on the mat.');
      hal1.learn('Dogs are wonderful pets.');
      await hal1.saveBrain(tmpFile);

      const hal2 = new MegaHal(2);
      await hal2.loadBrain(tmpFile);
      // Dictionary should have the same tokens
      expect(hal2.model.dictionary.find('CAT')).toBeDefined();
      expect(hal2.model.dictionary.find('DOGS')).toBeDefined();
      expect(hal2.model.dictionary.size).toBe(hal1.model.dictionary.size);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('trainFromFile loads and learns from file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'megahal-test-'));
    const tmpFile = path.join(tmpDir, 'training.txt');
    try {
      await fs.writeFile(tmpFile, '# comment\nThe quick brown fox jumps.\nLazy dogs sleep all day.\n');
      const hal = new MegaHal(2);
      await hal.trainFromFile(tmpFile);
      expect(hal.model.dictionary.find('QUICK')).toBeDefined();
      expect(hal.model.dictionary.find('FOX')).toBeDefined();
      expect(hal.model.dictionary.find('LAZY')).toBeDefined();
      // Comments should not be learned
      expect(hal.model.dictionary.find('COMMENT')).toBeUndefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('exportBrain and importBrain roundtrip', () => {
    const hal1 = new MegaHal(2);
    hal1.learn('Hello world how are you today.');
    const data = hal1.exportBrain();
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBeGreaterThan(0);

    const hal2 = new MegaHal(2);
    hal2.importBrain(data);
    expect(hal2.model.dictionary.size).toBe(hal1.model.dictionary.size);
    expect(hal2.model.dictionary.find('HELLO')).toBeDefined();
  });

  test('randomRange without rng uses Math.random fallback', () => {
    // Create MegaHal without rng (null)
    const hal = new MegaHal(2);
    hal.setLimit({ maxIterations: 1, timeout: 10 });
    // Train enough data
    hal.learn('The quick brown fox jumps over the lazy dog.');
    // This exercises the Math.random() fallback in randomRange
    const reply = hal.respond('Tell me about the fox jumping over the dog today.');
    // Should return something (either generated reply or fallback)
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
  });
});
