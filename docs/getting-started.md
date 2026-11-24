# Getting started

**English** | [Bahasa Indonesia](id/getting-started.md)

This guide takes you from an empty directory to three generated validators that provably agree.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 18+ | CLI and library |
| Python | 3.8+ | `parity` TypeScript ↔ Python comparison |
| Go | 1.21+ | `parity` TypeScript ↔ Go comparison, and compiling the Go target |

Go is optional. When no `go` executable is on `PATH`, parity compares TypeScript and Python and reports that Go was skipped.

## Install

```bash
npm install --save-dev schemapar
```

Then invoke it through `npx`:

```bash
npx schemapar --help
```

Or install it globally:

```bash
npm install -g schemapar
schemapar --help
```

If the package is not available from the registry yet, work from a checkout:

```bash
npm ci
npm run build
npm link        # optional: exposes the `schemapar` command
node dist/cli.js --help
```

From a checkout without `npm link`, replace `npx schemapar` below with `node dist/cli.js`.

## 1. Write a schema

Create `user.schema.json`:

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

Every property is required unless its schema sets `"optional": true`. See the [schema reference](schema-reference.md) for the full DSL.

## 2. Check the schema

```bash
npx schemapar check user.schema.json
```

Success:

```text
Schema is valid.
```

Failure prints every problem with its path into the schema document and exits with code `1`:

```text
Schema errors:
  /properties/age/minLenght: unknown field 'minLenght' for type 'integer'
```

`schemapar` rejects unknown fields on purpose: a typo should fail the build instead of silently enforcing less than intended.

## 3. Compile validators

```bash
npx schemapar compile user.schema.json --target ts --out user.validator.ts
npx schemapar compile user.schema.json --target py --out user_validator.py
npx schemapar compile user.schema.json --target go --out user_validator.go
```

Without `--out`, the generated source is written to stdout:

```bash
npx schemapar compile user.schema.json --target ts > user.validator.ts
```

| Flag | Meaning |
| --- | --- |
| `--target ts` | TypeScript module |
| `--target py` | Python module |
| `--target go` | Go package |
| `--out <file>` | Write to a file instead of stdout |

The output is deterministic: the same schema and version produce byte-identical files. Commit the generated files or regenerate them in CI — both work.

## 4. Use the generated validators

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

`Infer` is emitted by default and describes the validated shape. Pass `{ emitType: false }` to `generateTypeScript` if you only want the validator.

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

Each error is a dictionary with `path` (a list of property names and array indexes) and `message`.

### Go

Place `user_validator.go` in a package directory, for example `validator/`. The file defaults to `package validator` and exports `Validate`, `ValidationError` and `Missing`.

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

Notes:

- `Validate` expects the same shapes the TypeScript and Python validators receive. For JSON objects, that means `map[string]any`; `encoding/json` decodes numbers as `float64`, which the generated validator handles.
- A missing optional property is represented internally by the exported `Missing` sentinel. Decoded JSON with an absent key works automatically; use `validator.Missing` only when building maps programmatically and you need to distinguish “absent” from a zero value.
- The generated package uses only the Go standard library.

## 5. Prove parity

```bash
npx schemapar parity user.schema.json --seed 7 --cases 100
```

Expected output when Go is installed:

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python + Go) — 230 inputs (100 valid, 130 invalid)
```

Without Go:

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python) — 230 inputs (100 valid, 130 invalid)
  note: Go toolchain not found; compared TS + Python only. Use --go <path> to force it.
```

Flags:

```text
--seed <N>       PRNG seed (default: 42)
--cases <N>      Number of valid cases (default: 50)
--python <CMD>   Python executable (default: python3, then python)
--go <CMD>       Go executable (default: go)
--no-go          Compare TypeScript and Python only
```

Any mismatch exits with code `1` and prints the offending input plus each language's result. See [Parity testing](parity.md) for how the corpus is built and what exactly is compared.

## 6. Run it in CI

Install the tool as a dev dependency, then run `check` and `parity` in your pipeline. GitHub Actions example:

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

If you commit generated validators, add a freshness check so they cannot silently drift from the schema:

```bash
npx schemapar compile schema/user.schema.json --target ts --out validator/user.validator.ts
npx schemapar compile schema/user.schema.json --target py --out validator/user_validator.py
npx schemapar compile schema/user.schema.json --target go --out validator/user_validator.go
git diff --exit-code -- validator
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Invalid schema, parity mismatch, or runtime failure |
| `2` | Usage error (missing argument, bad flag, unknown command) |

## Troubleshooting

**`Python interpreter not found`**

Install Python 3.8+ or pass an explicit executable:

```bash
npx schemapar parity user.schema.json --python /usr/bin/python3.12
```

**Go is skipped**

Install Go 1.21+ and make sure `go version` works, or point at the binary:

```bash
npx schemapar parity user.schema.json --go /usr/local/go/bin/go
```

Use `--no-go` when you intentionally want a two-language comparison.

**`--go and --no-go cannot be combined`**

They are mutually exclusive. Pick one.

**A schema passes `check` but the validator rejects data**

Run `parity` first. If parity passes, the schema and all generated validators agree; the problem is the data or your assumptions about a format. Check the [format table](schema-reference.md#string-formats) — formats validate shape, not full semantics (for example, `date` does not check calendar validity).

**Generated files keep changing**

Regenerate with the same `schemapar` version used by the rest of the team. Codegen output is deterministic per version, but a version upgrade can legitimately change formatting.

## Next steps

- [Schema reference](schema-reference.md) — every node type and rule.
- [Parity testing](parity.md) — corpus construction and comparison semantics.
- [Architecture](architecture.md) — how the compiler and generators work internally.
