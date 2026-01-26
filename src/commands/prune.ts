import { Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { formatBytes, specToString } from "../types.js"
import { CacheService } from "../services/cache.js"
import { MetadataService } from "../services/metadata.js"

const daysOption = Options.integer("days").pipe(
  Options.withAlias("d"),
  Options.optional,
  Options.withDescription("Remove repos not accessed in N days")
)

const maxSizeOption = Options.text("max-size").pipe(
  Options.optional,
  Options.withDescription("Remove repos larger than size (e.g., 100M, 1G)")
)

const dryRunOption = Options.boolean("dry-run").pipe(
  Options.withDefault(false),
  Options.withDescription("Show what would be removed without actually removing")
)

function parseSize(sizeStr: string): number | null {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|K|KB|M|MB|G|GB)?$/i)
  if (match === null) return null

  const value = parseFloat(match[1]!)
  const unit = (match[2] ?? "B").toUpperCase()

  switch (unit) {
    case "B":
      return value
    case "K":
    case "KB":
      return value * 1024
    case "M":
    case "MB":
      return value * 1024 * 1024
    case "G":
    case "GB":
      return value * 1024 * 1024 * 1024
    default:
      return null
  }
}

export const prune = Command.make(
  "prune",
  { days: daysOption, maxSize: maxSizeOption, dryRun: dryRunOption },
  ({ days, maxSize, dryRun }) =>
    Effect.gen(function* () {
      const cache = yield* CacheService
      const metadata = yield* MetadataService

      if (Option.isNone(days) && Option.isNone(maxSize)) {
        yield* Console.log("Specify at least one of: --days or --max-size")
        return
      }

      let toRemove = yield* metadata.all()

      // Filter by age
      if (Option.isSome(days)) {
        const cutoff = Date.now() - days.value * 24 * 60 * 60 * 1000
        toRemove = toRemove.filter(
          (r) => new Date(r.lastAccessedAt).getTime() < cutoff
        )
      }

      // Filter by size
      if (Option.isSome(maxSize)) {
        const maxBytes = parseSize(maxSize.value)
        if (maxBytes === null) {
          yield* Console.log(`Invalid size format: ${maxSize.value}`)
          yield* Console.log("Use formats like: 100M, 1G, 500KB")
          return
        }
        toRemove = toRemove.filter((r) => r.sizeBytes > maxBytes)
      }

      if (toRemove.length === 0) {
        yield* Console.log("No repositories match the prune criteria.")
        return
      }

      const totalSize = toRemove.reduce((sum, r) => sum + r.sizeBytes, 0)

      if (dryRun) {
        yield* Console.log(`Would remove ${toRemove.length} repositories:`)
        yield* Console.log("")
        for (const repo of toRemove) {
          yield* Console.log(
            `  ${specToString(repo.spec).padEnd(40)}  ${formatBytes(repo.sizeBytes)}`
          )
        }
        yield* Console.log("")
        yield* Console.log(`Total: ${formatBytes(totalSize)}`)
        return
      }

      // Actually remove
      for (const repo of toRemove) {
        yield* cache.remove(repo.path)
        yield* metadata.remove(repo.spec)
        yield* Console.log(`Removed: ${specToString(repo.spec)}`)
      }

      yield* Console.log("")
      yield* Console.log(`Removed ${toRemove.length} repositories.`)
      yield* Console.log(`Freed: ${formatBytes(totalSize)}`)
    })
)
