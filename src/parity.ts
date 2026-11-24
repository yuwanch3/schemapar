/**
 * schemapar — parity engine
 *
 * Runs the generated TypeScript validator and the generated Python validator
 * against the SAME corpus of inputs, then compares the full error lists
 * (path + message, order-sensitive). Any divergence is a parity failure.
 *
 * Mechanics:
 *  - TypeScript side: the generated module is transpiled to ESM in-memory
 *    and imported from a temp file. That keeps `validate` in-process and fast.
 *  - Python side: the generated module + a tiny runner are written to a temp
 *    directory and invoked once per corpus via a single subprocess, with the
 *    corpus piped over stdin as JSON.
 *  - Special values (undefined / NaN / ±Infinity) cannot round-trip through
 *    JSON, so they are encoded with reserved wire markers on the way in and
 *    decoded back to native values on each side.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

import type { SchemaNode } from './schema.js';
import { generateTypeScript } from './gen-ts.js';
import { generatePython } from './gen-py.js';
import { generateGo } from './gen-go.js';
import { buildCorpus, MISSING } from './generator.js';

export interface ValidationError {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

export type ValidatorResult =
  | { readonly errors: ReadonlyArray<ValidationError> }
  | { readonly exception: string };

export interface ParityMismatch {
  readonly label: string;
  readonly valueWire: unknown;
  readonly tsResult: ValidatorResult;
  readonly pyResult: ValidatorResult;
  /** Present only when the Go validator was part of this run. */
  readonly goResult?: ValidatorResult;
}

export interface ParityResult {
  readonly total: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly mismatches: ReadonlyArray<ParityMismatch>;
  /** True when a Go validator was compiled and compared. */
  readonly goCompared: boolean;
  /** Why Go was skipped, when `goCompared` is false. */
  readonly goSkipReason?: string;
}

export interface ParityOptions {
  /** PRNG seed. Default: 42. */
  readonly seed?: number;
  /** Number of generated valid cases per run. Default: 50. */
  readonly cases?: number;
  /** Override the python executable (e.g. 'python', '/usr/bin/python3.12'). */
  readonly pythonCommand?: string;
  /**
   * Include the Go validator. Default: auto-detect.
   *
   * - `undefined` — compare Go when a `go` executable is on PATH, otherwise
   *   skip and set `goSkipReason`.
   * - `true` — require Go; throw when it is unavailable.
   * - `false` — compare TypeScript and Python only.
   */
  readonly go?: boolean;
  /** Override the Go executable (e.g. 'go', 'C:\\Go\\bin\\go.exe'). */
  readonly goCommand?: string;
}

// ---------------------------------------------------------------------------
// Wire encoding for values JSON cannot represent
// ---------------------------------------------------------------------------

const MISSING_KEY = '$missing';
const NAN_KEY = '$nan';
const INF_KEY = '$inf';

export function encodeForWire(v: unknown): unknown {
  if (v === MISSING || v === undefined) return { [MISSING_KEY]: true };
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { [NAN_KEY]: true };
    if (!Number.isFinite(v)) return { [INF_KEY]: v > 0 ? 1 : -1 };
    return v;
  }
  if (Array.isArray(v)) return v.map(encodeForWire);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = encodeForWire(val);
    }
    return out;
  }
  return v;
}

/** Decode a wire value back to a JS value the generated TS validator expects. */
function decodeForTs(wire: unknown): unknown {
  if (wire === null || typeof wire !== 'object') return wire;
  if (Array.isArray(wire)) return wire.map(decodeForTs);
  const obj = wire as Record<string, unknown>;
  if (obj[MISSING_KEY] === true) return undefined;
  if (obj[NAN_KEY] === true) return NaN;
  if (INF_KEY in obj) return (obj[INF_KEY] as number) > 0 ? Infinity : -Infinity;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) out[k] = decodeForTs(val);
  return out;
}

// ---------------------------------------------------------------------------
// Python runner
// ---------------------------------------------------------------------------

const PY_RUNNER = `import json
import sys

# Windows defaults stdin/stdout to the locale encoding (often cp1252), which
# mangles non-ASCII JSON and inflates len() for emoji. Force UTF-8 on both ends
# so the Python validator sees the same bytes the JS side produced.
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

import schema_validator as _sv

_MISSING_KEY = '$missing'
_NAN_KEY = '$nan'
_INF_KEY = '$inf'


def _decode(v):
    if isinstance(v, dict):
        if v.get(_MISSING_KEY) is True:
            return _sv._MISSING
        if v.get(_NAN_KEY) is True:
            return float('nan')
        if _INF_KEY in v:
            return float('inf') if v[_INF_KEY] > 0 else float('-inf')
        return {k: _decode(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_decode(x) for x in v]
    return v


def main():
    wire = json.load(sys.stdin)
    out = []
    for item in wire:
        value = _decode(item['value'])
        try:
            errors = _sv.validate(value)
            out.append({'errors': errors})
        except Exception as exc:
            out.append({'exception': repr(exc)})
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()
`;

function findPython(explicit?: string): string {
  const candidates = explicit ? [explicit] : ['python3', 'python'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  throw new Error(
    `Python interpreter not found. Tried: ${candidates.join(', ')}. ` +
      `Install Python 3.8+ or pass --python <path>.`,
  );
}

// ---------------------------------------------------------------------------
// Go runner
// ---------------------------------------------------------------------------

/**
 * Runner compiled alongside the generated Go validator (`package main`).
 * Keep the wire decoding in sync with the Python runner above and with
 * `test/fixtures/go-runner.go`.
 */
const GO_RUNNER = `package main

import (
\t"encoding/json"
\t"math"
\t"os"
)

func _decodeWire(v any) any {
\tswitch x := v.(type) {
\tcase map[string]any:
\t\tif b, ok := x["$missing"].(bool); ok && b {
\t\t\treturn Missing
\t\t}
\t\tif b, ok := x["$nan"].(bool); ok && b {
\t\t\treturn math.NaN()
\t\t}
\t\tif raw, ok := x["$inf"]; ok {
\t\t\tif n, ok := raw.(float64); ok && n > 0 {
\t\t\t\treturn math.Inf(1)
\t\t\t}
\t\t\treturn math.Inf(-1)
\t\t}
\t\tout := make(map[string]any, len(x))
\t\tfor key, value := range x {
\t\t\tout[key] = _decodeWire(value)
\t\t}
\t\treturn out
\tcase []any:
\t\tout := make([]any, len(x))
\t\tfor i, value := range x {
\t\t\tout[i] = _decodeWire(value)
\t\t}
\t\treturn out
\tdefault:
\t\treturn v
\t}
}

func main() {
\tvar input []map[string]any
\tif err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
\t\tpanic(err)
\t}
\tout := make([]any, 0, len(input))
\tfor _, item := range input {
\t\tout = append(out, Validate(_decodeWire(item["value"])))
\t}
\tif err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
\t\tpanic(err)
\t}
}
`;

/**
 * Locate a Go executable. An explicit command is required to work; otherwise
 * a missing toolchain is reported as `null` so auto-detection can skip Go.
 */
function findGo(explicit?: string): string | null {
  const candidates = explicit ? [explicit] : ['go'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TS validator loading
// ---------------------------------------------------------------------------

async function compileTsValidator(
  tsSource: string,
  dir: string,
): Promise<(v: unknown) => ValidationError[]> {
  const result = transpileModule(tsSource, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  });
  const jsPath = join(dir, 'ts_validator.mjs');
  writeFileSync(jsPath, result.outputText, 'utf8');
  const mod = (await import(pathToFileURL(jsPath).href)) as {
    validate?: (v: unknown) => ValidationError[];
  };
  if (typeof mod.validate !== 'function') {
    throw new Error('Generated TS validator does not export a `validate` function');
  }
  return mod.validate;
}

// ---------------------------------------------------------------------------
// Python validator execution
// ---------------------------------------------------------------------------

function runPyValidator(
  dir: string,
  wire: ReadonlyArray<{ value: unknown }>,
  pythonCmd: string,
): ReadonlyArray<ValidatorResult> {
  const result = spawnSync(pythonCmd, ['runner.py'], {
    cwd: dir,
    input: JSON.stringify(wire),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Failed to spawn Python (${pythonCmd}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Python validator failed (exit ${result.status}):\n${result.stderr || result.stdout}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`Python validator returned non-JSON output: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== wire.length) {
    throw new Error('Python validator returned malformed output');
  }
  return parsed as ReadonlyArray<ValidatorResult>;
}

// ---------------------------------------------------------------------------
// Go validator execution
// ---------------------------------------------------------------------------

function runGoValidator(
  dir: string,
  wire: ReadonlyArray<{ value: unknown }>,
  goCmd: string,
): ReadonlyArray<ValidatorResult> {
  const result = spawnSync(goCmd, ['run', '.'], {
    cwd: dir,
    input: JSON.stringify(wire),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  if (result.error) {
    throw new Error(`Failed to spawn Go (${goCmd}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Go validator failed (exit ${result.status}):\n${result.stderr || result.stdout}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`Go validator returned non-JSON output: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== wire.length) {
    throw new Error('Go validator returned malformed output');
  }
  // The Go runner emits one bare error list per input (like the test fixture),
  // while the parity harness compares `{ errors }` / `{ exception }` objects.
  return (parsed as ReadonlyArray<ReadonlyArray<ValidationError>>).map((errors) => ({ errors }));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function resultsEqual(a: ValidatorResult, b: ValidatorResult): boolean {
  if ('exception' in a && 'exception' in b) return a.exception === b.exception;
  if ('exception' in a || 'exception' in b) return false;
  if (a.errors.length !== b.errors.length) return false;
  for (let i = 0; i < a.errors.length; i++) {
    const ea = a.errors[i]!;
    const eb = b.errors[i]!;
    if (ea.message !== eb.message) return false;
    if (ea.path.length !== eb.path.length) return false;
    for (let j = 0; j < ea.path.length; j++) {
      if (ea.path[j] !== eb.path[j]) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runParity(
  schema: SchemaNode,
  options: ParityOptions = {},
): Promise<ParityResult> {
  const seed = options.seed ?? 42;
  const caseCount = options.cases ?? 50;
  const pythonCmd = findPython(options.pythonCommand);

  let goCmd: string | null = null;
  let goSkipReason: string | undefined;
  if (options.go === false) {
    goSkipReason = 'disabled by caller';
  } else {
    goCmd = findGo(options.goCommand);
    if (goCmd === null) {
      if (options.go === true || options.goCommand !== undefined) {
        throw new Error(
          `Go toolchain not found: ${options.goCommand ?? 'go'}. ` +
            `Install Go 1.21+ or run parity with --no-go.`,
        );
      }
      goSkipReason = 'go executable not found';
    }
  }

  const corpus = buildCorpus(schema, seed, caseCount);
  const allCases = [...corpus.valid, ...corpus.invalid];

  const dir = mkdtempSync(join(tmpdir(), 'schemapar-'));
  try {
    const validateTs = await compileTsValidator(generateTypeScript(schema), dir);
    writeFileSync(join(dir, 'schema_validator.py'), generatePython(schema), 'utf8');
    writeFileSync(join(dir, 'runner.py'), PY_RUNNER, 'utf8');

    const wireInput = allCases.map((c) => ({ value: encodeForWire(c.value) }));
    const pyResults = runPyValidator(dir, wireInput, pythonCmd);

    let goResults: ReadonlyArray<ValidatorResult> | null = null;
    if (goCmd !== null) {
      writeFileSync(
        join(dir, 'validator.go'),
        generateGo(schema, { packageName: 'main' }),
        'utf8',
      );
      writeFileSync(join(dir, 'main.go'), GO_RUNNER, 'utf8');
      // writeFileSync emits UTF-8 without a BOM; Go rejects a BOM in go.mod.
      writeFileSync(join(dir, 'go.mod'), 'module schemaparparity\n\ngo 1.21\n', 'utf8');
      goResults = runGoValidator(dir, wireInput, goCmd);
    }

    const mismatches: ParityMismatch[] = [];
    for (let i = 0; i < allCases.length; i++) {
      const c = allCases[i]!;
      const wire = wireInput[i]!.value;

      let tsResult: ValidatorResult;
      try {
        tsResult = { errors: validateTs(decodeForTs(wire)) };
      } catch (err) {
        tsResult = { exception: String(err) };
      }

      const pyResult = pyResults[i]!;
      const goResult = goResults === null ? undefined : goResults[i]!;
      const pyMismatch = !resultsEqual(tsResult, pyResult);
      const goMismatch = goResult !== undefined && !resultsEqual(tsResult, goResult);
      if (pyMismatch || goMismatch) {
        mismatches.push({
          label: c.label,
          valueWire: wire,
          tsResult,
          pyResult,
          ...(goResult !== undefined ? { goResult } : {}),
        });
      }
    }

    return {
      total: allCases.length,
      validCount: corpus.valid.length,
      invalidCount: corpus.invalid.length,
      mismatches,
      goCompared: goResults !== null,
      ...(goSkipReason !== undefined ? { goSkipReason } : {}),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
