/**
 * schemapar — public API
 *
 * Programmatic entry point. CLI users do not need to touch this module.
 */

export type {
  SchemaNode,
  SchemaType,
  SchemaError,
  ParseResult,
  ScalarValue,
  StringFormat,
  BaseNode,
  StringNode,
  NumberNode,
  IntegerNode,
  BooleanNode,
  LiteralNode,
  EnumNode,
  ArrayNode,
  ObjectNode,
  RecordNode,
  TupleNode,
  CrossFieldConstraint,
  UnionNode,
  AnyNode,
} from './schema.js';

export { parseSchema, formatPath } from './schema.js';
export { FORMAT_PATTERNS } from './schema.js';

export { generateTypeScript } from './gen-ts.js';
export type { GenTsOptions } from './gen-ts.js';

export { generatePython } from './gen-py.js';
export type { GenPyOptions } from './gen-py.js';

export { generateGo } from './gen-go.js';
export type { GenGoOptions } from './gen-go.js';

export { buildCorpus, generateValid, adversarialValues, Rng, MISSING } from './generator.js';
export type { Case } from './generator.js';

export { runParity, encodeForWire } from './parity.js';
export type {
  ParityOptions,
  ParityResult,
  ParityMismatch,
  ValidationError,
  ValidatorResult,
} from './parity.js';
