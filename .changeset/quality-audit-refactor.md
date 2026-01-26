---
"@cvr/repo": minor
---

Codebase quality audit and refactoring:

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
