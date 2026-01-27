import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Option } from "effect";
import type { PackageSpec } from "../types.js";

// Service interface
export class CacheService extends Context.Tag("@cvr/repo/services/cache/CacheService")<
  CacheService,
  {
    readonly cacheDir: string;
    readonly getPath: (spec: PackageSpec) => Effect.Effect<string>;
    readonly exists: (spec: PackageSpec) => Effect.Effect<boolean>;
    readonly remove: (path: string) => Effect.Effect<void>;
    readonly removeAll: () => Effect.Effect<void>;
    readonly getSize: (path: string) => Effect.Effect<number>;
    readonly ensureDir: (path: string) => Effect.Effect<void>;
  }
>() {
  // Live layer using real filesystem
  static readonly layer = Layer.effect(
    CacheService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const home = process.env.HOME ?? "~";
      const cacheDir = pathService.join(home, ".cache", "repo");

      // Ensure cache root exists (recursive mkdir doesn't fail on AlreadyExists)
      yield* fs
        .makeDirectory(cacheDir, { recursive: true })
        .pipe(
          Effect.catchTag("SystemError", (e) =>
            e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e),
          ),
        );

      const getPath = (spec: PackageSpec) =>
        Effect.gen(function* () {
          // All repos stored as: ~/.cache/repo/{name}[@version]
          // GitHub: owner/repo -> ~/.cache/repo/owner/repo
          // npm: package@version -> ~/.cache/repo/package/version (or package/default)
          // pypi/crates: same pattern
          const version = Option.getOrElse(spec.version, () => "default");
          switch (spec.registry) {
            case "github": {
              // GitHub repos don't have versions in path (use git refs)
              const normalizedPath = pathService.join(cacheDir, spec.name);

              // Fast path: normalized path exists
              if (yield* fs.exists(normalizedPath)) return normalizedPath;

              // Fallback: case-insensitive search for legacy cached repos
              // (repos cached before case-normalization fix may have different casing)
              // spec.name guaranteed to be "owner/repo" format for github registry
              const [owner, repo] = spec.name.split("/") as [string, string];

              const cacheExists = yield* fs.exists(cacheDir);
              if (!cacheExists) return normalizedPath;

              const entries = yield* fs.readDirectory(cacheDir);
              for (const entry of entries) {
                if (entry.toLowerCase() === owner) {
                  const ownerPath = pathService.join(cacheDir, entry);
                  const ownerStat = yield* fs.stat(ownerPath);
                  if (ownerStat.type !== "Directory") continue;

                  const repoEntries = yield* fs.readDirectory(ownerPath);
                  for (const repoEntry of repoEntries) {
                    if (repoEntry.toLowerCase() === repo) {
                      return pathService.join(ownerPath, repoEntry);
                    }
                  }
                }
              }

              return normalizedPath;
            }
            case "npm":
            case "pypi":
            case "crates":
              // Package registries include version in path
              return pathService.join(cacheDir, spec.name, version);
          }
        }).pipe(Effect.orDie);

      const exists = (spec: PackageSpec) =>
        Effect.gen(function* () {
          const path = yield* getPath(spec);
          return yield* fs.exists(path);
        }).pipe(Effect.orElse(() => Effect.succeed(false)));

      const remove = (path: string) =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(path);
          if (pathExists) {
            yield* fs.remove(path, { recursive: true });
          }
        }).pipe(Effect.ignore);

      const removeAll = () =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(cacheDir);
          if (pathExists) {
            yield* fs.remove(cacheDir, { recursive: true });
            yield* fs.makeDirectory(cacheDir, { recursive: true });
          }
        }).pipe(Effect.ignore);

      const getSize = (path: string): Effect.Effect<number> =>
        Effect.gen(function* () {
          const pathExists = yield* fs.exists(path);
          if (!pathExists) return 0;

          const calculateSize = (dir: string): Effect.Effect<number> =>
            Effect.gen(function* () {
              const stat = yield* fs.stat(dir);

              if (stat.type === "Directory") {
                const entries = yield* fs.readDirectory(dir);
                const sizes = yield* Effect.forEach(entries, (entry) =>
                  calculateSize(pathService.join(dir, entry)),
                );
                return sizes.reduce((a, b) => a + b, 0);
              }
              return Number(stat.size);
            }).pipe(Effect.orElse(() => Effect.succeed(0)));

          return yield* calculateSize(path);
        }).pipe(Effect.orElse(() => Effect.succeed(0)));

      const ensureDir = (path: string) =>
        fs.makeDirectory(path, { recursive: true }).pipe(
          Effect.catchTag("SystemError", (e) =>
            e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e),
          ),
          Effect.orElse(() => Effect.void),
        );

      return CacheService.of({
        cacheDir,
        getPath,
        exists,
        remove,
        removeAll,
        getSize,
        ensureDir,
      });
    }),
  );
}
