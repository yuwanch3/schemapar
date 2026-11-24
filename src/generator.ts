/**
 * schemapar — deterministic value generator for parity testing
 *
 * Two responsibilities:
 *   1. Produce VALID values that satisfy a schema (to prove positive parity).
 *   2. Produce INVALID / adversarial values that exercise boundary conditions
 *      (to prove negative parity and error-path parity).
 *
 * Everything is driven by a seeded PRNG so failures are reproducible: the
 * same seed always yields the same corpus.
 */

import type { SchemaNode, ObjectNode, CrossFieldConstraint, StringFormat } from './schema.js';
import { FORMAT_PATTERNS } from './schema.js';

/** Small, fast, well-known 32-bit PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Normalize to uint32 so that negative / non-integer seeds behave.
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error('int(): max < min');
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick one element. Throws on empty input. */
  pick<T>(items: ReadonlyArray<T>): T {
    if (items.length === 0) throw new Error('pick(): empty');
    return items[this.int(0, items.length - 1)]!;
  }

  /** true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** The wire format sent to the Python parity runner. */
export interface Case {
  /** Human-readable tag, useful when a parity failure is reported. */
  readonly label: string;
  readonly value: unknown;
}

/**
 * Values used to corrupt a known-valid sample. None of these can be a valid
 * value for every schema, so a mutation usually produces a failing input;
 * even when it does not, the parity harness still compares both validators.
 */
const MUTATION_VALUES: ReadonlyArray<unknown> = ['__mutated__', 0, 1.5, true, null, [], {}];

/**
 * Build a corpus for a schema. `valid` cases should pass, `invalid` cases
 * should fail. The parity harness runs BOTH sets through BOTH validators and
 * compares the FULL error list (not just pass/fail).
 *
 * Each generated valid value also yields one mutated sibling. Static probes
 * only cover the boundaries the generator author thought of; mutating a valid
 * tree reaches arbitrary nesting levels and key sets for free.
 */
export function buildCorpus(schema: SchemaNode, seed: number, n: number): {
  readonly valid: ReadonlyArray<Case>;
  readonly invalid: ReadonlyArray<Case>;
} {
  const rng = new Rng(seed);
  const valid: Case[] = [];
  const invalid: Case[] = [];

  for (let i = 0; i < n; i++) {
    const value = generateValid(schema, rng);
    valid.push({ label: `valid#${i}`, value });
    invalid.push({ label: `mutation#${i}`, value: mutateValue(value, rng) });
  }
  for (const v of adversarialValues(schema)) {
    invalid.push({ label: 'adversarial', value: v });
  }

  return { valid, invalid };
}

/** Produce a value that satisfies `node` (respecting optional/nullable randomly). */
export function generateValid(node: SchemaNode, rng: Rng): unknown {
  return generateValue(node, rng, false);
}

/**
 * Internal generator. `forcePresent` suppresses the optional/nullable
 * shortcuts, which is what constraint repair needs: filling a missing field
 * with `undefined` or `null` would not satisfy a numeric comparison.
 */
function generateValue(node: SchemaNode, rng: Rng, forcePresent: boolean): unknown {
  // Occasionally exercise optionality by omitting, and nullability by nulling.
  if (!forcePresent) {
    if (node.optional && rng.chance(0.15)) {
      return MISSING;
    }
    if (node.nullable && rng.chance(0.15)) {
      return null;
    }
  }

  switch (node.type) {
    case 'any':
      return rng.pick([0, 1, 'x', true, null, {}, []]);

    case 'string':
      return generateString(node, rng);

    case 'number': {
      const min = node.min ?? -1e6;
      const max = node.max ?? 1e6;
      if (rng.chance(0.2)) return rng.pick([min, max]);
      return min + rng.next() * (max - min);
    }

    case 'integer': {
      const min = node.min ?? -1_000_000;
      const max = node.max ?? 1_000_000;
      if (rng.chance(0.3)) return rng.pick([min, max]);
      return rng.int(min, max);
    }

    case 'boolean':
      return rng.chance(0.5);

    case 'literal':
      return node.value;

    case 'enum':
      return rng.pick(node.values);

    case 'array': {
      const count = clamp(rng.int(0, 5), node.minItems ?? 0, node.maxItems ?? 5);
      const out: unknown[] = [];
      for (let i = 0; i < count; i++) out.push(generateValue(node.items, rng, false));
      return out;
    }

    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node.properties)) {
        const v = generateValue(child, rng, false);
        if (v === MISSING) continue;
        out[key] = v;
      }
      applySatisfyingConstraints(node, out, rng);
      return out;
    }

    case 'record': {
      const min = node.minProperties ?? 0;
      const max = node.maxProperties ?? Math.max(min, 3);
      const count = clamp(rng.int(min, Math.max(min, max)), min, max);
      const out: Record<string, unknown> = {};
      for (let i = 0; i < count; i++) {
        out[recordKey(i)] = generateValue(node.values, rng, false);
      }
      return out;
    }

    case 'tuple': {
      return node.items.map((item) => generateValue(item, rng, false));
    }

    case 'union':
      return generateValue(rng.pick(node.variants), rng, forcePresent);

    default: {
      const _never: never = node;
      void _never;
      return undefined;
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Dynamic record keys. The old fixed `a..h` list silently capped every record
 * at 8 properties, so a schema with `minProperties: 12` produced an invalid
 * "valid" case.
 */
function recordKey(index: number): string {
  return `k${index}`;
}

/**
 * Nudge an object so it satisfies declared cross-field constraints. Only
 * used when generating VALID cases; invalid corpora leave the object alone
 * so that both validators see the same (failing) input.
 *
 * Repair is schema-aware: a field is refilled with a value that its own node
 * accepts, instead of a bare `0`. Otherwise an `integer` field could be
 * repaired into `1.5`, or a bounded field into an out-of-range number.
 */
function applySatisfyingConstraints(
  node: ObjectNode,
  obj: Record<string, unknown>,
  rng: Rng,
): void {
  const constraints = node.constraints ?? [];

  // Fill requiredTogether pairs first: later comparisons may use those fields.
  for (const c of constraints) {
    if (c.kind !== 'requiredTogether') continue;
    const presentCount = c.fields.filter((f) => isPresent(obj[f])).length;
    if (presentCount === 0) continue;
    for (const f of c.fields) {
      if (isPresent(obj[f])) continue;
      const child = node.properties[f];
      if (child === undefined) continue;
      const filled = generateValue(child, rng, true);
      if (filled !== MISSING) obj[f] = filled;
    }
  }

  for (const c of constraints) {
    if (c.kind === 'requiredTogether') continue;
    repairComparison(node, c, obj, rng);
  }
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== MISSING;
}

interface NumericRange {
  readonly integer: boolean;
  readonly min: number;
  readonly max: number;
}

/** Best-effort numeric interval for a node. Unions use their first numeric variant. */
function numericRange(node: SchemaNode): NumericRange | null {
  switch (node.type) {
    case 'number':
      return { integer: false, min: node.min ?? -1e6, max: node.max ?? 1e6 };
    case 'integer':
      return { integer: true, min: node.min ?? -1_000_000, max: node.max ?? 1_000_000 };
    case 'literal':
      return typeof node.value === 'number' && Number.isFinite(node.value)
        ? { integer: Number.isInteger(node.value), min: node.value, max: node.value }
        : null;
    case 'union': {
      for (const variant of node.variants) {
        const range = numericRange(variant);
        if (range !== null) return range;
      }
      return null;
    }
    default:
      return null;
  }
}

function pickInRange(range: NumericRange, rng: Rng): number {
  if (range.max <= range.min) return range.min;
  if (range.integer) return rng.int(Math.ceil(range.min), Math.floor(range.max));
  return range.min + rng.next() * (range.max - range.min);
}

type OrderingKind = Exclude<CrossFieldConstraint['kind'], 'requiredTogether' | 'equal' | 'notEqual'>;

function relationHolds(left: number, right: number, kind: OrderingKind): boolean {
  switch (kind) {
    case 'greaterThan':
      return left > right;
    case 'lessThan':
      return left < right;
    case 'greaterOrEqual':
      return left >= right;
    case 'lessOrEqual':
      return left <= right;
  }
}

/** Bounds for `left` such that `left <op> right` holds. */
function leftBoundsFor(kind: OrderingKind, right: number, leftRange: NumericRange): [number, number] {
  const step = leftRange.integer ? 1 : Math.max((leftRange.max - leftRange.min) * 1e-9, 1e-12);
  switch (kind) {
    case 'greaterThan':
      return [right + step, leftRange.max];
    case 'lessThan':
      return [leftRange.min, right - step];
    case 'greaterOrEqual':
      return [right, leftRange.max];
    case 'lessOrEqual':
      return [leftRange.min, right];
  }
}

function strictEqual(a: unknown, b: unknown): boolean {
  // Mirrors the generated `_eq_strict` helper: booleans are not numbers and
  // numbers/strings compare by value, everything else by identity.
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return typeof a === 'boolean' && typeof b === 'boolean' && a === b;
  }
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return a === b;
}

/** Does `value` satisfy `node`? Approximate, used only for constraint repair. */
function valueFits(node: SchemaNode, value: unknown): boolean {
  if (value === MISSING) return node.optional === true;
  if (value === null) return node.nullable === true;

  switch (node.type) {
    case 'any':
      return value !== undefined;
    case 'string': {
      if (typeof value !== 'string') return false;
      const length = [...value].length;
      if (node.minLength !== undefined && length < node.minLength) return false;
      if (node.maxLength !== undefined && length > node.maxLength) return false;
      if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) return false;
      return true;
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        && (node.min === undefined || value >= node.min)
        && (node.max === undefined || value <= node.max);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        && (node.min === undefined || value >= node.min)
        && (node.max === undefined || value <= node.max);
    case 'boolean':
      return typeof value === 'boolean';
    case 'literal':
      return strictEqual(value, node.value);
    case 'enum':
      return node.values.some((v) => strictEqual(value, v));
    case 'array':
      return Array.isArray(value)
        && (node.minItems === undefined || value.length >= node.minItems)
        && (node.maxItems === undefined || value.length <= node.maxItems)
        && value.every((item) => valueFits(node.items, item));
    case 'tuple':
      return Array.isArray(value)
        && value.length === node.items.length
        && value.every((item, i) => valueFits(node.items[i]!, item));
    case 'record':
      if (!isPlainRecord(value)) return false;
      return Object.entries(value).every(([, v]) => valueFits(node.values, v));
    case 'object': {
      if (!isPlainRecord(value)) return false;
      for (const [key, child] of Object.entries(node.properties)) {
        const childValue = value[key];
        if (!isPresent(childValue)) {
          if (!child.optional) return false;
          continue;
        }
        if (!valueFits(child, childValue)) return false;
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in node.properties)) return false;
        }
      }
      return true;
    }
    case 'union':
      return node.variants.some((variant) => valueFits(variant, value));
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function repairComparison(
  node: ObjectNode,
  constraint: Exclude<CrossFieldConstraint, { kind: 'requiredTogether' }>,
  obj: Record<string, unknown>,
  rng: Rng,
): void {
  const leftSchema = node.properties[constraint.left];
  const rightSchema = node.properties[constraint.right];
  if (leftSchema === undefined || rightSchema === undefined) return;

  const leftValue = obj[constraint.left];
  const rightValue = obj[constraint.right];
  // Missing fields mean the constraint is skipped by both validators, so
  // there is nothing to repair and optionality stays exercised.
  if (!isPresent(leftValue) || !isPresent(rightValue)) return;

  if (constraint.kind === 'equal') {
    if (strictEqual(leftValue, rightValue)) return;
    if (valueFits(leftSchema, rightValue)) {
      obj[constraint.left] = rightValue;
      return;
    }
    if (valueFits(rightSchema, leftValue)) {
      obj[constraint.right] = leftValue;
      return;
    }
    const leftRange = numericRange(leftSchema);
    const rightRange = numericRange(rightSchema);
    if (leftRange !== null && rightRange !== null) {
      const min = Math.max(leftRange.min, rightRange.min);
      const max = Math.min(leftRange.max, rightRange.max);
      if (min <= max) {
        const shared = pickInRange({ integer: leftRange.integer && rightRange.integer, min, max }, rng);
        obj[constraint.left] = shared;
        obj[constraint.right] = shared;
      }
    }
    return;
  }

  if (constraint.kind === 'notEqual') {
    if (!strictEqual(leftValue, rightValue)) return;
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = generateValue(leftSchema, rng, true);
      if (candidate !== MISSING && !strictEqual(candidate, rightValue) && valueFits(leftSchema, candidate)) {
        obj[constraint.left] = candidate;
        return;
      }
    }
    return;
  }

  // Ordering constraints only apply when both sides are finite numbers, which
  // is exactly what the generated validators check.
  if (
    typeof leftValue !== 'number' || !Number.isFinite(leftValue)
    || typeof rightValue !== 'number' || !Number.isFinite(rightValue)
  ) {
    return;
  }
  if (relationHolds(leftValue, rightValue, constraint.kind)) return;

  const leftRange = numericRange(leftSchema);
  const rightRange = numericRange(rightSchema);
  if (leftRange === null || rightRange === null) return;

  for (let attempt = 0; attempt < 24; attempt++) {
    const right = pickInRange(rightRange, rng);
    const [lo, hi] = leftBoundsFor(constraint.kind, right, leftRange);
    const min = Math.max(leftRange.min, lo);
    const max = Math.min(leftRange.max, hi);
    if (min > max) continue;
    const left = pickInRange({ ...leftRange, min, max }, rng);
    if (relationHolds(left, right, constraint.kind)) {
      obj[constraint.left] = left;
      obj[constraint.right] = right;
      return;
    }
  }

  // Infeasible combination (e.g. left.max < right.min for `greaterThan`):
  // settle on the closest boundary pair. The schema itself is contradictory,
  // so no generator can satisfy it; parity still holds because both
  // validators see the same values.
  const increasing = constraint.kind === 'greaterThan' || constraint.kind === 'greaterOrEqual';
  const right = increasing ? rightRange.min : rightRange.max;
  const left = increasing ? leftRange.max : leftRange.min;
  if (relationHolds(left, right, constraint.kind)) {
    obj[constraint.left] = left;
    obj[constraint.right] = right;
  }
}

function generateString(node: Extract<SchemaNode, { type: 'string' }>, rng: Rng): string {
  const min = node.minLength ?? 0;
  const max = node.maxLength ?? Math.max(min, 8);
  const formatRe = node.format === undefined ? null : new RegExp(FORMAT_PATTERNS[node.format]);
  const patternRe = node.pattern === undefined ? null : new RegExp(node.pattern);

  /**
   * A candidate is usable only when it satisfies *every* constraint on the
   * node. This matters when `format` and `pattern` are combined: a bare
   * format sample (e.g. ``bob@example.com``) may not match a stricter pattern,
   * and a pattern sample may not be a valid email.
   */
  const accepts = (candidate: string): boolean => {
    const length = [...candidate].length;
    if (length < min) return false;
    if (node.maxLength !== undefined && length > node.maxLength) return false;
    if (formatRe !== null && !formatRe.test(candidate)) return false;
    if (patternRe !== null && !patternRe.test(candidate)) return false;
    return true;
  };

  // A pattern can imply its own length; only an explicit maxLength may
  // constrain it, otherwise a fixed 20-character pattern would be rejected
  // by the generator's generic 8-character default.
  const patternMax = node.maxLength ?? Number.POSITIVE_INFINITY;

  if (patternRe !== null) {
    // Synthesize directly from the pattern's structure instead of guessing.
    // The old approach drew random ASCII and hoped it matched, which failed
    // for almost every non-trivial pattern (e.g. `^[0-9]{8,15}$`).
    const sampler = new PatternSampler(node.pattern!);
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = sampler.sample(rng);
      if (candidate === null) break;
      const length = [...candidate].length;
      if (length <= patternMax && accepts(candidate)) return candidate;
    }

    // When a format also applies, sample the format and check the pattern.
    // This rescues combinations where the pattern sampler only emits one
    // shape that the format rejects (or vice versa).
    if (node.format !== undefined) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = pickFormat(node.format, rng);
        if (accepts(candidate)) return candidate;
      }
    }

    // Fallback for constructs the sampler does not understand. Schema
    // validation has already rejected the portable-but-unsupported ones.
    for (let attempt = 0; attempt < 200; attempt++) {
      const length = min > max ? min : rng.int(min, Math.min(max, Math.max(min, 32)));
      const candidate = randomAscii(length, rng);
      if (accepts(candidate)) return candidate;
    }
    return randomAscii(min > max ? min : rng.int(min, Math.max(min, 8)), rng);
  }

  if (node.format !== undefined) {
    // Formats are the most constrained case, but explicit minLength /
    // maxLength may still make a particular sample unusable.
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = pickFormat(node.format, rng);
      if (accepts(candidate)) return candidate;
    }
    return pickFormat(node.format, rng);
  }

  return randomAscii(min > max ? min : rng.int(min, max), rng);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.';
const UNICODE_SAMPLES = ['é', 'ü', 'ñ', '漢', '字', '🎉', '🚀', '✓'];

function randomAscii(len: number, rng: Rng): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    // Occasionally include a multi-byte code point to stress length parity.
    if (rng.chance(0.1)) s += rng.pick(UNICODE_SAMPLES);
    else s += ALPHABET[rng.int(0, ALPHABET.length - 1)]!;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Pattern-aware string synthesis
// ---------------------------------------------------------------------------
//
// The parser only admits a portable regex subset, but "portable" does not mean
// "easy to guess randomly": `^[0-9]{8,15}$` essentially never appears by
// chance. This tiny sampler walks the pattern structure and emits a string
// that satisfies it, so generated "valid" cases really are valid.

type PatternAtom =
  | { readonly kind: 'char'; readonly chars: ReadonlyArray<string> }
  | { readonly kind: 'any' }
  | { readonly kind: 'anchor' }
  | { readonly kind: 'group'; readonly branches: ReadonlyArray<ReadonlyArray<PatternPiece>> };

interface PatternPiece {
  readonly atom: PatternAtom;
  readonly min: number;
  readonly max: number;
}

class PatternSampler {
  private index = 0;

  constructor(private readonly source: string) {}

  /** Parse and sample the pattern, or return null when a construct is not understood. */
  sample(rng: Rng): string | null {
    this.index = 0;
    const branches = this.parseAlternation();
    if (this.index !== this.source.length) return null;
    return samplePatternBranches(branches, rng);
  }

  private peek(offset = 0): string | undefined {
    return this.source[this.index + offset];
  }

  private parseAlternation(): PatternPiece[][] {
    const branches: PatternPiece[][] = [this.parseSequence()];
    while (this.peek() === '|') {
      this.index += 1;
      branches.push(this.parseSequence());
    }
    return branches;
  }

  private parseSequence(): PatternPiece[] {
    const pieces: PatternPiece[] = [];
    while (this.index < this.source.length) {
      const ch = this.peek()!;
      if (ch === '|' || ch === ')') break;
      const atom = this.parseAtom();
      if (atom === null) break;
      pieces.push({ atom, ...this.parseQuantifier() });
    }
    return pieces;
  }

  private parseAtom(): PatternAtom | null {
    const ch = this.peek();
    if (ch === undefined || ch === '|' || ch === ')' || ch === '*' || ch === '+' || ch === '?') {
      return null;
    }
    if (ch === '^' || ch === '$') {
      this.index += 1;
      return { kind: 'anchor' };
    }
    if (ch === '.') {
      this.index += 1;
      return { kind: 'any' };
    }
    if (ch === '[') return this.parseClass();
    if (ch === '(') {
      this.index += 1;
      // Non-capturing groups are the only `(?...)` form the parser accepts.
      if (this.peek() === '?' && this.peek(1) === ':') this.index += 2;
      const branches = this.parseAlternation();
      if (this.peek() === ')') this.index += 1;
      return { kind: 'group', branches };
    }
    if (ch === '\\') {
      this.index += 1;
      const escaped = this.parseEscape();
      return escaped === null ? null : { kind: 'char', chars: [escaped] };
    }
    this.index += 1;
    return { kind: 'char', chars: [ch] };
  }

  private parseQuantifier(): { min: number; max: number } {
    const ch = this.peek();
    if (ch === '*') {
      this.index += 1;
      this.skipLazy();
      return { min: 0, max: 3 };
    }
    if (ch === '+') {
      this.index += 1;
      this.skipLazy();
      return { min: 1, max: 3 };
    }
    if (ch === '?') {
      this.index += 1;
      this.skipLazy();
      return { min: 0, max: 1 };
    }
    if (ch === '{') {
      const match = /^\{([0-9]+)(?:,([0-9]*))?\}/.exec(this.source.slice(this.index));
      if (match !== null) {
        this.index += match[0].length;
        const min = Number(match[1]);
        const specifiedMax = match[2];
        const max = specifiedMax === undefined
          ? min
          : specifiedMax === ''
            ? min + 3
            : Number(specifiedMax);
        this.skipLazy();
        // Cap unbounded/very large repetitions so a hostile pattern cannot
        // blow up the corpus.
        const cappedMin = Math.min(min, 256);
        return {
          min: cappedMin,
          max: Math.max(cappedMin, Math.min(max, cappedMin + 8)),
        };
      }
    }
    return { min: 1, max: 1 };
  }

  private skipLazy(): void {
    if (this.peek() === '?') this.index += 1;
  }

  private parseClass(): PatternAtom | null {
    this.index += 1; // '['
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.index += 1;
    }
    const chars = new Set<string>();
    let first = true;
    while (this.index < this.source.length) {
      if (this.peek() === ']' && !first) {
        this.index += 1;
        break;
      }
      const start = this.parseClassChar();
      if (start === null) return null;
      first = false;
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        this.index += 1;
        const end = this.parseClassChar();
        if (end === null) return null;
        addCharRange(chars, start, end);
      } else {
        chars.add(start);
      }
    }
    if (chars.size === 0) return null;
    if (!negated) return { kind: 'char', chars: [...chars] };
    const allowed = [...ALPHABET].filter((c) => !chars.has(c));
    return { kind: 'char', chars: allowed.length > 0 ? allowed : [...ALPHABET] };
  }

  private parseClassChar(): string | null {
    const ch = this.peek();
    if (ch === undefined) return null;
    if (ch === '\\') {
      this.index += 1;
      return this.parseEscape();
    }
    this.index += 1;
    return ch;
  }

  private parseEscape(): string | null {
    const ch = this.peek();
    if (ch === undefined) return null;
    this.index += 1;
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case 'x':
        return this.parseHex(2);
      case 'u':
        return this.parseHex(4);
      default:
        return ch;
    }
  }

  private parseHex(count: number): string | null {
    const hex = this.source.slice(this.index, this.index + count);
    if (hex.length !== count || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    this.index += count;
    return String.fromCodePoint(parseInt(hex, 16));
  }
}

function addCharRange(chars: Set<string>, start: string, end: string): void {
  const from = start.codePointAt(0);
  const to = end.codePointAt(0);
  if (from === undefined || to === undefined || from > to || to - from > 256) {
    // Huge/odd ranges: endpoints are enough to satisfy the pattern.
    chars.add(start);
    chars.add(end);
    return;
  }
  for (let cp = from; cp <= to; cp++) chars.add(String.fromCodePoint(cp));
}

function samplePatternBranches(
  branches: ReadonlyArray<ReadonlyArray<PatternPiece>>,
  rng: Rng,
): string {
  return samplePatternSequence(rng.pick(branches), rng);
}

function samplePatternSequence(pieces: ReadonlyArray<PatternPiece>, rng: Rng): string {
  let out = '';
  for (const piece of pieces) {
    const span = Math.max(0, piece.max - piece.min);
    const count = piece.min + (span === 0 ? 0 : rng.int(0, span));
    for (let i = 0; i < count; i++) out += samplePatternAtom(piece.atom, rng);
  }
  return out;
}

function samplePatternAtom(atom: PatternAtom, rng: Rng): string {
  switch (atom.kind) {
    case 'anchor':
      return '';
    case 'any':
      return rng.pick([...ALPHABET]);
    case 'char':
      return atom.chars.length === 0 ? '' : rng.pick(atom.chars);
    case 'group':
      return samplePatternBranches(atom.branches, rng);
  }
}

function pickEmail(rng: Rng): string {
  const local = ['a', 'bob', 'x.y', 'user_1', 'test'][rng.int(0, 4)]!;
  const domain = ['example.com', 'test.io', 'mail.co'][rng.int(0, 2)]!;
  return `${local}@${domain}`;
}

function pickUuid(rng: Rng): string {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[rng.int(0, 15)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function pickDate(rng: Rng): string {
  const y = rng.int(1900, 2100);
  const m = String(rng.int(1, 12)).padStart(2, '0');
  const d = String(rng.int(1, 28)).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pickDateTime(rng: Rng): string {
  const hh = String(rng.int(0, 23)).padStart(2, '0');
  const mm = String(rng.int(0, 59)).padStart(2, '0');
  const ss = String(rng.int(0, 59)).padStart(2, '0');
  return `${pickDate(rng)}T${hh}:${mm}:${ss}Z`;
}

function pickTime(rng: Rng): string {
  const hh = String(rng.int(0, 23)).padStart(2, '0');
  const mm = String(rng.int(0, 59)).padStart(2, '0');
  const ss = String(rng.int(0, 59)).padStart(2, '0');
  const fraction = rng.chance(0.4) ? `.${rng.int(0, 999999)}` : '';
  const zone = rng.chance(0.5) ? 'Z' : `${rng.chance(0.5) ? '+' : '-'}${String(rng.int(0, 23)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}`;
  return `${hh}:${mm}:${ss}${fraction}${zone}`;
}

function pickHostname(rng: Rng): string {
  const alnum = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const label = () => {
    let s = alnum[rng.int(0, alnum.length - 1)]!;
    const middle = rng.int(0, 6);
    for (let i = 0; i < middle; i++) {
      s += 'abcdefghijklmnopqrstuvwxyz0123456789-'[rng.int(0, 36)]!;
    }
    // A label may not end with a hyphen.
    if (s.length > 1) s += alnum[rng.int(0, alnum.length - 1)]!;
    return s;
  };
  const count = rng.int(2, 3);
  const labels: string[] = [];
  for (let i = 0; i < count; i++) labels.push(label());
  return labels.join('.');
}

function pickIpv4(rng: Rng): string {
  return Array.from({ length: 4 }, () => String(rng.int(0, 255))).join('.');
}

function pickIpv6(rng: Rng): string {
  const group = () => rng.int(0, 0xffff).toString(16);
  const full = Array.from({ length: 8 }, group).join(':');
  const templates = [
    full,
    `${group()}:${group()}:${group()}:${group()}:${group()}:${group()}::`,
    `::${group()}:${group()}:${group()}`,
    `2001:db8::${group()}:${group()}`,
    `fe80::${group()}:${group()}`,
    '::1',
    '::',
  ];
  return rng.pick(templates);
}

function pickUri(rng: Rng): string {
  return rng.pick([
    `https://example.com/${pickHostname(rng)}`,
    `https://example.com/path?q=${rng.int(0, 999)}`,
    `mailto:${pickEmail(rng)}`,
    `urn:isbn:978${rng.int(100000000, 999999999)}`,
    `ftp://files.example.org/${pickHostname(rng)}.txt`,
  ]);
}

function pickFormat(format: StringFormat, rng: Rng): string {
  switch (format) {
    case 'email':
      return pickEmail(rng);
    case 'uuid':
      return pickUuid(rng);
    case 'date':
      return pickDate(rng);
    case 'date-time':
      return pickDateTime(rng);
    case 'time':
      return pickTime(rng);
    case 'hostname':
      return pickHostname(rng);
    case 'ipv4':
      return pickIpv4(rng);
    case 'ipv6':
      return pickIpv6(rng);
    case 'uri':
      return pickUri(rng);
  }
}

/**
 * A curated set of adversarial values for a schema. These target type
 * confusion, boundary violations, and structural mismatches — the exact
 * categories where polyglot validators drift apart.
 */
export function adversarialValues(node: SchemaNode): ReadonlyArray<unknown> {
  const out: unknown[] = [];

  // Universal wrong-type probes. Not every schema rejects every probe (e.g.
  // `any`), but the parity harness only compares the two validators against
  // each other, so including extras is safe and often catches drift.
  out.push(undefined);
  out.push(null);
  out.push(0);
  out.push(1);
  out.push(-1);
  out.push(1.5);
  out.push('');
  out.push('x');
  out.push('é');
  out.push('🎉');
  out.push(true);
  out.push(false);
  out.push([]);
  out.push({});
  // Anchors and Unicode-sensitive strings: `$` matches before a trailing
  // newline in Python (translated to \Z by the generator), and non-ASCII
  // whitespace/digits separate ECMA-262 from Python's Unicode classes.
  out.push('abc\n');
  out.push('123\n');
  out.push('\u00a0');
  out.push('2020-01-01\n');
  out.push('2020-01-01T00:00:00Z\n');

  // Per-type probes.
  switch (node.type) {
    case 'string':
      if (node.minLength !== undefined && node.minLength > 0) {
        out.push('a'.repeat(Math.max(0, node.minLength - 1)));
      }
      if (node.maxLength !== undefined) {
        out.push('a'.repeat(node.maxLength + 1));
        // Emoji trick: JS .length is 2 for a single code point.
        out.push('🎉'.repeat(node.maxLength + 1));
      }
      if (node.pattern !== undefined) {
        out.push('!!!');
      }
      if (node.format === 'email') out.push('not-an-email');
      if (node.format === 'uuid') out.push('not-a-uuid');
      if (node.format === 'date') out.push('2020-13-40');
      if (node.format === 'date-time') out.push('2020-01-01 00:00:00');
      if (node.format === 'time') out.push('not-a-time');
      if (node.format === 'hostname') out.push('-bad.example');
      if (node.format === 'ipv4') out.push('999.1.1.1');
      if (node.format === 'ipv6') out.push(':::1');
      if (node.format === 'uri') out.push('not a uri');
      break;

    case 'number':
    case 'integer':
      if (node.min !== undefined) out.push(node.min - 1, node.min - 0.5);
      if (node.max !== undefined) out.push(node.max + 1, node.max + 0.5);
      if (node.type === 'integer') out.push(1.5, -2.25);
      out.push(NaN);
      break;

    case 'enum':
      out.push('__not_in_enum__');
      out.push(-1);
      break;

    case 'literal':
      out.push(typeof node.value === 'string' ? '__other__' : -1);
      break;

    case 'array':
      out.push('not-an-array');
      if (node.minItems !== undefined && node.minItems > 0) {
        out.push(Array.from({ length: node.minItems - 1 }, () => generateValid(node.items, new Rng(1))));
      }
      if (node.maxItems !== undefined) {
        out.push(Array.from({ length: node.maxItems + 1 }, () => generateValid(node.items, new Rng(2))));
      }
      break;

    case 'record':
      out.push('not-an-object');
      if (node.minProperties !== undefined && node.minProperties > 0) {
        const tooFew: Record<string, unknown> = {};
        for (let i = 0; i < node.minProperties - 1; i++) {
          tooFew['k' + i] = generateValid(node.values, new Rng(3 + i));
        }
        out.push(tooFew);
      }
      if (node.maxProperties !== undefined) {
        const tooMany: Record<string, unknown> = {};
        for (let i = 0; i < node.maxProperties + 1; i++) {
          tooMany['k' + i] = generateValid(node.values, new Rng(50 + i));
        }
        out.push(tooMany);
      }
      // Astral key ordering: JS's default sort compares UTF-16 code units
      // (U+1F600 as D83D DE00 sorts before U+FFFD), while Python sorts code
      // points (U+FFFD first). A failing value makes the iteration order
      // visible in the error list.
      out.push({
        ['\u{1F600}']: adversarialFor(node.values),
        ['\uFFFD']: undefined,
      });
      break;

    case 'tuple':
      out.push('not-an-array');
      out.push(Array.from({ length: node.items.length - 1 }, () => 0));
      out.push(Array.from({ length: node.items.length + 1 }, () => 0));
      break;

    case 'object': {
      out.push('not-an-object');
      out.push([]);
      if (node.additionalProperties === false) {
        out.push({ __unknown__: 1 });
        // See the record case: astral keys expose UTF-16 vs code-point sort.
        out.push({ ['\u{1F600}']: 1, ['\uFFFD']: 1 });
      }
      for (const [key, child] of Object.entries(node.properties)) {
        // Wrong child type for a required property.
        if (!child.optional) out.push({ [key]: adversarialFor(child) });
      }
      break;
    }

    case 'union':
      out.push('__no_variant_matches__');
      break;

    case 'boolean':
      out.push(0, 1);
      break;

    case 'any':
      break;
  }

  return out;
}

function adversarialFor(node: SchemaNode): unknown {
  switch (node.type) {
    case 'string':
      return 0;
    case 'number':
    case 'integer':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-bool';
    case 'array':
      return 'not-an-array';
    case 'object':
      return 'not-an-object';
    case 'record':
      return 'not-an-object';
    case 'tuple':
      return 'not-an-array';
    case 'literal':
      return '__other__';
    case 'enum':
      return '__other__';
    case 'union':
      return '__other__';
    case 'any':
      return undefined;
    default:
      return undefined;
  }
}

/** Deep clone a generated value, preserving the MISSING sentinel. */
function cloneValue(value: unknown): unknown {
  if (value === MISSING || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = cloneValue(child);
  }
  return out;
}

interface MutationSlot {
  readonly parent: unknown[] | Record<string, unknown>;
  readonly key: string | number;
}

function isTraversable(value: unknown): value is unknown[] | Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function collectSlots(root: unknown): MutationSlot[] {
  const slots: MutationSlot[] = [];
  const visit = (container: unknown[] | Record<string, unknown>): void => {
    if (Array.isArray(container)) {
      container.forEach((child, index) => {
        slots.push({ parent: container, key: index });
        if (isTraversable(child)) visit(child);
      });
      return;
    }
    for (const [key, child] of Object.entries(container)) {
      slots.push({ parent: container, key });
      if (isTraversable(child)) visit(child);
    }
  };
  if (isTraversable(root)) visit(root);
  return slots;
}

/**
 * Corrupt a known-valid value: replace an arbitrary slot, delete a slot, or
 * add an unexpected property/item. Seeded, so the corpus stays reproducible.
 */
function mutateValue(value: unknown, rng: Rng): unknown {
  const clone = cloneValue(value);
  if (!isTraversable(clone)) {
    return rng.pick(MUTATION_VALUES);
  }

  const slots = collectSlots(clone);
  if (slots.length === 0) {
    if (Array.isArray(clone)) {
      clone.push(rng.pick(MUTATION_VALUES));
    } else {
      clone['__extra__'] = rng.pick(MUTATION_VALUES);
    }
    return clone;
  }

  const slot = rng.pick(slots);
  const action = rng.int(0, 3);
  if (action === 0) {
    (slot.parent as Record<string | number, unknown>)[slot.key] = rng.pick(MUTATION_VALUES);
  } else if (action === 1) {
    if (Array.isArray(slot.parent)) slot.parent.splice(slot.key as number, 1);
    else delete (slot.parent as Record<string, unknown>)[slot.key as string];
  } else if (action === 2) {
    if (Array.isArray(slot.parent)) slot.parent.push(rng.pick(MUTATION_VALUES));
    else (slot.parent as Record<string, unknown>)['__extra__'] = rng.pick(MUTATION_VALUES);
  } else if (Array.isArray(clone)) {
    clone.push(rng.pick(MUTATION_VALUES));
  } else {
    clone['__extra__'] = rng.pick(MUTATION_VALUES);
  }
  return clone;
}

/**
 * Marker for an absent value at the JS level. The parity runner translates
 * MISSING to `_MISSING` on the Python side and unwraps it on the TS side.
 */
export const MISSING = Symbol('schemapar.missing');
