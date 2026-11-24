# Changelog

**English** | [Bahasa Indonesia](CHANGELOG.id.md)

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Rust codegen target.
- Additional target languages such as Java and C#.
- Richer semantic format checks beyond the documented shapes.

## [0.2.0] - 2026-11-24

First public release on npm.

### Added

- Indonesian translations of the README, documentation guides, contributing guide and changelog, with language switchers on every English page.
- `README.id.md` is included in the published package.
- Repository, homepage and issue tracker metadata in `package.json`.

### Changed

- Documentation is split into matching English and Indonesian sets: `README.md`/`README.id.md`, `docs/`/`docs/id/`, `CONTRIBUTING.md`/`CONTRIBUTING.id.md`, `CHANGELOG.md`/`CHANGELOG.id.md` and `examples/README.md`/`examples/README.id.md`.

### Fixed

- Removed stray Python bytecode caches from the example directory and ignored them in Git.

## [0.1.0] - 2026-11-24

### Added

- JSON schema DSL with strict parsing: `string`, `number`, `integer`, `boolean`, `literal`, `enum`, `array`, `object`, `record`, `tuple`, `union`, `any`.
- `optional` and `nullable` modifiers on every node.
- Cross-field constraints: `greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`, `equal`, `notEqual`, `requiredTogether`.
- Nine shared string formats: `email`, `uuid`, `date`, `date-time`, `time`, `hostname`, `ipv4`, `ipv6`, `uri`.
- Portable regex policy with Python and Go translation, rejecting lookaround, named groups, backreferences, Unicode property escapes and shorthand classes.
- Dependency-free validators for TypeScript, Python and Go.
- Deterministic, schema-aware corpus generation: valid samples, mutations, adversarial probes, pattern-driven string synthesis and constraint repair.
- Three-way parity engine comparing full error lists (paths, messages and order) across TypeScript, Python and Go.
- CLI commands `check`, `compile` (`--target ts|py|go`) and `parity`, with `--seed`, `--cases`, `--python`, `--go` and `--no-go`.
- Programmatic API: `parseSchema`, `generateTypeScript`, `generatePython`, `generateGo`, `buildCorpus`, `generateValid`, `adversarialValues`, `Rng`, `MISSING`, `runParity`, `encodeForWire`.
- Checked-in example schema and generated validators.
- Self-test suite covering schema validation, codegen, determinism, parity, error accumulation and Go compilation.
- GitHub Actions CI for Node 18/20/22 with Python and Go, plus a package-install smoke test.
- npm packaging metadata, typed exports, MIT license and `prepublishOnly` guard.

[Unreleased]: https://github.com/yuwanch3/schemapar/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yuwanch3/schemapar/releases/tag/v0.2.0
[0.1.0]: https://github.com/yuwanch3/schemapar/releases/tag/v0.1.0
