import { describe, test, expect } from 'vitest';
import { Trie } from '../src/trie.js';

describe('Trie', () => {
  test('new trie has root', () => {
    const trie = new Trie();
    const root = trie.root();
    const node = trie.node(root);
    expect(node.symbol).toBe(0); // ERROR_ID
    expect(node.usage).toBe(0);
    expect(node.count).toBe(0);
    expect(trie.children(root)).toEqual([]);
  });

  test('addChild creates new node', () => {
    const trie = new Trie();
    const root = trie.root();
    const child = trie.addChild(root, 5);

    expect(trie.node(child).symbol).toBe(5);
    expect(trie.node(child).count).toBe(1);
    expect(trie.node(root).usage).toBe(1);
    expect(trie.branchCount(root)).toBe(1);
  });

  test('addChild increments existing counts', () => {
    const trie = new Trie();
    const root = trie.root();

    const first = trie.addChild(root, 5);
    const second = trie.addChild(root, 5);

    expect(first).toBe(second);
    expect(trie.node(first).count).toBe(2);
    expect(trie.node(root).usage).toBe(2);
    expect(trie.branchCount(root)).toBe(1);
  });

  test('children are sorted by symbol ID', () => {
    const trie = new Trie();
    const root = trie.root();

    trie.addChild(root, 10);
    trie.addChild(root, 3);
    trie.addChild(root, 7);
    trie.addChild(root, 1);

    const children = trie.children(root);
    const symbols = children.map(r => trie.node(r).symbol);
    expect(symbols).toEqual([1, 3, 7, 10]);
  });

  test('findChild works correctly', () => {
    const trie = new Trie();
    const root = trie.root();
    const added = trie.addChild(root, 42);

    expect(trie.findChild(root, 42)).toBe(added);
    expect(trie.findChild(root, 99)).toBeUndefined();
  });

  test('count saturation at 65535', () => {
    const trie = new Trie();
    const root = trie.root();

    const child = trie.addChild(root, 1);
    // Manually force saturation
    trie.node(child).count = 65534;
    trie.node(root).usage = 65534;

    // Increments to max
    trie.addChild(root, 1);
    expect(trie.node(child).count).toBe(65535);
    expect(trie.node(root).usage).toBe(65535);

    // Further increments are silently dropped
    trie.addChild(root, 1);
    expect(trie.node(child).count).toBe(65535);
    expect(trie.node(root).usage).toBe(65535);
  });

  test('multi-level trie navigation', () => {
    const trie = new Trie();
    const root = trie.root();

    const level1 = trie.addChild(root, 2);
    const level2 = trie.addChild(level1, 3);
    const level3 = trie.addChild(level2, 4);

    expect(trie.node(level3).symbol).toBe(4);
    expect(trie.node(level3).count).toBe(1);
    expect(trie.node(level2).usage).toBe(1);

    // Verify lookup
    const f1 = trie.findChild(root, 2);
    const f2 = trie.findChild(f1, 3);
    const f3 = trie.findChild(f2, 4);
    expect(f3).toBe(level3);
  });

  test('isEmpty returns true for new trie', () => {
    const trie = new Trie();
    expect(trie.isEmpty()).toBe(true);
  });

  test('isEmpty returns false after adding a child', () => {
    const trie = new Trie();
    trie.addChild(trie.root(), 5);
    expect(trie.isEmpty()).toBe(false);
  });

  test('node() with out-of-bounds ref throws RangeError', () => {
    const trie = new Trie();
    expect(() => trie.node(999)).toThrow('Node reference 999 is out of bounds');
    expect(() => trie.node(1)).toThrow('Node reference 1 is out of bounds'); // only root at index 0
  });

  test('node() with negative ref throws RangeError', () => {
    const trie = new Trie();
    expect(() => trie.node(-1)).toThrow('Node reference -1 is out of bounds');
    expect(() => trie.node(-100)).toThrow('Node reference -100 is out of bounds');
  });

  test('size getter returns correct count', () => {
    const trie = new Trie();
    expect(trie.size).toBe(1); // just root

    trie.addChild(trie.root(), 10);
    expect(trie.size).toBe(2); // root + one child

    trie.addChild(trie.root(), 20);
    expect(trie.size).toBe(3); // root + two children

    // Adding same symbol again should NOT increase size
    trie.addChild(trie.root(), 10);
    expect(trie.size).toBe(3);
  });

  test('findChild returns exact child ref value', () => {
    const trie = new Trie();
    const root = trie.root();
    expect(root).toBe(0); // root is always index 0

    const child1 = trie.addChild(root, 5);
    expect(child1).toBe(1); // first added node is at index 1

    const child2 = trie.addChild(root, 10);
    expect(child2).toBe(2); // second added node is at index 2

    // findChild returns the exact same ref
    expect(trie.findChild(root, 5)).toBe(1);
    expect(trie.findChild(root, 10)).toBe(2);

    // Non-existent child returns undefined (not null, not -1)
    expect(trie.findChild(root, 99)).toBeUndefined();
  });

  test('branchCount returns zero for node with no children', () => {
    const trie = new Trie();
    expect(trie.branchCount(trie.root())).toBe(0);
  });

  test('children returns empty array for leaf node', () => {
    const trie = new Trie();
    const root = trie.root();
    const child = trie.addChild(root, 1);
    expect(trie.children(child)).toEqual([]);
    expect(trie.branchCount(child)).toBe(0);
  });
});
