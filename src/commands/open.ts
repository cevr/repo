import { Args, Command, Options } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { specToString } from "../types.js"
import { MetadataService } from "../services/metadata.js"
import { RegistryService } from "../services/registry.js"

const specArg = Args.text({ name: "spec" }).pipe(
  Args.withDescription("Package spec to open")
)

const finderOption = Options.boolean("finder").pipe(
  Options.withAlias("f"),
  Options.withDefault(false),
  Options.withDescription("Open in Finder instead of editor")
)

const editorOption = Options.text("editor").pipe(
  Options.withAlias("e"),
  Options.optional,
  Options.withDescription("Editor to use (defaults to $EDITOR or code)")
)

export const open = Command.make(
  "open",
  { spec: specArg, finder: finderOption, editor: editorOption },
  ({ spec, finder, editor }) =>
    Effect.gen(function* () {
      const registry = yield* RegistryService
      const metadata = yield* MetadataService

      // Parse the spec
      const parsedSpec = yield* registry.parseSpec(spec)

      // Find in metadata
      const existing = yield* metadata.find(parsedSpec)
      if (!existing) {
        yield* Console.log(`Not found: ${specToString(parsedSpec)}`)
        yield* Console.log('Use "repo fetch" first to cache it.')
        return
      }

      // Update access time
      yield* metadata.updateAccessTime(parsedSpec)

      if (finder) {
        // Open in Finder (macOS)
        const proc = Bun.spawn(["open", existing.path], {
          stdout: "pipe",
          stderr: "pipe",
        })
        yield* Effect.tryPromise({
          try: () => proc.exited,
          catch: (e) => new Error(`Failed to open Finder: ${e}`),
        })
        yield* Console.log(`Opened in Finder: ${existing.path}`)
      } else {
        // Open in editor
        const editorCmd = Option.isSome(editor)
          ? editor.value
          : process.env.EDITOR ?? "code"

        const proc = Bun.spawn([editorCmd, existing.path], {
          stdout: "pipe",
          stderr: "pipe",
        })
        yield* Effect.tryPromise({
          try: () => proc.exited,
          catch: (e) => new Error(`Failed to open editor: ${e}`),
        })
        yield* Console.log(`Opened in ${editorCmd}: ${existing.path}`)
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
