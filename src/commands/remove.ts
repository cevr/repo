import { Args, Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { specToString, formatBytes } from "../types.js"
import { CacheService } from "../services/cache.js"
import { MetadataService } from "../services/metadata.js"
import { RegistryService } from "../services/registry.js"

const specArg = Args.text({ name: "spec" }).pipe(
  Args.withDescription("Package spec to remove")
)

export const remove = Command.make("remove", { spec: specArg }, ({ spec }) =>
  Effect.gen(function* () {
    const registry = yield* RegistryService
    const cache = yield* CacheService
    const metadata = yield* MetadataService

    // Parse the spec
    const parsedSpec = yield* registry.parseSpec(spec)

    // Find in metadata
    const existing = yield* metadata.find(parsedSpec)
    if (!existing) {
      yield* Console.log(`Not found: ${specToString(parsedSpec)}`)
      return
    }

    // Remove from cache
    yield* cache.remove(existing.path)

    // Remove from metadata
    yield* metadata.remove(parsedSpec)

    yield* Console.log(`Removed: ${specToString(parsedSpec)}`)
    yield* Console.log(`Freed: ${formatBytes(existing.sizeBytes)}`)
  }).pipe(
    Effect.catchAll((error) =>
      Console.error(`Error: ${error._tag}: ${JSON.stringify(error)}`)
    )
  )
)
