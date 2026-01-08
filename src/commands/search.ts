import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { MetadataService } from "../services/metadata.js"

const queryArg = Args.text({ name: "query" }).pipe(
  Args.withDescription("Search pattern (regex supported)")
)

const registryOption = Options.choice("registry", [
  "github",
  "npm",
  "pypi",
  "crates",
] as const).pipe(
  Options.withAlias("r"),
  Options.optional,
  Options.withDescription("Filter by registry")
)

const typeOption = Options.text("type").pipe(
  Options.withAlias("t"),
  Options.optional,
  Options.withDescription("File type filter (e.g., ts, py, rs)")
)

const contextOption = Options.integer("context").pipe(
  Options.withDefault(2),
  Options.withDescription("Lines of context around matches")
)

export const search = Command.make(
  "search",
  {
    query: queryArg,
    registry: registryOption,
    type: typeOption,
    context: contextOption,
  },
  ({ query, registry, type, context }) =>
    Effect.gen(function* () {
      const metadata = yield* MetadataService
      let repos = yield* metadata.all()

      // Filter by registry if specified
      if (Option.isSome(registry)) {
        repos = repos.filter((r) => r.spec.registry === registry.value)
      }

      if (repos.length === 0) {
        yield* Console.log("No repositories cached.")
        return
      }

      // Build ripgrep command
      const paths = repos.map((r) => r.path)
      const args = ["--color=always", "-n", `-C${context}`]

      if (Option.isSome(type)) {
        args.push(`--type=${type.value}`)
      }

      args.push(query, ...paths)

      yield* Console.log(
        `Searching ${repos.length} repositories for: ${query}`
      )
      yield* Console.log("")

      // Run ripgrep
      const proc = Bun.spawn(["rg", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const output = yield* Effect.tryPromise({
        try: async () => {
          const stdout = await new Response(proc.stdout).text()
          await proc.exited
          return stdout
        },
        catch: () => "", // ripgrep returns non-zero when no matches
      })

      if (output.trim()) {
        yield* Console.log(output)
      } else {
        yield* Console.log("No matches found.")
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          if (typeof error === "object" && error !== null && "_tag" in error) {
            yield* Console.error(
              `Error: ${(error as { _tag: string })._tag}: ${JSON.stringify(error)}`
            )
          } else {
            yield* Console.error(`Error: ${String(error)}`)
          }
        })
      )
    )
)
