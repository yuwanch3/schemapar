# Architecture

**English** | [Bahasa Indonesia](id/architecture.md)

`schemapar` is a build-time compiler plus a differential tester. It has no server, database or UI. This document explains how the pieces fit together and why the generated validators can be compared byte-for-byte in behavior.

## Pipeline

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
                 deterministic valid / invalid corpus
                                │
                                ▼
                        src/parity.ts
          run TS + Python (+ Go), compare error lists
                                │
                                ▼
                     terminal output / exit code
```

The CLI in `src/cli.ts` is a thin shell over these modules. `src/index.ts` exposes the same functionality as a library.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/schema.ts` | DSL types, `FORMAT_PATTERNS`, `parseSchema()`, strict field validation, portable regex policy, Python/Go pattern translation |
| `src/gen-ts.ts` | TypeScript codegen: `validate()`, `Infer`, `ValidationError` |
| `src/gen-py.ts` | Python codegen: `validate()`, `ValidationError`, `_MISSING` |
| `src/gen-go.ts` | Go codegen: `Validate()`, `ValidationError`, `Missing` |
| `src/generator.ts` | Seeded mulberry32 PRNG, valid value synthesis, mutations, adversarial probes, constraint repair |
| `src/parity.ts` | Corpus orchestration, wire encoding, TS transpilation, Python/Go runners, result comparison |
| `src/cli.ts` | `compile`, `check`, `parity`, argument parsing, exit codes |
| `src/index.ts` | Public API surface and types |

## Parsing and the schema AST

`parseSchema(raw)` turns untrusted JSON into a discriminated union of typed nodes. It is intentionally strict:

- Every node must have a known `type`.
- Unknown fields are rejected per type, so typos fail `check` instead of weakening validation.
- Numeric bounds are checked for type, sign, integrality and ordering.
- Cross-field constraints must reference declared properties and use an allowed shape.
- Regexes must compile and stay inside the portable subset.

The AST carries only normalized, validated data. Generators never re-validate the schema; they can assume the AST is well-formed.

`FORMAT_PATTERNS` lives in `schema.ts` so all three generators share one definition. A format is not re-implemented per language; each generator only translates anchors and escapes where its engine requires it.

## Code generation

All three generators follow the same shape:

1. Emit a header and public types.
2. Emit a public validator that creates an error list and calls a recursive walker.
3. Walk the AST, emitting guards and checks into nested blocks.
4. Collect module-level helpers while walking and append them at the end.

The generated code is deliberately plain: no classes, no closures over user state, no runtime dependency beyond each language's standard library.

### TypeScript

```ts
export interface ValidationError {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

export type Infer = { /* shape derived from the schema */ };

export function validate(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  walk(value, [], errors);
  return errors;
}
```

`Infer` is emitted by default (`emitType: false` disables it). Union variants are emitted as isolated helper functions so a `return` or guard inside one variant cannot affect another. A code-point comparator is emitted only when needed, because JavaScript's default sort compares UTF-16 code units.

### Python

```python
ValidationError = Dict[str, Any]
_MISSING = object()

def validate(value: Any) -> List[ValidationError]:
    ...
```

The module imports only `math`, `re` and `typing` from the standard library. `_MISSING` represents absent values. Strict equality helpers neutralize Python's `True == 1` and `1 == 1.0` behavior where JavaScript semantics are required.

### Go

```go
type ValidationError struct {
	Path    []any  `json:"path"`
	Message string `json:"message"`
}

var Missing any = missingSentinel{}

func Validate(value any) []ValidationError
```

The default package is `validator`; the default function is `Validate`. `math` is always imported; `regexp`, `sort` and `unicode/utf8` are added only when used. Objects are expected as `map[string]any`; numbers decoded by `encoding/json` arrive as `float64` and are handled by numeric helpers.

## Cross-language semantic decisions

Parity is not accidental. The generators encode the same decisions:

| Concern | Decision |
| --- | --- |
| String length | Count Unicode code points: `[...s].length`, `len(s)`, `utf8.RuneCountInString` |
| Key order | Unicode code-point order; TypeScript uses a custom comparator, Go relies on UTF-8 byte order, which is equivalent for valid UTF-8 |
| Booleans | Never numbers; Python's bool/int subclassing is explicitly rejected |
| Integers | No fractional part; NaN and infinities rejected |
| JSON numbers in Go | Integral `float64` accepted, matching `Number.isInteger` |
| Equality | Type-aware, mirroring JavaScript `===` |
| Absent value | `undefined` ↔ `_MISSING` ↔ `Missing` |
| Regex anchors | Python `$` becomes `\Z`; Go stays end-of-text |
| Unicode escapes | `\uXXXX` becomes `\x{XXXX}` for RE2 |
| Error order | Declaration order for properties, code-point order for dynamic keys, index order for arrays, constraints last |
| Error accumulation | Siblings and later checks continue after a failure |
| Shape failures | A wrong-typed node reports one shape error and does not descend |

## Corpus generation

`buildCorpus(schema, seed, n)` returns two lists:

- `valid` — `n` samples that should satisfy the schema.
- `invalid` — `n` mutations plus a schema-specific adversarial set.

The PRNG is mulberry32, normalized to `uint32`. The same seed and version therefore produce the same corpus, which makes failures reproducible from a printed seed.

Valid synthesis is schema-aware:

- strings are generated from the pattern's structure, not by random guessing;
- format and pattern are checked together when both exist;
- integer fields stay integral;
- optional and nullable branches are exercised;
- constraints are repaired after generation without changing field types;
- records can grow beyond the old eight-key cap.

Mutations clone a valid sample and replace, delete or add one slot. Adversarial probes cover universal wrong types plus per-type boundaries and Unicode traps.

## Parity engine

`runParity(schema, options)`:

1. Resolves Python (`python3`, then `python`) and optionally Go (`go`).
2. Builds the corpus.
3. Creates a temporary directory.
4. Transpiles the generated TypeScript with the TypeScript compiler API (`transpileModule`) and imports it from a temporary `.mjs` file.
5. Writes the Python validator plus a runner and executes it once for the whole corpus.
6. Optionally writes the Go validator plus a runner and `go.mod`, then executes `go run .`.
7. Encodes every input with wire sentinels, runs it through every validator, and compares results.
8. Deletes the temporary directory in a `finally` block.

The TypeScript side runs in-process. Python and Go run once per corpus rather than once per input, which keeps large runs practical.

### Why wire sentinels exist

JSON cannot represent `undefined`, `NaN` or infinities. Those are exactly the values where validators drift, so the harness reserves object markers:

```json
{ "$missing": true }
{ "$nan": true }
{ "$inf": 1 }
```

Each runner decodes them into its language's native representation. Without this, the most interesting edge cases could not cross the process boundary.

### Comparison

`resultsEqual` compares:

- error count;
- message strings;
- path lengths and every path element.

Exceptions match only when both sides threw with the same string. TypeScript is the baseline; Python and Go are each compared to it.

## Determinism

Determinism is a feature, not a side effect:

- schema parsing normalizes into a stable AST;
- generators emit properties in declaration order and dynamic keys in code-point order;
- the corpus PRNG is seeded;
- generated code has no timestamps or environment-dependent output;
- CI regenerates the checked-in examples and fails if `git diff` is non-empty.

The same schema and `schemapar` version produce byte-identical validators.

## Testing strategy

`test/parity.test.ts` is dependency-free (`node:assert`) and covers:

- schema acceptance and rejection, including regex portability;
- generated TS/Python/Go shape and helper behavior;
- deterministic corpus generation;
- parity for the example schema, unions, records, tuples, nested objects and cross-field constraints;
- error accumulation and ordering;
- generated valid strings satisfying their patterns;
- three-way parity when Go is available, opt-out behavior, and clear failure when Go is explicitly requested but missing;
- Go compilation and comparison (skipped gracefully when no toolchain is installed).

The test matrix runs typecheck, build, the full suite, a CLI parity smoke test and a generated-examples freshness check on Node 18, 20 and 22 with Python and Go available. A separate job packs the package and smoke-tests installation, type resolution and runtime imports.

## Packaging and public API

The package is ESM (`"type": "module"`) with:

- `main`, `types` and conditional `exports` pointing at `dist`;
- `sideEffects: false`;
- `bin.schemapar` pointing at `dist/cli.js`;
- `typescript` as a runtime dependency because parity transpiles generated code in memory;
- `prepublishOnly` running typecheck, tests and build.

Generated validators remain dependency-free; only the `schemapar` tool itself needs TypeScript.

## Extension points

Adding a node type requires:

1. A new interface and parser branch in `schema.ts`.
2. Codegen in all three generators.
3. Corpus generation and adversarial probes in `generator.ts`.
4. Parity tests covering positive and negative cases.

Adding a target language requires a new `gen-<lang>.ts`, wiring it into the CLI and parity harness, and a runner that speaks the same wire protocol.

Planned directions are listed in the [README](../README.md#status-and-roadmap) and [CHANGELOG](../CHANGELOG.md).
