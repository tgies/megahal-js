import { describe, test, expect } from 'vitest';
import { Trie } from '../src/trie.js';
import { ContextWindow, BidirectionalModel } from '../src/model.js';

describe('Model & ContextWindow', () => {
  test('context window initialization', () => {
    const trie = new Trie();
    const ctx = new ContextWindow(5);
    ctx.initialize(trie.root());

    expect(ctx.atDepth(0)).toBe(trie.root());
    expect(ctx.atDepth(1)).toBeNull();
    expect(ctx.atDepth(6)).toBeNull();
  });

  test('context window deepest non-null tracking', () => {
    const trie = new Trie();
    const ctx = new ContextWindow(5);
    ctx.initialize(trie.root());

    expect(ctx.deepest()).toBe(trie.root());

    const child = trie.addChild(trie.root(), 2);
    ctx.advance(trie, 2);
    expect(ctx.atDepth(1)).toBe(child);
    expect(ctx.deepest()).toBe(child);
  });

  test('learn skips short inputs', () => {
    const model = new BidirectionalModel(5);
    // Short input: length 3 <= order 5. Should skip.
    model.learn(['A', ' ', 'B']);

    expect(model.dictionary.size).toBe(2); // only sentinels
    expect(model.forward.size).toBe(1); // only root
  });

  test('learn populates dictionary and tries', () => {
    const model = new BidirectionalModel(2);
    const tokens = ['THE', ' ', 'CAT'];

    model.learn(tokens);

    // 2 sentinels + 3 tokens = 5
    expect(model.dictionary.size).toBe(5);
    expect(model.dictionary.find('THE')).toBeDefined();
    expect(model.dictionary.find('CAT')).toBeDefined();
    expect(model.dictionary.find(' ')).toBeDefined();

    // Verify forward trie path root -> THE
    const root = model.forward.root();
    const idThe = model.dictionary.find('THE');
    expect(model.forward.findChild(root, idThe)).toBeDefined();

    // Verify backward trie path root -> CAT (reverse order)
    const broot = model.backward.root();
    const idCat = model.dictionary.find('CAT');
    expect(model.backward.findChild(broot, idCat)).toBeDefined();
  });

  test('context window advanceAndLearn matches learn', () => {
    const model = new BidirectionalModel(3);
    model.learn(['A', 'B', 'C', 'D']);

    // Check depth path
    const root = model.forward.root();
    const idA = model.dictionary.find('A');
    const idB = model.dictionary.find('B');
    const idC = model.dictionary.find('C');
    const idD = model.dictionary.find('D');

    const f1 = model.forward.findChild(root, idA);
    expect(f1).toBeDefined();
    const f2 = model.forward.findChild(f1, idB);
    expect(f2).toBeDefined();
    const f3 = model.forward.findChild(f2, idC);
    expect(f3).toBeDefined();
    const f4 = model.forward.findChild(f3, idD);
    expect(f4).toBeDefined();
  });

  test('ContextWindow.advance sets slot to null when parent has no matching child', () => {
    const trie = new Trie();
    const ctx = new ContextWindow(3);
    ctx.initialize(trie.root());

    // Advance with a symbol that does not exist in the trie
    ctx.advance(trie, 999);

    // Slot 1 should be null because root has no child with symbol 999
    expect(ctx.atDepth(1)).toBeNull();
    // Slot 0 should still be root
    expect(ctx.atDepth(0)).toBe(trie.root());
  });

  test('ContextWindow.deepest returns null on freshly constructed (no initialize)', () => {
    const ctx = new ContextWindow(5);
    // All slots are null because initialize was never called
    expect(ctx.deepest()).toBeNull();
  });

  test('BidirectionalModel.forwardContext and backwardContext return separate instances', () => {
    const model = new BidirectionalModel(3);
    const fwd = model.forwardContext();
    const bwd = model.backwardContext();

    // They should be different objects
    expect(fwd).not.toBe(bwd);

    // Forward context should be initialized to forward root
    expect(fwd.atDepth(0)).toBe(model.forward.root());

    // Backward context should be initialized to backward root
    expect(bwd.atDepth(0)).toBe(model.backward.root());
  });

  test('learning adds FIN_ID (1) as a child at some depth in forward trie', () => {
    const model = new BidirectionalModel(2);
    model.learn(['HELLO', ' ', 'WORLD', '.']);

    // FIN_ID should appear somewhere as a child in the forward trie
    // After learning, the last symbol fed to forward is FIN_ID
    // So root should have the first token as a child, and at the terminal
    // depth, FIN_ID (1) should appear
    const root = model.forward.root();
    const FIN_ID = 1;

    // Walk the forward trie: look for FIN_ID somewhere
    let found = false;
    function search(ref, depth) {
      if (depth > model.order + 1) {return;}
      const children = model.forward.children(ref);
      for (const childRef of children) {
        const node = model.forward.node(childRef);
        if (node.symbol === FIN_ID) {
          found = true;
          return;
        }
        search(childRef, depth + 1);
      }
    }
    search(root, 0);
    expect(found).toBe(true);
  });

  test('backward trie learns tokens in reverse order', () => {
    const model = new BidirectionalModel(2);
    model.learn(['THE', ' ', 'CAT', '.']);

    const broot = model.backward.root();
    // In backward trie, first token learned is the last token of input
    // The sequence reversed is: '.', 'CAT', ' ', 'THE', FIN_ID
    const idDot = model.dictionary.find('.');
    expect(idDot).toBeDefined();

    // '.' should be a child of root in backward trie (first in reverse)
    const dotChild = model.backward.findChild(broot, idDot);
    expect(dotChild).toBeDefined();

    // 'CAT' should be a child of '.' in backward trie
    const idCat = model.dictionary.find('CAT');
    const catChild = model.backward.findChild(dotChild, idCat);
    expect(catChild).toBeDefined();

    // 'THE' should also appear somewhere (first token of input, deepest in backward)
    const idThe = model.dictionary.find('THE');
    expect(idThe).toBeDefined();
  });

  test('ContextWindow.atDepth returns null for out-of-range indices', () => {
    const ctx = new ContextWindow(3);
    ctx.initialize(0);
    expect(ctx.atDepth(-1)).toBeNull();
    expect(ctx.atDepth(5)).toBeNull(); // order+2 = 5, so index 5 is out of range
    expect(ctx.atDepth(100)).toBeNull();
  });

  test('multiple advance calls track context correctly', () => {
    const trie = new Trie();
    const root = trie.root();
    const ctx = new ContextWindow(2);
    ctx.initialize(root);

    // Build a path in the trie
    const child1 = trie.addChild(root, 10);
    const child2 = trie.addChild(child1, 20);

    // Advance through the path
    ctx.advance(trie, 10);
    expect(ctx.atDepth(1)).toBe(child1);

    ctx.advance(trie, 20);
    // root has no child 20, so depth 1 (root->20) should be null
    expect(ctx.atDepth(1)).toBeNull();
    // But depth 2 should track child1->20 since child1 does have child 20
    expect(ctx.atDepth(2)).toBe(child2);
  });
});
