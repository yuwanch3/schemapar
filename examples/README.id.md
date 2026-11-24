# Contoh

[English](README.md) | **Bahasa Indonesia**

Direktori ini berisi satu schema dan tiga validator yang dihasilkan darinya. File-file ini di-commit agar Anda bisa membaca output tanpa membangun tool, dan CI menghasilkan ulang untuk memastikan tidak pernah berbeda.

| File | Deskripsi |
| --- | --- |
| [`user.schema.json`](user.schema.json) | Schema sumber |
| [`user.validator.ts`](user.validator.ts) | Validator TypeScript hasil generate |
| [`user_validator.py`](user_validator.py) | Validator Python hasil generate |
| [`user_validator.go`](user_validator.go) | Validator Go hasil generate (`package validator`) |

## Schema

`user.schema.json` mendeskripsikan record user dengan:

- `id` (UUID), `email`, `name`, `role`, `nickname` (nullable), `tags`, dan `contact` yang wajib;
- `age` opsional (integer 0–150);
- `additionalProperties: false`, sehingga key tak dikenal ditolak;
- union `contact` dengan dua bentuk:
  - `{ "kind": "email", "value": <email> }`
  - `{ "kind": "phone", "value": <8–15 digit> }`.

Payload valid:

```json
{
  "id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "email": "ada@example.com",
  "name": "Ada",
  "age": 36,
  "role": "admin",
  "nickname": null,
  "tags": ["math"],
  "contact": { "kind": "email", "value": "ada@example.com" }
}
```

Beberapa kegagalan:

| Perubahan payload | Error |
| --- | --- |
| `"age": 200` | `["age"] integer greater than 150` |
| hapus `email` | `["email"] expected string` |
| `"contact": { "kind": "phone", "value": "abc" }` | `["contact"] value matched no union variant` |
| tambah `"admin": true` | `["admin"] unexpected property` |

## Generate ulang

Dari root repository:

```bash
npm run build

node dist/cli.js compile examples/user.schema.json --target ts --out examples/user.validator.ts
node dist/cli.js compile examples/user.schema.json --target py --out examples/user_validator.py
node dist/cli.js compile examples/user.schema.json --target go --out examples/user_validator.go
```

Atau, dengan paket terpasang:

```bash
npx schemapar compile examples/user.schema.json --target ts --out examples/user.validator.ts
npx schemapar compile examples/user.schema.json --target py --out examples/user_validator.py
npx schemapar compile examples/user.schema.json --target go --out examples/user_validator.go
```

Output deterministik. CI menjalankan ulang perintah ini dan gagal jika `git diff` melaporkan perubahan.

## Pakai validator hasil generate

### TypeScript

```ts
import { validate, type Infer } from './user.validator.js';

const errors = validate(payload);
const user: Infer = payload as Infer;
```

### Python

```python
from user_validator import validate

errors = validate(payload)
```

### Go

Letakkan `user_validator.go` di direktori package seperti `validator/`, lalu:

```go
import "example.com/app/validator"

errs := validator.Validate(payload) // payload adalah map[string]any
```

## Buktikan parity

```bash
node dist/cli.js parity examples/user.schema.json --seed 7 --cases 100
```

Output yang diharapkan jika Go terpasang:

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python + Go) — 230 inputs (100 valid, 130 invalid)
```

Lihat [Pengujian parity](../docs/id/parity.md) untuk isi corpus dan apa yang dibandingkan.
