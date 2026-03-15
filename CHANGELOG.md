# @cvr/repo

## 1.3.0

### Minor Changes

- [`f546c53`](https://github.com/cevr/repo/commit/f546c53da79e7179ff913ba5ed4f59100b62c88a) Thanks [@cevr](https://github.com/cevr)! - Auto-prune stale repos on fetch. Every `repo fetch` now removes cached repos not accessed in 30+ days. Extracted `pruneByAge` as shared logic between `fetch` and `clean`.

- [`86b39fc`](https://github.com/cevr/repo/commit/86b39fcb293f9fb0d20a8a250505eefffcac787b) Thanks [@cevr](https://github.com/cevr)! - Migrate from Effect v3 to v4 (effect-smol). Updates all services to ServiceMap.Service, errors to Schema.TaggedErrorClass, CLI to effect/unstable/cli, and test runner to effect-bun-test. Drops @effect/cli, @effect/platform, @effect/vitest, and vitest.

- [`f1ff77e`](https://github.com/cevr/repo/commit/f1ff77e8296c099e94953439361a550c81bc8ab8) Thanks [@cevr](https://github.com/cevr)! - Simplify CLI surface and migrate to Effect platform services.

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

## 1.2.0

### Minor Changes

- [`471abc5`](https://github.com/cevr/repo/commit/471abc5760c84068bec28217d84375e68140f012) Thanks [@cevr](https://github.com/cevr)! - Always refresh git repos on fetch, background refresh on path
  - `fetch`: cached git repos are now always updated (removed `--update` flag). Non-git repos still return cached path.
  - `path`: returns cached path immediately, then refreshes git refs via a forked `fetchRefs` in the background.
  - Added `fetchRefs` method to `GitService` for fetch-only (no reset) git refresh.

## 1.1.1

### Patch Changes

- [`c8d2d8f`](https://github.com/cevr/repo/commit/c8d2d8f7c42e9a53447263b1f8e23ba96468d72e) Thanks [@cevr](https://github.com/cevr)! - fix: case-insensitive cache lookup for legacy GitHub repos

  Repos cached before case-normalization fix may have mixed-case paths (e.g., `Vercel/Next.js`). Now `fetch`, `path`, `info`, and `remove` commands correctly find these legacy entries when queried with lowercase specs.

## 1.1.0

### Minor Changes

- [`dd85744`](https://github.com/cevr/repo/commit/dd857441f83d566fc7a5c733afeaa8a1112b8cbf) Thanks [@cevr](https://github.com/cevr)! - Codebase quality audit and refactoring:
  - Extract shared parsing logic to `src/parsing.ts` (eliminates ~130 lines of duplication)
  - Add unified error handler in `src/commands/shared.ts` for consistent error formatting
  - Add Effect.fn tracing to registry fetch helpers for better observability
  - Replace silent `Effect.ignore` with explicit error handling in cache/metadata services
  - Add in-memory caching with dirty flag to MetadataService (reduces disk reads)
  - Add atomic writes for metadata (temp file + rename)
  - Add batch operations: `addMany`, `removeMany`, `flush` to MetadataService
  - Refactor `open` command: replace `--finder`/`--editor` flags with unified `--with` option
  - Refactor `fetch` command: require explicit `--update` flag (no auto-update)
  - Fix temp file handling to use `os.tmpdir()` with random suffix
  - Add branded types for package names (GitHubRepoName, NpmPackageName, PypiPackageName, CratesPackageName)

### Patch Changes

- [`f6754cd`](https://github.com/cevr/repo/commit/f6754cd34b2d67701e2c0a6278db47d800785bb2) Thanks [@cevr](https://github.com/cevr)! - Fix case-insensitive GitHub repo lookups. `Vercel/Next.js` now matches `vercel/next.js`.
