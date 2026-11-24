# Arsitektur

[English](../architecture.md) | **Bahasa Indonesia**

`schemapar` adalah compiler build-time plus differential tester. Tidak ada server, database, atau UI. Dokumen ini menjelaskan bagaimana komponen-komponennya bekerja dan mengapa validator hasil generate bisa dibandingkan hingga ke perilaku byte-per-byte.

## Alur proses

```text
                 ┌──────────────────────────────┐
 JSON schema ───►│ src/schema.ts                │
                 │ parse + validate + normalize │
                 └──────────────┬───────────────┘
                                │ SchemaNode AST
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   src/gen-ts.ts          src/gen-py.ts          src/gen-go.ts
   TypeScript source      Python source          Go source
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
                       src/generator.ts
                 corpus valid / invalid deterministik
                                │
                                ▼
                        src/parity.ts
          jalankan TS + Python (+ Go), bandingkan daftar error
                                │
                                ▼
                     output terminal / exit code
```

CLI di `src/cli.ts` adalah shell tipis di atas modul-modul ini. `src/index.ts` mengekspos fungsionalitas yang sama sebagai library.

## Modul

| Modul | Tanggung jawab |
| --- | --- |
| `src/schema.ts` | Tipe DSL, `FORMAT_PATTERNS`, `parseSchema()`, validasi field ketat, kebijakan regex portabel, terjemahan pattern Python/Go |
| `src/gen-ts.ts` | Codegen TypeScript: `validate()`, `Infer`, `ValidationError` |
| `src/gen-py.ts` | Codegen Python: `validate()`, `ValidationError`, `_MISSING` |
| `src/gen-go.ts` | Codegen Go: `Validate()`, `ValidationError`, `Missing` |
| `src/generator.ts` | PRNG mulberry32 ber-seed, sintesis nilai valid, mutasi, probe adversarial, perbaikan constraint |
| `src/parity.ts` | Orkestrasi corpus, wire encoding, transpilasi TS, runner Python/Go, perbandingan hasil |
| `src/cli.ts` | `compile`, `check`, `parity`, parsing argumen, exit code |
| `src/index.ts` | Permukaan API publik dan tipe |

## Parsing dan AST schema

`parseSchema(raw)` mengubah JSON tak tepercaya menjadi discriminated union berisi node bertipe. Parser sengaja ketat:

- Setiap node harus punya `type` yang dikenal.
- Field tak dikenal ditolak per tipe, sehingga typo gagal di `check` alih-alih melemahkan validasi.
- Batas numerik diperiksa tipe, tanda, integralitas, dan urutannya.
- Constraint antar-field harus mereferensikan properti yang dideklarasikan dan memakai bentuk yang diizinkan.
- Regex harus bisa dikompilasi dan berada dalam subset portabel.

AST hanya membawa data yang sudah dinormalisasi dan divalidasi. Generator tidak memvalidasi ulang schema; mereka bisa mengasumsikan AST sudah well-formed.

`FORMAT_PATTERNS` berada di `schema.ts` agar ketiga generator memakai satu definisi. Format tidak diimplementasikan ulang per bahasa; setiap generator hanya menerjemahkan anchor dan escape saat engine-nya membutuhkan.

## Pembuatan kode

Ketiga generator mengikuti pola yang sama:

1. Emit header dan tipe publik.
2. Emit validator publik yang membuat daftar error dan memanggil walker rekursif.
3. Telusuri AST, emit guard dan pengecekan ke blok bersarang.
4. Kumpulkan helper level modul selama penelusuran dan tambahkan di akhir.

Kode hasil generate sengaja polos: tanpa class, tanpa closure atas state pengguna, tanpa dependency runtime selain standard library tiap bahasa.

### TypeScript

```ts
export interface ValidationError {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

export type Infer = { /* bentuk yang diturunkan dari schema */ };

export function validate(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  walk(value, [], errors);
  return errors;
}
```

`Infer` dihasilkan secara default (`emitType: false` menonaktifkannya). Varian union dihasilkan sebagai fungsi helper terisolasi agar `return` atau guard di satu varian tidak memengaruhi varian lain. Comparator code point hanya dihasilkan jika diperlukan, karena sort default JavaScript membandingkan unit UTF-16.

### Python

```python
ValidationError = Dict[str, Any]
_MISSING = object()

def validate(value: Any) -> List[ValidationError]:
    ...
```

Modul hanya mengimpor `math`, `re`, dan `typing` dari standard library. `_MISSING` merepresentasikan nilai yang tidak ada. Helper kesetaraan ketat menetralkan perilaku `True == 1` dan `1 == 1.0` Python saat semantik JavaScript dibutuhkan.

### Go

```go
type ValidationError struct {
	Path    []any  `json:"path"`
	Message string `json:"message"`
}

var Missing any = missingSentinel{}

func Validate(value any) []ValidationError
```

Package default adalah `validator`; fungsi default adalah `Validate`. `math` selalu diimpor; `regexp`, `sort`, dan `unicode/utf8` hanya ditambahkan saat dipakai. Objek diharapkan sebagai `map[string]any`; angka hasil decode `encoding/json` datang sebagai `float64` dan ditangani helper numerik.

## Keputusan semantik lintas bahasa

Parity bukan kebetulan. Generator menanamkan keputusan yang sama:

| Aspek | Keputusan |
| --- | --- |
| Panjang string | Hitung code point Unicode: `[...s].length`, `len(s)`, `utf8.RuneCountInString` |
| Urutan key | Urutan code point Unicode; TypeScript memakai comparator kustom, Go mengandalkan urutan byte UTF-8 yang setara untuk UTF-8 valid |
| Boolean | Tidak pernah angka; subclass bool/int Python ditolak eksplisit |
| Integer | Tanpa bagian pecahan; NaN dan infinity ditolak |
| Angka JSON di Go | `float64` integral diterima, sesuai `Number.isInteger` |
| Kesetaraan | Sadar tipe, mengikuti `===` JavaScript |
| Nilai absen | `undefined` ↔ `_MISSING` ↔ `Missing` |
| Anchor regex | `$` Python menjadi `\Z`; Go tetap end-of-text |
| Unicode escape | `\uXXXX` menjadi `\x{XXXX}` untuk RE2 |
| Urutan error | Urutan deklarasi untuk properti, urutan code point untuk key dinamis, urutan indeks untuk array, constraint terakhir |
| Akumulasi error | Properti saudara dan pengecekan berikutnya tetap berjalan setelah kegagalan |
| Kegagalan bentuk | Node bertipe salah melaporkan satu error bentuk dan tidak turun ke anak |

## Pembuatan corpus

`buildCorpus(schema, seed, n)` mengembalikan dua daftar:

- `valid` — `n` sampel yang seharusnya memenuhi schema.
- `invalid` — `n` mutasi plus set adversarial khusus schema.

PRNG adalah mulberry32 yang dinormalisasi ke `uint32`. Seed dan versi yang sama menghasilkan corpus yang sama, sehingga kegagalan bisa direproduksi dari seed yang dicetak.

Sintesis valid sadar schema:

- string dihasilkan dari struktur pattern, bukan tebakan acak;
- format dan pattern diperiksa bersamaan jika keduanya ada;
- field integer tetap integral;
- cabang optional dan nullable diuji;
- constraint diperbaiki setelah generate tanpa mengubah tipe field;
- record bisa tumbuh melewati batas lama delapan key.

Mutasi meng-clone sampel valid lalu mengganti, menghapus, atau menambahkan satu slot. Probe adversarial mencakup tipe salah universal plus batas per tipe dan jebakan Unicode.

## Mesin parity

`runParity(schema, options)`:

1. Menentukan Python (`python3`, lalu `python`) dan opsional Go (`go`).
2. Membangun corpus.
3. Membuat direktori sementara.
4. Mentranspile TypeScript hasil generate dengan API compiler TypeScript (`transpileModule`) dan meng-import-nya dari file `.mjs` sementara.
5. Menulis validator Python plus runner dan menjalankannya sekali untuk seluruh corpus.
6. Opsional menulis validator Go plus runner dan `go.mod`, lalu menjalankan `go run .`.
7. Mengenkode setiap input dengan sentinel wire, menjalankannya melalui setiap validator, dan membandingkan hasil.
8. Menghapus direktori sementara di blok `finally`.

Sisi TypeScript berjalan in-process. Python dan Go berjalan sekali per corpus, bukan sekali per input, sehingga run besar tetap praktis.

### Mengapa sentinel wire ada

JSON tidak bisa merepresentasikan `undefined`, `NaN`, atau infinity. Nilai-nilai itulah tempat validator biasanya berbeda, jadi harness menyediakan marker objek khusus:

```json
{ "$missing": true }
{ "$nan": true }
{ "$inf": 1 }
```

Setiap runner mendekodenya menjadi representasi native bahasanya. Tanpa ini, kasus tepi paling menarik tidak bisa melewati batas proses.

### Perbandingan

`resultsEqual` membandingkan:

- jumlah error;
- string pesan;
- panjang path dan setiap elemen path.

Exception cocok hanya jika kedua sisi melempar dengan string yang sama. TypeScript adalah baseline; Python dan Go masing-masing dibandingkan dengannya.

## Determinisme

Determinisme adalah fitur, bukan efek samping:

- parsing schema menormalisasi ke AST yang stabil;
- generator mengemit properti dalam urutan deklarasi dan key dinamis dalam urutan code point;
- PRNG corpus ber-seed;
- kode hasil generate tidak mengandung timestamp atau output yang bergantung environment;
- CI menghasilkan ulang contoh yang di-commit dan gagal jika `git diff` tidak kosong.

Schema dan versi `schemapar` yang sama menghasilkan validator yang identik byte per byte.

## Strategi pengujian

`test/parity.test.ts` tanpa dependency (`node:assert`) dan mencakup:

- penerimaan dan penolakan schema, termasuk portabilitas regex;
- bentuk dan perilaku helper TS/Python/Go hasil generate;
- pembuatan corpus deterministik;
- parity untuk schema contoh, union, record, tuple, objek bersarang, dan constraint antar-field;
- akumulasi dan urutan error;
- string valid hasil generate benar-benar memenuhi pattern-nya;
- parity tiga arah saat Go tersedia, perilaku opt-out, dan kegagalan jelas saat Go diminta eksplisit tetapi tidak ada;
- kompilasi dan perbandingan Go (dilewati dengan rapi jika toolchain tidak terpasang).

Matriks test menjalankan typecheck, build, seluruh suite, smoke test parity CLI, dan pengecekan kesegaran contoh hasil generate pada Node 18, 20, dan 22 dengan Python dan Go tersedia. Job terpisah melakukan pack paket dan smoke test instalasi, resolusi tipe, serta import runtime.

## Pengemasan dan API publik

Paket adalah ESM (`"type": "module"`) dengan:

- `main`, `types`, dan `exports` kondisional yang menunjuk ke `dist`;
- `sideEffects: false`;
- `bin.schemapar` yang menunjuk ke `dist/cli.js`;
- `typescript` sebagai dependency runtime karena parity mentranspile kode hasil generate di memori;
- `prepublishOnly` yang menjalankan typecheck, test, dan build.

Validator hasil generate tetap tanpa dependency; hanya tool `schemapar` yang membutuhkan TypeScript.

## Titik ekstensi

Menambah tipe node membutuhkan:

1. Interface dan cabang parser baru di `schema.ts`.
2. Codegen di ketiga generator.
3. Pembuatan corpus dan probe adversarial di `generator.ts`.
4. Test parity untuk kasus positif dan negatif.

Menambah bahasa target membutuhkan `gen-<lang>.ts` baru, wiring ke CLI dan parity harness, serta runner yang berbicara protokol wire yang sama.

Arah yang direncanakan tercantum di [README utama](../../README.id.md#status-dan-roadmap) dan [CHANGELOG](../../CHANGELOG.id.md).
