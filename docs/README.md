# schemapar documentation

**English** | [Bahasa Indonesia](id/README.md)

`schemapar` compiles one JSON schema into TypeScript, Python and Go validators, then proves the generated validators behave identically.

| Document | Read it when you want to… |
| --- | --- |
| [Getting started](getting-started.md) | Install the tool, compile your first validator, run parity, wire it into CI |
| [Schema reference](schema-reference.md) | Look up a node type, field, constraint, format or regex rule |
| [Parity testing](parity.md) | Understand corpus generation, comparison rules and mismatch reports |
| [Architecture](architecture.md) | Understand how the compiler, generators and parity engine fit together |

Other useful files:

- [README](../README.md) — project overview and quick start.
- [Examples](../examples/README.md) — checked-in schema and generated validators.
- [Contributing](../CONTRIBUTING.md) — local development and change guidelines.
- [Changelog](../CHANGELOG.md) — release history.

## The mental model

```text
schema.json ──► schemapar compile --target ts ──► validator.ts
            ├─► schemapar compile --target py ──► validator.py
            ├─► schemapar compile --target go ──► validator.go
            └─► schemapar parity ──────────────► terminal output + exit code
```

- **Compile** turns rules into standalone source files.
- **Parity** generates a corpus, runs every validator on the same inputs, and compares the complete error lists.
- `schemapar` is a build-time tool. The generated validators have no runtime dependency on it.
