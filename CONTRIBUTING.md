# Contributing

**English** | [Bahasa Indonesia](CONTRIBUTING.id.md)

Thanks for considering a contribution. `schemapar` is a small compiler with an unusually strict correctness bar: every generated language must behave identically. Changes are welcome when they preserve that bar.

## Before you start

- For a bug, include the schema, the seed and case count, your OS, and the versions of Node, Python, Go and `schemapar`.
- For a new node type, format or target language, open an issue first so the semantics can be agreed before codegen is written.
- Do not weaken parity to make a test pass. Fix the behavior or document the limitation.

## Setup

Requirements:

- Node.js 18+
- Python 3.8+ (for parity)
- Go 1.21+ (optional, for the Go target and three-way parity)

```bash
git clone https://github.com/yuwanch3/schemapar.git
cd schemapar
npm ci
npm run build
```

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # self-tests; Go cases skip when no toolchain is present
npm run build       # emit dist/
npm run dev -- check examples/user.schema.json
npm run parity -- examples/user.schema.json --seed 7 --cases 100
```

Run the full suite before opening a pull request. If Go is installed, make sure the Go test actually runs rather than being skipped.

## Conventions

### Generated code

- Generated validators must have **zero runtime dependencies** beyond each language's standard library.
- Output must be deterministic: no timestamps, random identifiers or environment-dependent formatting.
- Error messages are baked at generation time and must be identical across targets.
- Dynamic keys (unknown object properties, record keys) are visited in Unicode code-point order.
- Validation accumulates errors; it does not stop at the first failure.
- A wrong-typed node reports one shape error and does not descend into children.

### Schema parsing

- Reject unknown fields rather than ignoring them.
- Validate bounds, references and constraint shapes at parse time.
- Keep regexes inside the portable subset enforced by `findPatternProblem`.
- If a construct cannot be supported identically in ECMA-262, Python `re` and Go RE2, reject it.

### TypeScript style

The project uses strict TypeScript with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. Prefer explicit types at module boundaries, readonly data, and small pure functions. ESM imports use `.js` extensions.

## Adding a node type

1. Add the interface and parser branch in `src/schema.ts`.
2. Add the type to `KNOWN_TYPES`, `TYPE_FIELDS` and the `SchemaNode` union.
3. Implement codegen in `src/gen-ts.ts`, `src/gen-py.ts` and `src/gen-go.ts`.
4. Add generation and adversarial probes in `src/generator.ts`.
5. Add tests in `test/parity.test.ts` for valid values, invalid values, nested use and error ordering.
6. Update `docs/schema-reference.md` and, if useful, `examples/user.schema.json` plus regenerated examples.

## Adding a string format

1. Add the regex source to `FORMAT_PATTERNS` in `src/schema.ts`. It must be portable across all three engines.
2. Add a sample generator and adversarial probe in `src/generator.ts`.
3. Add a parity test covering accepted and rejected values.
4. Document the format and its limitations in `docs/schema-reference.md`.

## Adding a target language

1. Create `src/gen-<lang>.ts` with a generator and options type.
2. Export it from `src/index.ts`.
3. Wire `--target` in `src/cli.ts`.
4. Add a runner to `src/parity.ts` that speaks the same wire protocol (`$missing`, `$nan`, `$inf`).
5. Add the language to the mismatch report and success line.
6. Add compile-and-compare tests.
7. Update the README, docs and CI.

## Regenerating examples

The checked-in validators must stay in sync with the schema:

```bash
node dist/cli.js compile examples/user.schema.json --target ts --out examples/user.validator.ts
node dist/cli.js compile examples/user.schema.json --target py --out examples/user_validator.py
node dist/cli.js compile examples/user.schema.json --target go --out examples/user_validator.go
```

CI regenerates them and fails on `git diff`. Commit the regenerated files with the schema or generator change that caused them.

## Tests

`test/parity.test.ts` is deliberately dependency-free and uses `node:assert/strict`. A typical addition:

```ts
test('reports every failing required property', () => {
  // ...
});
```

Prefer behavior-level tests over string snapshots. When a test concerns a cross-language guarantee, exercise all available targets rather than only TypeScript.

## Pull requests

- Keep changes focused and explain the parity impact.
- Include the commands you ran and their results.
- Mention whether Go was available locally.
- Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.
- Do not commit `node_modules`, `dist`, tarballs or debug files.

## Reporting a parity bug

Please include:

- the schema (or a minimal reproduction);
- the `schemapar` version from `package.json` (or the commit SHA);
- the exact command, seed and case count;
- the mismatch report, including the input and each language's result;
- Node, Python and Go versions.

A reproducible seed is the fastest path to a fix.
