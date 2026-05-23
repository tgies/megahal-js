# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-22

Initial release. A JavaScript port of the MegaHAL conversational engine
(Jason Hutchens, 1998), targeting both Node.js and browser environments.

### Added
- Forward and backward 5th-order Markov trie models with case-insensitive symbols.
- Tokenization matching the original C boundary rules, including apostrophe
  handling for contractions and sentence-terminal normalization.
- Two-pass keyword extraction with banned, auxiliary, and swap-table support.
- Reply generation with seeded forward and backward babble phases, keyword
  priority, and the `used_key` discipline.
- Surprise-based reply scoring with depth-averaged probability and the
  num >= 8 / num >= 16 length penalties.
- Binary brain persistence compatible with the `MegaHALv8` cookie format,
  with optional 64-bit count/usage extensions.
- Default support file data (banned, auxiliary, greeting, swap) bundled.
- TypeScript declarations generated from JSDoc.

[1.0.0]: https://github.com/tgies/megahal-js/releases/tag/v1.0.0
