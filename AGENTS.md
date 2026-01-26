# repo CLI

Multi-registry source code cache manager. Bun + Effect TypeScript.

## Commands

```bash
bun run gate      # parallel: typecheck, lint, fmt, test
bun run dev       # run CLI in dev mode
bun run build     # compile binary
bun run link      # symlink to ~/.bun/bin/repo
```

## Tooling

- **oxlint**: linter w/ TypeScript + import plugins
- **oxfmt**: formatter (reorders JSON keys alphabetically)
- **lefthook**: pre-commit runs gate checks
- **concurrently**: parallel script runner for gate

## Effect Patterns

### Schema for JSON

Use `Schema.encode`/`Schema.decodeUnknown` in Effect generators, NOT sync variants:

```typescript
// Inside Effect.gen
const jsonStr = yield * Schema.encode(Schema.parseJson(Schema.Unknown))(data);
const parsed = yield * Schema.decodeUnknown(Schema.compose(Schema.parseJson(), MySchema))(str);
```

Language service warns on `Schema.encodeSync`/`Schema.decodeUnknownSync` inside generators.

### Service Layers

Each service in `src/services/` has:

- Live layer: real filesystem/network
- Test layer in `src/test-utils/layers/`: in-memory mock

Test layers share parsing logic with live (duplicated in registry.ts).

### Non-null Assertions

oxlint forbids `!` assertions. Use `as Type` with comment explaining guarantee:

```typescript
// match[1] guaranteed to exist when regex matches
const value = match[1] as string;
```

## Architecture

See CLAUDE.md for full architecture docs.

## Gotchas

- `@effect/cli` arg ordering: options before positional args, or use `--opt=value`
- oxfmt reorders JSON keys - run `bun run fmt` after editing package.json
- typecheck exit code 2 = warnings only (Effect language service suggestions)
