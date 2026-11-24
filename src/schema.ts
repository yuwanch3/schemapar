/**
 * schemapar — schema DSL
 *
 * A small, JSON-friendly, language-neutral schema definition language.
 * Phase 1 supports: string, number, integer, boolean, literal, enum,
 * array, object, union, any — with optional/nullable modifiers and
 * basic constraints. Constraints that require language-specific
 * semantics (e.g. regex flavor) are intentionally limited to a common
 * subset so that generated validators agree across runtimes.
 */

export type ScalarValue = string | number | boolean | null;

/**
 * String formats understood by every generated validator.
 *
 * The regex source lives here so that TypeScript, Python and Go share one
 * definition. Each backend only translates anchors/escapes into its own
 * syntax; it never re-implements the format.
 */
export const FORMAT_PATTERNS = {
  email: '^[^ \\t\\n\\r\\f\\v@]+@[^ \\t\\n\\r\\f\\v@]+\\.[^ \\t\\n\\r\\f\\v@]+$',
  uuid: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  date: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  'date-time': '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?Z$',
  time: '^[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$',
  hostname:
    '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$',
  ipv4: '^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$',
  ipv6:
    '^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?:(?::[0-9a-fA-F]{1,4}){1,6})|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)|::(?:ffff(?::0{1,4})?:)?(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])|(?:[0-9a-fA-F]{1,4}:){1,4}:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))$',
  uri: '^[A-Za-z][A-Za-z0-9+.-]*:[^ \\t\\n\\r\\f\\v]+$',
} as const;

export type StringFormat = keyof typeof FORMAT_PATTERNS;

export interface BaseNode {
  readonly optional?: boolean;
  readonly nullable?: boolean;
}

export interface StringNode extends BaseNode {
  readonly type: 'string';
  readonly minLength?: number;
  readonly maxLength?: number;
  /**
   * A regular expression source string. Only the ECMA-262 common subset
   * is allowed (no lookbehind, no named groups) to guarantee parity
   * with Python's `re` module. Enforced by the schema validator.
   */
  readonly pattern?: string;
  readonly format?: StringFormat;
}

export interface NumberNode extends BaseNode {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
}

export interface IntegerNode extends BaseNode {
  readonly type: 'integer';
  readonly min?: number;
  readonly max?: number;
}

export interface BooleanNode extends BaseNode {
  readonly type: 'boolean';
}

export interface LiteralNode extends BaseNode {
  readonly type: 'literal';
  readonly value: ScalarValue;
}

export interface EnumNode extends BaseNode {
  readonly type: 'enum';
  readonly values: ReadonlyArray<string | number | boolean>;
}

export interface ArrayNode extends BaseNode {
  readonly type: 'array';
  readonly items: SchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ObjectNode extends BaseNode {
  readonly type: 'object';
  /** Per-property optionality lives on each child node. */
  readonly properties: { readonly [key: string]: SchemaNode };
  readonly additionalProperties?: boolean;
  /**
   * Declarative cross-field constraints. Evaluated only after every child
   * property has validated structurally, so error ordering is stable and
   * identical across generated languages.
   */
  readonly constraints?: ReadonlyArray<CrossFieldConstraint>;
}

export interface RecordNode extends BaseNode {
  readonly type: 'record';
  /** Schema applied to every value in the map. */
  readonly values: SchemaNode;
  readonly minProperties?: number;
  readonly maxProperties?: number;
}

export interface TupleNode extends BaseNode {
  readonly type: 'tuple';
  /** Fixed-length positional schemas; the array must have exactly this length. */
  readonly items: ReadonlyArray<SchemaNode>;
}

/**
 * A cross-field rule evaluated on an object once its structure is valid.
 * Kept intentionally small and declarative so that TypeScript and Python
 * can implement identical semantics without a shared expression language.
 */
export type CrossFieldConstraint =
  | {
      readonly kind:
        | 'greaterThan'
        | 'lessThan'
        | 'greaterOrEqual'
        | 'lessOrEqual'
        | 'equal'
        | 'notEqual';
      readonly left: string;
      readonly right: string;
      readonly message?: string;
    }
  | {
      readonly kind: 'requiredTogether';
      readonly fields: ReadonlyArray<string>;
      readonly message?: string;
    };

export interface UnionNode extends BaseNode {
  readonly type: 'union';
  readonly variants: ReadonlyArray<SchemaNode>;
}

export interface AnyNode extends BaseNode {
  readonly type: 'any';
}

export type SchemaNode =
  | StringNode
  | NumberNode
  | IntegerNode
  | BooleanNode
  | LiteralNode
  | EnumNode
  | ArrayNode
  | ObjectNode
  | RecordNode
  | TupleNode
  | UnionNode
  | AnyNode;

export type SchemaType = SchemaNode['type'];

/** A single structural problem in a schema definition. */
export interface SchemaError {
  /** Path into the schema document, e.g. ['properties', 'age', 'max']. */
  readonly path: ReadonlyArray<string>;
  readonly message: string;
}

/** Result of parsing/validating a raw schema document. */
export type ParseResult =
  | { readonly ok: true; readonly schema: SchemaNode }
  | { readonly ok: false; readonly errors: ReadonlyArray<SchemaError> };

const KNOWN_TYPES: ReadonlyArray<SchemaType> = [
  'string',
  'number',
  'integer',
  'boolean',
  'literal',
  'enum',
  'array',
  'object',
  'record',
  'tuple',
  'union',
  'any',
];

const KNOWN_FORMATS: ReadonlyArray<string> = Object.keys(FORMAT_PATTERNS);

/**
 * Fields accepted on a schema node, in addition to the common `type` /
 * `optional` / `nullable` modifiers. Unknown keys are rejected: silently
 * ignoring a typo (for example `minLenght`) produces a schema that passes
 * `check` but validates less than the author intended.
 */
const COMMON_NODE_FIELDS: ReadonlyArray<string> = ['type', 'optional', 'nullable'];

const TYPE_FIELDS: Readonly<Record<SchemaType, ReadonlyArray<string>>> = {
  any: [],
  string: ['minLength', 'maxLength', 'pattern', 'format'],
  number: ['min', 'max'],
  integer: ['min', 'max'],
  boolean: [],
  literal: ['value'],
  enum: ['values'],
  array: ['items', 'minItems', 'maxItems'],
  object: ['properties', 'additionalProperties', 'constraints'],
  record: ['values', 'minProperties', 'maxProperties'],
  tuple: ['items'],
  union: ['variants'],
};

function rejectUnknownFields(
  raw: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  context: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(raw)) {
    if (!allowedSet.has(key)) {
      errors.push({ path: [...path, key], message: `unknown field '${key}' ${context}` });
    }
  }
}

/**
 * Patterns are evaluated by ECMA-262 `RegExp` on the TypeScript side and by
 * Python's `re` on the Python side. The engines disagree on several
 * constructs, so we enforce a common subset at parse time instead of
 * discovering drift at runtime.
 *
 * `$` is allowed but translated to `\Z` for Python (see
 * translatePatternForPython): Python's `$` also matches immediately before a
 * trailing newline, while ECMA-262's does not.
 */
const SAFE_LETTER_ESCAPES = new Set(['f', 'n', 'r', 't', 'v', 'x', 'u']);

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z]/.test(ch);
}

function isAsciiDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/**
 * Return a human-readable reason when `pattern` uses a construct whose
 * behavior differs between ECMA-262 and Python `re`, or null when the pattern
 * stays inside the portable subset.
 */
export function findPatternProblem(pattern: string): string | null {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;

    if (ch === '\\') {
      const next = pattern[i + 1];
      // A dangling escape is reported by the RegExp constructor below.
      if (next === undefined) return null;
      if (isAsciiDigit(next)) {
        return 'backreferences and legacy octal escapes are not portable; use a literal character instead';
      }
      if ('dDwWsSbB'.includes(next)) {
        return 'shorthand classes (\\d, \\w, \\s, \\b) are not portable; use an explicit class such as [0-9] or [A-Za-z0-9_]';
      }
      if (next === 'p' || next === 'P') {
        return 'Unicode property escapes are not supported';
      }
      if (next === 'A' || next === 'Z' || next === 'z') {
        return 'anchors \\A, \\Z and \\z are not supported; use ^ and $';
      }
      if (next === 'c') return 'control escapes (\\cX) are not supported';
      if (next === 'k') return 'named backreferences are not supported';
      if (next === 'a') {
        return 'escape \\a means a bell character in Python but a literal "a" in ECMA-262; use \\x07 or the literal character';
      }
      if (next === 'N' || next === 'U') {
        return `escape \\${next} is not portable between ECMA-262 and Python; use \\uXXXX instead`;
      }
      if (next === 'u' && pattern[i + 2] === '{') {
        return 'Unicode code point escapes (\\u{...}) are not supported; use \\uXXXX';
      }
      if (isAsciiLetter(next) && !SAFE_LETTER_ESCAPES.has(next)) {
        return `escape \\${next} is a literal in ECMA-262 but invalid in Python; escape the character explicitly`;
      }
      i++; // skip the escaped character
      continue;
    }

    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }

    if (ch === '[') {
      // `[]` never matches in ECMA-262 and `[^]` matches anything, but both
      // are syntax errors in Python. Reject the shapes that diverge.
      if (pattern[i + 1] === ']') return 'empty character classes are not supported';
      if (pattern[i + 1] === '^' && pattern[i + 2] === ']' && pattern[i + 3] !== ']') {
        return 'empty negated character classes are not supported';
      }
      i++; // consume '['
      if (pattern[i] === '^') i++;
      if (pattern[i] === ']') i++; // a leading ']' is a literal member in both
      inClass = true;
      continue;
    }

    if (ch === '(' && pattern[i + 1] === '?') {
      const rest = pattern.slice(i + 2);
      if (rest.startsWith('<') || rest.startsWith('P<') || rest.startsWith('P=')) {
        return 'lookbehind and named groups are not supported';
      }
      if (rest.startsWith('=') || rest.startsWith('!')) {
        return 'lookahead is not supported by the RE2 engine (Go/Rust regex)';
      }
    }
  }
  return null;
}

/**
 * Rewrite a portable pattern for Python's `re`.
 *
 * Python's `$` matches before a trailing newline, unlike ECMA-262's `$`, so
 * unescaped `$` outside a character class becomes `\Z` (end of string).
 */
export function translatePatternForPython(pattern: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      out += ch;
      if (i + 1 < pattern.length) {
        out += pattern[i + 1];
        i++;
      }
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      out += ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      out += ch;
      continue;
    }
    out += ch === '$' ? '\\Z' : ch;
  }
  return out;
}

/**
 * Rewrite a portable pattern for Go's RE2 engine.
 *
 * RE2 accepts `\xHH` and `\x{XXXX}` but not ECMA-262/Python `\uXXXX`, so
 * four-hex-digit escapes are converted. Escaped backslashes are skipped so
 * that a literal `\\u0041` stays literal.
 */
export function translatePatternForGo(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = pattern[i + 1];
    if (next === 'u') {
      const hex = pattern.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += `\\x{${hex}}`;
        i += 5;
        continue;
      }
    }
    out += ch;
    if (next !== undefined) {
      out += next;
      i++;
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isScalar(value: unknown): value is ScalarValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

/**
 * Validate a raw (JSON-parsed) schema document and return a typed node.
 * This validates ONLY the schema definition itself — not user data.
 */
export function parseSchema(raw: unknown): ParseResult {
  const errors: SchemaError[] = [];
  const schema = parseNode(raw, [], errors);
  if (errors.length > 0 || schema === null) {
    return { ok: false, errors };
  }
  return { ok: true, schema };
}

function parseNode(
  raw: unknown,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
): SchemaNode | null {
  if (!isPlainObject(raw)) {
    errors.push({ path, message: 'schema node must be an object' });
    return null;
  }

  const type = raw['type'];
  if (typeof type !== 'string' || !KNOWN_TYPES.includes(type as SchemaType)) {
    errors.push({
      path: [...path, 'type'],
      message: `unknown or missing type; expected one of: ${KNOWN_TYPES.join(', ')}`,
    });
    return null;
  }

  rejectUnknownFields(
    raw,
    [...COMMON_NODE_FIELDS, ...TYPE_FIELDS[type as SchemaType]],
    path,
    errors,
    `for type '${type}'`,
  );

  const baseOk = parseBase(raw, path, errors);

  switch (type as SchemaType) {
    case 'string':
      return parseStringNode(raw, path, errors, baseOk);
    case 'number':
    case 'integer':
      return parseNumericNode(raw, path, errors, baseOk, type as 'number' | 'integer');
    case 'boolean':
      return withBase({ type: 'boolean' }, baseOk);
    case 'literal':
      return parseLiteralNode(raw, path, errors, baseOk);
    case 'enum':
      return parseEnumNode(raw, path, errors, baseOk);
    case 'array':
      return parseArrayNode(raw, path, errors, baseOk);
    case 'object':
      return parseObjectNode(raw, path, errors, baseOk);
    case 'record':
      return parseRecordNode(raw, path, errors, baseOk);
    case 'tuple':
      return parseTupleNode(raw, path, errors, baseOk);
    case 'union':
      return parseUnionNode(raw, path, errors, baseOk);
    case 'any':
      return withBase({ type: 'any' }, baseOk);
    default: {
      // Exhaustiveness guard; unreachable because of the KNOWN_TYPES check.
      const _never: never = type as never;
      void _never;
      return null;
    }
  }
}

interface BaseFields {
  readonly optional?: boolean;
  readonly nullable?: boolean;
}

function parseBase(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
): BaseFields {
  const out: { optional?: boolean; nullable?: boolean } = {};
  for (const key of ['optional', 'nullable'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      errors.push({ path: [...path, key], message: `${key} must be a boolean` });
      continue;
    }
    out[key] = value;
  }
  return out;
}

function withBase<T extends SchemaNode>(node: Omit<T, 'optional' | 'nullable'>, base: BaseFields): T {
  return { ...node, ...base } as T;
}

function optionalNumber(
  raw: Record<string, unknown>,
  key: string,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  opts: { integer?: boolean } = {},
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (opts.integer) {
    if (!isInteger(value)) {
      errors.push({ path: [...path, key], message: `${key} must be an integer` });
      return undefined;
    }
    return value;
  }
  if (!isFiniteNumber(value)) {
    errors.push({ path: [...path, key], message: `${key} must be a finite number` });
    return undefined;
  }
  return value;
}

function parseStringNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): StringNode {
  const minLength = optionalNumber(raw, 'minLength', path, errors, { integer: true });
  const maxLength = optionalNumber(raw, 'maxLength', path, errors, { integer: true });

  if (minLength !== undefined && minLength < 0) {
    errors.push({ path: [...path, 'minLength'], message: 'minLength must be >= 0' });
  }
  if (maxLength !== undefined && maxLength < 0) {
    errors.push({ path: [...path, 'maxLength'], message: 'maxLength must be >= 0' });
  }
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    errors.push({ path: [...path, 'minLength'], message: 'minLength must be <= maxLength' });
  }

  const pattern = raw['pattern'];
  let patternStr: string | undefined;
  if (pattern !== undefined) {
    if (typeof pattern !== 'string') {
      errors.push({ path: [...path, 'pattern'], message: 'pattern must be a string' });
    } else {
      patternStr = pattern;
      const problem = findPatternProblem(pattern);
      if (problem !== null) {
        errors.push({ path: [...path, 'pattern'], message: `unsupported pattern construct: ${problem}` });
      }
      try {
        new RegExp(pattern);
      } catch (err) {
        errors.push({
          path: [...path, 'pattern'],
          message: `invalid regular expression: ${(err as Error).message}`,
        });
      }
    }
  }

  const format = raw['format'];
  let formatStr: StringNode['format'];
  if (format !== undefined) {
    if (typeof format !== 'string' || !KNOWN_FORMATS.includes(format)) {
      errors.push({
        path: [...path, 'format'],
        message: `format must be one of: ${KNOWN_FORMATS.join(', ')}`,
      });
    } else {
      formatStr = format as StringNode['format'];
    }
  }

  const node: Omit<StringNode, 'optional' | 'nullable'> = {
    type: 'string',
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
    ...(patternStr !== undefined ? { pattern: patternStr } : {}),
    ...(formatStr !== undefined ? { format: formatStr } : {}),
  };
  return withBase<StringNode>(node, base);
}

function parseNumericNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
  type: 'number' | 'integer',
): NumberNode | IntegerNode {
  const min = optionalNumber(raw, 'min', path, errors, { integer: type === 'integer' });
  const max = optionalNumber(raw, 'max', path, errors, { integer: type === 'integer' });
  if (min !== undefined && max !== undefined && min > max) {
    errors.push({ path: [...path, 'min'], message: 'min must be <= max' });
  }
  if (type === 'integer') {
    const node: Omit<IntegerNode, 'optional' | 'nullable'> = {
      type: 'integer',
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
    return withBase<IntegerNode>(node, base);
  }
  const node: Omit<NumberNode, 'optional' | 'nullable'> = {
    type: 'number',
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
  return withBase<NumberNode>(node, base);
}

function parseLiteralNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): LiteralNode | null {
  const value = raw['value'];
  if (!isScalar(value)) {
    errors.push({ path: [...path, 'value'], message: 'literal value must be a string, number, boolean, or null' });
    return null;
  }
  return withBase<LiteralNode>({ type: 'literal', value }, base);
}

function parseEnumNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): EnumNode | null {
  const values = raw['values'];
  if (!Array.isArray(values) || values.length === 0) {
    errors.push({ path: [...path, 'values'], message: 'enum values must be a non-empty array' });
    return null;
  }
  const out: Array<string | number | boolean> = [];
  const seen = new Set<string>();
  values.forEach((v, i) => {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      errors.push({
        path: [...path, 'values', String(i)],
        message: 'enum values must be strings, numbers, or booleans (null is not allowed)',
      });
      return;
    }
    const key = `${typeof v}:${String(v)}`;
    if (seen.has(key)) {
      errors.push({ path: [...path, 'values', String(i)], message: 'duplicate enum value' });
      return;
    }
    seen.add(key);
    out.push(v);
  });
  return withBase<EnumNode>({ type: 'enum', values: out }, base);
}

function parseArrayNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): ArrayNode | null {
  if (!('items' in raw)) {
    errors.push({ path: [...path, 'items'], message: 'array requires an items schema' });
    return null;
  }
  const items = parseNode(raw['items'], [...path, 'items'], errors);
  if (items === null) return null;

  const minItems = optionalNumber(raw, 'minItems', path, errors, { integer: true });
  const maxItems = optionalNumber(raw, 'maxItems', path, errors, { integer: true });
  if (minItems !== undefined && minItems < 0) {
    errors.push({ path: [...path, 'minItems'], message: 'minItems must be >= 0' });
  }
  if (maxItems !== undefined && maxItems < 0) {
    errors.push({ path: [...path, 'maxItems'], message: 'maxItems must be >= 0' });
  }
  if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
    errors.push({ path: [...path, 'minItems'], message: 'minItems must be <= maxItems' });
  }

  const node: Omit<ArrayNode, 'optional' | 'nullable'> = {
    type: 'array',
    items,
    ...(minItems !== undefined ? { minItems } : {}),
    ...(maxItems !== undefined ? { maxItems } : {}),
  };
  return withBase<ArrayNode>(node, base);
}

function parseObjectNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): ObjectNode | null {
  const props = raw['properties'];
  if (!isPlainObject(props)) {
    errors.push({ path: [...path, 'properties'], message: 'object requires a properties object' });
    return null;
  }
  const properties: Record<string, SchemaNode> = {};
  for (const [key, child] of Object.entries(props)) {
    if (key === '') {
      errors.push({ path: [...path, 'properties'], message: 'property names must be non-empty' });
      continue;
    }
    const parsed = parseNode(child, [...path, 'properties', key], errors);
    if (parsed !== null) properties[key] = parsed;
  }

  let additionalProperties: boolean | undefined;
  const ap = raw['additionalProperties'];
  if (ap !== undefined) {
    if (typeof ap !== 'boolean') {
      errors.push({ path: [...path, 'additionalProperties'], message: 'additionalProperties must be a boolean' });
    } else {
      additionalProperties = ap;
    }
  }

  const constraints = parseConstraints(raw['constraints'], [...path, 'constraints'], properties, errors);

  const node: Omit<ObjectNode, 'optional' | 'nullable'> = {
    type: 'object',
    properties,
    ...(additionalProperties !== undefined ? { additionalProperties } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
  };
  return withBase<ObjectNode>(node, base);
}

const COMPARISON_KINDS: ReadonlyArray<CrossFieldConstraint['kind']> = [
  'greaterThan',
  'lessThan',
  'greaterOrEqual',
  'lessOrEqual',
  'equal',
  'notEqual',
  'requiredTogether',
];

function parseConstraints(
  raw: unknown,
  path: ReadonlyArray<string>,
  properties: Record<string, SchemaNode>,
  errors: SchemaError[],
): ReadonlyArray<CrossFieldConstraint> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push({ path, message: 'constraints must be an array' });
    return [];
  }
  const out: CrossFieldConstraint[] = [];
  raw.forEach((entry, i) => {
    const p = [...path, String(i)];
    if (!isPlainObject(entry)) {
      errors.push({ path: p, message: 'constraint must be an object' });
      return;
    }
    const kind = entry['kind'];
    if (typeof kind !== 'string' || !COMPARISON_KINDS.includes(kind as CrossFieldConstraint['kind'])) {
      errors.push({ path: [...p, 'kind'], message: `kind must be one of: ${COMPARISON_KINDS.join(', ')}` });
      return;
    }
    rejectUnknownFields(
      entry,
      kind === 'requiredTogether'
        ? ['kind', 'message', 'fields']
        : ['kind', 'message', 'left', 'right'],
      p,
      errors,
      `for constraint '${kind}'`,
    );
    let message: string | undefined;
    const msg = entry['message'];
    if (msg !== undefined) {
      if (typeof msg !== 'string') {
        errors.push({ path: [...p, 'message'], message: 'message must be a string' });
      } else {
        message = msg;
      }
    }

    if (kind === 'requiredTogether') {
      const fields = entry['fields'];
      if (!Array.isArray(fields) || fields.length < 2) {
        errors.push({ path: [...p, 'fields'], message: 'requiredTogether needs at least two fields' });
        return;
      }
      const parsedFields: string[] = [];
      fields.forEach((f, j) => {
        if (typeof f !== 'string') {
          errors.push({ path: [...p, 'fields', String(j)], message: 'field name must be a string' });
          return;
        }
        if (!(f in properties)) {
          errors.push({ path: [...p, 'fields', String(j)], message: `unknown property '${f}'` });
          return;
        }
        parsedFields.push(f);
      });
      if (parsedFields.length === fields.length) {
        out.push({ kind: 'requiredTogether', fields: parsedFields, ...(message !== undefined ? { message } : {}) });
      }
      return;
    }

    const left = entry['left'];
    const right = entry['right'];
    if (typeof left !== 'string' || !(left in properties)) {
      errors.push({ path: [...p, 'left'], message: `left must reference a known property` });
      return;
    }
    if (typeof right !== 'string' || !(right in properties)) {
      errors.push({ path: [...p, 'right'], message: `right must reference a known property` });
      return;
    }
    out.push({
      kind: kind as Exclude<CrossFieldConstraint['kind'], 'requiredTogether'>,
      left,
      right,
      ...(message !== undefined ? { message } : {}),
    });
  });
  return out;
}

function parseRecordNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): RecordNode | null {
  if (!('values' in raw)) {
    errors.push({ path: [...path, 'values'], message: 'record requires a values schema' });
    return null;
  }
  const values = parseNode(raw['values'], [...path, 'values'], errors);
  if (values === null) return null;
  const minProperties = optionalNumber(raw, 'minProperties', path, errors, { integer: true });
  const maxProperties = optionalNumber(raw, 'maxProperties', path, errors, { integer: true });
  if (minProperties !== undefined && minProperties < 0) {
    errors.push({ path: [...path, 'minProperties'], message: 'minProperties must be >= 0' });
  }
  if (maxProperties !== undefined && maxProperties < 0) {
    errors.push({ path: [...path, 'maxProperties'], message: 'maxProperties must be >= 0' });
  }
  if (minProperties !== undefined && maxProperties !== undefined && minProperties > maxProperties) {
    errors.push({ path: [...path, 'minProperties'], message: 'minProperties must be <= maxProperties' });
  }
  const node: Omit<RecordNode, 'optional' | 'nullable'> = {
    type: 'record',
    values,
    ...(minProperties !== undefined ? { minProperties } : {}),
    ...(maxProperties !== undefined ? { maxProperties } : {}),
  };
  return withBase<RecordNode>(node, base);
}

function parseTupleNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): TupleNode | null {
  const items = raw['items'];
  if (!Array.isArray(items) || items.length === 0) {
    errors.push({ path: [...path, 'items'], message: 'tuple requires a non-empty items array' });
    return null;
  }
  const parsed: SchemaNode[] = [];
  items.forEach((v, i) => {
    const node = parseNode(v, [...path, 'items', String(i)], errors);
    if (node !== null) parsed.push(node);
  });
  if (parsed.length === 0) return null;
  return withBase<TupleNode>({ type: 'tuple', items: parsed }, base);
}

function parseUnionNode(
  raw: Record<string, unknown>,
  path: ReadonlyArray<string>,
  errors: SchemaError[],
  base: BaseFields,
): UnionNode | null {
  const variants = raw['variants'];
  if (!Array.isArray(variants) || variants.length < 1) {
    errors.push({ path: [...path, 'variants'], message: 'union requires a non-empty array of variants' });
    return null;
  }
  const parsed: SchemaNode[] = [];
  variants.forEach((v, i) => {
    const node = parseNode(v, [...path, 'variants', String(i)], errors);
    if (node !== null) parsed.push(node);
  });
  if (parsed.length === 0) return null;
  return withBase<UnionNode>({ type: 'union', variants: parsed }, base);
}

/**
 * Compute a stable, human-readable JSON pointer for a path, e.g.
 * '/properties/age/max'. Useful for diagnostics.
 */
export function formatPath(path: ReadonlyArray<string>): string {
  if (path.length === 0) return '/';
  return '/' + path.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}
