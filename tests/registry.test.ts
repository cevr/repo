import { Effect, Layer, Option } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { RegistryService } from "../src/services/registry.js"
import { GitService } from "../src/services/git.js"
import { CacheService } from "../src/services/cache.js"
import { MetadataService } from "../src/services/metadata.js"
import { specToString } from "../src/types.js"

// Compose test layers - all services use in-memory implementations
const testLayer = Layer.mergeAll(
  RegistryService.testLayer,
  GitService.testLayer,
  CacheService.testLayer,
  MetadataService.testLayer
)

describe("fetch flow", () => {
  it.effect("fetches a GitHub repo and adds it to metadata", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // User runs: repo fetch vercel/next.js
      const spec = yield* registry.parseSpec("vercel/next.js")
      expect(spec.registry).toBe("github")
      expect(spec.name).toBe("vercel/next.js")

      // Get the destination path
      const destPath = yield* cache.getPath(spec)
      expect(destPath).toContain("vercel/next.js")

      // Fetch the repo
      yield* registry.fetch(spec, destPath)

      // Add to metadata (simulating what fetch command does)
      const now = new Date().toISOString()
      yield* metadata.add({
        spec,
        fetchedAt: now,
        lastAccessedAt: now,
        sizeBytes: 1000,
        path: destPath,
      })

      // Verify it's in metadata
      const found = yield* metadata.find(spec)
      expect(found).not.toBeNull()
      expect(found?.path).toBe(destPath)
    }).pipe(Effect.provide(testLayer))
  )

  it.effect("fetches an npm package with version", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // User runs: repo fetch npm:lodash@4.17.21
      const spec = yield* registry.parseSpec("npm:lodash@4.17.21")
      expect(spec.registry).toBe("npm")
      expect(spec.name).toBe("lodash")
      expect(Option.getOrNull(spec.version)).toBe("4.17.21")

      // Get the destination path - should include version
      const destPath = yield* cache.getPath(spec)
      expect(destPath).toContain("lodash")
      expect(destPath).toContain("4.17.21")

      // Fetch and add to metadata
      yield* registry.fetch(spec, destPath)
      yield* metadata.add({
        spec,
        fetchedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        sizeBytes: 500,
        path: destPath,
      })

      // Verify
      const found = yield* metadata.find(spec)
      expect(found?.spec.name).toBe("lodash")
    }).pipe(Effect.provide(testLayer))
  )

  it.effect("fetches a scoped npm package", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService

      // User runs: repo fetch npm:@effect/cli@0.73.0
      const spec = yield* registry.parseSpec("npm:@effect/cli@0.73.0")
      expect(spec.registry).toBe("npm")
      expect(spec.name).toBe("@effect/cli")
      expect(Option.getOrNull(spec.version)).toBe("0.73.0")

      const destPath = yield* cache.getPath(spec)
      expect(destPath).toContain("@effect/cli")
      expect(destPath).toContain("0.73.0")
    }).pipe(Effect.provide(testLayer))
  )
})

describe("list flow", () => {
  it.effect("lists all cached repos", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // Fetch multiple repos
      const specs = [
        yield* registry.parseSpec("vercel/next.js"),
        yield* registry.parseSpec("npm:effect@3.0.0"),
        yield* registry.parseSpec("pypi:requests"),
      ]

      for (const spec of specs) {
        const destPath = yield* cache.getPath(spec)
        yield* registry.fetch(spec, destPath)
        yield* metadata.add({
          spec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 1000,
          path: destPath,
        })
      }

      // User runs: repo list
      const all = yield* metadata.all()
      expect(all.length).toBe(3)

      // Verify different registries are present
      const registries = all.map((r) => r.spec.registry)
      expect(registries).toContain("github")
      expect(registries).toContain("npm")
      expect(registries).toContain("pypi")
    }).pipe(Effect.provide(testLayer))
  )
})

describe("remove flow", () => {
  it.effect("removes a cached repo", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // Fetch a repo
      const spec = yield* registry.parseSpec("owner/repo")
      const destPath = yield* cache.getPath(spec)
      yield* registry.fetch(spec, destPath)
      yield* metadata.add({
        spec,
        fetchedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        sizeBytes: 1000,
        path: destPath,
      })

      // Verify it exists
      const before = yield* metadata.find(spec)
      expect(before).not.toBeNull()

      // User runs: repo remove owner/repo
      yield* cache.remove(destPath)
      const removed = yield* metadata.remove(spec)
      expect(removed).toBe(true)

      // Verify it's gone
      const after = yield* metadata.find(spec)
      expect(after).toBeNull()
    }).pipe(Effect.provide(testLayer))
  )
})

describe("clean flow", () => {
  it.effect("removes all cached repos", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // Fetch multiple repos
      const specs = [
        yield* registry.parseSpec("a/b"),
        yield* registry.parseSpec("c/d"),
        yield* registry.parseSpec("npm:pkg"),
      ]

      for (const spec of specs) {
        const destPath = yield* cache.getPath(spec)
        yield* registry.fetch(spec, destPath)
        yield* metadata.add({
          spec,
          fetchedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          sizeBytes: 100,
          path: destPath,
        })
      }

      // Verify repos exist
      const before = yield* metadata.all()
      expect(before.length).toBe(3)

      // User runs: repo clean
      yield* cache.removeAll()
      // Clear metadata
      for (const spec of specs) {
        yield* metadata.remove(spec)
      }

      // Verify all gone
      const after = yield* metadata.all()
      expect(after.length).toBe(0)
    }).pipe(Effect.provide(testLayer))
  )
})

describe("prune flow", () => {
  it.effect("finds repos older than specified days", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // Add an old repo (31 days ago)
      const oldSpec = yield* registry.parseSpec("old/repo")
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
      yield* metadata.add({
        spec: oldSpec,
        fetchedAt: oldDate.toISOString(),
        lastAccessedAt: oldDate.toISOString(),
        sizeBytes: 1000,
        path: yield* cache.getPath(oldSpec),
      })

      // Add a recent repo
      const newSpec = yield* registry.parseSpec("new/repo")
      yield* metadata.add({
        spec: newSpec,
        fetchedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        sizeBytes: 1000,
        path: yield* cache.getPath(newSpec),
      })

      // User runs: repo prune --days 30
      const oldRepos = yield* metadata.findOlderThan(30)
      expect(oldRepos.length).toBe(1)
      expect(oldRepos[0]?.spec.name).toBe("old/repo")

      // Prune them
      for (const repo of oldRepos) {
        yield* cache.remove(repo.path)
        yield* metadata.remove(repo.spec)
      }

      // Verify only new repo remains
      const remaining = yield* metadata.all()
      expect(remaining.length).toBe(1)
      expect(remaining[0]?.spec.name).toBe("new/repo")
    }).pipe(Effect.provide(testLayer))
  )

  it.effect("finds repos larger than specified size", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // Add a large repo
      const largeSpec = yield* registry.parseSpec("large/repo")
      yield* metadata.add({
        spec: largeSpec,
        fetchedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        sizeBytes: 100_000_000, // 100MB
        path: yield* cache.getPath(largeSpec),
      })

      // Add a small repo
      const smallSpec = yield* registry.parseSpec("small/repo")
      yield* metadata.add({
        spec: smallSpec,
        fetchedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        sizeBytes: 1_000_000, // 1MB
        path: yield* cache.getPath(smallSpec),
      })

      // User runs: repo prune --max-size 50MB
      const largeRepos = yield* metadata.findLargerThan(50_000_000)
      expect(largeRepos.length).toBe(1)
      expect(largeRepos[0]?.spec.name).toBe("large/repo")
    }).pipe(Effect.provide(testLayer))
  )
})

describe("update flow", () => {
  it.effect("updates access time when repo is re-fetched", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // Initial fetch
      const spec = yield* registry.parseSpec("owner/repo")
      const destPath = yield* cache.getPath(spec)
      const initialTime = new Date(Date.now() - 1000).toISOString()
      yield* metadata.add({
        spec,
        fetchedAt: initialTime,
        lastAccessedAt: initialTime,
        sizeBytes: 1000,
        path: destPath,
      })

      // User runs: repo fetch owner/repo (again)
      // This should update access time
      yield* metadata.updateAccessTime(spec)

      // Verify access time was updated
      const found = yield* metadata.find(spec)
      expect(found).not.toBeNull()
      expect(new Date(found!.lastAccessedAt).getTime()).toBeGreaterThan(
        new Date(initialTime).getTime()
      )
      // But fetchedAt should remain the same
      expect(found!.fetchedAt).toBe(initialTime)
    }).pipe(Effect.provide(testLayer))
  )
})

describe("spec parsing", () => {
  it.effect("parses various spec formats correctly", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService

      // GitHub formats
      const github1 = yield* registry.parseSpec("vercel/next.js")
      expect(specToString(github1)).toBe("vercel/next.js")

      const github2 = yield* registry.parseSpec("vercel/next.js@v14.0.0")
      expect(specToString(github2)).toBe("vercel/next.js@v14.0.0")

      // npm formats
      const npm1 = yield* registry.parseSpec("npm:lodash")
      expect(specToString(npm1)).toBe("npm:lodash")

      const npm2 = yield* registry.parseSpec("npm:lodash@4.17.21")
      expect(specToString(npm2)).toBe("npm:lodash@4.17.21")

      const npm3 = yield* registry.parseSpec("npm:@effect/cli@0.73.0")
      expect(specToString(npm3)).toBe("npm:@effect/cli@0.73.0")

      // PyPI format
      const pypi = yield* registry.parseSpec("pypi:requests@2.31.0")
      expect(specToString(pypi)).toBe("pypi:requests@2.31.0")

      // Crates format
      const crates = yield* registry.parseSpec("crates:serde@1.0.0")
      expect(specToString(crates)).toBe("crates:serde@1.0.0")

      // Bare package name defaults to npm
      const bare = yield* registry.parseSpec("lodash")
      expect(bare.registry).toBe("npm")
    }).pipe(Effect.provide(testLayer))
  )
})

describe("git operations", () => {
  it.effect("tracks cloned repos and checks if path is a git repo", () =>
    Effect.gen(function* () {
      const git = yield* GitService

      // Clone a repo
      yield* git.clone("https://github.com/owner/repo.git", "/tmp/repo", {
        depth: 100,
      })

      // Check if it's a git repo
      const isGit = yield* git.isGitRepo("/tmp/repo")
      expect(isGit).toBe(true)

      // Non-cloned path should not be a git repo
      const notGit = yield* git.isGitRepo("/tmp/other")
      expect(notGit).toBe(false)
    }).pipe(Effect.provide(testLayer))
  )

  it.effect("gets current ref from cloned repo", () =>
    Effect.gen(function* () {
      const git = yield* GitService

      yield* git.clone("https://github.com/owner/repo.git", "/tmp/repo")
      const ref = yield* git.getCurrentRef("/tmp/repo")
      expect(ref).toBe("v1.0.0") // Test layer returns this
    }).pipe(Effect.provide(testLayer))
  )
})

describe("path flow", () => {
  it.effect("returns path for cached repo", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      // Fetch a repo first
      const spec = yield* registry.parseSpec("owner/repo")
      const destPath = yield* cache.getPath(spec)
      yield* registry.fetch(spec, destPath)
      yield* metadata.add({
        spec,
        fetchedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        sizeBytes: 1000,
        path: destPath,
      })

      // Now path lookup should work
      const found = yield* metadata.find(spec)
      expect(found).not.toBeNull()
      expect(found?.path).toBe(destPath)
    }).pipe(Effect.provide(testLayer))
  )

  it.effect("returns null for uncached repo", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const metadata = yield* MetadataService

      // Don't fetch, just try to find
      const spec = yield* registry.parseSpec("nonexistent/repo")
      const found = yield* metadata.find(spec)
      expect(found).toBeNull()
    }).pipe(Effect.provide(testLayer))
  )
})

describe("info flow", () => {
  it.effect("returns metadata for cached repo with git info", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService
      const git = yield* GitService

      // Setup: fetch and add to metadata
      const spec = yield* registry.parseSpec("owner/repo")
      const destPath = yield* cache.getPath(spec)
      yield* git.clone("https://github.com/owner/repo.git", destPath, {
        depth: 100,
      })

      const now = new Date().toISOString()
      yield* metadata.add({
        spec,
        fetchedAt: now,
        lastAccessedAt: now,
        sizeBytes: 5000,
        path: destPath,
      })

      // Verify metadata exists
      const found = yield* metadata.find(spec)
      expect(found).not.toBeNull()
      expect(found?.sizeBytes).toBe(5000)
      expect(found?.path).toBe(destPath)

      // Verify git info is available
      const isGit = yield* git.isGitRepo(destPath)
      expect(isGit).toBe(true)

      const ref = yield* git.getCurrentRef(destPath)
      expect(ref).toBe("v1.0.0") // test layer returns this
    }).pipe(Effect.provide(testLayer))
  )

  it.effect("returns null for uncached repo", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const metadata = yield* MetadataService

      const spec = yield* registry.parseSpec("missing/repo")
      const found = yield* metadata.find(spec)
      expect(found).toBeNull()
    }).pipe(Effect.provide(testLayer))
  )
})

describe("integration flow", () => {
  it.effect("complete workflow: fetch, path, info, explore", () =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const cache = yield* CacheService
      const metadata = yield* MetadataService
      const git = yield* GitService

      // Step 1: Parse spec (user input)
      const spec = yield* registry.parseSpec("vercel/next.js")
      expect(spec.registry).toBe("github")

      // Step 2: Check if cached (repo path)
      const beforeFetch = yield* metadata.find(spec)
      expect(beforeFetch).toBeNull() // Not cached yet

      // Step 3: Fetch (repo fetch)
      const destPath = yield* cache.getPath(spec)
      yield* registry.fetch(spec, destPath)
      yield* git.clone("https://github.com/vercel/next.js.git", destPath, {
        depth: 100,
      })

      const now = new Date().toISOString()
      yield* metadata.add({
        spec,
        fetchedAt: now,
        lastAccessedAt: now,
        sizeBytes: 50000,
        path: destPath,
      })

      // Step 4: Path lookup (repo path)
      const afterFetch = yield* metadata.find(spec)
      expect(afterFetch).not.toBeNull()
      expect(afterFetch?.path).toBe(destPath)
      expect(destPath).toContain("vercel/next.js")

      // Step 5: Info lookup (repo info)
      expect(afterFetch?.sizeBytes).toBe(50000)
      const isGit = yield* git.isGitRepo(destPath)
      expect(isGit).toBe(true)

      // Step 6: Update access time on re-access
      const beforeUpdate = afterFetch?.lastAccessedAt
      yield* metadata.updateAccessTime(spec)
      const updated = yield* metadata.find(spec)
      expect(
        new Date(updated!.lastAccessedAt).getTime()
      ).toBeGreaterThanOrEqual(new Date(beforeUpdate!).getTime())

      // Step 7: List shows the repo
      const all = yield* metadata.all()
      expect(all.length).toBe(1)
      expect(all[0]?.spec.name).toBe("vercel/next.js")
    }).pipe(Effect.provide(testLayer))
  )
})
