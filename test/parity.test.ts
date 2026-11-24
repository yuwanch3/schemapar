/**
 * schemapar — self-tests
 *
 * Run with: npx tsx test/parity.test.ts
 *
 * These tests are deliberately dependency-free (node:assert only) so that
 * schemapar itself remains a zero-runtime-dependency tool.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

import {
  parseSchema,
  generateTypeScript,
  generatePython,
  generateGo,
  runParity,
  buildCorpus,
  generateValid,
  encodeForWire,
  Rng,
  FORMAT_PATTERNS,
} from '../src/index.js';
import type { SchemaNode } from '../src/index.js';

interface GenError {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

/**
 * Compile the generated TS the same way the parity engine does and import it.
 * This catches syntax/scope errors that a string-regex assertion cannot.
 */
async function loadGeneratedTs(schema: SchemaNode): Promise<(v: unknown) => GenError[]> {
  const out = transpileModule(generateTypeScript(schema), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  });
  const dir = mkdtempSync(join(tmpdir(), 'schemapar-test-'));
  const file = join(dir, 'validator.mjs');
  writeFileSync(file, out.outputText, 'utf8');
  const mod = (await import(pathToFileURL(file).href)) as {
    validate?: (v: unknown) => GenError[];
  };
  if (typeof mod.validate !== 'function') {
    throw new Error('generated TS validator does not export validate()');
  }
  return mod.validate;
}

/** True when a Go toolchain is on PATH. The Go test is skipped otherwise. */
function goIsAvailable(): boolean {
  try {
    return spawnSync('go', ['version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Compile a generated Go validator into a throwaway module and run the test
 * fixture over the provided values. The fixture understands the same wire
 * sentinels as the Python runner (`$missing`, `$nan`, `$inf`).
 */
function runGeneratedGo(
  schema: SchemaNode,
  values: ReadonlyArray<unknown>,
): ReadonlyArray<ReadonlyArray<GenError>> {
  const dir = mkdtempSync(join(tmpdir(), 'schemapar-go-'));
  try {
    writeFileSync(join(dir, 'validator.go'), generateGo(schema, { packageName: 'main' }), 'utf8');
    writeFileSync(
      join(dir, 'main.go'),
      readFileSync(resolve('test/fixtures/go-runner.go'), 'utf8'),
      'utf8',
    );
    // Node writes UTF-8 without a byte-order mark by default. Go rejects a
    // BOM in go.mod, so never use PowerShell's Set-Content here.
    writeFileSync(join(dir, 'go.mod'), 'module schemaparcheck\n\ngo 1.21\n', 'utf8');

    const wire = values.map((value) => ({ value: encodeForWire(value) }));
    const result = spawnSync('go', ['run', '.'], {
      cwd: dir,
      input: JSON.stringify(wire),
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      throw new Error(`go run exited ${result.status}:\n${result.stderr || result.stdout}`);
    }
    return JSON.parse(result.stdout) as GenError[][];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  ✗ ${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}\n`);
  }
}

function loadUserSchema() {
  const raw = readFileSync(resolve('examples/user.schema.json'), 'utf8');
  const parsed = parseSchema(JSON.parse(raw));
  if (!parsed.ok) {
    throw new Error(
      'examples/user.schema.json is invalid: ' +
        parsed.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
    );
  }
  return parsed.schema;
}

async function main(): Promise<void> {
  process.stdout.write('schemapar self-tests\n');

  // -------- schema validation -------------------------------------------
  await test('accepts a minimal schema', () => {
    const r = parseSchema({ type: 'string' });
    assert.equal(r.ok, true);
  });

  await test('rejects unknown type', () => {
    const r = parseSchema({ type: 'nope' });
    assert.equal(r.ok, false);
  });

  await test('rejects minLength > maxLength', () => {
    const r = parseSchema({ type: 'string', minLength: 5, maxLength: 2 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors[0]!.message, /minLength/);
  });

  await test('rejects lookbehind in pattern (Python parity)', () => {
    const r = parseSchema({ type: 'string', pattern: '(?<=x)y' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.errors[0]!.message, /lookbehind/);
  });

  await test('rejects duplicate enum values', () => {
    const r = parseSchema({ type: 'enum', values: ['a', 'a'] });
    assert.equal(r.ok, false);
  });

  // -------- codegen -----------------------------------------------------
  await test('generateTypeScript emits a validate() function', () => {
    const schema = loadUserSchema();
    const src = generateTypeScript(schema);
    assert.match(src, /export function validate\(value: unknown\): ValidationError\[\]/);
    assert.match(src, /export type Infer/);
    assert.match(src, /Object\.keys\(obj\d*\)\.sort\(_byCodePoint\)/);
  });

  await test('generatePython emits a validate() function with helpers', () => {
    const schema = loadUserSchema();
    const src = generatePython(schema);
    assert.match(src, /def validate\(value: Any\) -> List\[ValidationError\]:/);
    assert.match(src, /def _eq_strict\(/);
    assert.match(src, /def _is_number\(/);
    assert.match(src, /sorted\(/);
  });

  await test('generateGo emits a Validate() function with helpers', () => {
    const schema = loadUserSchema();
    const src = generateGo(schema);
    assert.match(src, /func Validate\(value any\) \[\]ValidationError/);
    assert.match(src, /type ValidationError struct/);
    assert.match(src, /var Missing any = missingSentinel\{\}/);
    assert.match(src, /utf8\.RuneCountInString/);
    assert.match(src, /sort\.Strings/);
    assert.match(src, /regexp\.MustCompile/);
  });

  await test('generated TS does not redeclare _cpLen in the same scope', () => {
    const schema = parseSchema({
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 1 },
        b: { type: 'string', maxLength: 4 },
      },
    });
    assert.equal(schema.ok, true);
    if (!schema.ok) return;
    const src = generateTypeScript(schema.schema);
    // Two sibling string nodes must each be wrapped in their own block.
    assert.match(src, /\{\s*\n\s*const _cpLen/);
  });

  // -------- corpus ------------------------------------------------------
  await test('buildCorpus produces deterministic output for a fixed seed', () => {
    const schema = loadUserSchema();
    const a = buildCorpus(schema, 7, 10);
    const b = buildCorpus(schema, 7, 10);
    assert.deepEqual(
      a.valid.map((c) => c.value),
      b.valid.map((c) => c.value),
    );
  });

  // -------- parity (end-to-end) ----------------------------------------
  await test('parity holds for examples/user.schema.json', async () => {
    const schema = loadUserSchema();
    const result = await runParity(schema, { seed: 1234, cases: 40 });
    if (result.mismatches.length > 0) {
      const first = result.mismatches[0]!;
      throw new Error(
        `${result.mismatches.length} mismatch(es); first:\n` +
          `  input=${JSON.stringify(first.valueWire)}\n` +
          `  ts=${JSON.stringify(first.tsResult)}\n` +
          `  py=${JSON.stringify(first.pyResult)}`,
      );
    }
    assert.equal(result.mismatches.length, 0);
  });

  await test('parity holds for a union-heavy schema', async () => {
    const r = parseSchema({
      type: 'array',
      items: {
        type: 'union',
        variants: [
          { type: 'integer', min: -10, max: 10 },
          { type: 'string', minLength: 1, maxLength: 3 },
          { type: 'literal', value: null },
          { type: 'boolean' },
        ],
      },
      maxItems: 4,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const result = await runParity(r.schema, { seed: 99, cases: 30 });
    if (result.mismatches.length > 0) {
      const first = result.mismatches[0]!;
      throw new Error(
        `${result.mismatches.length} mismatch(es); first:\n` +
          `  input=${JSON.stringify(first.valueWire)}\n` +
          `  ts=${JSON.stringify(first.tsResult)}\n` +
          `  py=${JSON.stringify(first.pyResult)}`,
      );
    }
    assert.equal(result.mismatches.length, 0);
  });

  // -------- Phase 2: record / tuple / constraints ----------------------
  await test('parity holds for a record schema', async () => {
    const r = parseSchema({
      type: 'record',
      values: { type: 'integer', min: 0, max: 100 },
      minProperties: 1,
      maxProperties: 4,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const result = await runParity(r.schema, { seed: 11, cases: 40 });
    if (result.mismatches.length > 0) {
      const first = result.mismatches[0]!;
      throw new Error(
        `${result.mismatches.length} mismatch(es); first:\n` +
          `  input=${JSON.stringify(first.valueWire)}\n` +
          `  ts=${JSON.stringify(first.tsResult)}\n` +
          `  py=${JSON.stringify(first.pyResult)}`,
      );
    }
    assert.equal(result.mismatches.length, 0);
  });

  await test('parity holds for a tuple schema', async () => {
    const r = parseSchema({
      type: 'tuple',
      items: [
        { type: 'string', minLength: 1 },
        { type: 'integer', min: 0 },
        { type: 'boolean' },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const result = await runParity(r.schema, { seed: 21, cases: 40 });
    if (result.mismatches.length > 0) {
      const first = result.mismatches[0]!;
      throw new Error(
        `${result.mismatches.length} mismatch(es); first:\n` +
          `  input=${JSON.stringify(first.valueWire)}\n` +
          `  ts=${JSON.stringify(first.tsResult)}\n` +
          `  py=${JSON.stringify(first.pyResult)}`,
      );
    }
    assert.equal(result.mismatches.length, 0);
  });

  await test('parity holds for cross-field constraints (numeric)', async () => {
    const r = parseSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        min: { type: 'integer', min: 0, max: 100 },
        max: { type: 'integer', min: 0, max: 100 },
      },
      constraints: [
        { kind: 'lessOrEqual', left: 'min', right: 'max' },
        { kind: 'notEqual', left: 'min', right: 'max', message: 'min and max must differ' },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const result = await runParity(r.schema, { seed: 31, cases: 60 });
    if (result.mismatches.length > 0) {
      const first = result.mismatches[0]!;
      throw new Error(
        `${result.mismatches.length} mismatch(es); first:\n` +
          `  input=${JSON.stringify(first.valueWire)}\n` +
          `  ts=${JSON.stringify(first.tsResult)}\n` +
          `  py=${JSON.stringify(first.pyResult)}`,
      );
    }
    assert.equal(result.mismatches.length, 0);
  });

  await test('parity holds for requiredTogether constraint', async () => {
    const r = parseSchema({
      type: 'object',
      properties: {
        username: { type: 'string', minLength: 1, optional: true },
        password: { type: 'string', minLength: 1, optional: true },
      },
      constraints: [
        { kind: 'requiredTogether', fields: ['username', 'password'] },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const result = await runParity(r.schema, { seed: 41, cases: 40 });
    if (result.mismatches.length > 0) {
      const first = result.mismatches[0]!;
      throw new Error(
        `${result.mismatches.length} mismatch(es); first:\n` +
          `  input=${JSON.stringify(first.valueWire)}\n` +
          `  ts=${JSON.stringify(first.tsResult)}\n` +
          `  py=${JSON.stringify(first.pyResult)}`,
      );
    }
    assert.equal(result.mismatches.length, 0);
  });

  await test('rejects constraint referencing unknown property', () => {
    const r = parseSchema({
      type: 'object',
      properties: { a: { type: 'integer' } },
      constraints: [{ kind: 'lessThan', left: 'a', right: 'missing' }],
    });
    assert.equal(r.ok, false);
  });

  // -------- P0 regressions: codegen scoping + error accumulation --------
  await test('generated TS loads with nested and sibling object properties', async () => {
    const r = parseSchema({
      type: 'object',
      properties: {
        addr: { type: 'object', properties: { street: { type: 'string' } } },
        bill: { type: 'object', properties: { city: { type: 'string' } } },
      },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const validate = await loadGeneratedTs(r.schema);
    assert.deepEqual(validate({ addr: { street: 1 }, bill: { city: 2 } }), [
      { path: ['addr', 'street'], message: 'expected string' },
      { path: ['bill', 'city'], message: 'expected string' },
    ]);
  });

  await test('reports every failing required property, including ones after an optional', async () => {
    const r = parseSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        a: { type: 'string', optional: true },
        b: { type: 'integer' },
        c: { type: 'string' },
        d: { type: 'string' },
      },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const validate = await loadGeneratedTs(r.schema);
    assert.deepEqual(validate({ e: 1 }), [
      { path: ['b'], message: 'expected integer' },
      { path: ['c'], message: 'expected string' },
      { path: ['d'], message: 'expected string' },
      { path: ['e'], message: 'unexpected property' },
    ]);
  });

  await test('validates every array item after a failing item', async () => {
    const r = parseSchema({ type: 'array', items: { type: 'string' } });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const validate = await loadGeneratedTs(r.schema);
    assert.deepEqual(validate([1, 'ok', 3]), [
      { path: [0], message: 'expected string' },
      { path: [2], message: 'expected string' },
    ]);
  });

  await test('skips constraints when the object is structurally invalid', async () => {
    const r = parseSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        min: { type: 'integer', min: 0, max: 100 },
        max: { type: 'integer', min: 0, max: 100 },
      },
      constraints: [{ kind: 'lessOrEqual', left: 'min', right: 'max' }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const validate = await loadGeneratedTs(r.schema);
    assert.deepEqual(validate({ min: 'x', max: 1 }), [
      { path: ['min'], message: 'expected integer' },
    ]);
    assert.deepEqual(validate({ min: 5, max: 1 }), [
      { path: [], message: 'constraint failed: min <= max' },
    ]);
  });

  await test('parity holds for nested objects, arrays and optional-before-required fields', async () => {
    const r = parseSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        note: { type: 'string', optional: true },
        address: {
          type: 'object',
          additionalProperties: false,
          properties: {
            street: { type: 'string', minLength: 1 },
            zip: { type: 'string', pattern: '^[0-9]{5}$' },
          },
        },
        tags: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 3 },
      },
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const result = await runParity(r.schema, { seed: 2024, cases: 30 });
    if (result.mismatches.length > 0) {
      const first = result.mismatches[0]!;
      throw new Error(
        `${result.mismatches.length} mismatch(es); first:\n` +
          `  input=${JSON.stringify(first.valueWire)}\n` +
          `  ts=${JSON.stringify(first.tsResult)}\n` +
          `  py=${JSON.stringify(first.pyResult)}`,
      );
    }
    assert.equal(result.mismatches.length, 0);
  });

  // -------- P1 regressions: regex subset, literals, Unicode length ------
  await test('rejects pattern constructs that diverge between JS and Python', () => {
    for (const pattern of ['^\\d+$', '^\\w+$', '\\bword\\b', '\\q', '\\a', '[]', '\\u{41}', '\\cA', '\\1']) {
      const r = parseSchema({ type: 'string', pattern });
      assert.equal(r.ok, false, `expected ${JSON.stringify(pattern)} to be rejected`);
    }
    for (const pattern of ['^[0-9]+$', '^abc$', '[$]', '\\$', '\\\\d', '[a-z]{2,4}']) {
      const r = parseSchema({ type: 'string', pattern });
      assert.equal(r.ok, true, `expected ${JSON.stringify(pattern)} to be accepted`);
    }
  });

  await test('generated valid strings actually satisfy their pattern', () => {
    const cases: ReadonlyArray<{ pattern: string; minLength?: number; maxLength?: number }> = [
      { pattern: '^[0-9]{8,15}$' },
      { pattern: '^(foo|bar)$' },
      { pattern: '^[A-Z]{2}[0-9]{3}$' },
      { pattern: '^a+b*c?$' },
      { pattern: '^[^0-9]{3,5}$' },
      { pattern: '^[A-Z]{20}$' },
      { pattern: '^[a-z]+$', minLength: 2, maxLength: 3 },
      { pattern: '^\\$[0-9]+\\.[0-9]{2}$' },
    ];
    for (const { pattern, minLength, maxLength } of cases) {
      const r = parseSchema({ type: 'string', pattern, minLength, maxLength });
      assert.equal(r.ok, true, `${pattern}: ${JSON.stringify(r.ok ? [] : r.errors)}`);
      if (!r.ok) continue;
      const re = new RegExp(pattern);
      const rng = new Rng(17);
      for (let i = 0; i < 25; i++) {
        const value = generateValid(r.schema, rng);
        assert.equal(typeof value, 'string', pattern);
        const text = value as string;
        assert.ok(re.test(text), `${pattern} did not match ${JSON.stringify(text)}`);
        if (minLength !== undefined) assert.ok([...text].length >= minLength);
        if (maxLength !== undefined) assert.ok([...text].length <= maxLength);
      }
    }
  });

  await test('$ anchor does not match a trailing newline (TS + Python parity)', async () => {
    const r = parseSchema({ type: 'string', pattern: '^abc$' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const validate = await loadGeneratedTs(r.schema);
    assert.deepEqual(validate('abc'), []);
    assert.deepEqual(validate('abc\n'), [
      { path: [], message: 'string does not match pattern' },
    ]);
    const result = await runParity(r.schema, { seed: 7, cases: 10 });
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches[0]));
  });

  await test('format checks reject trailing newlines in both languages', async () => {
    for (const [format, bad] of [
      ['date', '2020-01-01\n'],
      ['date-time', '2020-01-01T00:00:00Z\n'],
    ] as const) {
      const r = parseSchema({ type: 'string', format });
      assert.equal(r.ok, true);
      if (!r.ok) continue;
      const validate = await loadGeneratedTs(r.schema);
      assert.deepEqual(validate(bad), [
        { path: [], message: `string does not match format ${format}` },
      ]);
      const result = await runParity(r.schema, { seed: 9, cases: 10 });
      assert.equal(result.mismatches.length, 0, `${format}: ${JSON.stringify(result.mismatches[0])}`);
    }
  });

  await test('every format generates samples accepted by its own regex', async () => {
    for (const format of Object.keys(FORMAT_PATTERNS) as Array<keyof typeof FORMAT_PATTERNS>) {
      const r = parseSchema({ type: 'string', format });
      assert.equal(r.ok, true, `${format}: ${JSON.stringify(r.ok ? [] : r.errors)}`);
      if (!r.ok) continue;
      const re = new RegExp(FORMAT_PATTERNS[format]);
      const validate = await loadGeneratedTs(r.schema);
      const rng = new Rng(77);
      for (let i = 0; i < 20; i++) {
        const value = generateValid(r.schema, rng);
        assert.equal(typeof value, 'string', format);
        const text = value as string;
        assert.ok(re.test(text), `${format} sample ${JSON.stringify(text)} does not match`);
        assert.deepEqual(validate(text), [], `${format} sample ${JSON.stringify(text)} rejected`);
      }
    }
  });

  await test('format + pattern generation satisfies both constraints', async () => {
    const r = parseSchema({
      type: 'string',
      format: 'email',
      pattern: '^[a-z]+@example\\.com$',
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const formatRe = new RegExp(FORMAT_PATTERNS.email);
    const patternRe = new RegExp(r.schema.type === 'string' ? r.schema.pattern! : '');
    const validate = await loadGeneratedTs(r.schema);
    const rng = new Rng(91);
    for (let i = 0; i < 25; i++) {
      const value = generateValid(r.schema, rng) as string;
      assert.match(value, patternRe, `case ${i}`);
      assert.match(value, formatRe, `case ${i}`);
      assert.deepEqual(validate(value), [], `case ${i}: ${JSON.stringify(value)}`);
    }
    const result = await runParity(r.schema, { seed: 91, cases: 20 });
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches[0]));
  });

  await test('parity holds for every format and a format+pattern pair', async () => {
    const r = parseSchema({
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        (Object.keys(FORMAT_PATTERNS) as Array<keyof typeof FORMAT_PATTERNS>).map((format) => [
          format.replace('-', '_'),
          { type: 'string', format },
        ]),
      ),
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const result = await runParity(r.schema, { seed: 314, cases: 20 });
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches[0]));
  });

  await test('literal error messages escape backslashes and newlines identically', async () => {
    for (const value of ['C:\\temp', 'a\nb', "it's"]) {
      const r = parseSchema({ type: 'literal', value });
      assert.equal(r.ok, true);
      if (!r.ok) continue;
      const expected = `expected literal ${JSON.stringify(value)}`;
      const validate = await loadGeneratedTs(r.schema);
      assert.deepEqual(validate('nope'), [{ path: [], message: expected }]);
      const result = await runParity(r.schema, { seed: 3, cases: 5 });
      assert.equal(result.mismatches.length, 0, `${JSON.stringify(value)}: ${JSON.stringify(result.mismatches[0])}`);
    }
  });

  await test('string length counts Unicode code points, not UTF-16 units', async () => {
    const r = parseSchema({ type: 'string', minLength: 1, maxLength: 2 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const validate = await loadGeneratedTs(r.schema);
    assert.deepEqual(validate('🎉'), []);
    assert.deepEqual(validate('🎉🎉'), []);
    assert.deepEqual(validate('🎉🎉🎉'), [
      { path: [], message: 'string longer than 2' },
    ]);
  });

  await test('every generated valid case passes the generated validator', async () => {
    const schema = loadUserSchema();
    const validate = await loadGeneratedTs(schema);
    const corpus = buildCorpus(schema, 7, 60);
    for (const c of corpus.valid) {
      assert.deepEqual(validate(c.value), [], `${c.label}: ${JSON.stringify(c.value)}`);
    }
  });

  // -------- P2 regressions: strict keys, record size, constraints, sort ---
  await test('rejects unknown schema fields and unknown constraint fields', () => {
    const typo = parseSchema({ type: 'string', minLenght: 3 });
    assert.equal(typo.ok, false);
    if (!typo.ok) {
      assert.equal(typo.errors[0]!.path.join('/'), 'minLenght');
      assert.match(typo.errors[0]!.message, /unknown field 'minLenght'/);
    }

    const wrongType = parseSchema({ type: 'boolean', minLength: 1 });
    assert.equal(wrongType.ok, false);

    const badConstraint = parseSchema({
      type: 'object',
      properties: { a: { type: 'integer' }, b: { type: 'integer' } },
      constraints: [{ kind: 'lessThan', left: 'a', right: 'b', typo: true }],
    });
    assert.equal(badConstraint.ok, false);
    if (!badConstraint.ok) {
      assert.match(badConstraint.errors[0]!.message, /unknown field 'typo'/);
    }

    const ok = parseSchema({ type: 'string', minLength: 1, optional: true, nullable: true });
    assert.equal(ok.ok, true);
  });

  await test('record generation honours minProperties above the old 8-key cap', async () => {
    const r = parseSchema({
      type: 'record',
      values: { type: 'integer', min: 0, max: 9 },
      minProperties: 12,
      maxProperties: 12,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    const value = generateValid(r.schema, new Rng(5)) as Record<string, unknown>;
    assert.equal(Object.keys(value).length, 12);
    for (const v of Object.values(value)) {
      assert.equal(typeof v, 'number');
      assert.ok(Number.isInteger(v));
    }

    const validate = await loadGeneratedTs(r.schema);
    assert.deepEqual(validate(value), []);
    const result = await runParity(r.schema, { seed: 5, cases: 10 });
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches[0]));
  });

  await test('constraint repair keeps generated values inside each field schema', async () => {
    const r = parseSchema({
      type: 'object',
      properties: {
        low: { type: 'integer', min: 10, max: 20 },
        high: { type: 'integer', min: 0, max: 5 },
        mirrored: { type: 'integer', min: 0, max: 20 },
        same: { type: 'integer', min: 10, max: 30 },
      },
      constraints: [
        { kind: 'greaterThan', left: 'low', right: 'high' },
        { kind: 'equal', left: 'mirrored', right: 'same' },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    const rng = new Rng(31);
    const validate = await loadGeneratedTs(r.schema);
    for (let i = 0; i < 25; i++) {
      const value = generateValid(r.schema, rng) as Record<string, unknown>;
      assert.deepEqual(validate(value), [], `case ${i}: ${JSON.stringify(value)}`);
      assert.ok(Number.isInteger(value['low']));
      assert.ok(Number.isInteger(value['high']));
      assert.ok((value['low'] as number) > (value['high'] as number));
      assert.ok((value['low'] as number) >= 10 && (value['low'] as number) <= 20);
      assert.ok((value['high'] as number) >= 0 && (value['high'] as number) <= 5);
      assert.equal(value['mirrored'], value['same']);
    }

    const result = await runParity(r.schema, { seed: 31, cases: 25 });
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches[0]));
  });

  await test('sorts object and record keys by code point, matching Python', async () => {
    const astral = '\u{1F600}';
    const replacement = '\uFFFD';

    const obj = parseSchema({ type: 'object', additionalProperties: false, properties: {} });
    assert.equal(obj.ok, true);
    if (!obj.ok) return;
    const validateObj = await loadGeneratedTs(obj.schema);
    assert.deepEqual(validateObj({ [astral]: 1, [replacement]: 1 }), [
      { path: [replacement], message: 'unexpected property' },
      { path: [astral], message: 'unexpected property' },
    ]);
    const objParity = await runParity(obj.schema, { seed: 13, cases: 5 });
    assert.equal(objParity.mismatches.length, 0, JSON.stringify(objParity.mismatches[0]));

    const rec = parseSchema({ type: 'record', values: { type: 'string', minLength: 1 } });
    assert.equal(rec.ok, true);
    if (!rec.ok) return;
    const validateRec = await loadGeneratedTs(rec.schema);
    assert.deepEqual(validateRec({ [astral]: 0, [replacement]: 0 }), [
      { path: [replacement], message: 'expected string' },
      { path: [astral], message: 'expected string' },
    ]);
    const recParity = await runParity(rec.schema, { seed: 13, cases: 5 });
    assert.equal(recParity.mismatches.length, 0, JSON.stringify(recParity.mismatches[0]));
  });

  await test('mutation corpus is deterministic and mirrors the valid count', () => {
    const schema = loadUserSchema();
    const a = buildCorpus(schema, 7, 10);
    const b = buildCorpus(schema, 7, 10);
    assert.deepEqual(
      a.invalid.map((c) => [c.label, c.value]),
      b.invalid.map((c) => [c.label, c.value]),
    );
    const mutations = a.invalid.filter((c) => c.label.startsWith('mutation#'));
    assert.equal(mutations.length, a.valid.length);
    assert.equal(mutations.length, 10);
    assert.ok(
      mutations.some((c, i) => JSON.stringify(c.value) !== JSON.stringify(a.valid[i]!.value)),
      'expected at least one mutation to differ from its source value',
    );
  });

  await test('three-way parity reports Go when available', async () => {
    const result = await runParity(loadUserSchema(), { seed: 5, cases: 8 });
    if (goIsAvailable()) {
      assert.equal(result.goCompared, true);
      assert.equal(result.goSkipReason, undefined);
    } else {
      assert.equal(result.goCompared, false);
      assert.match(result.goSkipReason ?? '', /go executable/);
    }
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches[0]));
  });

  await test('parity can opt out of Go explicitly', async () => {
    const result = await runParity(loadUserSchema(), { seed: 5, cases: 5, go: false });
    assert.equal(result.goCompared, false);
    assert.equal(result.goSkipReason, 'disabled by caller');
    assert.equal(result.mismatches.length, 0);
  });

  await test('explicitly requested but missing Go fails clearly', async () => {
    await assert.rejects(
      () =>
        runParity(loadUserSchema(), {
          seed: 1,
          cases: 1,
          go: true,
          goCommand: 'schemapar-definitely-not-a-go-binary',
        }),
      /Go toolchain not found/,
    );
  });

  await test('generated Go validator compiles and matches TypeScript', async () => {
    if (!goIsAvailable()) {
      process.stdout.write('    (skipped: go toolchain not found)\n');
      return;
    }

    const r = parseSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email' },
        id: { type: 'string', format: 'uuid' },
        at: { type: 'string', format: 'date-time' },
        clock: { type: 'string', format: 'time' },
        host: { type: 'string', format: 'hostname' },
        ip4: { type: 'string', format: 'ipv4' },
        ip6: { type: 'string', format: 'ipv6' },
        link: { type: 'string', format: 'uri' },
        code: { type: 'string', pattern: '^\\u0041[0-9]{2,4}$' },
        strictEmail: { type: 'string', format: 'email', pattern: '^[a-z]+@example\\.com$' },
        low: { type: 'integer', min: 10, max: 20 },
        high: { type: 'integer', min: 0, max: 5 },
        same: { type: 'integer', min: 0, max: 30 },
        mirror: { type: 'integer', min: 0, max: 30 },
        nested: {
          type: 'record',
          values: { type: 'string', minLength: 1 },
          minProperties: 1,
          maxProperties: 3,
        },
        pair: { type: 'tuple', items: [{ type: 'string' }, { type: 'integer' }] },
        choice: {
          type: 'union',
          variants: [
            { type: 'literal', value: 'a' },
            { type: 'integer', min: 0 },
          ],
        },
        note: { type: 'string', nullable: true, optional: true, maxLength: 5 },
      },
      constraints: [
        { kind: 'greaterThan', left: 'low', right: 'high' },
        { kind: 'equal', left: 'same', right: 'mirror' },
      ],
    });
    assert.equal(r.ok, true, JSON.stringify(r.ok ? [] : r.errors));
    if (!r.ok) return;

    const validateTs = await loadGeneratedTs(r.schema);
    const corpus = buildCorpus(r.schema, 77, 20);
    const cases = [...corpus.valid, ...corpus.invalid];
    const values = cases.map((c) => c.value);
    const goResults = runGeneratedGo(r.schema, values);

    assert.equal(goResults.length, values.length);
    for (let i = 0; i < cases.length; i++) {
      assert.deepEqual(
        goResults[i],
        validateTs(cases[i]!.value),
        `${cases[i]!.label}: value=${JSON.stringify(cases[i]!.value)}`,
      );
    }
  });

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
