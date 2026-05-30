import { describe, test, expect, vi } from 'vitest';
import { MegaHal, parseWordList, parseSwapFile, KeywordConfig, loadWordList, loadSwapFile, tokenize, extractKeywords } from '../index.js';
import { generateReply } from '../src/generator.js';
import { BidirectionalModel } from '../src/model.js';

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

function withoutProcess(callback) {
  const originalProcess = globalThis.process;
  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: undefined
  });
  try {
    return callback();
  } finally {
    Object.defineProperty(globalThis, 'process', {
      configurable: true,
      value: originalProcess
    });
  }
}

describe('MegaHal Engine Integration', () => {
  test('new engine creates empty model with ERROR and FIN', () => {
    const hal = new MegaHal(5);
    expect(hal.model.dictionary.size).toBe(2);
    expect(hal.greetings).toEqual([]);
    expect(hal.limit).toEqual({ timeout: 1000, maxIterations: 0 });
    expect(hal.fallbackReply).toBe("I don't know enough to answer you yet!");
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

  test('generate returns generated text instead of null when a reply exists', () => {
    const hal = new MegaHal(2, makeSeededRng(42));
    hal.setLimit({ timeout: 0, maxIterations: 5 });
    hal.learn('The cat sat on the mat and watched birds outside.');

    expect(hal.generate('cat')).toBe(
      'The cat sat on the cat sat on the cat sat on the mat and watched birds outside.'
    );
  });

  test('respond returns generated text instead of fallback when a reply exists', () => {
    const hal = new MegaHal(2, makeSeededRng(42));
    hal.setLimit({ timeout: 0, maxIterations: 5 });
    hal.learn('The cat sat on the mat and watched birds outside.');

    expect(hal.respond('cat')).toBe(
      'The cat sat on the cat sat on the cat sat on the mat and watched birds outside.'
    );
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

  test('loadWordList refuses to run in a browser-like environment', async () => {
    globalThis.window = {};
    try {
      await expect(loadWordList('ignored')).rejects.toThrow(
        'loadWordList is only supported in Node.js environment'
      );
    } finally {
      delete globalThis.window;
    }
  });

  test('loadSwapFile refuses to run in a browser-like environment', async () => {
    globalThis.window = {};
    try {
      await expect(loadSwapFile('ignored')).rejects.toThrow(
        'loadSwapFile is only supported in Node.js environment'
      );
    } finally {
      delete globalThis.window;
    }
  });

  test('instance file helpers refuse to run in a browser-like environment', async () => {
    const hal = new MegaHal(2);
    globalThis.window = {};
    try {
      await expect(hal.saveBrain('ignored')).rejects.toThrow(
        'saveBrain is only supported in Node.js environment'
      );
      await expect(hal.loadBrain('ignored')).rejects.toThrow(
        'loadBrain is only supported in Node.js environment'
      );
      await expect(hal.trainFromFile('ignored')).rejects.toThrow(
        'trainFromFile is only supported in Node.js environment'
      );
    } finally {
      delete globalThis.window;
    }
  });

  test('file helpers refuse to run when process is absent', async () => {
    const hal = new MegaHal(2);
    const promises = withoutProcess(() => [
      loadWordList('ignored'),
      loadSwapFile('ignored'),
      hal.saveBrain('ignored'),
      hal.loadBrain('ignored'),
      hal.trainFromFile('ignored')
    ]);

    await expect(promises[0]).rejects.toThrow(
      'loadWordList is only supported in Node.js environment'
    );
    await expect(promises[1]).rejects.toThrow(
      'loadSwapFile is only supported in Node.js environment'
    );
    await expect(promises[2]).rejects.toThrow(
      'saveBrain is only supported in Node.js environment'
    );
    await expect(promises[3]).rejects.toThrow(
      'loadBrain is only supported in Node.js environment'
    );
    await expect(promises[4]).rejects.toThrow(
      'trainFromFile is only supported in Node.js environment'
    );
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
    expect(reply).toBe('Hello world is beautiful and amazing today.');
  });

  test('greet picks from multiple greetings', () => {
    const hal = new MegaHal(5);
    hal.setLimit({ timeout: 0, maxIterations: 1 });
    hal.setGreetings(['Hello', 'Hi', 'Hey']);
    // Without training data, all greetings should result in fallback
    const reply = hal.greet();
    expect(reply).toBe('Hello!');
  });

  test('greet uses injected rng for greeting selection', () => {
    const calls = [];
    const rng = {
      randomRange(min, max) {
        calls.push([min, max]);
        return 1;
      }
    };
    const hal = new MegaHal(5, rng);
    hal.setLimit({ timeout: 0, maxIterations: 1 });
    hal.setGreetings(['Hello', 'Hi', 'Hey']);

    expect(hal.greet()).toBe('Hello!');
    expect(calls).toEqual([[0, 3]]);
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
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    // Create MegaHal without rng (null)
    const hal = new MegaHal(2);
    hal.setLimit({ timeout: 0, maxIterations: 1 });
    hal.setGreetings(['Hello', 'Hi']);

    try {
      expect(hal.greet()).toBe('Hello!');
      expect(randomSpy).toHaveBeenCalledOnce();
    } finally {
      randomSpy.mockRestore();
    }
  });

  // ============================================================================
  // Issue #12: greet() anti-echo and keyword extraction fidelity
  // ============================================================================

  test('greet anti-echo: reply identical to tokenized greeting is rejected', () => {
    // C reference: generate_reply() calls dissimilar(greets, reply); a reply
    // token-for-token identical to the greeting input is rejected.
    // With order=1 and a model learned only on 'Hello.', the only possible reply
    // is ['HELLO', '.']. greet() tokenizes its greeting word into inputTokens, so
    // that candidate equals inputTokens, is rejected, and greet() falls back to the
    // fallback greeting.

    // Part 1: verify the underlying generateReply anti-echo behavior.
    const model = new BidirectionalModel(1);
    model.learn(['HELLO', '.']);

    const greetTokens = tokenize('Hello');      // ['HELLO', '.']
    const config = new KeywordConfig();
    const keywords = extractKeywords(greetTokens, model.dictionary, config);
    // HELLO is in the dict and not banned/aux, so it should be a keyword.
    expect(keywords.has('HELLO')).toBe(true);

    // inputTokens=[] leaves the candidate ['HELLO','.'] unequal to [], so it passes
    // the anti-echo gate and becomes the reply.
    const rng0 = makeSeededRng(0);
    const emptyInputResult = generateReply(
      model, [], keywords, new Set(), { timeout: 0, maxIterations: 1 }, rng0
    );
    expect(emptyInputResult).toEqual(['HELLO', '.']);

    // inputTokens = greetTokens makes ['HELLO','.'] equal to greetTokens, so it is
    // rejected and the reply is empty.
    const rng0b = makeSeededRng(0);
    const greetInputResult = generateReply(
      model, greetTokens, keywords, new Set(), { timeout: 0, maxIterations: 1 }, rng0b
    );
    expect(greetInputResult).toEqual([]);

    // Part 2: greet() falls back when all candidates are anti-echoed. With a
    // single-sentence model ('Hello.') and 'Hello' as the greeting, every candidate
    // is ['HELLO', '.'], which equals tokenize('Hello'), so greet() returns the
    // fallback greeting instead of the greeting word.
    const hal = new MegaHal(1, makeSeededRng(0));
    hal.setFallbackGreeting('Hello!');
    hal.setLimit({ timeout: 0, maxIterations: 1 });
    hal.learn('Hello.');
    hal.setGreetings(['Hello']);

    const greetReply = hal.greet();
    expect(greetReply).toBe('Hello!');
  });

  test('greet: greeting word not in model dictionary is not forced as keyword', () => {
    // C reference: make_keywords runs add_key() which skips words not in model
    // dictionary (megahal.c:2325-2326). A greeting word absent from the model
    // must not be injected as a keyword.
    const model2 = new BidirectionalModel(2);
    // Train on sentences that do NOT include 'AHOY'
    model2.learn(['THE', ' ', 'CAT', ' ', 'SAT', ' ', 'TODAY', '.']);

    const greetTokens2 = tokenize('Ahoy');   // ['AHOY', '.']
    const config2 = new KeywordConfig();
    const keywords2 = extractKeywords(greetTokens2, model2.dictionary, config2);

    // 'AHOY' is not in the model dictionary, so extractKeywords must not include it.
    expect(keywords2.has('AHOY')).toBe(false);
    expect(keywords2.size).toBe(0);
  });

  test('greet: banned greeting word is excluded from keywords via extractKeywords', () => {
    // C reference: add_key() skips banned words (megahal.c:2328-2330).
    const model3 = new BidirectionalModel(2);
    model3.learn(['HELLO', ' ', 'THERE', ' ', 'TODAY', '.']);

    const greetTokens3 = tokenize('Hello');
    const config3 = new KeywordConfig();
    config3.banned.add('HELLO');

    const keywords3 = extractKeywords(greetTokens3, model3.dictionary, config3);
    // 'HELLO' is in the model but banned, so extractKeywords must exclude it.
    expect(keywords3.has('HELLO')).toBe(false);
  });
});
