# Pengujian parity

[English](../parity.md) | **Bahasa Indonesia**

`schemapar parity` menjawab satu pertanyaan:

> Dengan input yang sama, apakah validator TypeScript, Python, dan Go hasil generate mengembalikan error yang sama, dalam urutan yang sama, dengan path dan pesan yang sama?

Ini bukan smoke test yang hanya memeriksa lolos/gagal. Seluruh daftar error dibandingkan.

```bash
schemapar parity user.schema.json --seed 7 --cases 100
```

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python + Go) — 230 inputs (100 valid, 130 invalid)
```

## Apa yang terjadi dalam satu run

```text
schema
  │
  ├─ buildCorpus(seed, cases)
  │     ├─ nilai valid sebanyak cases
  │     ├─ satu mutasi untuk tiap nilai valid
  │     └─ probe adversarial terkurasi
  │
  ├─ generate TypeScript ──► transpile di memori ──► validasi in-process
  ├─ generate Python ──────► tulis modul temp ─────► jalankan satu subprocess
  └─ generate Go ──────────► tulis modul temp ─────► go run .
  │
  └─ bandingkan daftar error lengkap tiap input
```

1. Schema di-parse dan divalidasi.
2. Corpus deterministik dibangun dari seed.
3. Validator TypeScript ditranspile di memori lalu di-import.
4. Validator Python dan runner kecil ditulis ke direktori sementara dan dijalankan sekali untuk seluruh corpus. Input dikirim lewat stdin sebagai JSON.
5. Jika Go tersedia, validator Go dan runner ditulis ke direktori sementara yang sama dengan `go.mod`, lalu dijalankan memakai `go run .`.
6. Setiap input dikirim ke setiap validator. Hasil dibandingkan dengan hasil TypeScript.
7. Direktori sementara dihapus.

## Pembentukan corpus

Untuk `--cases N`:

- **N sampel valid** — dihasilkan dari schema, mengikuti batas, tipe, dan format tiap field.
- **N mutasi** — setiap sampel valid di-clone dan dirusak satu kali.
- **Probe adversarial** — set terkurasi yang menyasar type confusion, batas, dan kasus sensitif Unicode.

Total input adalah `2 × N + probe adversarial`. Untuk schema contoh yang di-commit, set probe menyumbang 30 input, sehingga `--cases 50` menghasilkan 130 input dan `--cases 100` menghasilkan 230.

### Pembuatan sampel valid

Generator sadar schema, bukan sekadar kumpulan JSON acak:

- String disintesis dari struktur pattern — character class, grup, alternasi, dan quantifier — sehingga `^[0-9]{8,15}$` benar-benar menghasilkan nilai yang cocok.
- Jika `format` dan `pattern` sama-sama ada, kandidat harus memenuhi keduanya.
- Field `integer` tetap integer; batas numerik dihormati.
- Properti opsional kadang dihilangkan; properti nullable kadang diisi `null`.
- Constraint antar-field diperbaiki setelah generate, tanpa mengubah integer menjadi float.
- Record menghormati `minProperties`, termasuk nilai di atas batas lama delapan key.
- Key objek dan record diurutkan berdasarkan code point Unicode.

### Mutasi

Setiap sampel valid di-clone, lalu satu operasi diterapkan pada slot yang dipilih acak:

- mengganti nilai dengan kandidat type confusion (`"__mutated__"`, `0`, `1.5`, `true`, `null`, `[]`, `{}`);
- menghapus properti atau item array;
- menambahkan properti tak terduga (`__extra__`) atau item array.

Jika sampel tidak punya slot yang bisa ditelusuri, kandidat dipilih langsung. Mutasi memperluas cakupan negatif di kedalaman arbitrer tanpa menulis setiap kasus secara manual.

### Probe adversarial

Probe tetap mencakup:

- `undefined`, `null`, boolean, integer, float, string kosong, string non-ASCII, emoji;
- array dan objek dengan bentuk salah;
- string dengan newline di akhir, non-breaking space, teks mirip date, dan teks mirip date-time;
- probe per tipe seperti `not-an-email`, `999.1.1.1`, `:::1`, angka di luar rentang, `NaN`, enum/literal yang tidak cocok, serta pelanggaran panjang tuple/array.

`undefined`, `NaN`, dan infinity tidak bisa direpresentasikan dalam JSON, jadi harness mengenkodenya dengan marker wire khusus.

## Wire encoding

Input dienkode sebelum dikirim ke subprocess:

| Nilai JavaScript | Bentuk wire |
| --- | --- |
| `undefined` / `MISSING` | `{ "$missing": true }` |
| `NaN` | `{ "$nan": true }` |
| `Infinity` | `{ "$inf": 1 }` |
| `-Infinity` | `{ "$inf": -1 }` |

Array dan objek dienkode secara rekursif. Runner Python mendekode `$missing` menjadi sentinel `_MISSING`, `$nan` menjadi `float('nan')`, dan `$inf` menjadi `float('inf')`. Runner Go mendekodenya menjadi `Missing`, `math.NaN()`, dan `math.Inf(±1)`. Sisi TypeScript mendekode kembali menjadi `undefined`, `NaN`, dan `Infinity`.

Inilah yang memungkinkan pengujian kasus tepi paling penting, tempat bahasa biasanya berbeda.

## Apa yang dibandingkan

Untuk setiap input, `schemapar` membandingkan:

1. Jumlah error.
2. `message` setiap error.
3. Panjang `path` setiap error dan setiap elemennya, dalam urutan.

Hasilnya berupa salah satu dari:

```ts
{ errors: ValidationError[] }
```

atau, jika validator melempar exception:

```ts
{ exception: string }
```

Dua exception cocok hanya jika kedua sisi melempar dan string exception-nya sama. Exception di satu sisi dan error di sisi lain selalu mismatch.

Hasil TypeScript adalah baseline. Python dibandingkan dengan TypeScript, dan Go dibandingkan dengan TypeScript.

## Referensi CLI

```text
schemapar parity <schema.json> [options]
```

| Flag | Default | Arti |
| --- | --- | --- |
| `--seed <N>` | `42` | Seed PRNG; seed + versi sama = corpus sama |
| `--cases <N>` | `50` | Jumlah sampel valid (dan karena itu mutasi) |
| `--python <CMD>` | `python3`, lalu `python` | Executable Python |
| `--go <CMD>` | `go` | Executable Go |
| `--no-go` | nonaktif | Bandingkan TypeScript dan Python saja |

`--go` dan `--no-go` saling eksklusif.

Exit code:

| Kode | Arti |
| --- | --- |
| `0` | Parity terpenuhi |
| `1` | Schema error, mismatch, atau kegagalan runtime |
| `2` | Kesalahan penggunaan |

## Membaca mismatch

```text
✗ Parity FAILED — 1 mismatch(es)

  [valid#0]
    input:    {"id":"...","age":16}
    ts:       OK
    python:   OK
    go:       id: expected string
```

Setiap mismatch mencakup:

- `label` — `valid#<i>`, `mutation#<i>`, atau `adversarial`;
- `valueWire` — input terenkode yang memicu perbedaan;
- `tsResult` — error atau exception TypeScript;
- `pyResult` — error atau exception Python;
- `goResult` — hanya ada jika Go ikut dibandingkan.

Reproduksi dengan seed, jumlah kasus, schema, dan versi `schemapar` yang sama:

```bash
schemapar parity user.schema.json --seed 7 --cases 100
```

Corpus hasil generate deterministik untuk seed dan versi yang tetap. Perubahan codegen bisa secara sah mengubah nilai atau urutan hasil generate, jadi catat versinya bersama seed saat melaporkan bug.

## Deteksi Go

| Konfigurasi | Perilaku |
| --- | --- |
| Tanpa opsi | Bandingkan Go jika `go` ada di `PATH`; jika tidak, lewati dan isi `goSkipReason` |
| `go: true` / `--go <cmd>` | Wajibkan Go; gagal dengan jelas jika tidak tersedia |
| `go: false` / `--no-go` | Lewati Go; isi `goSkipReason` dengan `disabled by caller` |

Jika Go dilewati karena executable tidak ditemukan, CLI mencetak:

```text
note: Go toolchain not found; compared TS + Python only. Use --go <path> to force it.
```

## API programmatic

```ts
import { parseSchema, runParity } from 'schemapar';

const parsed = parseSchema(schemaJson);
if (!parsed.ok) throw new Error('invalid schema');

const result = await runParity(parsed.schema, {
  seed: 7,
  cases: 100,
  // pythonCommand: '/usr/bin/python3.12',
  // go: false,
  // goCommand: '/usr/local/go/bin/go',
});

console.log(result.total, result.validCount, result.invalidCount);
console.log(result.goCompared, result.goSkipReason);
for (const mismatch of result.mismatches) {
  console.log(mismatch.label, mismatch.valueWire);
  console.log(mismatch.tsResult, mismatch.pyResult, mismatch.goResult);
}
```

`ParityOptions`:

| Opsi | Tipe | Default | Arti |
| --- | --- | --- | --- |
| `seed` | number | `42` | Seed PRNG |
| `cases` | number | `50` | Sampel valid per run |
| `pythonCommand` | string | otomatis | Executable Python |
| `go` | boolean | otomatis | Sertakan/wajibkan/lewati Go |
| `goCommand` | string | `go` | Executable Go |

`ParityResult`:

| Field | Arti |
| --- | --- |
| `total` | Total input yang dibandingkan |
| `validCount` | Jumlah sampel valid hasil generate |
| `invalidCount` | Mutasi + probe adversarial |
| `mismatches` | Setiap input yang berbeda beserta semua hasil yang tersedia |
| `goCompared` | Apakah Go ikut dibandingkan |
| `goSkipReason` | Alasan Go dilewati, jika dilewati |

## Jaminan dan batasan

Dijamin oleh desain:

- Pesan, path, dan urutan error dibandingkan secara persis.
- Panjang string diukur dalam code point di semua target.
- Boolean tidak pernah diperlakukan sebagai angka.
- Integer menolak nilai pecahan, NaN, dan infinity.
- `undefined` melewati sentinel khusus bahasa.
- Key objek tak dikenal dan key record dikunjungi dalam urutan code point.
- Validasi mengakumulasi error alih-alih berhenti di error pertama.
- Hanya subset regex portabel yang mencapai codegen.

Batasan saat ini:

- Perbandingan adalah TypeScript ↔ Python dan TypeScript ↔ Go. Tidak ada perbandingan langsung Python ↔ Go; keduanya berpatokan pada hasil TypeScript.
- Format memvalidasi bentuk, bukan validitas semantik penuh. `date` tidak menolak `2020-13-40`.
- Run Go mengompilasi dengan `go run .`; run pertama bisa lebih lambat saat toolchain melakukan build.
- Corpus deterministik per seed dan versi, tidak stabil antar-perubahan codegen.
- Panic pada kode Go hasil generate membatalkan seluruh run Go, bukan menghasilkan exception per input.

## Memakai parity di CI

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
- uses: actions/setup-python@v5
  with:
    python-version: '3.12'
- uses: actions/setup-go@v5
  with:
    go-version: stable

- run: npm ci
- run: npx schemapar check schema/user.schema.json
- run: npx schemapar parity schema/user.schema.json --seed 7 --cases 100
```

Exit code non-zero menggagalkan job. Jika Go tidak terpasang di runner, perintah tetap berhasil dengan perbandingan dua bahasa; tambahkan `--go go` jika Go wajib untuk pipeline Anda.
