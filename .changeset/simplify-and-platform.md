---
"@cvr/repo": minor
---

Simplify CLI surface and migrate to Effect platform services.

**Command surface reduction (10 → 5):** Remove `info`, `open`, `stats`, `search`, `prune`. Merge prune logic into `clean` with `--days`, `--max-size`, `--dry-run` flags. Add `--json` to `fetch`.

**Output discipline:** stdout = data only (paths, JSON), stderr = status/progress messages. Makes `cd $(repo fetch owner/repo)` work.

**Effect platform migration:**

- `Bun.spawn` → `ChildProcessSpawner` + `ChildProcess` from `effect/unstable/process`
- `fetch()` → `HttpClient` from `effect/unstable/http`
- `Bun.write` / `import("node:*")` → `FileSystem` from Effect
- `process.env.HOME` → `Config.string("HOME")`
- `Date.now()` / `new Date()` → `Clock.currentTimeMillis`
- `null` → `Option` for `metadata.find`, `CacheState.index`, `extractRepoInfo`

**Bug fixes:** git clone fallback cleanup, human-readable error messages, error swallowing fixes.

**Dead code cleanup:** Remove unused types, service methods, branded names, `parseSpecOrThrow`.
