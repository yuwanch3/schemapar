# schemapar

**Write a schema once. Compile validators for TypeScript, Python and Go. _Prove_ they behave identically.**

`schemapar` is a build-time CLI and library for teams whose services are written in more than one language. Define a data contract in a small JSON DSL, generate dependency-free validators, then fuzz all generated validators against the same corpus and compare their **full error lists**. If two implementations diverge — even by one error path or message — the build fails.

```text
$ schemapar parity examples/user.schema.json
Running parity: seed=42 cases=50
✓ Parity OK (TS + Python + Go) — 130 inputs (50 valid, 80 invalid)
```

[![CI](https://github.com/yuwanch3/schemapar/actions/workflows/ci.yml/badge.svg)](https://github.com/yuwanch3/schemapar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Targets](https://img.shields.io/badge/targets-TypeScript%20%7C%20Python%20%7C%20Go-informational.svg)](#generated-validators)

**English** | [Bahasa Indonesia](README.id.md)

---

## Why

A frontend in TypeScript, a service in Go and a backend in Python often validate the same JSON. The rules are rewritten in each language and slowly drift:

- one side accepts `1.5` where another requires an integer;
- one side counts an emoji as 2 characters, another as 1;
- one side sorts unexpected keys, another reports them in insertion order;
- regexes, error messages and error paths stop matching.

Type generators such as protobuf, quicktype or OpenAPI describe _shapes_, not _behavior_. `schemapar` treats validator behavior as the contract and tests it directly.

## Quick start

```bash
npm install --save-dev schemapar
```

If the package is not available from the registry yet, run it from a checkout instead:

```bash
npm ci
npm run build
npm link        # optional: exposes the `schemapar` command
node dist/cli.js --help
```

The commands below use `schemapar`. From a checkout without `npm link`, use `node dist/cli.js` in its place.

Create `user.schema.json`:

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

Check the schema, then compile it:

```bash
schemapar check user.schema.json

schemapar compile user.schema.json --target ts --out user.validator.ts
schemapar compile user.schema.json --target py --out user_validator.py
schemapar compile user.schema.json --target go --out user_validator.go
```

Prove that all three validators agree:

```bash
schemapar parity user.schema.json --seed 7 --cases 100
```

`parity` generates valid values, mutates each one, adds adversarial probes, runs the corpus through every generated validator, and compares paths, messages and ordering. It exits non-zero on any mismatch.

## Generated validators

| Target | Output | Public API |
| --- | --- | --- |
| TypeScript | `.ts` module | `validate(value): ValidationError[]`, `Infer`, `ValidationError` |
| Python | `.py` module | `validate(value) -> list[ValidationError]`, `ValidationError` |
| Go | Go package (`package validator` by default) | `Validate(value any) []ValidationError`, `ValidationError`, `Missing` |

The generated files have **zero runtime dependencies**. Vendor them into your project, commit them, or regenerate them in CI. `schemapar` itself is not needed at runtime.

For Go, an absent optional property is represented by the exported `Missing` sentinel, mirroring JavaScript's `undefined`.

## Documentation

| Document | Contents |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, first schema, generated APIs, CI integration |
| [Schema reference](docs/schema-reference.md) | Every node type, modifier, constraint, format and regex rule |
| [Parity testing](docs/parity.md) | Corpus generation, comparison rules, CLI flags, mismatch reports |
| [Architecture](docs/architecture.md) | Pipeline, codegen design, determinism, parity internals |
| [Examples](examples/README.md) | The checked-in example schema and generated validators |
| [Contributing](CONTRIBUTING.md) | Local development, tests and change guidelines |
| [Changelog](CHANGELOG.md) | Release history |
| [Dokumentasi Indonesia](docs/id/README.md) | Versi Bahasa Indonesia dari dokumentasi ini |

## Schema at a glance

A schema is a JSON object. Every node has a `type` and may carry `optional` and/or `nullable`.

| `type` | Fields |
| --- | --- |
| `string` | `minLength`, `maxLength`, `pattern`, `format` |
| `number` | `min`, `max` |
| `integer` | `min`, `max` |
| `boolean` | — |
| `literal` | `value` (string \| number \| boolean \| null) |
| `enum` | `values` (non-empty array of string \| number \| boolean) |
| `array` | `items`, `minItems`, `maxItems` |
| `object` | `properties`, `additionalProperties` (default `true`), `constraints` |
| `record` | `values`, `minProperties`, `maxProperties` |
| `tuple` | `items` (non-empty positional array) |
| `union` | `variants` (non-empty array) |
| `any` | — |

Supported string formats: `email`, `uuid`, `date`, `date-time`, `time`, `hostname`, `ipv4`, `ipv6`, `uri`.

Unknown fields are rejected, so a typo such as `minLenght` fails `check` instead of silently enforcing less than intended. See the [schema reference](docs/schema-reference.md) for field rules and examples.

Cross-field constraints are declared on `object` nodes:

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

## Parity guarantees

The generated validators are engineered so the following are identical across TypeScript, Python and Go:

- **Error messages** — baked at generation time.
- **Error paths and order** — paths such as `["contact", "value"]`; unexpected object and record keys are visited in Unicode **code-point** order.
- **String length** — counted in Unicode code points, not UTF-16 units.
- **Number semantics** — booleans are never numbers; integers reject fractional values; NaN and infinities are rejected.
- **Enum/literal comparison** — type-aware, matching JavaScript `===`.
- **Absent values** — JavaScript `undefined` maps to `_MISSING` in Python and `Missing` in Go.
- **Regex semantics** — a portable subset is enforced by the parser; `$` becomes `\Z` in Python, and `\uXXXX` becomes `\x{XXXX}` in Go.
- **Error accumulation** — one failing property does not stop validation of its siblings or later checks.

Read [Parity testing](docs/parity.md) for the exact comparison rules and corpus construction.

## Programmatic API

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

`runParity` compares Go automatically when a toolchain is available. Pass `go: false` to compare TypeScript and Python only, `go: true` to require Go, or `goCommand` to select a specific executable. The result exposes `goCompared` and, when skipped, `goSkipReason`.

## Requirements

- **Node.js 18+** to run the CLI and library.
- **Python 3.8+** for `parity` (TypeScript ↔ Python comparison).
- **Go 1.21+** optional; when `go` is on `PATH`, `parity` compiles and compares the Go validator too.

`schemapar` depends on `typescript` at runtime because `parity` transpiles the generated TypeScript validator in memory. The generated validators remain dependency-free.

## Project layout

```text
src/
  schema.ts     # DSL types, format patterns, parseSchema(), regex policy
  gen-ts.ts     # TypeScript validator codegen
  gen-py.ts     # Python validator codegen
  gen-go.ts     # Go validator codegen (RE2)
  generator.ts  # Deterministic PRNG + valid/adversarial corpus builder
  parity.ts     # Runs validators, compares full error lists
  cli.ts        # compile | check | parity
  index.ts      # Public API
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
npm test        # self-tests, including TS/Python/Go parity when toolchains exist
npm run build
```

The test matrix runs typecheck, build, the full self-test suite, a CLI parity smoke test and a generated-examples freshness check on Node 18, 20 and 22 with Python and Go available. A separate job packs the package and smoke-tests installation, type resolution and runtime imports.

## Status and roadmap

Current release line: **0.1.0**. Supported node types: `string`, `number`, `integer`, `boolean`, `literal`, `enum`, `array`, `object`, `record`, `tuple`, `union`, `any`, plus cross-field constraints (`greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`, `equal`, `notEqual`, `requiredTogether`) and nine string formats.

Planned:

- Rust codegen target.
- Additional targets such as Java and C#.
- Richer semantic format checks beyond the documented shapes.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). In short: keep generated output deterministic, keep the three validators in lockstep, and add a parity test for every behavior change.

## License

MIT — see [LICENSE](LICENSE).
