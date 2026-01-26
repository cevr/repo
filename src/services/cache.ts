import { FileSystem, Path } from "@effect/platform"
import { Context, Effect, Layer, Option } from "effect"
import type { PackageSpec } from "../types.js"

// Service interface
export class CacheService extends Context.Tag("@cvr/repo/services/cache/CacheService")<
  CacheService,
  {
    readonly cacheDir: string
    readonly getPath: (spec: PackageSpec) => Effect.Effect<string>
    readonly exists: (spec: PackageSpec) => Effect.Effect<boolean>
    readonly remove: (path: string) => Effect.Effect<void>
    readonly removeAll: () => Effect.Effect<void>
    readonly getSize: (path: string) => Effect.Effect<number>
    readonly ensureDir: (path: string) => Effect.Effect<void>
  }
>() {
  // Live layer using real filesystem
  static readonly layer = Layer.effect(
    CacheService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const home = process.env.HOME ?? "~"
      const cacheDir = pathService.join(home, ".cache", "repo")

      // Ensure cache root exists
      yield* fs.makeDirectory(cacheDir, { recursive: true }).pipe(Effect.ignore)

      const getPath = (spec: PackageSpec) =>
        Effect.sync(() => {
          // All repos stored as: ~/.cache/repo/{name}[@version]
          // GitHub: owner/repo -> ~/.cache/repo/owner/repo
          // npm: package@version -> ~/.cache/repo/package/version (or package/default)
          // pypi/crates: same pattern
          const version = Option.getOrElse(spec.version, () => "default")
          switch (spec.registry) {
            case "github":
              // GitHub repos don't have versions in path (use git refs)
              return pathService.join(cacheDir, spec.name)
            case "npm":
            case "pypi":
            case "crates":
              // Package registries include version in path
              return pathService.join(cacheDir, spec.name, version)
          }
        })

      const exists = (spec: PackageSpec) =>
        Effect.gen(function* () {
          const path = yield* getPath(spec)
          return yield* fs.exists(path)
        }).pipe(Effect.orElse(() => Effect.succeed(false)))

      const remove = (path: string) =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(path)
          if (pathExists) {
            yield* fs.remove(path, { recursive: true })
          }
        }).pipe(Effect.ignore)

      const removeAll = () =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(cacheDir)
          if (pathExists) {
            yield* fs.remove(cacheDir, { recursive: true })
            yield* fs.makeDirectory(cacheDir, { recursive: true })
          }
        }).pipe(Effect.ignore)

      const getSize = (path: string): Effect.Effect<number> =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(path)
          if (!pathExists) return 0

          const calculateSize = (dir: string): Effect.Effect<number> =>
            Effect.gen(function* () {
              const stat = yield* fs.stat(dir)

              if (stat.type === "Directory") {
                const entries = yield* fs.readDirectory(dir)
                const sizes = yield* Effect.forEach(entries, (entry) =>
                  calculateSize(pathService.join(dir, entry))
                )
                return sizes.reduce((a, b) => a + b, 0)
              }
              return Number(stat.size)
            }).pipe(Effect.orElse(() => Effect.succeed(0)))

          return yield* calculateSize(path)
        }).pipe(Effect.orElse(() => Effect.succeed(0)))

      const ensureDir = (path: string) =>
        fs.makeDirectory(path, { recursive: true }).pipe(Effect.ignore)

      return CacheService.of({
        cacheDir,
        getPath,
        exists,
        remove,
        removeAll,
        getSize,
        ensureDir,
      })
    })
  )

}
