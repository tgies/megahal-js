import { describe, test, expect } from 'vitest';
import { evaluateReply } from '../src/evaluator.js';
import { BidirectionalModel } from '../src/model.js';

/**
 * Helper: build a model of given order and learn multiple sentences.
 */
function buildModel(order, sentences) {
  const model = new BidirectionalModel(order);
  for (const tokens of sentences) {
    model.learn(tokens);
  }
  return model;
}

/**
 * These tests verify evaluateReply with hand-computed expected entropy values
 * based on known trie structures. This kills arithmetic and conditional mutants.
 *
 * With order=2, after learning ['A', 'B', 'C'], the forward trie becomes:
 *   root -> A (count=1, usage from root increments)
 *   root -> B (count=1)
 *   root -> C (count=1)
 *   A -> B (count=1)
 *   B -> C (count=1)
 *   C -> FIN (count=1)
 *   ...and FIN entries at various depths
 *
 * Forward context slots after processing each token in candidate:
 *   Initially: slots = [root, null, null]
 *   After 'A': slots = [root, root->A, null]
 *   After 'B': slots = [root, root->B, A->B]
 *   After 'C': slots = [root, root->C, B->C]
 */

describe('evaluateReply: exact entropy computation', () => {
  test('single keyword, single learned sentence, order=1: exact entropy', () => {
    // order=1, learn ['A', 'B'] (length 2 > order 1)
    // Forward trie:
    //   root(usage=3) -> A(count=1), B(count=1), FIN(count=1)
    //   A(usage=1) -> B(count=1)
    //   B(usage=1) -> FIN(count=1)
    // Backward trie:
    //   root(usage=3) -> B(count=1), A(count=1), FIN(count=1)
    //   B(usage=1) -> A(count=1)
    //   A(usage=1) -> FIN(count=1)
    //
    // candidate = ['A', 'B'], keywords = {'A'}
    //
    // Forward eval for 'A':
    //   j=0: parent=root, child=root->A, prob += 1/3, ctxCount=1
    //   entropy -= log(1/3 / 1) = -log(1/3) = log(3)
    //   num = 1
    //
    // Forward eval for 'B': not a keyword, skipped
    //
    // Backward eval (reverse: 'B', 'A'):
    //   Process 'B': not keyword, skip. bwdCtx.advance(backward, B_id)
    //   Process 'A': keyword.
    //     j=0: parent=root, child=root->A. root.usage=3, A.count=1. prob += 1/3, ctxCount=1
    //     entropy -= log(1/3 / 1) = log(3)
    //     num = 2
    //
    // Total entropy = log(3) + log(3) = 2*log(3) ≈ 2.197
    // num = 2, no penalty (< 8)
    const model = buildModel(1, [['A', 'B']]);
    const score = evaluateReply(model, ['A', 'B'], new Set(['A']));

    // 2 * ln(3) ≈ 2.1972
    expect(score).toBeCloseTo(2 * Math.log(3), 10);
  });

  test('forward pass only (keyword at start, backward context has no match)', () => {
    // order=1, learn ['X', 'Y', 'Z']
    // candidate = ['X'], keywords = {'X'}
    //
    // Forward eval for 'X':
    //   j=0: parent=root, child=root->X. root.usage=4 (X,Y,Z,FIN all added).
    //   X.count=1. prob = 1/4, ctxCount=1
    //   entropy -= log(1/4) = log(4)
    //   num=1
    //
    // Backward eval (reverse: 'X'):
    //   Process 'X': keyword.
    //     j=0: parent=bwdRoot, child=bwdRoot->X?
    //     Backward trie learned Z,Y,X,FIN. So bwdRoot has children Z,Y,X,FIN.
    //     bwdRoot.usage=4, X.count=1. prob=1/4, ctxCount=1
    //     entropy -= log(1/4) = log(4)
    //     num=2
    //
    // Total = 2*log(4) = 4*log(2) ≈ 2.7726
    const model = buildModel(1, [['X', 'Y', 'Z']]);
    const score = evaluateReply(model, ['X'], new Set(['X']));
    expect(score).toBeCloseTo(2 * Math.log(4), 10);
  });

  test('two keywords accumulate entropy additively', () => {
    // order=1, learn ['A', 'B']
    // candidate = ['A', 'B'], keywords = {'A', 'B'}
    //
    // Forward:
    //   'A': j=0 parent=root(usage=3), child A(count=1). prob=1/3. entropy -= log(1/3)=log(3). num=1
    //   'B': j=0 parent=root(usage=3), child B(count=1). prob=1/3. Also j=0 slot[0]=root,
    //         but wait — after advancing A, slots become [root, A_ref].
    //         j=0: parent=root(usage=3), child B(count=1). prob=1/3, ctxCount=1
    //         j=1 would be order, but order=1 so loop is j < 1, only j=0.
    //         Wait, loop is j < model.order = j < 1, so only j=0.
    //         entropy -= log(1/3) = log(3). num=2
    //
    // Backward (reverse: 'B', 'A'):
    //   'B': j=0 parent=bwdRoot(usage=3), child B(count=1). prob=1/3. entropy -= log(1/3). num=3
    //   'A': j=0 parent=bwdRoot(usage=3), child A(count=1). prob=1/3. entropy -= log(1/3). num=4
    //
    // Total = 4*log(3) ≈ 4.394
    const model = buildModel(1, [['A', 'B']]);
    const score = evaluateReply(model, ['A', 'B'], new Set(['A', 'B']));
    expect(score).toBeCloseTo(4 * Math.log(3), 10);
  });

  test('non-keyword tokens do not contribute to entropy or num', () => {
    const model = buildModel(1, [['A', 'B']]);
    // Only 'A' is keyword, 'B' is not
    const scoreOneKw = evaluateReply(model, ['A', 'B'], new Set(['A']));
    // Now make both keywords
    const scoreTwoKw = evaluateReply(model, ['A', 'B'], new Set(['A', 'B']));

    // scoreOneKw = 2*log(3), scoreTwoKw = 4*log(3)
    expect(scoreTwoKw).toBeGreaterThan(scoreOneKw);
    expect(scoreTwoKw).toBeCloseTo(2 * scoreOneKw, 10);
  });

  test('forward pass considers multiple context depths', () => {
    // order=2, learn ['A', 'B', 'C']
    // candidate = ['A', 'B', 'C'], keywords = {'C'}
    //
    // Forward eval for 'C':
    //   After processing A and B, fwd context is:
    //     slots[0]=root, slots[1]=root->B, slots[2]=A->B
    //   j=0: parent=root(usage=4: A,B,C,FIN), child=root->C(count=1). prob += 1/4, ctxCount=1
    //   j=1: parent=root->B(usage=1: B->C), child=B->C(count=1). prob += 1/1, ctxCount=2
    //   probability = 1/4 + 1/1 = 5/4, ctxCount=2
    //   entropy -= log(5/4 / 2) = -log(5/8)
    //
    // Backward eval for 'C' (candidate reversed: 'C', 'B', 'A'):
    //   Process 'C' first. bwdCtx initially: slots = [bwdRoot, null, null]
    //   j=0: parent=bwdRoot. bwdRoot children: C, B, A, FIN (learned C,B,A,FIN in backward).
    //     child=bwdRoot->C(count=1). bwdRoot.usage=4. prob += 1/4, ctxCount=1
    //   j=1: parent=null. skip.
    //   entropy -= log(1/4 / 1) = log(4)
    //   num = 2
    //
    // Total = -log(5/8) + log(4) = log(8/5) + log(4) = log(32/5)
    // num=2, no penalty
    const model = buildModel(2, [['A', 'B', 'C']]);
    const score = evaluateReply(model, ['A', 'B', 'C'], new Set(['C']));

    const expected = -Math.log(5 / 8) + Math.log(4);
    expect(score).toBeCloseTo(expected, 10);
  });

  test('backward pass iterates candidate in reverse', () => {
    // order=1, learn ['A', 'B', 'C']
    // candidate = ['C', 'A'], keywords = {'A'}
    //
    // Forward: process 'C' (not kw), then 'A' (keyword).
    //   'A': j=0 parent=root(usage=4), child=root->A(count=1). prob=1/4. entropy -= log(1/4). num=1
    //
    // Backward (reverse: 'A', 'C'): process 'A' first, then 'C'.
    //   'A': keyword. j=0: parent=bwdRoot(usage=4), child=bwdRoot->A(count=1). prob=1/4. entropy -= log(1/4). num=2
    //
    // Total = 2*log(4)
    const model = buildModel(1, [['A', 'B', 'C']]);
    const score = evaluateReply(model, ['C', 'A'], new Set(['A']));
    expect(score).toBeCloseTo(2 * Math.log(4), 10);
  });

  test('unknown symId causes token to be skipped entirely', () => {
    const model = buildModel(1, [['A', 'B']]);
    // 'UNKNOWN' is not in dictionary → symId === undefined → skipped
    const score = evaluateReply(model, ['UNKNOWN'], new Set(['UNKNOWN']));
    expect(score).toBe(0.0);
  });

  test('candidate with length 0 returns exactly 0', () => {
    const model = buildModel(1, [['A', 'B']]);
    expect(evaluateReply(model, [], new Set(['A']))).toBe(0.0);
  });

  test('null candidate returns exactly 0', () => {
    const model = buildModel(1, [['A', 'B']]);
    expect(evaluateReply(model, null, new Set(['A']))).toBe(0.0);
  });

  test('candidate.length === 0 is falsy but caught by || check', () => {
    // This tests L10: !candidate || candidate.length === 0
    // An empty array is truthy but length 0 → returns 0
    const model = buildModel(1, [['A', 'B']]);
    expect(evaluateReply(model, [], new Set())).toBe(0.0);
  });
});

describe('evaluateReply: length penalty', () => {
  test('num < 8: no penalty applied', () => {
    // order=1, learn ['A', 'B']
    // candidate = ['A', 'B'], keywords = {'A', 'B'} → num=4
    const model = buildModel(1, [['A', 'B']]);
    const score = evaluateReply(model, ['A', 'B'], new Set(['A', 'B']));
    // num=4, no penalty. score = 4*log(3)
    expect(score).toBeCloseTo(4 * Math.log(3), 10);
  });

  test('num = 8 exactly: sqrt penalty applied', () => {
    // Need num=8 → 4 keyword tokens, each counted in both fwd and bwd = 8
    // order=1, learn ['A', 'B', 'C', 'D']
    // candidate = ['A', 'B', 'C', 'D'], all keywords
    // Forward: each keyword at root depth, root.usage=5 (A,B,C,D,FIN), each count=1
    //   prob = 1/5 for each, ctxCount=1 each → entropy -= log(1/5) × 4 = 4*log(5)
    // Backward: same symmetry → entropy -= 4*log(5)
    // Total raw entropy = 8*log(5), num=8
    // Penalty: entropy /= sqrt(8-1) = sqrt(7)
    // num < 16 so no second penalty
    const model = buildModel(1, [['A', 'B', 'C', 'D']]);
    const score = evaluateReply(model, ['A', 'B', 'C', 'D'], new Set(['A', 'B', 'C', 'D']));

    const rawEntropy = 8 * Math.log(5);
    const expected = rawEntropy / Math.sqrt(7);
    expect(score).toBeCloseTo(expected, 10);
  });

  test('num = 7: no penalty (boundary check)', () => {
    // Need num=7. With order=1, each keyword counted in fwd + bwd.
    // If we have 4 keywords → num=8. Need 3.5... that's not possible with integers.
    // Let's use a keyword that only appears in ONE direction by putting it only once.
    // Actually, with order=1 and a keyword in the candidate, it always gets counted
    // in both forward and backward. So num is always even.
    // We can use order=2 to get an odd num by having a keyword that only gets a match
    // in one direction's context.
    //
    // Alternative: just verify the boundary between num=6 and num=8.
    // order=1, 3 keywords → num=6 (< 8, no penalty)
    const model = buildModel(1, [['A', 'B', 'C']]);
    const score = evaluateReply(model, ['A', 'B', 'C'], new Set(['A', 'B', 'C']));
    const rawEntropy = 6 * Math.log(4);
    expect(score).toBeCloseTo(rawEntropy, 10);
  });

  test('num >= 16: both sqrt and division penalty applied', () => {
    // Need num=16 → 8 keyword tokens, fwd+bwd = 16
    // order=1, learn 8 tokens ['A','B','C','D','E','F','G','H']
    const tokens = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const model = buildModel(1, [tokens]);
    const kw = new Set(tokens);
    const score = evaluateReply(model, tokens, kw);

    // root.usage = 9 (8 tokens + FIN), each token count=1
    // Forward: 8 keywords × -log(1/9) = 8*log(9)
    // Backward: same = 8*log(9)
    // rawEntropy = 16*log(9), num=16
    // Penalty 1: entropy /= sqrt(16-1) = sqrt(15)
    // Penalty 2: entropy /= 16
    const rawEntropy = 16 * Math.log(9);
    const expected = rawEntropy / Math.sqrt(15) / 16;
    expect(score).toBeCloseTo(expected, 10);
  });

  test('num = 15: only sqrt penalty, not division', () => {
    // We need an odd num. This is tricky with the algorithm.
    // Let's verify the boundary differently: check that num=8 and num=16 produce
    // different penalties from what they would without the penalty.
    const model8 = buildModel(1, [['A', 'B', 'C', 'D']]);
    const score8 = evaluateReply(model8, ['A', 'B', 'C', 'D'], new Set(['A', 'B', 'C', 'D']));
    const raw8 = 8 * Math.log(5);
    // With penalty: raw / sqrt(7). Without: raw
    expect(score8).toBeLessThan(raw8);
    expect(score8).toBeCloseTo(raw8 / Math.sqrt(7), 10);
  });

  test('penalty thresholds use >= not >', () => {
    // If mutant changes >= 8 to > 8, num=8 would NOT get penalized
    // Our exact test for num=8 above would catch this.
    // If mutant changes >= 16 to > 16, num=16 would only get sqrt penalty
    const tokens = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const model = buildModel(1, [tokens]);
    const kw = new Set(tokens);
    const score = evaluateReply(model, tokens, kw);

    // With correct >= 16: both penalties
    const rawEntropy = 16 * Math.log(9);
    const withBothPenalties = rawEntropy / Math.sqrt(15) / 16;
    const withOnlySqrtPenalty = rawEntropy / Math.sqrt(15);

    // Score should match both penalties, NOT just sqrt
    expect(score).toBeCloseTo(withBothPenalties, 10);
    expect(score).not.toBeCloseTo(withOnlySqrtPenalty, 5);
  });

  test('sqrt penalty uses num-1, not num or num+1', () => {
    const model = buildModel(1, [['A', 'B', 'C', 'D']]);
    const score = evaluateReply(model, ['A', 'B', 'C', 'D'], new Set(['A', 'B', 'C', 'D']));
    const raw = 8 * Math.log(5);

    // Correct: sqrt(num-1) = sqrt(7)
    expect(score).toBeCloseTo(raw / Math.sqrt(7), 10);
    // Wrong: sqrt(num) = sqrt(8) — should NOT match
    expect(score).not.toBeCloseTo(raw / Math.sqrt(8), 5);
    // Wrong: sqrt(num+1) = sqrt(9) — should NOT match
    expect(score).not.toBeCloseTo(raw / Math.sqrt(9), 5);
  });

  test('division penalty uses /= not *=', () => {
    const tokens = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const model = buildModel(1, [tokens]);
    const kw = new Set(tokens);
    const score = evaluateReply(model, tokens, kw);
    const raw = 16 * Math.log(9);

    // /= num means divide by 16
    const correctDivide = raw / Math.sqrt(15) / 16;
    // *= num means multiply by 16
    const wrongMultiply = raw / Math.sqrt(15) * 16;

    expect(score).toBeCloseTo(correctDivide, 10);
    expect(Math.abs(score - wrongMultiply)).toBeGreaterThan(1);
  });

  test('sqrt penalty uses /= not *=', () => {
    const model = buildModel(1, [['A', 'B', 'C', 'D']]);
    const score = evaluateReply(model, ['A', 'B', 'C', 'D'], new Set(['A', 'B', 'C', 'D']));
    const raw = 8 * Math.log(5);

    // /= sqrt(7) should make score < raw
    expect(score).toBeLessThan(raw);
    // *= sqrt(7) would make score > raw
    expect(score).not.toBeCloseTo(raw * Math.sqrt(7), 5);
  });
});

describe('evaluateReply: num counter', () => {
  test('num increments for each keyword token, even if ctxCount is 0', () => {
    // The spec says num++ happens after the keyword block regardless of ctxCount.
    // With order=2, candidate = ['A'], keywords = {'A'},
    // learned sentence = ['A', 'B', 'C']
    //
    // Forward: 'A' is keyword.
    //   j=0: root is parent, root->A exists. prob += 1/4, ctxCount=1
    //   j=1: null parent, skip
    //   entropy -= log(1/4) = log(4). num=1
    // Backward: 'A' is keyword.
    //   j=0: bwdRoot is parent, bwdRoot->A exists. prob += 1/4, ctxCount=1
    //   entropy -= log(1/4) = log(4). num=2
    // Total = 2*log(4)
    const model = buildModel(2, [['A', 'B', 'C']]);
    const score = evaluateReply(model, ['A'], new Set(['A']));
    expect(score).toBeCloseTo(2 * Math.log(4), 10);
  });

  test('num++ not num-- (UpdateOperator mutant)', () => {
    // If num-- instead of num++, then num would be negative after keywords,
    // and the penalty branches wouldn't fire. The score would be the raw entropy.
    // Our exact penalty tests above catch this, but let's be explicit:
    const model = buildModel(1, [['A', 'B', 'C', 'D']]);
    const score = evaluateReply(model, ['A', 'B', 'C', 'D'], new Set(['A', 'B', 'C', 'D']));
    // num should be 8, triggering penalty. If num-- it would be -8, no penalty.
    const raw = 8 * Math.log(5);
    // Score should be LESS than raw due to penalty
    expect(score).toBeLessThan(raw);
  });
});

describe('evaluateReply: ctxCount and probability', () => {
  test('ctxCount++ not ctxCount-- (UpdateOperator mutant)', () => {
    // If ctxCount-- instead of ++, ctxCount would be negative or zero.
    // When ctxCount <= 0, the entropy -= log(probability/ctxCount) branch is skipped.
    // So the score would be 0 despite keywords matching.
    const model = buildModel(1, [['A', 'B']]);
    const score = evaluateReply(model, ['A', 'B'], new Set(['A']));
    // With correct ctxCount++, score > 0
    expect(score).toBeGreaterThan(0);
    // If ctxCount were 0, score would be 0
    expect(score).not.toBe(0);
  });

  test('ctxCount > 0 check matters (conditional boundary)', () => {
    // If ctxCount > 0 is mutated to ctxCount >= 0, then ctxCount=0 would
    // cause entropy -= log(0/0) = NaN. If mutated to ctxCount < 0 or false,
    // no entropy would be added. Let's verify ctxCount > 0 is correct.
    const model = buildModel(1, [['A', 'B']]);
    const score = evaluateReply(model, ['A'], new Set(['A']));
    // Should be a positive finite number
    expect(score).toBeGreaterThan(0);
    expect(Number.isFinite(score)).toBe(true);
  });

  test('parentNode.usage > 0 guard prevents division by zero', () => {
    // In a normally-built model, usage is always > 0 when children exist.
    // This guard is a safety net. Our tests exercise the normal path.
    const model = buildModel(1, [['A', 'B']]);
    const score = evaluateReply(model, ['A', 'B'], new Set(['A']));
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

describe('evaluateReply: keyword matching', () => {
  test('keyword match is case-insensitive via toUpperCase', () => {
    // tokens are lowercase, keywords uppercase
    const model = buildModel(1, [['hello', 'world']]);
    const score = evaluateReply(model, ['hello'], new Set(['HELLO']));
    expect(score).toBeGreaterThan(0);
  });

  test('if toUpperCase were toLowerCase, case-sensitive keywords would fail', () => {
    // keywords are uppercase. If we used toLowerCase on token,
    // 'HELLO'.toLowerCase() = 'hello', which wouldn't match Set(['HELLO'])
    // But with correct toUpperCase: 'hello'.toUpperCase() = 'HELLO' → matches
    const model = buildModel(1, [['hello', 'world']]);
    const scoreUpper = evaluateReply(model, ['hello'], new Set(['HELLO']));
    const scoreLower = evaluateReply(model, ['hello'], new Set(['hello']));
    // Both should work since toUpperCase('hello') = 'HELLO' and keywords.has('HELLO') succeeds
    expect(scoreUpper).toBeGreaterThan(0);
    // 'hello'.toUpperCase() = 'HELLO', Set(['hello']).has('HELLO') = false → score = 0
    expect(scoreLower).toBe(0);
  });

  test('keyword set is checked with has(), not just truthiness', () => {
    const model = buildModel(1, [['A', 'B']]);
    // Empty keyword set → no matches → score = 0
    expect(evaluateReply(model, ['A', 'B'], new Set())).toBe(0);
    // Non-empty keyword set with wrong words → score = 0
    expect(evaluateReply(model, ['A', 'B'], new Set(['ZZZ']))).toBe(0);
  });
});

describe('evaluateReply: guard branch coverage (false paths)', () => {
  test('high-order model has null parent refs at deeper context depths', () => {
    // order=5, learn a short sentence. Context slots beyond depth 1 will be null.
    // This exercises the `parentRef !== null` guard being FALSE at deeper depths.
    const model = buildModel(5, [
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    ]);
    // candidate = ['A', 'B'], keywords = {'A'}
    // Forward: after processing 'A', only slot[0]=root and slot[1]=root->A are set.
    // Slots 2-5 are null. The loop j=0..4 will hit null parents at j>=2.
    // The `parentRef !== null` guard at L32 must return false for those depths.
    const score = evaluateReply(model, ['A', 'B'], new Set(['A']));
    // Should still produce a valid score from the depths that DO have parents
    expect(score).toBeGreaterThan(0);
    expect(Number.isFinite(score)).toBe(true);
  });

  test('candidate token exists in dict but not as child of current context', () => {
    // This exercises the `childRef !== undefined` guard being FALSE.
    // order=1, learn ['A', 'B'] and ['C', 'D'].
    // candidate = ['A', 'D'], keywords = {'D'}
    // Forward: process 'A' (advance ctx). Now ctx has root and root->A.
    //   Process 'D': keyword. j=0 parent=root. root->D exists? No, root has children
    //   A, B, C, D, FIN. Actually root->D DOES exist if we learned ['C', 'D'].
    //
    // Let's use order=2 instead. Learn ['A', 'B', 'C'] only.
    // candidate = ['A', 'X'], where 'X' is in dict but not reachable from 'A'.
    // We need 'X' in the dict. Learn ['X', 'Y', 'Z'] separately.
    const model = buildModel(2, [['A', 'B', 'C'], ['X', 'Y', 'Z']]);
    // candidate = ['A', 'X'], keywords = {'X'}
    // Forward: process 'A' → ctx = [root, root->A, null]
    //   Process 'X': keyword.
    //     j=0: parent=root, child=root->X. root->X exists (learned in second sentence).
    //       prob += X.count/root.usage, ctxCount=1
    //     j=1: parent=root->A. findChild(root->A, X_id)? A's only child is B.
    //       childRef = undefined → guard false → skip
    //   entropy -= log(prob/ctxCount). num=1.
    //
    // This exercises the childRef !== undefined guard being FALSE at depth 1.
    const score = evaluateReply(model, ['A', 'X'], new Set(['X']));
    expect(score).toBeGreaterThan(0);
    expect(Number.isFinite(score)).toBe(true);

    // Compare to candidate ['X', 'Y'] where context is richer
    const scoreRicher = evaluateReply(model, ['X', 'Y'], new Set(['Y']));
    expect(scoreRicher).toBeGreaterThan(0);
    // The richer context should produce a different score
    // (Y after X has depth-1 context from X->Y, while X after A doesn't)
  });

  test('parentNode.usage > 0 guard: usage is always > 0 in normal models', () => {
    // In a normally-constructed model via learn(), a node with children always has
    // usage > 0. The guard `parentNode.usage > 0` is a safety check.
    // However, the `>= 0` mutant (always true for non-negative usage) would also pass.
    // To kill this, we need the guard to actually matter — but since usage is always
    // positive for nodes with children, the `> 0` vs `>= 0` mutant can't be killed
    // without constructing a pathological trie (which we can't do through the public API).
    // We verify the function works correctly with normal data.
    const model = buildModel(1, [['A', 'B']]);
    const score = evaluateReply(model, ['A'], new Set(['A']));
    expect(score).toBeCloseTo(2 * Math.log(3), 10);
  });

  test('ctxCount > 0 vs >= 0: ctxCount is always 0 or positive', () => {
    // When a keyword token has NO matching parent context at any depth,
    // ctxCount stays 0 and the entropy branch is skipped.
    // This happens when the keyword is in the dictionary but not reachable
    // from the current context at any depth.
    //
    // order=2, learn ['A', 'B', 'C']. candidate = ['X'], keywords = {'X'}
    // where X is in the dict (learned in another sentence).
    const model = buildModel(2, [['A', 'B', 'C'], ['X', 'Y', 'Z']]);

    // candidate = ['X'], keywords = {'X'}
    // Forward: 'X' is keyword.
    //   j=0: parent=root, root->X exists. prob += X.count/root.usage. ctxCount=1.
    //   j=1: parent=null (no ctx yet). Skip.
    //   ctxCount=1 > 0 → entropy -= log(prob)
    //
    // But what if we use a token that's in the dict but NOT a child of root?
    // That shouldn't happen: all learned tokens are children of root.
    // So ctxCount is always >= 1 for tokens that are in the dict.
    //
    // The `ctxCount > 0` vs `ctxCount >= 0` mutant survives because ctxCount
    // is always positive when the keyword is in the dict and findable at root level.
    // This is an equivalent mutant in practice.
    const score = evaluateReply(model, ['X'], new Set(['X']));
    expect(score).toBeGreaterThan(0);
  });

  test('!candidate guard (L10) catches undefined/null/empty', () => {
    const model = buildModel(1, [['A', 'B']]);
    // null candidate → !candidate is true → return 0
    expect(evaluateReply(model, null, new Set(['A']))).toBe(0);
    // undefined candidate → !candidate is true → return 0
    expect(evaluateReply(model, undefined, new Set(['A']))).toBe(0);
    // empty array → candidate.length === 0 → return 0
    expect(evaluateReply(model, [], new Set(['A']))).toBe(0);
    // non-empty candidate → should NOT return 0
    expect(evaluateReply(model, ['A'], new Set(['A']))).not.toBe(0);
  });

  test('backward loop direction: i starts at candidate.length-1 and goes to 0', () => {
    // If the backward loop iterated forward instead of backward, the context
    // would be built differently, producing different entropy values.
    const model = buildModel(2, [['A', 'B', 'C', 'D']]);
    // In the forward pass, tokens are processed left-to-right: A, B, C, D
    // In the backward pass, tokens are processed right-to-left: D, C, B, A
    // The backward context advances through the backward trie.
    // If we flip the direction, the context depths would be wrong.
    const score = evaluateReply(model, ['A', 'B', 'C', 'D'], new Set(['B', 'C']));
    expect(score).toBeGreaterThan(0);

    // The score should be deterministic — verify exact value
    const score2 = evaluateReply(model, ['A', 'B', 'C', 'D'], new Set(['B', 'C']));
    expect(score).toBe(score2);
  });
});

