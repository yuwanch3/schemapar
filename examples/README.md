# Examples

**English** | [Bahasa Indonesia](README.id.md)

This directory contains one schema and the three validators generated from it. They are checked in so you can read the output without building the tool, and CI regenerates them to ensure they never drift.

| File | Description |
| --- | --- |
| [`user.schema.json`](user.schema.json) | Source schema |
| [`user.validator.ts`](user.validator.ts) | Generated TypeScript validator |
| [`user_validator.py`](user_validator.py) | Generated Python validator |
| [`user_validator.go`](user_validator.go) | Generated Go validator (`package validator`) |

## The schema

`user.schema.json` describes a user record with:

- required `id` (UUID), `email`, `name`, `role`, `nickname` (nullable), `tags` and `contact`;
- optional `age` (integer 0–150);
- `additionalProperties: false`, so unknown keys are rejected;
- a `contact` union of two shapes:
  - `{ "kind": "email", "value": <email> }`
  - `{ "kind": "phone", "value": <8–15 digits> }`.

A valid payload:

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

Some failures:

| Payload change | Error |
| --- | --- |
| `"age": 200` | `["age"] integer greater than 150` |
| remove `email` | `["email"] expected string` |
| `"contact": { "kind": "phone", "value": "abc" }` | `["contact"] value matched no union variant` |
| add `"admin": true` | `["admin"] unexpected property` |

## Regenerate

From the repository root:

```bash
npm run build

node dist/cli.js compile examples/user.schema.json --target ts --out examples/user.validator.ts
node dist/cli.js compile examples/user.schema.json --target py --out examples/user_validator.py
node dist/cli.js compile examples/user.schema.json --target go --out examples/user_validator.go
```

Or, with the package installed:

```bash
npx schemapar compile examples/user.schema.json --target ts --out examples/user.validator.ts
npx schemapar compile examples/user.schema.json --target py --out examples/user_validator.py
npx schemapar compile examples/user.schema.json --target go --out examples/user_validator.go
```

The output is deterministic. CI reruns these commands and fails if `git diff` reports a change.

## Use the generated validators

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

Place `user_validator.go` in a package directory such as `validator/`, then:

```go
import "example.com/app/validator"

errs := validator.Validate(payload) // payload is map[string]any
```

## Prove parity

```bash
node dist/cli.js parity examples/user.schema.json --seed 7 --cases 100
```

Expected when Go is installed:

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python + Go) — 230 inputs (100 valid, 130 invalid)
```

See [Parity testing](../docs/parity.md) for what the corpus contains and what is compared.
