import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { formatBytes, type Registry } from "../types.js"
import { MetadataService } from "../services/metadata.js"
import { CacheService } from "../services/cache.js"

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Output as JSON")
)

export const stats = Command.make("stats", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const metadata = yield* MetadataService
    const cache = yield* CacheService

    const repos = yield* metadata.all()

    // Group by registry
    const byRegistry: Record<Registry, { count: number; size: number }> = {
      github: { count: 0, size: 0 },
      npm: { count: 0, size: 0 },
      pypi: { count: 0, size: 0 },
      crates: { count: 0, size: 0 },
    }

    for (const repo of repos) {
      byRegistry[repo.spec.registry].count++
      byRegistry[repo.spec.registry].size += repo.sizeBytes
    }

    const totalCount = repos.length
    const totalSize = repos.reduce((sum, r) => sum + r.sizeBytes, 0)

    // Find oldest and newest
    const sorted = [...repos].sort(
      (a, b) =>
        new Date(a.lastAccessedAt).getTime() -
        new Date(b.lastAccessedAt).getTime()
    )
    const oldest = sorted[0]
    const newest = sorted[sorted.length - 1]

    if (json) {
      yield* Console.log(
        JSON.stringify(
          {
            cacheDir: cache.cacheDir,
            totalCount,
            totalSize,
            byRegistry,
            oldest: oldest
              ? {
                  name: oldest.spec.name,
                  lastAccessed: oldest.lastAccessedAt,
                }
              : null,
            newest: newest
              ? {
                  name: newest.spec.name,
                  lastAccessed: newest.lastAccessedAt,
                }
              : null,
          },
          null,
          2
        )
      )
      return
    }

    yield* Console.log("")
    yield* Console.log("Cache Statistics")
    yield* Console.log("═".repeat(50))
    yield* Console.log(`Cache directory: ${cache.cacheDir}`)
    yield* Console.log("")

    yield* Console.log("By Registry:")
    yield* Console.log("─".repeat(50))
    for (const [registry, data] of Object.entries(byRegistry)) {
      if (data.count > 0) {
        yield* Console.log(
          `  ${registry.padEnd(10)} ${String(data.count).padStart(5)} repos  ${formatBytes(data.size).padStart(10)}`
        )
      }
    }
    yield* Console.log("─".repeat(50))
    yield* Console.log(
      `  ${"Total".padEnd(10)} ${String(totalCount).padStart(5)} repos  ${formatBytes(totalSize).padStart(10)}`
    )

    if (oldest) {
      yield* Console.log("")
      yield* Console.log(`Oldest: ${oldest.spec.name} (${oldest.lastAccessedAt})`)
    }
    if (newest) {
      yield* Console.log(`Newest: ${newest.spec.name} (${newest.lastAccessedAt})`)
    }
  }).pipe(
    Effect.catchAll((error) =>
      Console.error(`Error: ${error._tag}: ${JSON.stringify(error)}`)
    )
  )
)
