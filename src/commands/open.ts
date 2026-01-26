import { Args, Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { OpenError, specToString } from "../types.js";
import { MetadataService } from "../services/metadata.js";
import { RegistryService } from "../services/registry.js";
import { handleCommandError } from "./shared.js";

const specArg = Args.text({ name: "spec" }).pipe(Args.withDescription("Package spec to open"));

// Target: "finder" | "editor" | custom editor command
// --with finder  -> open in Finder
// --with code    -> open in VS Code
// --with vim     -> open in vim
// (no option)    -> use $EDITOR or "code"
const withOption = Options.text("with").pipe(
  Options.withAlias("w"),
  Options.optional,
  Options.withDescription(
    'Target: "finder" for Finder, or editor command (default: $EDITOR or code)',
  ),
);

export const open = Command.make(
  "open",
  { spec: specArg, with: withOption },
  ({ spec, with: target }) =>
    Effect.gen(function* () {
      const registry = yield* RegistryService;
      const metadata = yield* MetadataService;

      // Parse the spec
      const parsedSpec = yield* registry.parseSpec(spec);

      // Find in metadata
      const existing = yield* metadata.find(parsedSpec);
      if (existing === null) {
        yield* Console.log(`Not found: ${specToString(parsedSpec)}`);
        yield* Console.log('Use "repo fetch" first to cache it.');
        return;
      }

      // Update access time
      yield* metadata.updateAccessTime(parsedSpec);

      // Determine target
      const targetValue = Option.getOrElse(target, () => process.env.EDITOR ?? "code");

      if (targetValue === "finder") {
        // Open in Finder (macOS)
        const proc = Bun.spawn(["open", existing.path], {
          stdout: "pipe",
          stderr: "pipe",
        });
        yield* Effect.tryPromise({
          try: () =>
            proc.exited.then((code) => {
              if (code !== 0) throw new Error(`exit code ${code}`);
            }),
          catch: (e) => new OpenError({ command: "open", cause: e }),
        });
        yield* Console.log(`Opened in Finder: ${existing.path}`);
      } else {
        // Open in editor
        const proc = Bun.spawn([targetValue, existing.path], {
          stdout: "pipe",
          stderr: "pipe",
        });
        yield* Effect.tryPromise({
          try: () =>
            proc.exited.then((code) => {
              if (code !== 0) throw new Error(`exit code ${code}`);
            }),
          catch: (e) => new OpenError({ command: targetValue, cause: e }),
        });
        yield* Console.log(`Opened in ${targetValue}: ${existing.path}`);
      }
    }).pipe(Effect.catchAll(handleCommandError)),
);
