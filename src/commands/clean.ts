import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { formatBytes } from "../types.js";
import { CacheService } from "../services/cache.js";
import { MetadataService } from "../services/metadata.js";

const confirmOption = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDefault(false),
  Options.withDescription("Skip confirmation prompt"),
);

export const clean = Command.make("clean", { yes: confirmOption }, ({ yes }) =>
  Effect.gen(function* () {
    const cache = yield* CacheService;
    const metadata = yield* MetadataService;

    const repos = yield* metadata.all();
    if (repos.length === 0) {
      yield* Console.log("Cache is already empty.");
      return;
    }

    const totalSize = repos.reduce((sum, r) => sum + r.sizeBytes, 0);

    if (!yes) {
      yield* Console.log(
        `This will remove ${repos.length} cached repositories (${formatBytes(totalSize)}).`,
      );
      yield* Console.log("Use --yes to confirm.");
      return;
    }

    yield* cache.removeAll();
    yield* metadata.save({ version: 1, repos: [] });

    yield* Console.log(`Removed ${repos.length} repositories.`);
    yield* Console.log(`Freed: ${formatBytes(totalSize)}`);
  }),
);
