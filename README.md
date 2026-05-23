# MegaHAL-JS

[![CI](https://github.com/tgies/megahal-js/actions/workflows/ci.yml/badge.svg)](https://github.com/tgies/megahal-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A JavaScript port of Jason Hutchens' famous 1998 MegaHAL conversational engine.

MegaHAL-JS runs natively in Node.js (>= 20) and in all modern browsers.

---

## Installation

```bash
npm install megahal-js
```

---

## Quick Start

### Modern ESM (Node & Browser)

```javascript
import { MegaHal } from 'megahal-js';

// Instantiate with order N (default is 5)
const hal = new MegaHal(5);

// Train the engine
hal.learn('The cat sat on the mat.');
hal.learn('The dog chased the cat around the yard.');

// Generate a reply (this will also learn from the prompt before generating)
const reply = hal.respond('Tell me about the cat.');
console.log(reply);
// e.g., "The dog chased the cat sat on the mat."
```

### Browser direct integration (Vanilla HTML/JS)

```html
<!DOCTYPE html>
<html>
<head>
  <title>MegaHAL Chatbot</title>
</head>
<body>
  <script type="module">
    import { MegaHal } from './node_modules/megahal-js/index.js';
    
    const hal = new MegaHal(3);
    hal.learn('Hello world!');
    hal.learn('Welcome to the web browser version of MegaHAL.');
    
    console.log(hal.respond('hello'));
  </script>
</body>
</html>
```

---

## API Reference

### `class MegaHal`

#### `constructor(order = 5, rng = null)`
Creates a new MegaHAL engine.
- `order`: The Markov n-gram depth (trie depth). Defaults to `5`.
- `rng`: An optional custom random number generator. Must implement `randomRange(min, max)` returning an integer in `[min, max)`. If omitted, defaults to `Math.random`.

#### `respond(input)`
Learns from the input sentence, extracts its keywords, generates a response biased toward those keywords, capitalizes the response according to sentence-casing rules, and returns it.
- `input`: The prompt string.
- Returns: `string`

#### `generate(input)`
Generates a response to the prompt *without* learning from it. Returns `null` if no reply can be generated.
- `input`: The prompt string.
- Returns: `string | null`

#### `greet()`
Generates an initial greeting using a random word selected from the greeting keywords list. Falls back to the default fallback greeting if no greeting can be generated.
- Returns: `string`

#### `learn(input)`
Tokenizes and trains both forward and backward models on the given sentence.
- `input`: Sentence to train on.

#### `setLimit({ timeout, maxIterations })`
Configures generation limits for the reply loop.
- `timeout`: Maximum milliseconds to spend generating candidate responses (defaults to `1000`).
- `maxIterations`: Maximum candidates to generate.

#### `setKeywordConfig(config)`
Overrides the extraction config containing banned words, auxiliary words, and the swap table.
- `config`: A `KeywordConfig` instance.

#### `setGreetings(greetings)`
Sets the keywords list used to seed the initial greeting.
- `greetings`: Array of string greeting words.

#### `exportBrain()`
Serializes the engine's internal dictionary and tries into a spec-compliant C-compatible `.brn` binary format and returns a `Uint8Array`.
- Returns: `Uint8Array`

#### `importBrain(data)`
Deserializes a binary brain from a `Uint8Array` or `ArrayBuffer` into the engine, restoring dictionary and tries.
- `data`: Binary data buffer.

#### `trainFromContent(content)`
Trains the model on multi-line text corpus. Lines starting with `#` are ignored as comments.
- `content`: Plain text string.

#### `saveBrain(path)` *(Node-only)*
Asynchronously saves the serialized binary brain to a file.
- `path`: Target file path.

#### `loadBrain(path)` *(Node-only)*
Asynchronously loads a serialized binary brain from a file.
- `path`: Source file path.

#### `trainFromFile(path)` *(Node-only)*
Asynchronously trains the model from a corpus file.
- `path`: Text file path.

---

## Quality & Verification Commands

```bash
# Run unit tests
npm test

# Run test coverage
npm run test:coverage

# Perform TypeScript check
npm run typecheck

# Build declaration types
npm run build:types

# Run ESLint linter
npm run lint

# Run Stryker Mutation Testing
npm run test:mutation
```

---

## License

MIT © [Tony Gies](mailto:tgies@tgies.net)
