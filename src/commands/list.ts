import { Command, Options } from "@effect/cli";
import { Console, Effect, Option, Schema } from "effect";
import { formatBytes, formatRelativeTime, specToString } from "../types.js";
import { MetadataService } from "../services/metadata.js";
import { handleCommandError } from "./shared.js";

const registryOption = Options.choice("registry", [
  "github",
  "npm",
  "pypi",
  "crates",
] as const).pipe(
  Options.withAlias("r"),
  Options.optional,
  Options.withDescription("Filter by registry"),
);

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Output as JSON"),
);

const sortOption = Options.choice("sort", ["date", "size", "name"] as const).pipe(
  Options.withAlias("s"),
  Options.withDefault("date" as const),
  Options.withDescription("Sort by: date, size, name"),
);

export const list = Command.make(
  "list",
  { registry: registryOption, json: jsonOption, sort: sortOption },
  ({ registry, json, sort }) =>
    Effect.gen(function* () {
      const metadata = yield* MetadataService;
      let repos = yield* metadata.all();

      // Filter by registry if specified
      if (Option.isSome(registry)) {
        repos = repos.filter((r) => r.spec.registry === registry.value);
      }

      // Sort
      const sorted = [...repos].sort((a, b) => {
        switch (sort) {
          case "date":
            return new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime();
          case "size":
            return b.sizeBytes - a.sizeBytes;
          case "name":
            return a.spec.name.localeCompare(b.spec.name);
        }
      });

      if (json) {
        const output = {
          repos: sorted.map((r) => ({
            ...r,
            spec: {
              registry: r.spec.registry,
              name: r.spec.name,
              version: Option.getOrNull(r.spec.version),
            },
          })),
          total: sorted.length,
          totalSize: sorted.reduce((sum, r) => sum + r.sizeBytes, 0),
        };
        const jsonStr = yield* Schema.encode(Schema.parseJson(Schema.Unknown))(output);
        yield* Console.log(jsonStr);
        return;
      }

      if (sorted.length === 0) {
        yield* Console.log("No repositories cached.");
        yield* Console.log('Use "repo fetch <spec>" to cache a repository.');
        return;
      }

      yield* Console.log("");
      yield* Console.log(`Cached Repositories (${sorted.length})`);
      yield* Console.log("═".repeat(80));

      for (const repo of sorted) {
        const spec = specToString(repo.spec);
        const size = formatBytes(repo.sizeBytes);
        const date = formatRelativeTime(new Date(repo.lastAccessedAt));
        const registryStr = repo.spec.registry.padEnd(6);

        yield* Console.log(`${registryStr}  ${spec.padEnd(40)}  ${size.padStart(10)}  ${date}`);
      }

      yield* Console.log("═".repeat(80));
      const totalSize = sorted.reduce((sum, r) => sum + r.sizeBytes, 0);
      yield* Console.log(`Total: ${formatBytes(totalSize)}`);
    }).pipe(Effect.catchAll(handleCommandError)),
);
