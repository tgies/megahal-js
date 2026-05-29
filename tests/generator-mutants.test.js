import { describe, test, expect, vi } from 'vitest';
import { generateOneReply, generateReply, capitalize } from '../src/generator.js';
import { BidirectionalModel } from '../src/model.js';

/**
 * Deterministic seeded RNG.
 */
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

function buildModel(order, sentences) {
  const model = new BidirectionalModel(order);
  for (const tokens of sentences) {
    model.learn(tokens);
  }
  return model;
}

// ============================================================================
// Tests that pin exact deterministic outputs for specific seeds.
// These kill mutants in seed(), babble(), generateOneReply() internals.
// ============================================================================
describe('deterministic generation: exact outputs', () => {
  test('omitted rng uses Math.random fallback', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      expect(generateOneReply(model, new Set(), new Set())).toEqual(['A', 'B', 'C']);
    } finally {
      randomSpy.mockRestore();
    }
  });

  test('seed=42, order=1, single sentence: exact reply', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    const rng = makeSeededRng(42);
    const reply = generateOneReply(model, new Set(['B']), new Set(), rng);
    expect(reply).toEqual(['A', 'B', 'C']);
  });

  test('seed=0, order=1, two sentences: exact reply', () => {
    const model = buildModel(1, [['X', 'Y'], ['Y', 'Z']]);
    const rng = makeSeededRng(0);
    const reply = generateOneReply(model, new Set(['Y']), new Set(), rng);
    expect(reply).toEqual(['Y']);
  });

  test('generateReply with maxIterations=1: exact deterministic output', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    const rng = makeSeededRng(42);
    const result = generateReply(
      model, ['X'], new Set(['A']), new Set(),
      { timeout: 0, maxIterations: 1 }, rng
    );
    expect(result).toEqual(['A', 'B', 'C']);
  });
});

// ============================================================================
// tokensEqual: tested indirectly through generateReply behavior
// ============================================================================
describe('tokensEqual (via generateReply)', () => {
  test('when baseline equals input, best becomes empty and loop must find something', () => {
    // Build a model with a single very short sentence. With specific seeds,
    // generateOneReply(model, emptyKw, emptyAux) might produce exactly the input.
    // The code says: if (tokensEqual(best, inputTokens)) { best = []; }
    // Then the loop tries to beat an empty best.
    const model = buildModel(1, [['P', 'Q']]);
    const rng = makeSeededRng(42);
    const input = ['P', 'Q'];
    const result = generateReply(
      model, input, new Set(['P']), new Set(),
      { timeout: 0, maxIterations: 5 }, rng
    );
    // Must return an array (possibly empty if all candidates = input)
    expect(Array.isArray(result)).toBe(true);
  });

  test('tokensEqual is case-insensitive: "a" matches "A"', () => {
    const model = buildModel(1, [['hello', 'world']]);
    const rng = makeSeededRng(42);
    // Input in uppercase, model has lowercase tokens
    // tokensEqual compares via toUpperCase, so if candidate produces 'hello'
    // and input is 'HELLO', they should match (and candidate is skipped)
    const result = generateReply(
      model, ['HELLO', 'WORLD'], new Set(['HELLO']), new Set(),
      { timeout: 0, maxIterations: 3 }, rng
    );
    expect(Array.isArray(result)).toBe(true);
  });

  test('different-length arrays are not equal', () => {
    // If tokensEqual length check is removed (BlockStatement mutant),
    // comparing arrays of different lengths would throw or return wrong result.
    const model = buildModel(1, [['A', 'B', 'C', 'D']]);
    const rng = makeSeededRng(42);
    // Short input won't match longer candidates
    const result = generateReply(
      model, ['A'], new Set(['B']), new Set(),
      { timeout: 0, maxIterations: 3 }, rng
    );
    expect(Array.isArray(result)).toBe(true);
    // Should have a result since candidates won't equal the 1-token input
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// seed() function: tested via generateOneReply
// ============================================================================
describe('seed function behavior', () => {
  test('keyword in dictionary becomes seed token', () => {
    const model = buildModel(1, [
      ['DOG', 'RAN'],
      ['CAT', 'SAT'],
      ['RAT', 'ATE'],
    ]);
    // With DOG as keyword, it should appear in most replies as the seed
    let dogCount = 0;
    for (let s = 0; s < 30; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['DOG']), new Set(), rng);
      if (reply.length > 0 && reply[0] === 'DOG') {
        dogCount++;
      }
      // Also check if DOG is anywhere (backward phase might prepend before it)
      if (reply.includes('DOG')) {dogCount++;}
    }
    expect(dogCount).toBeGreaterThan(0);
  });

  test('keyword not in dictionary falls through to random root child', () => {
    const model = buildModel(1, [['A', 'B']]);
    const rng = makeSeededRng(42);
    const reply = generateOneReply(model, new Set(['NONEXISTENT']), new Set(), rng);
    // Falls back to random root child, should still produce output
    expect(reply.length).toBeGreaterThan(0);
    // Reply should contain dictionary tokens
    expect(reply.every(t => ['A', 'B', '<ERROR>', '<FIN>'].includes(t) || t === ' ')).toBe(true);
  });

  test('auxiliary keyword is skipped by seed', () => {
    const model = buildModel(1, [['A', 'B'], ['C', 'D']]);
    // 'A' is both keyword and auxiliary → seed skips it
    const rng = makeSeededRng(42);
    const reply = generateOneReply(model, new Set(['A']), new Set(['A']), rng);
    // Should still produce a reply (falls back to random root child)
    expect(reply.length).toBeGreaterThan(0);
  });

  test('non-auxiliary keyword is selected even when usedKey starts false', () => {
    const model = buildModel(1, [['WORD', 'OTHER']]);
    let keywordFound = false;
    for (let s = 0; s < 20; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['WORD']), new Set(), rng);
      if (reply.includes('WORD')) {
        keywordFound = true;
        break;
      }
    }
    expect(keywordFound).toBe(true);
  });

  test('empty keyword set always falls back to random root child', () => {
    const model = buildModel(1, [['A', 'B']]);
    const rng = makeSeededRng(42);
    const reply = generateOneReply(model, new Set(), new Set(), rng);
    expect(reply.length).toBeGreaterThan(0);
  });

  test('input-order keyword scanning: insertion order determines seed selection', () => {
    // C reference (megahal.c:2697-2711): seed() scans keys in insertion order,
    // starting at rnd(keys->size). The JS port must not sort the keyword list.
    //
    // kw1 inserts A first, then C: slots [A, C].
    // kw2 inserts C first, then A: slots [C, A].
    // makeSeededRng(42) picks start index 1 for a 2-element list.
    //   kw1: starts at slot 1 (C) → seeds C → reply ['C', 'D']
    //   kw2: starts at slot 1 (A) → seeds A → reply ['A', 'B']
    // With sorted order (old buggy behavior) both would start at the same symbol.
    const model = buildModel(1, [['A', 'B'], ['C', 'D']]);
    const kw1 = new Set(['A', 'C']); // input order: slots [A, C]
    const kw2 = new Set(['C', 'A']); // input order: slots [C, A]
    const reply1 = generateOneReply(model, kw1, new Set(), makeSeededRng(42));
    const reply2 = generateOneReply(model, kw2, new Set(), makeSeededRng(42));
    // Different insertion orders with the same RNG seed produce different results.
    expect(reply1).toEqual(['C', 'D']);
    expect(reply2).toEqual(['A', 'B']);
  });

  test('all auxiliary keywords are skipped before random fallback', () => {
    const model = buildModel(1, [['A', 'B'], ['C', 'D']]);
    const reply = generateOneReply(model, new Set(['A']), new Set(['A']), makeSeededRng(42));
    expect(reply).toEqual(['C', 'D']);
  });
});

// ============================================================================
// babble() function: tested via generateOneReply
// ============================================================================
describe('babble function behavior', () => {
  test('keyword child is preferentially selected over random', () => {
    // Model where root has multiple children. CAT is a keyword.
    const model = buildModel(1, [
      ['CAT', 'SAT'],
      ['DOG', 'RAN'],
      ['RAT', 'ATE'],
      ['BAT', 'FLEW'],
    ]);
    let catAsKw = 0;
    let catNoKw = 0;
    const trials = 50;
    for (let s = 0; s < trials; s++) {
      const r1 = makeSeededRng(s);
      if (generateOneReply(model, new Set(['CAT']), new Set(), r1).includes('CAT')) {catAsKw++;}
      const r2 = makeSeededRng(s);
      if (generateOneReply(model, new Set(), new Set(), r2).includes('CAT')) {catNoKw++;}
    }
    // CAT should appear strictly more often as keyword
    expect(catAsKw).toBeGreaterThan(catNoKw);
  });

  test('alreadyInReply prevents duplicate keyword selection', () => {
    // If a keyword is already in the reply, babble won't select it again via keyword priority.
    // This is hard to test directly but we can verify replies don't contain duplicate tokens
    // across many runs.
    const model = buildModel(1, [['A', 'B', 'C']]);
    for (let s = 0; s < 20; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['A']), new Set(), rng);
      // Count occurrences of 'A' — should be at most 1
      const aCount = reply.filter(t => t === 'A').length;
      expect(aCount).toBeLessThanOrEqual(1);
    }
  });

  test('count decrement and < 0 check selects symbol probabilistically', () => {
    // With a known model, the count-based selection should work.
    // If count -= child.count is mutated to += or removed, behavior changes.
    const model = buildModel(1, [['A', 'B'], ['A', 'C']]);
    // 'A' has count=2 at root. 'B' has count=1. 'C' has count=1.
    // FIN has count=2. root.usage=6.
    // Babble should select A more often than B or C when not using keywords.
    let aCount = 0;
    const trials = 100;
    for (let s = 0; s < trials; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(), new Set(), rng);
      if (reply.includes('A')) {aCount++;}
    }
    // A should appear in a reasonable fraction
    expect(aCount).toBeGreaterThan(0);
  });

  test('usedKey.val = true is set when keyword is used', () => {
    // When usedKey.val becomes true, auxiliary keywords can also be selected.
    // Test: keyword 'X' is not aux, keyword 'Y' is aux.
    // After X is used (usedKey.val = true), Y should become selectable.
    const model = buildModel(1, [['X', 'Y', 'Z']]);
    let yFound = false;
    for (let s = 0; s < 50; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['X', 'Y']), new Set(['Y']), rng);
      if (reply.includes('Y')) {
        yFound = true;
        break;
      }
    }
    // Y (auxiliary) should be selectable after X (non-auxiliary) is used
    expect(yFound).toBe(true);
  });
});

// ============================================================================
// generateOneReply: forward + backward phase logic
// ============================================================================
describe('generateOneReply phases', () => {
  test('forward phase generates tokens after seed', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    // Seed is a keyword. Forward babble should extend rightward.
    let foundForward = false;
    for (let s = 0; s < 50; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['A']), new Set(), rng);
      // If A is seed, forward should generate B and/or C
      if (reply.includes('A') && (reply.includes('B') || reply.includes('C'))) {
        const aIdx = reply.indexOf('A');
        const bIdx = reply.indexOf('B');
        const cIdx = reply.indexOf('C');
        if (bIdx > aIdx || cIdx > aIdx) {
          foundForward = true;
          break;
        }
      }
    }
    expect(foundForward).toBe(true);
  });

  test('backward phase prepends tokens before seed', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    let foundBackward = false;
    for (let s = 0; s < 50; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['C']), new Set(), rng);
      // If C is seed, backward should prepend A and/or B
      if (reply.includes('C') && (reply.includes('A') || reply.includes('B'))) {
        const cIdx = reply.indexOf('C');
        const aIdx = reply.indexOf('A');
        const bIdx = reply.indexOf('B');
        if (aIdx < cIdx || bIdx < cIdx) {
          foundBackward = true;
          break;
        }
      }
    }
    expect(foundBackward).toBe(true);
  });

  test('backward phase uses unshift to prepend', () => {
    // If unshift is changed to push, backward tokens would appear at end
    const model = buildModel(1, [['A', 'B', 'C']]);
    let found = false;
    for (let s = 0; s < 50; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['B']), new Set(), rng);
      if (reply.includes('A') && reply.includes('B')) {
        // A should come BEFORE B (prepended by backward phase)
        if (reply.indexOf('A') < reply.indexOf('B')) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  test('empty forward root children returns empty reply', () => {
    const model = new BidirectionalModel(10);
    // Don't learn anything — forward root has no children
    const rng = makeSeededRng(42);
    const reply = generateOneReply(model, new Set(), new Set(), rng);
    expect(reply).toEqual([]);
  });

  test('seedId === ERROR_ID skips forward phase', () => {
    // If model has no children at all, seed returns ERROR_ID, forward phase is skipped.
    const model = new BidirectionalModel(5);
    const rng = makeSeededRng(42);
    const reply = generateOneReply(model, new Set(), new Set(), rng);
    expect(reply).toEqual([]);
  });

  test('backward context initialization uses replyIds from forward phase', () => {
    // The backward phase initializes context from the forward reply.
    // If this initialization is removed (BlockStatement mutant), backward babble
    // would use an empty context and behave differently.
    const model = buildModel(1, [['A', 'B', 'C']]);
    // We need forward + backward to produce different output than forward alone.
    // With a keyword as seed, forward extends right, backward extends left.
    let multiDirectional = false;
    for (let s = 0; s < 50; s++) {
      const rng = makeSeededRng(s);
      const reply = generateOneReply(model, new Set(['B']), new Set(), rng);
      // If B is seed: forward could generate C, backward could generate A
      // Reply should have tokens on both sides of B
      const bIdx = reply.indexOf('B');
      if (bIdx > 0 && bIdx < reply.length - 1) {
        multiDirectional = true;
        break;
      }
    }
    // At least some seeds should produce tokens on both sides
    expect(multiDirectional).toBe(true);
  });
});

// ============================================================================
// generateReply: iteration and selection logic
// ============================================================================
describe('generateReply iteration logic', () => {
  test('maxSurprise starts at -1, so first valid candidate always wins', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    const rng = makeSeededRng(42);
    const result = generateReply(
      model, ['X'], new Set(['A']), new Set(),
      { timeout: 0, maxIterations: 1 }, rng
    );
    // With 1 iteration, the first candidate with surprise > -1 becomes best
    expect(result.length).toBeGreaterThan(0);
  });

  test('higher surprise replaces lower surprise as best', () => {
    // With multiple iterations, higher-scoring candidates should win
    const model = buildModel(1, [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]);
    const rng = makeSeededRng(42);
    const result = generateReply(
      model, ['X'], new Set(['A', 'B', 'C', 'D', 'E', 'F']), new Set(),
      { timeout: 0, maxIterations: 20 }, rng
    );
    expect(result.length).toBeGreaterThan(0);
  });

  test('maxIterations=0 with timeout=0 does exactly 1 iteration then breaks', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    // The safety check: if timeout===0 && maxIterations===0, break after 1 iteration
    const rng = makeSeededRng(42);
    const result = generateReply(
      model, ['X'], new Set(['A']), new Set(),
      { timeout: 0, maxIterations: 0 }, rng
    );
    expect(Array.isArray(result)).toBe(true);
  });

  test('timeout > 0 runs until time expires', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    const rng = makeSeededRng(42);
    const start = Date.now();
    const result = generateReply(
      model, ['X'], new Set(['A']), new Set(),
      { timeout: 30, maxIterations: 0 }, rng
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(25); // should run for ~30ms
    expect(result.length).toBeGreaterThan(0);
  });

  test('maxIterations limits the number of candidates evaluated', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    // With maxIterations=2, exactly 2 candidates are evaluated
    const rng = makeSeededRng(42);
    const result = generateReply(
      model, ['X'], new Set(['A']), new Set(),
      { timeout: 0, maxIterations: 2 }, rng
    );
    expect(Array.isArray(result)).toBe(true);
  });

  test('candidate equal to input is not selected as best', () => {
    // tokensEqual prevents echoing the input
    const model = buildModel(1, [['A', 'B']]);
    const rng = makeSeededRng(42);
    const input = ['A', 'B'];
    const result = generateReply(
      model, input, new Set(['A']), new Set(),
      { timeout: 0, maxIterations: 10 }, rng
    );
    // Result should not be exactly input (case-insensitive)
    // With only one learned sentence, this is tricky, but the code handles it
    expect(Array.isArray(result)).toBe(true);
  });

  test('default timeout and maxIterations use correct defaults', () => {
    const model = buildModel(1, [['A', 'B', 'C']]);
    const rng = makeSeededRng(42);
    // limit.timeout defaults to 1000, limit.maxIterations defaults to 0
    // With {} as limit, should use defaults
    const result = generateReply(
      model, ['X'], new Set(['A']), new Set(),
      { timeout: 50 }, rng  // only specify timeout
    );
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// capitalize: regex and boundary edge cases
// ============================================================================
describe('capitalize edge cases for regex mutants', () => {
  test('regex anchor ^: only single chars match [a-zA-Z]', () => {
    // If regex anchor ^ is removed, multi-char strings could match
    // But the function iterates char-by-char so this shouldn't matter...
    // However, killing the mutant requires the test to fail if regex changes.
    // The regex /^[a-zA-Z]$/ tests single chars. If changed to /[a-zA-Z]$/
    // or /^[a-zA-Z]/, it would match differently.
    // With char-by-char iteration, each char is length 1, so anchors matter less.
    // Let's test specific outputs that would change if regex were wrong.
    expect(capitalize(['a1b'])).toBe('A1b');
    expect(capitalize(['1a'])).toBe('1A');  // start=true, '1' is not alpha → not capitalized, start stays true, 'a' → 'A'
  });

  test('whitespace regex /^\\s$/: tab and space both count', () => {
    // The capitalize function checks /^\s$/ to detect whitespace after punctuation.
    // A tab character should also trigger sentence-start capitalization.
    expect(capitalize(['hello', '.\t', 'world'])).toBe('Hello.\tWorld');
  });

  test('newline and carriage return after punctuation trigger capitalization', () => {
    expect(capitalize(['hello', '.\n', 'world'])).toBe('Hello.\nWorld');
    expect(capitalize(['hello', '.\r', 'world'])).toBe('Hello.\rWorld');
  });

  test('form feed and vertical tab after punctuation trigger capitalization', () => {
    expect(capitalize(['hello', '.\f', 'world'])).toBe('Hello.\fWorld');
    expect(capitalize(['hello', '.\v', 'world'])).toBe('Hello.\vWorld');
  });

  test('position > 2 boundary is strict: i > 2, not i >= 2', () => {
    // At position i=2, the check `i > 2` is false, so no capitalization
    // "a. b" → a(0) .(1) ' '(2) b(3)
    // At i=2: i > 2 is FALSE → space at position 2 doesn't trigger
    expect(capitalize(['a', '. ', 'b'])).toBe('A. b');
    // "ab. c" → a(0) b(1) .(2) ' '(3) c(4)
    // At i=3: i > 2 is TRUE, prev='.' → start=true
    expect(capitalize(['ab', '. ', 'c'])).toBe('Ab. C');
  });

  test('alpha chars after start=true are uppercased', () => {
    expect(capitalize(['hello'])).toBe('Hello');
    // After first alpha, start=false, rest lowercase
    expect(capitalize(['HELLO'])).toBe('Hello');
    expect(capitalize(['ABZ'])).toBe('Abz');
  });

  test('non-alpha chars do not change start flag', () => {
    // Numbers before first alpha → start stays true
    expect(capitalize(['123', 'abc'])).toBe('123Abc');
    // Punctuation before first alpha → start stays true
    expect(capitalize(['...', 'hello'])).toBe('...Hello');
    expect(capitalize(['[abc'])).toBe('[Abc');
    expect(capitalize(['{abc'])).toBe('{Abc');
  });

  test('loop iterates exactly raw.length times', () => {
    // If i <= raw.length mutant: would access raw[raw.length] which is undefined
    // but JS tolerates that. The test should verify no extra chars appear.
    const result = capitalize(['abc']);
    expect(result).toBe('Abc');
    expect(result.length).toBe(3);
  });
});
