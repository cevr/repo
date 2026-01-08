import { FileSystem, Path } from "@effect/platform"
import { Context, Effect, Layer, Option, Schema } from "effect"
import type { PackageSpec, RepoMetadata } from "../types.js"
import { MetadataIndex, MetadataError } from "../types.js"

// Create encode/decode functions for proper JSON serialization
const encodeMetadata = Schema.encodeSync(MetadataIndex)
const decodeMetadata = Schema.decodeUnknownSync(MetadataIndex)

// Service interface
export class MetadataService extends Context.Tag("@repo/MetadataService")<
  MetadataService,
  {
    readonly load: () => Effect.Effect<MetadataIndex>
    readonly save: (index: MetadataIndex) => Effect.Effect<void>
    readonly add: (metadata: RepoMetadata) => Effect.Effect<void>
    readonly remove: (spec: PackageSpec) => Effect.Effect<boolean>
    readonly find: (spec: PackageSpec) => Effect.Effect<RepoMetadata | null>
    readonly updateAccessTime: (spec: PackageSpec) => Effect.Effect<void>
    readonly findOlderThan: (days: number) => Effect.Effect<readonly RepoMetadata[]>
    readonly findLargerThan: (bytes: number) => Effect.Effect<readonly RepoMetadata[]>
    readonly all: () => Effect.Effect<readonly RepoMetadata[]>
  }
>() {
  // Live layer using real filesystem
  static readonly layer = Layer.effect(
    MetadataService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const home = process.env.HOME ?? "~"
      const cacheDir = pathService.join(home, ".cache", "repo")
      const metadataPath = pathService.join(cacheDir, "metadata.json")

      const specMatches = (a: PackageSpec, b: PackageSpec): boolean => {
        if (a.registry !== b.registry || a.name !== b.name) return false
        const aVersion = Option.getOrElse(a.version, () => "")
        const bVersion = Option.getOrElse(b.version, () => "")
        return aVersion === bVersion
      }

      const load = (): Effect.Effect<MetadataIndex> =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(metadataPath)
          if (!exists) {
            return { version: 1, repos: [] }
          }
          const content = yield* fs.readFileString(metadataPath)
          return decodeMetadata(JSON.parse(content))
        }).pipe(Effect.orElse(() => Effect.succeed({ version: 1, repos: [] })))

      const save = (index: MetadataIndex): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(cacheDir, { recursive: true })
          const encoded = encodeMetadata(index)
          yield* fs.writeFileString(metadataPath, JSON.stringify(encoded, null, 2))
        }).pipe(Effect.ignore)

      const add = (metadata: RepoMetadata): Effect.Effect<void> =>
        Effect.gen(function* () {
          const index = yield* load()
          const filtered = index.repos.filter(
            (r) => !specMatches(r.spec, metadata.spec)
          )
          const newIndex: MetadataIndex = {
            ...index,
            repos: [...filtered, metadata],
          }
          yield* save(newIndex)
        })

      const remove = (spec: PackageSpec): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          const index = yield* load()
          const originalLength = index.repos.length
          const filtered = index.repos.filter((r) => !specMatches(r.spec, spec))
          if (filtered.length === originalLength) {
            return false
          }
          yield* save({ ...index, repos: filtered })
          return true
        })

      const find = (spec: PackageSpec): Effect.Effect<RepoMetadata | null> =>
        Effect.gen(function* () {
          const index = yield* load()
          return index.repos.find((r) => specMatches(r.spec, spec)) ?? null
        })

      const updateAccessTime = (spec: PackageSpec): Effect.Effect<void> =>
        Effect.gen(function* () {
          const index = yield* load()
          const updated = index.repos.map((r) => {
            if (specMatches(r.spec, spec)) {
              return { ...r, lastAccessedAt: new Date().toISOString() }
            }
            return r
          })
          yield* save({ ...index, repos: updated })
        })

      const findOlderThan = (
        days: number
      ): Effect.Effect<readonly RepoMetadata[]> =>
        Effect.gen(function* () {
          const index = yield* load()
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
          return index.repos.filter(
            (r) => new Date(r.lastAccessedAt).getTime() < cutoff
          )
        })

      const findLargerThan = (
        bytes: number
      ): Effect.Effect<readonly RepoMetadata[]> =>
        Effect.gen(function* () {
          const index = yield* load()
          return index.repos.filter((r) => r.sizeBytes > bytes)
        })

      const all = (): Effect.Effect<readonly RepoMetadata[]> =>
        Effect.gen(function* () {
          const index = yield* load()
          return index.repos
        })

      return MetadataService.of({
        load,
        save,
        add,
        remove,
        find,
        updateAccessTime,
        findOlderThan,
        findLargerThan,
        all,
      })
    })
  )

  // Test layer using in-memory store
  static readonly testLayer = Layer.sync(MetadataService, () => {
    let index: MetadataIndex = { version: 1, repos: [] }

    const specMatches = (a: PackageSpec, b: PackageSpec): boolean => {
      if (a.registry !== b.registry || a.name !== b.name) return false
      const aVersion = Option.getOrElse(a.version, () => "")
      const bVersion = Option.getOrElse(b.version, () => "")
      return aVersion === bVersion
    }

    const load = () => Effect.succeed(index)

    const save = (newIndex: MetadataIndex) =>
      Effect.sync(() => {
        index = newIndex
      })

    const add = (metadata: RepoMetadata) =>
      Effect.sync(() => {
        const filtered = index.repos.filter(
          (r) => !specMatches(r.spec, metadata.spec)
        )
        index = { ...index, repos: [...filtered, metadata] }
      })

    const remove = (spec: PackageSpec) =>
      Effect.sync(() => {
        const originalLength = index.repos.length
        const filtered = index.repos.filter((r) => !specMatches(r.spec, spec))
        index = { ...index, repos: filtered }
        return filtered.length < originalLength
      })

    const find = (spec: PackageSpec) =>
      Effect.sync(
        () => index.repos.find((r) => specMatches(r.spec, spec)) ?? null
      )

    const updateAccessTime = (spec: PackageSpec) =>
      Effect.sync(() => {
        index = {
          ...index,
          repos: index.repos.map((r) => {
            if (specMatches(r.spec, spec)) {
              return { ...r, lastAccessedAt: new Date().toISOString() }
            }
            return r
          }),
        }
      })

    const findOlderThan = (days: number) =>
      Effect.sync(() => {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        return index.repos.filter(
          (r) => new Date(r.lastAccessedAt).getTime() < cutoff
        )
      })

    const findLargerThan = (bytes: number) =>
      Effect.sync(() => index.repos.filter((r) => r.sizeBytes > bytes))

    const all = () => Effect.sync(() => index.repos)

    return MetadataService.of({
      load,
      save,
      add,
      remove,
      find,
      updateAccessTime,
      findOlderThan,
      findLargerThan,
      all,
    })
  })
}
