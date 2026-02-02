import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { formatBytes, specToString } from "../types.js";
import { CacheService } from "../services/cache.js";
import { MetadataService } from "../services/metadata.js";
import { RegistryService } from "../services/registry.js";
import { GitService } from "../services/git.js";
import { handleCommandError } from "./shared.js";

const specArg = Args.text({ name: "spec" }).pipe(
  Args.withDescription(
    "Package spec: owner/repo, npm:package[@version], pypi:package, crates:crate",
  ),
);

const forceOption = Options.boolean("force").pipe(
  Options.withAlias("f"),
  Options.withDefault(false),
  Options.withDescription("Force re-clone (removes existing and clones fresh)"),
);

const fullHistoryOption = Options.boolean("full").pipe(
  Options.withDefault(false),
  Options.withDescription("Clone full git history (default: shallow clone with depth 100)"),
);

export const fetch = Command.make(
  "fetch",
  { spec: specArg, force: forceOption, full: fullHistoryOption },
  ({ spec, force, full }) =>
    Effect.gen(function* () {
      const registry = yield* RegistryService;
      const cache = yield* CacheService;
      const metadata = yield* MetadataService;
      const git = yield* GitService;

      // Parse the spec
      const parsedSpec = yield* registry.parseSpec(spec);
      const specStr = specToString(parsedSpec);

      // Check if already cached
      const existing = yield* metadata.find(parsedSpec);
      const destPath = yield* cache.getPath(parsedSpec);

      if (existing !== null) {
        const isGit = yield* git.isGitRepo(existing.path);

        if (force) {
          // Force: remove and re-clone
          yield* Console.log(`Force re-fetching ${specStr}...`);
          yield* cache.remove(existing.path);
          yield* metadata.remove(parsedSpec);
        } else if (isGit) {
          // Git repo: always pull latest
          yield* Console.log(`Updating ${specStr}...`);
          yield* git
            .update(existing.path)
            .pipe(
              Effect.catchAll((e) =>
                Console.log(`Update failed, repo may be up to date: ${e._tag}`),
              ),
            );

          // Recalculate size after update
          const sizeBytes = yield* cache.getSize(existing.path);
          const currentRef = yield* git
            .getCurrentRef(existing.path)
            .pipe(Effect.orElseSucceed(() => "unknown"));

          yield* metadata.add({
            spec: parsedSpec,
            fetchedAt: existing.fetchedAt,
            lastAccessedAt: new Date().toISOString(),
            sizeBytes,
            path: existing.path,
          });

          yield* Console.log(`Updated: ${existing.path}`);
          yield* Console.log(`Current ref: ${currentRef}`);
          yield* Console.log(`Size: ${formatBytes(sizeBytes)}`);
          return;
        } else {
          // Not a git repo, can't update
          yield* metadata.updateAccessTime(parsedSpec);
          yield* Console.log(`Already cached at: ${existing.path}`);
          yield* Console.log(`Size: ${formatBytes(existing.sizeBytes)}`);
          yield* Console.log(`Use --force to re-fetch from scratch`);
          return;
        }
      }

      // Fresh fetch
      yield* Console.log(`Fetching ${specStr}...`);

      // Ensure parent directory exists
      const parentPath = destPath.split("/").slice(0, -1).join("/");
      yield* cache.ensureDir(parentPath);

      // Fetch from registry
      yield* registry.fetch(parsedSpec, destPath, { fullHistory: full });

      // Calculate size
      const sizeBytes = yield* cache.getSize(destPath);

      // Get current ref if it's a git repo
      const isGit = yield* git.isGitRepo(destPath);
      if (isGit) {
        const currentRef = yield* git
          .getCurrentRef(destPath)
          .pipe(Effect.orElseSucceed(() => "unknown"));
        yield* Console.log(`Ref: ${currentRef}`);
      }

      // Update metadata
      const now = new Date().toISOString();
      yield* metadata.add({
        spec: parsedSpec,
        fetchedAt: now,
        lastAccessedAt: now,
        sizeBytes,
        path: destPath,
      });

      yield* Console.log(`Fetched to: ${destPath}`);
      yield* Console.log(`Size: ${formatBytes(sizeBytes)}`);
    }).pipe(Effect.catchAll(handleCommandError)),
);
