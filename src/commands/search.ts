import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import { MetadataService } from "../services/metadata.js";
import { handleCommandError } from "./shared.js";

const queryArg = Argument.string("query").pipe(
  Argument.withDescription("Search pattern (regex supported)"),
);

const registryFlag = Flag.choice("registry", ["github", "npm", "pypi", "crates"] as const).pipe(
  Flag.withAlias("r"),
  Flag.optional,
  Flag.withDescription("Filter by registry"),
);

const typeFlag = Flag.string("type").pipe(
  Flag.withAlias("t"),
  Flag.optional,
  Flag.withDescription("File type filter (e.g., ts, py, rs)"),
);

const contextFlag = Flag.integer("context").pipe(
  Flag.withDefault(2),
  Flag.withDescription("Lines of context around matches"),
);

export const search = Command.make(
  "search",
  {
    query: queryArg,
    registry: registryFlag,
    type: typeFlag,
    context: contextFlag,
  },
  ({ query, registry, type, context }) =>
    Effect.gen(function* () {
      const metadata = yield* MetadataService;
      let repos = yield* metadata.all();

      // Filter by registry if specified
      if (Option.isSome(registry)) {
        repos = repos.filter((r) => r.spec.registry === registry.value);
      }

      if (repos.length === 0) {
        yield* Console.log("No repositories cached.");
        return;
      }

      // Build ripgrep command
      const paths = repos.map((r) => r.path);
      const args = ["--color=always", "-n", `-C${context}`];

      if (Option.isSome(type)) {
        args.push(`--type=${type.value}`);
      }

      args.push(query, ...paths);

      yield* Console.log(`Searching ${repos.length} repositories for: ${query}`);
      yield* Console.log("");

      // Run ripgrep
      const proc = Bun.spawn(["rg", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = yield* Effect.tryPromise({
        try: async () => {
          const stdout = await new Response(proc.stdout).text();
          await proc.exited;
          return stdout;
        },
        catch: () => "", // ripgrep returns non-zero when no matches
      });

      if (output.trim().length > 0) {
        yield* Console.log(output);
      } else {
        yield* Console.log("No matches found.");
      }
    }).pipe(Effect.catch(handleCommandError)),
);
