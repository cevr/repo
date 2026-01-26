import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { specToString, formatBytes, formatRelativeTime } from "../types.js"
import { MetadataService } from "../services/metadata.js"
import { RegistryService } from "../services/registry.js"
import { GitService } from "../services/git.js"

const specArg = Args.text({ name: "spec" }).pipe(
  Args.withDescription("Package spec to get info for")
)

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Output as JSON")
)

export const info = Command.make(
  "info",
  { spec: specArg, json: jsonOption },
  ({ spec, json }) =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const metadata = yield* MetadataService
      const git = yield* GitService

      const parsedSpec = yield* registry.parseSpec(spec)
      const existing = yield* metadata.find(parsedSpec)

      if (existing === null) {
        yield* Console.error(`Not cached: ${specToString(parsedSpec)}`)
        return
      }

      const isGit = yield* git.isGitRepo(existing.path)
      const currentRef = isGit
        ? yield* git
            .getCurrentRef(existing.path)
            .pipe(Effect.orElseSucceed(() => "unknown"))
        : null

      if (json) {
        yield* Console.log(
          JSON.stringify(
            {
              spec: {
                registry: existing.spec.registry,
                name: existing.spec.name,
                version: Option.getOrNull(existing.spec.version),
              },
              path: existing.path,
              sizeBytes: existing.sizeBytes,
              sizeHuman: formatBytes(existing.sizeBytes),
              fetchedAt: existing.fetchedAt,
              lastAccessedAt: existing.lastAccessedAt,
              isGitRepo: isGit,
              currentRef,
            },
            null,
            2
          )
        )
      } else {
        yield* Console.log(``)
        yield* Console.log(`Repository Info`)
        yield* Console.log("═".repeat(50))
        yield* Console.log(`Spec:     ${specToString(existing.spec)}`)
        yield* Console.log(`Registry: ${existing.spec.registry}`)
        yield* Console.log(`Path:     ${existing.path}`)
        yield* Console.log(`Size:     ${formatBytes(existing.sizeBytes)}`)
        yield* Console.log(
          `Fetched:  ${formatRelativeTime(new Date(existing.fetchedAt))}`
        )
        yield* Console.log(
          `Accessed: ${formatRelativeTime(new Date(existing.lastAccessedAt))}`
        )
        if (isGit && currentRef !== null) {
          yield* Console.log(`Git ref:  ${currentRef}`)
        }
      }

      yield* metadata.updateAccessTime(parsedSpec)
    })
)
