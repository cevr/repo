# @cvr/repo

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
