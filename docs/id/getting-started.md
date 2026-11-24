# Memulai

[English](../getting-started.md) | **Bahasa Indonesia**

Panduan ini membawa Anda dari direktori kosong sampai memiliki tiga validator hasil generate yang terbukti sepakat.

## Prasyarat

| Tool | Versi | Dibutuhkan untuk |
| --- | --- | --- |
| Node.js | 18+ | CLI dan library |
| Python | 3.8+ | Perbandingan TypeScript ↔ Python di `parity` |
| Go | 1.21+ | Perbandingan TypeScript ↔ Go di `parity`, dan compile target Go |

Go bersifat opsional. Jika tidak ada executable `go` di `PATH`, parity membandingkan TypeScript dan Python lalu melaporkan bahwa Go dilewati.

## Instalasi

```bash
npm install --save-dev schemapar
```

Panggil melalui `npx`:

```bash
npx schemapar --help
```

Atau install secara global:

```bash
npm install -g schemapar
schemapar --help
```

Jika paket belum tersedia di registry, jalankan dari checkout:

```bash
npm ci
npm run build
npm link        # opsional: menyediakan perintah `schemapar`
node dist/cli.js --help
```

Dari checkout tanpa `npm link`, ganti `npx schemapar` di bawah dengan `node dist/cli.js`.

## 1. Tulis schema

Buat `user.schema.json`:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "email": { "type": "string", "format": "email" },
    "name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "age": { "type": "integer", "min": 0, "max": 150, "optional": true },
    "role": { "type": "enum", "values": ["admin", "member", "guest"] },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "maxItems": 5
    }
  }
}
```

Setiap properti wajib kecuali schema-nya menetapkan `"optional": true`. Lihat [referensi schema](schema-reference.md) untuk DSL lengkap.

## 2. Periksa schema

```bash
npx schemapar check user.schema.json
```

Berhasil:

```text
Schema is valid.
```

Gagal akan mencetak setiap masalah beserta path-nya di dokumen schema dan keluar dengan kode `1`:

```text
Schema errors:
  /properties/age/minLenght: unknown field 'minLenght' for type 'integer'
```

`schemapar` sengaja menolak field tak dikenal: typo harus menggagalkan build, bukan diam-diam melonggarkan validasi.

## 3. Compile validator

```bash
npx schemapar compile user.schema.json --target ts --out user.validator.ts
npx schemapar compile user.schema.json --target py --out user_validator.py
npx schemapar compile user.schema.json --target go --out user_validator.go
```

Tanpa `--out`, source hasil generate ditulis ke stdout:

```bash
npx schemapar compile user.schema.json --target ts > user.validator.ts
```

| Flag | Arti |
| --- | --- |
| `--target ts` | Modul TypeScript |
| `--target py` | Modul Python |
| `--target go` | Package Go |
| `--out <file>` | Tulis ke file, bukan stdout |

Output bersifat deterministik: schema dan versi yang sama menghasilkan file yang identik byte per byte. Commit file hasil generate atau generate ulang di CI — keduanya bisa.

## 4. Pakai validator hasil generate

### TypeScript

```ts
import { validate, type Infer, type ValidationError } from './user.validator.js';

const value: unknown = JSON.parse(raw);

const errors: ValidationError[] = validate(value);
if (errors.length > 0) {
  for (const error of errors) {
    console.error(error.path.join('.'), error.message);
  }
  throw new Error('invalid user');
}

const user: Infer = value as Infer;
console.log(user.email);
```

`Infer` dihasilkan secara default dan mendeskripsikan bentuk yang tervalidasi. Gunakan `{ emitType: false }` pada `generateTypeScript` jika hanya ingin validatornya.

### Python

```python
import json
from user_validator import validate

payload = json.loads(raw)
errors = validate(payload)

if errors:
    for error in errors:
        print(".".join(str(p) for p in error["path"]), error["message"])
    raise ValueError("invalid user")
```

Setiap error adalah dictionary dengan `path` (list berisi nama properti dan indeks array) dan `message`.

### Go

Letakkan `user_validator.go` di direktori package, misalnya `validator/`. File ini default memakai `package validator` dan mengekspor `Validate`, `ValidationError`, serta `Missing`.

```go
package main

import (
	"encoding/json"
	"fmt"

	"example.com/app/validator"
)

func main() {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		panic(err)
	}

	for _, err := range validator.Validate(payload) {
		fmt.Println(err.Path, err.Message)
	}
}
```

Catatan:

- `Validate` mengharapkan bentuk yang sama dengan validator TypeScript dan Python. Untuk objek JSON, artinya `map[string]any`; `encoding/json` mendekode angka sebagai `float64`, dan validator hasil generate menanganinya.
- Properti opsional yang tidak ada direpresentasikan secara internal oleh sentinel `Missing` yang diekspor. JSON hasil decode dengan key yang tidak ada bekerja otomatis; gunakan `validator.Missing` hanya saat membangun map secara programatik dan perlu membedakan “tidak ada” dari nilai nol.
- Package hasil generate hanya memakai standard library Go.

## 5. Buktikan parity

```bash
npx schemapar parity user.schema.json --seed 7 --cases 100
```

Output yang diharapkan jika Go terpasang:

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python + Go) — 230 inputs (100 valid, 130 invalid)
```

Tanpa Go:

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python) — 230 inputs (100 valid, 130 invalid)
  note: Go toolchain not found; compared TS + Python only. Use --go <path> to force it.
```

Flag:

```text
--seed <N>       Seed PRNG (default: 42)
--cases <N>      Jumlah kasus valid (default: 50)
--python <CMD>   Executable Python (default: python3, lalu python)
--go <CMD>       Executable Go (default: go)
--no-go          Bandingkan TypeScript dan Python saja
```

Perbedaan apa pun keluar dengan kode `1` dan mencetak input penyebabnya beserta hasil tiap bahasa. Lihat [Pengujian parity](parity.md) untuk cara corpus dibangun dan apa yang dibandingkan.

## 6. Jalankan di CI

Install tool sebagai dev dependency, lalu jalankan `check` dan `parity` di pipeline. Contoh GitHub Actions:

```yaml
name: schema

on:
  push:
  pull_request:

jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

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

Jika Anda meng-commit validator hasil generate, tambahkan pengecekan kesegaran agar tidak diam-diam berbeda dari schema:

```bash
npx schemapar compile schema/user.schema.json --target ts --out validator/user.validator.ts
npx schemapar compile schema/user.schema.json --target py --out validator/user_validator.py
npx schemapar compile schema/user.schema.json --target go --out validator/user_validator.go
git diff --exit-code -- validator
```

## Exit code

| Kode | Arti |
| --- | --- |
| `0` | Berhasil |
| `1` | Schema tidak valid, mismatch parity, atau kegagalan runtime |
| `2` | Kesalahan penggunaan (argumen hilang, flag salah, command tak dikenal) |

## Troubleshooting

**`Python interpreter not found`**

Install Python 3.8+ atau berikan executable eksplisit:

```bash
npx schemapar parity user.schema.json --python /usr/bin/python3.12
```

**Go dilewati**

Install Go 1.21+ dan pastikan `go version` bekerja, atau arahkan ke binary:

```bash
npx schemapar parity user.schema.json --go /usr/local/go/bin/go
```

Gunakan `--no-go` jika memang ingin perbandingan dua bahasa.

**`--go and --no-go cannot be combined`**

Keduanya saling eksklusif. Pilih salah satu.

**Schema lolos `check` tetapi validator menolak data**

Jalankan `parity` lebih dulu. Jika parity lolos, schema dan semua validator hasil generate sepakat; masalahnya ada pada data atau asumsi Anda tentang suatu format. Periksa [tabel format](schema-reference.md#format-string) — format memvalidasi bentuk, bukan semantik penuh (misalnya `date` tidak memeriksa validitas kalender).

**File hasil generate terus berubah**

Generate ulang dengan versi `schemapar` yang sama dengan tim. Output codegen deterministik per versi, tetapi upgrade versi bisa mengubah format secara sah.

## Langkah berikutnya

- [Referensi schema](schema-reference.md) — semua tipe node dan aturan.
- [Pengujian parity](parity.md) — pembentukan corpus dan semantik perbandingan.
- [Arsitektur](architecture.md) — cara compiler dan generator bekerja secara internal.
