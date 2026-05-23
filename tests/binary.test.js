import { describe, test, expect } from 'vitest';
import { MegaHal } from '../index.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

describe('Binary Serialization', () => {
  test('export and import brain roundtrip', () => {
    const hal = new MegaHal(2);
    hal.learn('The quick brown fox jumps over the lazy dog.');
    hal.learn('Cats and dogs are popular pets.');

    const brainData = hal.exportBrain();
    expect(brainData).toBeInstanceOf(Uint8Array);
    expect(brainData.length).toBeGreaterThan(10);

    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    expect(hal2.model.order).toBe(hal.model.order);
    expect(hal2.model.dictionary.size).toBe(hal.model.dictionary.size);
    expect(hal2.model.dictionary.resolve(2)).toBe(hal.model.dictionary.resolve(2));

    // Verify forward trie matches
    expect(hal2.model.forward.size).toBe(hal.model.forward.size);
    expect(hal2.model.forward.node(0).usage).toBe(hal.model.forward.node(0).usage);
  });

  test('load brain throws error on invalid cookie', () => {
    const hal = new MegaHal(2);
    const invalidData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => hal.importBrain(invalidData)).toThrow(/cookie/i);
  });

  test('saveBrain and loadBrain filesystem files', async () => {
    const hal = new MegaHal(2);
    hal.learn('Unique test string for file persistence check.');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'megahal-test-'));
    const tempFile = path.join(tempDir, 'brain.brn');

    try {
      await hal.saveBrain(tempFile);

      // Verify file exists and has content
      const stats = await fs.stat(tempFile);
      expect(stats.size).toBeGreaterThan(0);

      const hal2 = new MegaHal(2);
      await hal2.loadBrain(tempFile);

      expect(hal2.model.dictionary.find('unique')).toBeDefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('64-bit usage and size serialization roundtrip', () => {
    const hal = new MegaHal(2);
    hal.learn('Testing 64-bit binary serialization compatibility.');

    const defaultData = hal.exportBrain();
    const falseData = hal.exportBrain({ use64Bit: false });
    const brainData = hal.exportBrain({ use64Bit: true });
    expect(falseData).toEqual(defaultData);
    expect(brainData.length).toBeGreaterThan(defaultData.length);
    expect(brainData).toBeInstanceOf(Uint8Array);

    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    expect(hal2.model.order).toBe(hal.model.order);
    expect(hal2.model.dictionary.size).toBe(hal.model.dictionary.size);
    expect(hal2.model.dictionary.find('testing')).toBeDefined();
    expect(hal2.model.forward.nodes.length).toBe(hal.model.forward.nodes.length);
  });

  test('compatibility with C-generated 64-bit megahal.brn', async () => {
    const cBrainPath = '/home/tgies/src/megahal-workspace/megahal/megahal.brn';
    let fileExists = false;
    try {
      await fs.access(cBrainPath);
      fileExists = true;
    } catch {
      // Ignored if file does not exist (e.g. in environments where C binary wasn't built/run)
    }

    if (fileExists) {
      const data = await fs.readFile(cBrainPath);
      const hal = new MegaHal(5);
      hal.importBrain(data);

      expect(hal.model.dictionary.size).toBeGreaterThan(2);
      expect(hal.model.forward.nodes.length).toBeGreaterThan(1);
      expect(hal.model.backward.nodes.length).toBeGreaterThan(1);
    }
  });

  test('serialization throws RangeError if dictionary exceeds 65536 entries', () => {
    const hal = new MegaHal(2);
    
    // Stub dictionary entries size to exceed 65536
    const originalEntries = hal.model.dictionary.entries;
    hal.model.dictionary.entries = {
      length: 65537,
      [Symbol.iterator]: function* () {
        for (let i = 0; i < 65537; i++) {
          yield 'WORD' + i;
        }
      }
    };

    expect(() => hal.exportBrain()).toThrow(
      'Dictionary size (65537) exceeds maximum of 65536 symbols supported by the binary format'
    );

    // Restore dictionary
    hal.model.dictionary.entries = originalEntries;
  });

  test('serialization throws if a dictionary symbol exceeds 255 bytes', () => {
    const hal = new MegaHal(2);
    hal.learn('Seed sentence to populate dictionary.');

    const originalEntries = hal.model.dictionary.entries;
    const longWord = 'X'.repeat(256);
    hal.model.dictionary.entries = [...originalEntries, longWord];

    try {
      expect(() => hal.exportBrain()).toThrow(/255/);
    } finally {
      hal.model.dictionary.entries = originalEntries;
    }
  });

  test('serialization accepts a dictionary symbol exactly 255 bytes long', () => {
    const hal = new MegaHal(2);
    const maxWord = 'X'.repeat(255);
    hal.model.dictionary.intern(maxWord);

    const brainData = hal.exportBrain();
    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    expect(hal2.model.dictionary.find(maxWord)).toBeDefined();
  });

  test('serialization accepts exactly 65536 dictionary entries', () => {
    const hal = new MegaHal(2);
    const originalEntries = hal.model.dictionary.entries;
    hal.model.dictionary.entries = new Proxy(
      { length: 65536 },
      {
        get(target, prop) {
          if (prop === 'length') {
            return target.length;
          }
          if (typeof prop === 'symbol') {
            return undefined;
          }
          const index = Number(prop);
          if (Number.isInteger(index) && index >= 0 && index < target.length) {
            return `W${index}`;
          }
          return undefined;
        }
      }
    );

    try {
      expect(() => hal.exportBrain()).not.toThrow();
    } finally {
      hal.model.dictionary.entries = originalEntries;
    }
  });

  test('serialization grows its writer buffer for large dictionaries', () => {
    const hal = new MegaHal(2);
    for (let i = 0; i < 800; i++) {
      hal.model.dictionary.intern(`WORD_${i.toString().padStart(4, '0')}`);
    }

    const brainData = hal.exportBrain();
    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    expect(brainData.length).toBeGreaterThan(4096);
    expect(hal2.model.dictionary.find('WORD_0799')).toBeDefined();
  });

  test('serialization preserves exact trie node counts and usage values', () => {
    const hal = new MegaHal(2);
    hal.learn('The quick brown fox.');
    hal.learn('The quick red cat.');

    const fwdRootUsageBefore = hal.model.forward.node(0).usage;
    const bwdRootUsageBefore = hal.model.backward.node(0).usage;
    const fwdSizeBefore = hal.model.forward.size;
    const bwdSizeBefore = hal.model.backward.size;

    const brainData = hal.exportBrain();
    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    expect(hal2.model.forward.size).toBe(fwdSizeBefore);
    expect(hal2.model.backward.size).toBe(bwdSizeBefore);
    expect(hal2.model.forward.node(0).usage).toBe(fwdRootUsageBefore);
    expect(hal2.model.backward.node(0).usage).toBe(bwdRootUsageBefore);
  });

  test('deserializing truncated data after cookie+order throws an error', () => {
    // Build valid cookie + order but nothing else
    const encoder = new TextEncoder();
    const cookie = encoder.encode('MegaHALv8');
    // cookie(9) + order(1) = 10 bytes, but no trie data follows
    const truncated = new Uint8Array(10);
    truncated.set(cookie);
    truncated[9] = 5; // order = 5

    const hal = new MegaHal(2);
    // Should throw because it will try to read trie data that isn't there
    expect(() => hal.importBrain(truncated)).toThrow();
  });

  test('deserializing truncated dictionary word reports unexpected end of file', () => {
    const hal = new MegaHal(2);
    hal.learn('Dictionary truncation should fail during string reading.');

    const brainData = hal.exportBrain();
    const truncated = brainData.slice(0, brainData.length - 1);
    const hal2 = new MegaHal(2);

    expect(() => hal2.importBrain(truncated)).toThrow(/Unexpected end of file/);
  });

  test('brain with order=2 roundtrips correctly', () => {
    const hal = new MegaHal(2);
    hal.learn('Dogs are wonderful animals that bring joy.');
    hal.learn('Cats are wonderful pets that purr loudly.');

    const brainData = hal.exportBrain();
    const hal2 = new MegaHal(5); // Start with different order
    hal2.importBrain(brainData);

    // Order should be restored to 2
    expect(hal2.model.order).toBe(2);
    expect(hal2.model.dictionary.size).toBe(hal.model.dictionary.size);
    expect(hal2.model.forward.size).toBe(hal.model.forward.size);
    expect(hal2.model.backward.size).toBe(hal.model.backward.size);
  });

  test('brain with order=3 roundtrips correctly', () => {
    const hal = new MegaHal(3);
    hal.learn('Testing order three model serialization and deserialization.');

    const brainData = hal.exportBrain();
    const hal2 = new MegaHal(1);
    hal2.importBrain(brainData);

    expect(hal2.model.order).toBe(3);
  });

  test('backward trie preserved after roundtrip', () => {
    const hal = new MegaHal(2);
    hal.learn('Alpha beta gamma delta epsilon.');

    // Check backward trie root usage
    const bwdRootUsage = hal.model.backward.node(0).usage;
    const bwdNodeCount = hal.model.backward.size;

    const brainData = hal.exportBrain();
    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    expect(hal2.model.backward.node(0).usage).toBe(bwdRootUsage);
    expect(hal2.model.backward.size).toBe(bwdNodeCount);
  });

  test('dictionary entries preserved exactly after roundtrip', () => {
    const hal = new MegaHal(2);
    hal.learn('Hello world foo bar baz qux.');

    const dictSize = hal.model.dictionary.size;
    // Collect all dictionary entries
    const entries = [];
    for (let i = 0; i < dictSize; i++) {
      entries.push(hal.model.dictionary.resolve(i));
    }

    const brainData = hal.exportBrain();
    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    expect(hal2.model.dictionary.size).toBe(dictSize);
    for (let i = 0; i < dictSize; i++) {
      expect(hal2.model.dictionary.resolve(i)).toBe(entries[i]);
    }
  });

  test('64-bit serialization preserves exact data after roundtrip', () => {
    const hal = new MegaHal(2);
    hal.learn('Testing sixty four bit serialization preservation.');
    hal.learn('Another sentence for more trie data.');

    const brainData = hal.exportBrain({ use64Bit: true });

    const hal2 = new MegaHal(2);
    hal2.importBrain(brainData);

    // Verify exact forward trie metrics
    expect(hal2.model.forward.size).toBe(hal.model.forward.size);
    expect(hal2.model.forward.node(0).usage).toBe(hal.model.forward.node(0).usage);
    expect(hal2.model.backward.size).toBe(hal.model.backward.size);
    expect(hal2.model.backward.node(0).usage).toBe(hal.model.backward.node(0).usage);
  });

  test('export brain returns Uint8Array with deterministic size', () => {
    const hal1 = new MegaHal(2);
    hal1.learn('Deterministic size test sentence.');

    const hal2 = new MegaHal(2);
    hal2.learn('Deterministic size test sentence.');

    const data1 = hal1.exportBrain();
    const data2 = hal2.exportBrain();

    expect(data1.length).toBe(data2.length);
    // Binary content should be identical
    expect(data1).toEqual(data2);
  });
});
