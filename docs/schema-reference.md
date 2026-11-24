# Schema reference

**English** | [Bahasa Indonesia](id/schema-reference.md)

A `schemapar` schema is a JSON document whose root is a **schema node**. This page documents every accepted node, field and rule. Anything not listed here is rejected.

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" }
  }
}
```

## Common fields

Every node accepts these fields in addition to its type-specific fields:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | string | required | Node type, one of the values below |
| `optional` | boolean | `false` | Skip validation when the value is `undefined` / absent |
| `nullable` | boolean | `false` | Skip validation when the value is `null` |

`optional` and `nullable` can both be `true`. In that case either an absent value or `null` is accepted.

`optional` is most useful on object properties:

```json
{
  "type": "object",
  "properties": {
    "age": { "type": "integer", "optional": true }
  }
}
```

A property is required unless its own node sets `"optional": true`.

Unknown fields are rejected with a path into the schema document:

```text
/properties/age/minLenght: unknown field 'minLenght' for type 'integer'
```

## Node types

### `string`

| Field | Type | Rules |
| --- | --- | --- |
| `minLength` | integer | `>= 0` |
| `maxLength` | integer | `>= 0`, and `>= minLength` when both are present |
| `pattern` | string | Must compile and stay inside the [portable regex subset](#regex-policy) |
| `format` | string | One of the [supported formats](#string-formats) |

Length is measured in Unicode **code points**, so a single emoji counts as 1 on every target. If both `pattern` and `format` are present, the value must satisfy both.

```json
{
  "type": "string",
  "minLength": 8,
  "maxLength": 15,
  "pattern": "^[0-9]+$"
}
```

Errors: `expected string`, `string shorter than N`, `string longer than N`, `string does not match pattern`, `string does not match format <name>`.

### `number`

| Field | Type | Rules |
| --- | --- | --- |
| `min` | finite number | Inclusive lower bound |
| `max` | finite number | Inclusive upper bound |

Accepts any finite JSON number, including fractional values. Rejects booleans, NaN, `Infinity` and `-Infinity`. If `min > max`, the schema is rejected at parse time.

Errors: `expected number`, `number less than N`, `number greater than N`.

### `integer`

| Field | Type | Rules |
| --- | --- | --- |
| `min` | integer | Inclusive lower bound |
| `max` | integer | Inclusive upper bound |

Accepts numbers with no fractional part. Rejects booleans, fractional values, NaN and infinities. In Go, JSON numbers arrive as `float64`; the generated validator accepts integral `float64` values and Go integer types, matching TypeScript's `Number.isInteger` and Python's integer check.

Errors: `expected integer`, `integer less than N`, `integer greater than N`.

### `boolean`

No fields.

Error: `expected boolean`.

### `literal`

| Field | Type | Rules |
| --- | --- | --- |
| `value` | string \| number \| boolean \| null | Required |

The value must equal the literal using type-aware equality. `true` does not equal `1`, and `1` does not equal `"1"`.

```json
{ "type": "literal", "value": "email" }
```

Error: `expected literal <JSON>`.

### `enum`

| Field | Type | Rules |
| --- | --- | --- |
| `values` | array | Non-empty; elements are string \| number \| boolean; duplicates rejected; `null` not allowed |

```json
{ "type": "enum", "values": ["admin", "member", "guest"] }
```

Error: `value not in enum`.

### `array`

| Field | Type | Rules |
| --- | --- | --- |
| `items` | schema | Required |
| `minItems` | integer | `>= 0` |
| `maxItems` | integer | `>= 0`, and `>= minItems` when both are present |

Every item is validated, even after an earlier item fails.

```json
{
  "type": "array",
  "items": { "type": "string", "minLength": 1 },
  "maxItems": 5
}
```

Errors: `expected array`, `array shorter than N`, `array longer than N`, plus per-item errors at paths such as `["tags", 0]`.

### `object`

| Field | Type | Rules |
| --- | --- | --- |
| `properties` | object | Required; maps property names to schemas; names must be non-empty |
| `additionalProperties` | boolean | Default `true` |
| `constraints` | array | Optional [cross-field constraints](#cross-field-constraints) |

Properties are validated in declaration order. A property is required unless its node is `optional`. When `additionalProperties` is `false`, every unknown key produces `unexpected property` at path `[...objectPath, key]`, visited in Unicode code-point order.

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "age": { "type": "integer", "optional": true }
  }
}
```

Errors: `expected object`, per-property errors, `unexpected property`, plus constraint errors.

### `record`

A map with arbitrary string keys and a uniform value schema.

| Field | Type | Rules |
| --- | --- | --- |
| `values` | schema | Required |
| `minProperties` | integer | `>= 0` |
| `maxProperties` | integer | `>= 0`, and `>= minProperties` when both are present |

Keys are validated in Unicode code-point order, which keeps error order identical across languages.

```json
{
  "type": "record",
  "values": { "type": "integer" },
  "minProperties": 1
}
```

Errors: `expected object`, `object has fewer than N properties`, `object has more than N properties`, plus per-value errors.

### `tuple`

A fixed-length array with a schema per position.

| Field | Type | Rules |
| --- | --- | --- |
| `items` | array of schemas | Required, non-empty |

The array must have **exactly** the same length as `items`. If the length differs, a single length error is reported and positions are not validated.

```json
{
  "type": "tuple",
  "items": [
    { "type": "string" },
    { "type": "integer" }
  ]
}
```

Errors: `expected array`, `tuple must have exactly N items`, plus positional errors.

### `union`

A value is valid when it validates against **any** variant.

| Field | Type | Rules |
| --- | --- | --- |
| `variants` | array of schemas | Required, non-empty |

Variant errors are isolated and suppressed. If no variant accepts the value, one error is reported at the union's path:

```text
value matched no union variant
```

```json
{
  "type": "union",
  "variants": [
    { "type": "string", "format": "email" },
    { "type": "string", "pattern": "^[0-9]{8,15}$" }
  ]
}
```

### `any`

No fields. Accepts any JSON value. An `undefined` value is still rejected unless the node is `optional`.

Error: `expected a value, got undefined`.

## Cross-field constraints

Constraints live on `object` nodes and are evaluated **after** the object's structural validation. If any property failed, constraints are skipped for that object, so a missing field does not also produce constraint noise.

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

### Comparison constraints

`greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`, `equal`, `notEqual`.

| Field | Rules |
| --- | --- |
| `kind` | One of the six comparison kinds |
| `left` | Name of a property declared on the same object |
| `right` | Name of a property declared on the same object |
| `message` | Optional custom message |

Semantics:

- **Ordering kinds** (`greaterThan`, `lessThan`, `greaterOrEqual`, `lessOrEqual`) apply only when both sides are finite numbers. Otherwise the constraint is skipped.
- **`equal` / `notEqual`** use type-aware equality and are skipped when either side is absent (`undefined`).
- The error path is the object's path, not the path of `left` or `right`.
- Default message: `constraint failed: <left> <op> <right>`, for example `constraint failed: min <= max`.

### `requiredTogether`

| Field | Rules |
| --- | --- |
| `kind` | `"requiredTogether"` |
| `fields` | Array of at least two known property names |
| `message` | Optional custom message |

The constraint fails only when **some but not all** listed fields are present. All absent or all present passes.

Default message: `fields must be provided together: <field1>, <field2>`.

## String formats

Formats are shared regex definitions baked into every generated validator. They validate **shape**, not full RFC semantics.

| Format | Accepts | Notes |
| --- | --- | --- |
| `email` | `local@domain.tld` | No whitespace; requires one `@` and at least one `.` after it. Not full RFC 5322. |
| `uuid` | `8-4-4-4-12` hex digits | Case-insensitive hex; no braces or `urn:` prefix. |
| `date` | `YYYY-MM-DD` | Shape only. `2020-13-40` passes; calendar validity is not checked. |
| `date-time` | `YYYY-MM-DDTHH:MM:SS[.fff]Z` | Uppercase `T`, trailing `Z` required. Offsets are not accepted. |
| `time` | `HH:MM:SS[.fff][Z\|±HH:MM]` | Offset is optional. Shape only; range is not checked. |
| `hostname` | Dot-separated labels | Letters, digits and hyphens; labels cannot start or end with a hyphen. No trailing dot. |
| `ipv4` | Dotted decimal | Each octet 0–255. |
| `ipv6` | IPv6 text forms | Includes `::` compression and IPv4-mapped forms. |
| `uri` | `scheme:rest` | Scheme starts with a letter; no whitespace in the remainder. Not a full RFC 3986 parser. |

If a node has both `format` and `pattern`, both must pass. During parity corpus generation, candidates are checked against both.

## Regex policy

`pattern` is evaluated by ECMA-262 `RegExp` in TypeScript, Python `re` in Python and RE2 in Go. To keep behavior identical, only a portable subset is accepted at parse time.

**Allowed**

- Literals, `.`, `^`, `$`
- Character classes, ranges and negation: `[a-z]`, `[^0-9]`
- Groups `(...)` and non-capturing groups `(?:...)`
- Alternation `|`
- Quantifiers `*`, `+`, `?`, `{m}`, `{m,}`, `{m,n}`
- Escapes `\f`, `\n`, `\r`, `\t`, `\v`, `\xHH`, `\uXXXX`
- Escaped metacharacters such as `\.` and `\\`

**Rejected**

| Construct | Reason |
| --- | --- |
| Lookahead `(?=...)`, `(?!...)` | Not supported by RE2 (Go) |
| Lookbehind `(?<=...)`, `(?<!...)` | Not portable across all targets |
| Named groups `(?<name>...)`, `(?P<name>...)` | Not portable |
| Named backreferences `\k<name>` | Not portable |
| Numeric backreferences and octal escapes `\1` | Not portable |
| Unicode property escapes `\p{...}`, `\P{...}` | Not supported by RE2 |
| Shorthand classes `\d`, `\w`, `\s`, `\b`, `\B` | Different Unicode semantics between engines |
| Anchors `\A`, `\Z`, `\z` | Use `^` and `$` instead |
| Control escapes `\cX` | Not portable |
| `\a` | Bell in Python, literal `a` in ECMA-262 |
| `\N`, `\U`, `\u{...}` | Use `\uXXXX` |
| Empty classes `[]`, `[^]` | Valid in ECMA-262, syntax errors in Python |

Use explicit classes instead of shorthand:

```json
{ "type": "string", "pattern": "^[0-9]{8,15}$" }
```

Translation performed by the generators:

- Python: an unescaped `$` becomes `\Z`, so a trailing newline never matches.
- Go: `\uXXXX` becomes RE2's `\x{XXXX}`.

## Error model

All generated validators share the same behavior:

- **Accumulate errors.** One failing property does not stop sibling properties, later array items or later checks.
- **Path arrays.** Each error has a `path` of property names (`string`) and array indexes (`number`), plus a `message`.
- **Ordering.** Object properties in schema declaration order; unknown object keys and record keys in Unicode code-point order; array items by index; constraints after structural checks in declaration order.
- **Shape errors stop deeper checks.** If a node is the wrong type, only the shape error is reported for that node; its children are not visited.
- **Union errors are collapsed.** Variants are tried in isolation; if none passes, one `value matched no union variant` error is reported.

Examples:

```text
["email"]            expected string
["tags", 2]          string shorter than 1
["contact"]          value matched no union variant
["age"]              integer greater than 150
[]                   constraint failed: min <= max
```

## Complete example

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "email": { "type": "string", "format": "email" },
    "name": { "type": "string", "minLength": 1, "maxLength": 80 },
    "age": { "type": "integer", "min": 0, "max": 150, "optional": true },
    "role": { "type": "enum", "values": ["admin", "member", "guest"] },
    "nickname": { "type": "string", "nullable": true, "maxLength": 20 },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1, "maxLength": 24 },
      "maxItems": 5
    },
    "contact": {
      "type": "union",
      "variants": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": { "type": "literal", "value": "email" },
            "value": { "type": "string", "format": "email" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": { "type": "literal", "value": "phone" },
            "value": { "type": "string", "pattern": "^[0-9]{8,15}$" }
          }
        }
      ]
    },
    "min": { "type": "integer", "optional": true },
    "max": { "type": "integer", "optional": true }
  },
  "constraints": [
    { "kind": "lessOrEqual", "left": "min", "right": "max" }
  ]
}
```

This is close to [`examples/user.schema.json`](../examples/user.schema.json), which is checked into the repository together with its generated validators.

## Schema validation rules

`schemapar check` rejects a document when any of these are violated:

- Root is not a plain object, or `type` is missing/unknown.
- A field is unknown for that node type.
- `optional` / `nullable` are not booleans.
- A numeric bound has the wrong type, or a length/count bound is negative or non-integer.
- `minLength > maxLength`, `minItems > maxItems`, `minProperties > maxProperties`, or `min > max`.
- `literal.value` is not a scalar.
- `enum.values` is empty, contains `null`, or contains duplicates.
- `array` has no `items`; `record` has no `values`; `tuple.items` is empty.
- `union.variants` is empty.
- `object.properties` is missing or not an object; a property name is empty.
- A constraint references an unknown property, has an unknown `kind`, or has extra fields.
- `requiredTogether.fields` has fewer than two entries.
- A `pattern` fails to compile or uses a non-portable construct.
- A `format` is not one of the nine supported names.
