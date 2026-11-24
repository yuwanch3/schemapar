# Changelog

**English** | [Bahasa Indonesia](CHANGELOG.id.md)

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Indonesian translations of the README, guides, contributing guide and changelog.

### Planned

- Rust codegen target.
- Release `0.2.0`.
- Additional target languages such as Java and C#.
- Richer semantic format checks beyond the documented shapes.

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

[Unreleased]: https://github.com/yuwanch3/schemapar/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yuwanch3/schemapar/releases/tag/v0.1.0
