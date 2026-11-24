# schemapar

**Tulis schema sekali. Compile validator untuk TypeScript, Python, dan Go. _Buktikan_ perilakunya identik.**

`schemapar` adalah CLI dan library build-time untuk tim yang servisnya ditulis dalam lebih dari satu bahasa. Definisikan kontrak data dalam DSL JSON kecil, hasilkan validator tanpa dependency, lalu fuzz semua validator hasil generate terhadap corpus yang sama dan bandingkan **seluruh daftar error**-nya. Jika dua implementasi berbeda — bahkan hanya pada satu path atau pesan error — build gagal.

```text
$ schemapar parity examples/user.schema.json
Running parity: seed=42 cases=50
✓ Parity OK (TS + Python + Go) — 130 inputs (50 valid, 80 invalid)
```

[![CI](https://github.com/yuwanch3/schemapar/actions/workflows/ci.yml/badge.svg)](https://github.com/yuwanch3/schemapar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Targets](https://img.shields.io/badge/targets-TypeScript%20%7C%20Python%20%7C%20Go-informational.svg)](#validator-yang-dihasilkan)

**Bahasa Indonesia** | [English](README.md)

---

## Mengapa

Frontend TypeScript, service Go, dan backend Python sering memvalidasi JSON yang sama. Aturannya ditulis ulang di tiap bahasa dan perlahan menjadi berbeda:

- satu sisi menerima `1.5` padahal sisi lain mewajibkan integer;
- satu sisi menghitung emoji sebagai 2 karakter, sisi lain sebagai 1;
- satu sisi mengurutkan key tak dikenal, sisi lain melaporkannya sesuai urutan insertion;
- regex, pesan error, dan path error tidak lagi sama.

Generator tipe seperti protobuf, quicktype, atau OpenAPI mendeskripsikan _bentuk_, bukan _perilaku_. `schemapar` memperlakukan perilaku validator sebagai kontrak dan mengujinya secara langsung.

## Mulai cepat

```bash
npm install --save-dev schemapar
```

Jika paket belum tersedia di registry, jalankan dari checkout:

```bash
npm ci
npm run build
npm link        # opsional: menyediakan perintah `schemapar`
node dist/cli.js --help
```

Perintah di bawah memakai `schemapar`. Dari checkout tanpa `npm link`, ganti dengan `node dist/cli.js`.

Buat `user.schema.json`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "email": { "type": "string", "format": "email" },
    "age": { "type": "integer", "min": 0, "max": 150, "optional": true },
    "role": { "type": "enum", "values": ["admin", "member", "guest"] }
  }
}
```

Periksa schema, lalu compile:

```bash
schemapar check user.schema.json

schemapar compile user.schema.json --target ts --out user.validator.ts
schemapar compile user.schema.json --target py --out user_validator.py
schemapar compile user.schema.json --target go --out user_validator.go
```

Buktikan ketiga validator sepakat:

```bash
schemapar parity user.schema.json --seed 7 --cases 100
```

`parity` menghasilkan nilai valid, memutasi setiap nilai, menambahkan probe adversarial, menjalankan corpus melalui setiap validator, lalu membandingkan path, pesan, dan urutannya. Perintah ini keluar dengan kode non-zero jika ada perbedaan.

## Validator yang dihasilkan

| Target | Output | API publik |
| --- | --- | --- |
| TypeScript | modul `.ts` | `validate(value): ValidationError[]`, `Infer`, `ValidationError` |
| Python | modul `.py` | `validate(value) -> list[ValidationError]`, `ValidationError` |
| Go | package Go (default `package validator`) | `Validate(value any) []ValidationError`, `ValidationError`, `Missing` |

File hasil generate memiliki **nol dependency runtime**. Vendor ke proyek Anda, commit, atau generate ulang di CI. `schemapar` sendiri tidak dibutuhkan saat runtime.

Untuk Go, properti opsional yang tidak ada direpresentasikan oleh sentinel `Missing` yang diekspor, setara dengan `undefined` di JavaScript.

## Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [Memulai](docs/id/getting-started.md) | Instalasi, schema pertama, API hasil generate, integrasi CI |
| [Referensi schema](docs/id/schema-reference.md) | Semua tipe node, modifier, constraint, format, dan aturan regex |
| [Pengujian parity](docs/id/parity.md) | Pembuatan corpus, aturan perbandingan, flag CLI, laporan mismatch |
| [Arsitektur](docs/id/architecture.md) | Alur proses, desain codegen, determinisme, internal parity |
| [Contoh](examples/README.id.md) | Schema contoh dan validator hasil generate yang di-commit |
| [Kontribusi](CONTRIBUTING.id.md) | Development lokal, test, dan panduan perubahan |
| [Changelog](CHANGELOG.id.md) | Riwayat rilis |

Dokumentasi versi Inggris tersedia di [docs/README.md](docs/README.md).

## Ringkasan schema

Schema adalah objek JSON. Setiap node punya `type` dan boleh membawa `optional` dan/atau `nullable`.

| `type` | Field |
| --- | --- |
| `string` | `minLength`, `maxLength`, `pattern`, `format` |
| `number` | `min`, `max` |
| `integer` | `min`, `max` |
| `boolean` | — |
| `literal` | `value` (string \| number \| boolean \| null) |
| `enum` | `values` (array non-kosong berisi string \| number \| boolean) |
| `array` | `items`, `minItems`, `maxItems` |
| `object` | `properties`, `additionalProperties` (default `true`), `constraints` |
| `record` | `values`, `minProperties`, `maxProperties` |
| `tuple` | `items` (array posisional non-kosong) |
| `union` | `variants` (array non-kosong) |
| `any` | — |

Format string yang didukung: `email`, `uuid`, `date`, `date-time`, `time`, `hostname`, `ipv4`, `ipv6`, `uri`.

Field tak dikenal ditolak, jadi typo seperti `minLenght` gagal di `check` alih-alih diam-diam melonggarkan validasi. Lihat [referensi schema](docs/id/schema-reference.md) untuk aturan field dan contoh.

Constraint antar-field dideklarasikan pada node `object`:

```json
{
  "type": "object",
  "properties": {
    "min": { "type": "integer" },
    "max": { "type": "integer" },
    "start": { "type": "string", "optional": true },
    "end": { "type": "string", "optional": true }
  },
  "constraints": [
    { "kind": "lessOrEqual", "left": "min", "right": "max" },
    { "kind": "requiredTogether", "fields": ["start", "end"] }
  ]
}
```

## Jaminan parity

Validator hasil generate dirancang agar hal-hal berikut identik di TypeScript, Python, dan Go:

- **Pesan error** — ditanam saat generate.
- **Path dan urutan error** — path seperti `["contact", "value"]`; key objek dan record yang tidak dikenal dikunjungi dalam urutan **code point** Unicode.
- **Panjang string** — dihitung dalam code point Unicode, bukan unit UTF-16.
- **Semantik angka** — boolean bukan angka; integer menolak nilai pecahan; NaN dan infinity ditolak.
- **Perbandingan enum/literal** — sadar tipe, mengikuti `===` JavaScript.
- **Nilai absen** — `undefined` JavaScript dipetakan ke `_MISSING` di Python dan `Missing` di Go.
- **Semantik regex** — parser memberlakukan subset portabel; `$` menjadi `\Z` di Python, dan `\uXXXX` menjadi `\x{XXXX}` di Go.
- **Akumulasi error** — satu properti gagal tidak menghentikan validasi properti saudara atau pengecekan berikutnya.

Baca [Pengujian parity](docs/id/parity.md) untuk aturan perbandingan dan pembentukan corpus secara lengkap.

## API programatik

```ts
import { readFileSync } from 'node:fs';
import {
  parseSchema,
  generateTypeScript,
  generatePython,
  generateGo,
  runParity,
} from 'schemapar';

const parsed = parseSchema(JSON.parse(readFileSync('user.schema.json', 'utf8')));
if (!parsed.ok) {
  for (const e of parsed.errors) console.error(e.path.join('.'), e.message);
  process.exit(1);
}

const ts = generateTypeScript(parsed.schema);
const py = generatePython(parsed.schema);
const go = generateGo(parsed.schema);

const result = await runParity(parsed.schema, { seed: 42, cases: 100 });
if (result.mismatches.length > 0) {
  console.error('Validators disagree', result.mismatches);
  process.exit(1);
}
```

`runParity` membandingkan Go secara otomatis jika toolchain tersedia. Gunakan `go: false` untuk hanya membandingkan TypeScript dan Python, `go: true` untuk mewajibkan Go, atau `goCommand` untuk memilih executable tertentu. Hasilnya menyediakan `goCompared` dan, jika dilewati, `goSkipReason`.

## Kebutuhan

- **Node.js 18+** untuk menjalankan CLI dan library.
- **Python 3.8+** untuk `parity` (perbandingan TypeScript ↔ Python).
- **Go 1.21+** opsional; jika `go` ada di `PATH`, `parity` juga mengompilasi dan membandingkan validator Go.

`schemapar` bergantung pada `typescript` saat runtime karena `parity` mentranspile validator TypeScript hasil generate di memori. Validator hasil generate tetap tanpa dependency.

## Struktur proyek

```text
src/
  schema.ts     # tipe DSL, pola format, parseSchema(), kebijakan regex
  gen-ts.ts     # codegen validator TypeScript
  gen-py.ts     # codegen validator Python
  gen-go.ts     # codegen validator Go (RE2)
  generator.ts  # PRNG deterministik + pembuat corpus valid/adversarial
  parity.ts     # menjalankan validator, membandingkan seluruh daftar error
  cli.ts        # compile | check | parity
  index.ts      # API publik
test/
  parity.test.ts
  fixtures/go-runner.go
examples/
  user.schema.json
  user.validator.ts
  user_validator.py
  user_validator.go
```

## Development

```bash
npm ci
npm run typecheck
npm test        # self-test, termasuk parity TS/Python/Go jika toolchain tersedia
npm run build
```

Matriks test menjalankan typecheck, build, seluruh self-test, smoke test parity CLI, dan pengecekan kesegaran contoh hasil generate pada Node 18, 20, dan 22 dengan Python dan Go tersedia. Job terpisah melakukan pack paket dan smoke test instalasi, resolusi tipe, serta import runtime.

## Status dan roadmap

Versi saat ini: **0.2.0**. Tipe node yang didukung: `string`, `number`, `integer`, `boolean`, `literal`, `enum`, `array`, `object`, `record`, `tuple`, `union`, `any`, plus constraint antar-field (`greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`, `equal`, `notEqual`, `requiredTogether`) dan sembilan format string.

Rencana:

- Target codegen Rust.
- Target tambahan seperti Java dan C#.
- Pengecekan format semantik yang lebih kaya di luar bentuk yang didokumentasikan.

Lihat [CHANGELOG.id.md](CHANGELOG.id.md) untuk riwayat rilis.

## Kontribusi

Issue dan pull request terbuka. Mulai dari [CONTRIBUTING.id.md](CONTRIBUTING.id.md). Singkatnya: jaga output generate tetap deterministik, jaga ketiga validator tetap selaras, dan tambahkan test parity untuk setiap perubahan perilaku.

## Lisensi

MIT — lihat [LICENSE](LICENSE).
