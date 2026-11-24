# Changelog

[English](CHANGELOG.md) | **Bahasa Indonesia**

Semua perubahan penting pada proyek ini didokumentasikan di sini. Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), dan proyek memakai [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Direncanakan

- Target codegen Rust.
- Bahasa target tambahan seperti Java dan C#.
- Pengecekan format semantik yang lebih kaya di luar bentuk yang didokumentasikan.

## [0.2.0] - 2026-11-24

Rilis publik pertama di npm.

### Ditambahkan

- Terjemahan Bahasa Indonesia untuk README, panduan dokumentasi, panduan kontribusi, dan changelog, dengan language switcher di setiap halaman Inggris.
- `README.id.md` disertakan dalam paket yang dipublikasikan.
- Metadata repository, homepage, dan issue tracker di `package.json`.

### Diubah

- Dokumentasi dipisah menjadi pasangan Inggris dan Indonesia: `README.md`/`README.id.md`, `docs/`/`docs/id/`, `CONTRIBUTING.md`/`CONTRIBUTING.id.md`, `CHANGELOG.md`/`CHANGELOG.id.md`, dan `examples/README.md`/`examples/README.id.md`.

### Diperbaiki

- Menghapus cache bytecode Python yang tidak sengaja ada di direktori contoh dan mengabaikannya di Git.

## [0.1.0] - 2026-11-24

### Ditambahkan

- DSL schema JSON dengan parsing ketat: `string`, `number`, `integer`, `boolean`, `literal`, `enum`, `array`, `object`, `record`, `tuple`, `union`, `any`.
- Modifier `optional` dan `nullable` pada setiap node.
- Constraint antar-field: `greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`, `equal`, `notEqual`, `requiredTogether`.
- Sembilan format string bersama: `email`, `uuid`, `date`, `date-time`, `time`, `hostname`, `ipv4`, `ipv6`, `uri`.
- Kebijakan regex portabel dengan terjemahan Python dan Go, menolak lookaround, named group, backreference, Unicode property escape, dan shorthand class.
- Validator tanpa dependency untuk TypeScript, Python, dan Go.
- Pembuatan corpus deterministik dan sadar schema: sampel valid, mutasi, probe adversarial, sintesis string berbasis pattern, dan perbaikan constraint.
- Mesin parity tiga arah yang membandingkan seluruh daftar error (path, pesan, dan urutan) di TypeScript, Python, dan Go.
- Perintah CLI `check`, `compile` (`--target ts|py|go`), dan `parity`, dengan `--seed`, `--cases`, `--python`, `--go`, dan `--no-go`.
- API programatik: `parseSchema`, `generateTypeScript`, `generatePython`, `generateGo`, `buildCorpus`, `generateValid`, `adversarialValues`, `Rng`, `MISSING`, `runParity`, `encodeForWire`.
- Schema contoh dan validator hasil generate yang di-commit.
- Suite self-test yang mencakup validasi schema, codegen, determinisme, parity, akumulasi error, dan kompilasi Go.
- GitHub Actions CI untuk Node 18/20/22 dengan Python dan Go, plus smoke test instalasi paket.
- Metadata packaging npm, export bertipe, lisensi MIT, dan guard `prepublishOnly`.

[Unreleased]: https://github.com/yuwanch3/schemapar/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yuwanch3/schemapar/releases/tag/v0.2.0
[0.1.0]: https://github.com/yuwanch3/schemapar/releases/tag/v0.1.0
