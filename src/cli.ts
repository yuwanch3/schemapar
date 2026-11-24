#!/usr/bin/env node
/**
 * schemapar — command-line interface
 *
 * Subcommands:
 *   compile <schema> --target ts|py|go [--out <file>] Emit a validator.
 *   check   <schema>                                  Validate the schema itself.
 *   parity  <schema> [--seed N] [--cases N] [--python CMD] [--go CMD] [--no-go]
 *                                                     Prove TS/Python/Go agree.
 *
 * Exit codes:
 *   0  success
 *   1  schema error / parity mismatch
 *   2  usage error
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseSchema, formatPath } from './schema.js';
import { generateTypeScript } from './gen-ts.js';
import { generatePython } from './gen-py.js';
import { generateGo } from './gen-go.js';
import { runParity } from './parity.js';

const USAGE = `
schemapar — polyglot schema compiler + parity tester

Usage:
  schemapar compile <schema.json> --target ts|py|go [--out <file>]
  schemapar check   <schema.json>
  schemapar parity  <schema.json> [--seed N] [--cases N] [--python CMD] [--go CMD] [--no-go]

Options:
  --target <ts|py|go> Output language for \`compile\` (required).
  --out <file>       Write output to a file instead of stdout.
  --seed <N>         PRNG seed for \`parity\` (default: 42).
  --cases <N>        Number of valid cases per parity run (default: 50).
  --python <CMD>     Python executable to invoke (default: python3, then python).
  --go <CMD>         Go executable to invoke for \`parity\` (default: go).
  --no-go            Compare TypeScript and Python only.
  -h, --help         Show this help.
`;

interface ParsedArgs {
  readonly positional: ReadonlyArray<string>;
  readonly flags: ReadonlyMap<string, string>;
}

/** Flags that do not take a value. */
const BOOLEAN_FLAGS = new Set(['help', 'no-go']);

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') {
      flags.set('help', 'true');
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
        continue;
      }
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags.set(key, 'true');
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Flag --${key} requires a value`);
      }
      flags.set(key, next);
      i++;
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags };
}

function readSchema(filePath: string): ReturnType<typeof parseSchema> {
  const abs = resolve(filePath);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read schema file: ${(err as Error).message}`);
  }
  // Editors on Windows often prepend a UTF-8 BOM; JSON.parse rejects it.
  raw = raw.replace(/^\uFEFF/, '');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Schema is not valid JSON: ${(err as Error).message}`);
  }
  return parseSchema(json);
}

function printSchemaErrors(errors: ReadonlyArray<{ path: ReadonlyArray<string>; message: string }>): void {
  for (const e of errors) {
    process.stderr.write(`  ${formatPath(e.path)}: ${e.message}\n`);
  }
}

async function cmdCompile(args: ParsedArgs): Promise<number> {
  const schemaPath = args.positional[0];
  if (!schemaPath) {
    process.stderr.write('compile: missing <schema.json>\n');
    return 2;
  }
  const target = args.flags.get('target');
  if (target !== 'ts' && target !== 'py' && target !== 'go') {
    process.stderr.write('compile: --target must be `ts`, `py`, or `go`\n');
    return 2;
  }

  const parsed = readSchema(schemaPath);
  if (!parsed.ok) {
    process.stderr.write('Schema errors:\n');
    printSchemaErrors(parsed.errors);
    return 1;
  }

  const out =
    target === 'ts'
      ? generateTypeScript(parsed.schema)
      : target === 'py'
        ? generatePython(parsed.schema)
        : generateGo(parsed.schema);
  const outPath = args.flags.get('out');
  if (outPath) {
    writeFileSync(resolve(outPath), out, 'utf8');
    process.stdout.write(`Wrote ${outPath}\n`);
  } else {
    process.stdout.write(out);
  }
  return 0;
}

function cmdCheck(args: ParsedArgs): number {
  const schemaPath = args.positional[0];
  if (!schemaPath) {
    process.stderr.write('check: missing <schema.json>\n');
    return 2;
  }
  const parsed = readSchema(schemaPath);
  if (parsed.ok) {
    process.stdout.write('Schema is valid.\n');
    return 0;
  }
  process.stderr.write('Schema errors:\n');
  printSchemaErrors(parsed.errors);
  return 1;
}

async function cmdParity(args: ParsedArgs): Promise<number> {
  const schemaPath = args.positional[0];
  if (!schemaPath) {
    process.stderr.write('parity: missing <schema.json>\n');
    return 2;
  }
  const parsed = readSchema(schemaPath);
  if (!parsed.ok) {
    process.stderr.write('Schema errors:\n');
    printSchemaErrors(parsed.errors);
    return 1;
  }

  const seedRaw = args.flags.get('seed');
  const seed = seedRaw === undefined ? 42 : Number(seedRaw);
  if (!Number.isInteger(seed)) {
    process.stderr.write('parity: --seed must be an integer\n');
    return 2;
  }
  const casesRaw = args.flags.get('cases');
  const cases = casesRaw === undefined ? 50 : Number(casesRaw);
  if (!Number.isInteger(cases) || cases < 1) {
    process.stderr.write('parity: --cases must be a positive integer\n');
    return 2;
  }

  const pythonCommand = args.flags.get('python');
  const goCommand = args.flags.get('go');
  const noGo = args.flags.has('no-go');
  if (noGo && goCommand !== undefined) {
    process.stderr.write('parity: --go and --no-go cannot be combined\n');
    return 2;
  }
  process.stdout.write(`Running parity: seed=${seed} cases=${cases}\n`);

  let result;
  try {
    result = await runParity(parsed.schema, {
      seed,
      cases,
      ...(pythonCommand !== undefined ? { pythonCommand } : {}),
      ...(goCommand !== undefined ? { goCommand } : {}),
      ...(noGo ? { go: false } : {}),
    });
  } catch (err) {
    process.stderr.write(`Parity run failed: ${(err as Error).message}\n`);
    return 1;
  }

  if (result.mismatches.length === 0) {
    const languages = result.goCompared ? 'TS + Python + Go' : 'TS + Python';
    process.stdout.write(
      `✓ Parity OK (${languages}) — ${result.total} inputs (${result.validCount} valid, ${result.invalidCount} invalid)\n`,
    );
    if (!result.goCompared && result.goSkipReason === 'go executable not found') {
      process.stdout.write(
        '  note: Go toolchain not found; compared TS + Python only. Use --go <path> to force it.\n',
      );
    }
    return 0;
  }

  process.stderr.write(`✗ Parity FAILED — ${result.mismatches.length} mismatch(es)\n\n`);
  for (const m of result.mismatches) {
    process.stderr.write(`  [${m.label}]\n`);
    process.stderr.write(`    input:    ${safeJson(m.valueWire)}\n`);
    process.stderr.write(`    ts:       ${formatResult(m.tsResult)}\n`);
    process.stderr.write(`    python:   ${formatResult(m.pyResult)}\n`);
    if (m.goResult !== undefined) {
      process.stderr.write(`    go:       ${formatResult(m.goResult)}\n`);
    }
    process.stderr.write('\n');
  }
  return 1;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatResult(r: { errors?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>; exception?: string }): string {
  if ('exception' in r && r.exception !== undefined) return `THREW ${r.exception}`;
  const errs = r.errors ?? [];
  if (errs.length === 0) return 'OK';
  return errs.map((e) => `${formatPath(e.path.map(String))}: ${e.message}`).join('; ');
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    return argv.length === 0 ? 2 : 0;
  }

  const command = argv[0];
  let args: ParsedArgs;
  try {
    args = parseArgs(argv.slice(1));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }
  if (args.flags.has('help')) {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (command) {
    case 'compile':
      return cmdCompile(args);
    case 'check':
      return cmdCheck(args);
    case 'parity':
      return cmdParity(args);
    default:
      process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Fatal: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
