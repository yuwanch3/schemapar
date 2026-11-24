# Parity testing

**English** | [Bahasa Indonesia](id/parity.md)

`schemapar parity` answers one question:

> Given the same inputs, do the generated TypeScript, Python and Go validators return the same errors, in the same order, with the same paths and messages?

It is not a smoke test that only checks pass/fail. The complete error list is compared.

```bash
schemapar parity user.schema.json --seed 7 --cases 100
```

```text
Running parity: seed=7 cases=100
✓ Parity OK (TS + Python + Go) — 230 inputs (100 valid, 130 invalid)
```

## What happens in a run

```text
schema
  │
  ├─ buildCorpus(seed, cases)
  │     ├─ cases valid values
  │     ├─ one mutated sibling per valid value
  │     └─ curated adversarial probes
  │
  ├─ generate TypeScript ──► transpile in memory ──► validate in-process
  ├─ generate Python ──────► write temp module ───► run one subprocess
  └─ generate Go ──────────► write temp module ───► go run .
  │
  └─ compare each input's full error list
```

1. The schema is parsed and validated.
2. A deterministic corpus is built from the seed.
3. The TypeScript validator is transpiled in memory and imported.
4. The Python validator and a small runner are written to a temporary directory and executed once for the whole corpus. Input is piped over stdin as JSON.
5. When Go is available, the Go validator and runner are written to the same temporary directory with a `go.mod` and executed with `go run .`.
6. Every input is sent to every validator. Results are compared against the TypeScript result.
7. The temporary directory is removed.

## Corpus construction

For `--cases N`:

- **N valid samples** — generated from the schema, respecting each field's own bounds, types and formats.
- **N mutations** — each valid sample is cloned and corrupted once.
- **Adversarial probes** — a curated set targeting type confusion, boundaries and Unicode-sensitive cases.

Total inputs are therefore `2 × N + adversarial probes`. For the checked-in example schema, the probe set contributes 30 inputs, so `--cases 50` produces 130 inputs and `--cases 100` produces 230.

### Valid sample generation

The generator is schema-aware, not a bag of random JSON:

- Strings are synthesized from the pattern structure — character classes, groups, alternation and quantifiers — so `^[0-9]{8,15}$` actually produces matching values.
- When both `format` and `pattern` are present, a candidate must satisfy both.
- `integer` fields stay integers; numeric bounds are respected.
- Optional properties are omitted some of the time; nullable properties are set to `null` some of the time.
- Cross-field constraints are repaired after generation, without turning an integer into a float.
- Records honour `minProperties`, including values above the older eight-key cap.
- Object and record keys are ordered by Unicode code point.

### Mutations

Each valid sample is cloned, then one operation is applied at a randomly chosen slot:

- replace a value with a type-confusion candidate (`"__mutated__"`, `0`, `1.5`, `true`, `null`, `[]`, `{}`);
- delete a property or array item;
- add an unexpected property (`__extra__`) or array item.

If the sample has no traversable slots, a candidate is picked directly. Mutations widen negative coverage at arbitrary nesting levels without hand-writing every case.

### Adversarial probes

The fixed probes include:

- `undefined`, `null`, booleans, integers, a float, empty strings, non-ASCII strings, emoji;
- arrays and objects of the wrong shape;
- strings with a trailing newline, non-breaking space, date-like text and date-time-like text;
- per-type probes such as `not-an-email`, `999.1.1.1`, `:::1`, out-of-range numbers, `NaN`, enum/literal misses and tuple/array length violations.

`undefined`, `NaN` and infinities cannot be represented in JSON, so the harness encodes them with reserved wire markers.

## Wire encoding

Inputs are encoded before being piped to the subprocesses:

| JavaScript value | Wire form |
| --- | --- |
| `undefined` / `MISSING` | `{ "$missing": true }` |
| `NaN` | `{ "$nan": true }` |
| `Infinity` | `{ "$inf": 1 }` |
| `-Infinity` | `{ "$inf": -1 }` |

Arrays and objects are encoded recursively. The Python runner decodes `$missing` to its `_MISSING` sentinel, `$nan` to `float('nan')` and `$inf` to `float('inf')`. The Go runner decodes them to `Missing`, `math.NaN()` and `math.Inf(±1)`. The TypeScript side decodes back to `undefined`, `NaN` and `Infinity`.

This is what makes it possible to test the exact edge cases where languages usually drift.

## What is compared

For each input, `schemapar` compares:

1. The number of errors.
2. Each error's `message`.
3. Each error's `path` length and every element, in order.

A result is either:

```ts
{ errors: ValidationError[] }
```

or, if the validator threw:

```ts
{ exception: string }
```

Two exceptions match only when both sides threw and the exception strings are equal. An exception on one side and errors on the other is always a mismatch.

The TypeScript result is the baseline. Python is compared to TypeScript, and Go is compared to TypeScript.

## CLI reference

```text
schemapar parity <schema.json> [options]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed <N>` | `42` | PRNG seed; same seed + same version = same corpus |
| `--cases <N>` | `50` | Number of valid samples (and therefore mutations) |
| `--python <CMD>` | `python3`, then `python` | Python executable |
| `--go <CMD>` | `go` | Go executable |
| `--no-go` | off | Compare TypeScript and Python only |

`--go` and `--no-go` are mutually exclusive.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Parity holds |
| `1` | Schema error, mismatch, or runtime failure |
| `2` | Usage error |

## Reading a mismatch

```text
✗ Parity FAILED — 1 mismatch(es)

  [valid#0]
    input:    {"id":"...","age":16}
    ts:       OK
    python:   OK
    go:       id: expected string
```

Each mismatch includes:

- `label` — `valid#<i>`, `mutation#<i>`, or `adversarial`;
- `valueWire` — the encoded input that triggered the divergence;
- `tsResult` — TypeScript errors or exception;
- `pyResult` — Python errors or exception;
- `goResult` — present only when Go was compared.

Reproduce with the same seed, case count, schema and `schemapar` version:

```bash
schemapar parity user.schema.json --seed 7 --cases 100
```

The generated corpus is deterministic for a fixed seed and version. A codegen change can legitimately change generated values or ordering, so record the version alongside the seed when filing a bug.

## Go detection

| Configuration | Behavior |
| --- | --- |
| No option | Compare Go when `go` is on `PATH`; otherwise skip and set `goSkipReason` |
| `go: true` / `--go <cmd>` | Require Go; fail clearly when unavailable |
| `go: false` / `--no-go` | Skip Go; set `goSkipReason` to `disabled by caller` |

When Go is skipped because the executable is missing, the CLI prints:

```text
note: Go toolchain not found; compared TS + Python only. Use --go <path> to force it.
```

## Programmatic API

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

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `seed` | number | `42` | PRNG seed |
| `cases` | number | `50` | Valid samples per run |
| `pythonCommand` | string | auto | Python executable |
| `go` | boolean | auto | Include/require/skip Go |
| `goCommand` | string | `go` | Go executable |

`ParityResult`:

| Field | Meaning |
| --- | --- |
| `total` | Total inputs compared |
| `validCount` | Number of generated valid samples |
| `invalidCount` | Mutations + adversarial probes |
| `mismatches` | Every divergent input with all available results |
| `goCompared` | Whether Go participated |
| `goSkipReason` | Why Go was skipped, when it was |

## Guarantees and limits

Guaranteed by design:

- Error messages, paths and ordering are compared exactly.
- String length is measured in code points on every target.
- Booleans are never treated as numbers.
- Integers reject fractional values, NaN and infinities.
- `undefined` round-trips through language-specific sentinels.
- Unknown object keys and record keys are visited in code-point order.
- Validation accumulates errors instead of stopping at the first one.
- Only the portable regex subset reaches codegen.

Current limits:

- Comparison is TypeScript ↔ Python and TypeScript ↔ Go. There is no direct Python ↔ Go comparison; both are anchored to the TypeScript result.
- Formats validate shape, not full semantic validity. `date` does not reject `2020-13-40`.
- The Go run compiles with `go run .`; the first run can be slower while the toolchain builds.
- The corpus is deterministic per seed and version, not stable across codegen changes.
- A panic in generated Go code aborts the whole Go run rather than producing a per-input exception.

## Using parity in CI

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

A non-zero exit fails the job. If Go is not installed in the runner, the command still succeeds with a two-language comparison; add `--go go` if Go is mandatory for your pipeline.
