import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import type { PackageSpec, RepoMetadata } from "../types.js";
import { MetadataIndex } from "../types.js";

// In-memory cache state
interface CacheState {
  index: MetadataIndex | null;
  dirty: boolean;
}

// Service interface
export class MetadataService extends Context.Tag("@cvr/repo/services/metadata/MetadataService")<
  MetadataService,
  {
    readonly load: () => Effect.Effect<MetadataIndex>;
    readonly save: (index: MetadataIndex) => Effect.Effect<void>;
    readonly add: (metadata: RepoMetadata) => Effect.Effect<void>;
    readonly addMany: (metadata: readonly RepoMetadata[]) => Effect.Effect<void>;
    readonly remove: (spec: PackageSpec) => Effect.Effect<boolean>;
    readonly removeMany: (specs: readonly PackageSpec[]) => Effect.Effect<number>;
    readonly find: (spec: PackageSpec) => Effect.Effect<RepoMetadata | null>;
    readonly updateAccessTime: (spec: PackageSpec) => Effect.Effect<void>;
    readonly findOlderThan: (days: number) => Effect.Effect<readonly RepoMetadata[]>;
    readonly findLargerThan: (bytes: number) => Effect.Effect<readonly RepoMetadata[]>;
    readonly all: () => Effect.Effect<readonly RepoMetadata[]>;
    readonly flush: () => Effect.Effect<void>;
  }
>() {
  // Live layer using real filesystem with in-memory caching
  static readonly layer = Layer.effect(
    MetadataService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const home = process.env.HOME ?? "~";
      const cacheDir = pathService.join(home, ".cache", "repo");
      const metadataPath = pathService.join(cacheDir, "metadata.json");

      // In-memory cache
      const cacheRef = yield* Ref.make<CacheState>({ index: null, dirty: false });

      const specMatches = (a: PackageSpec, b: PackageSpec): boolean => {
        if (a.registry !== b.registry) return false;
        // GitHub repos are case-insensitive (legacy cached repos may have different casing)
        const aName = a.registry === "github" ? a.name.toLowerCase() : a.name;
        const bName = b.registry === "github" ? b.name.toLowerCase() : b.name;
        if (aName !== bName) return false;
        const aVersion = Option.getOrElse(a.version, () => "");
        const bVersion = Option.getOrElse(b.version, () => "");
        return aVersion === bVersion;
      };

      // Load from disk (bypasses cache)
      const loadFromDisk = (): Effect.Effect<MetadataIndex> =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(metadataPath);
          if (!exists) {
            return { version: 1, repos: [] };
          }
          const content = yield* fs.readFileString(metadataPath);
          return yield* Schema.decodeUnknown(Schema.compose(Schema.parseJson(), MetadataIndex))(
            content,
          );
        }).pipe(Effect.orElse(() => Effect.succeed({ version: 1, repos: [] })));

      // Load with caching
      const load = (): Effect.Effect<MetadataIndex> =>
        Effect.gen(function* () {
          const cache = yield* Ref.get(cacheRef);
          if (cache.index !== null) {
            return cache.index;
          }
          const index = yield* loadFromDisk();
          yield* Ref.set(cacheRef, { index, dirty: false });
          return index;
        });

      // Atomic save to disk (write temp, rename)
      const saveToDisk = (index: MetadataIndex): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* fs
            .makeDirectory(cacheDir, { recursive: true })
            .pipe(
              Effect.catchTag("SystemError", (e) =>
                e.reason === "AlreadyExists" ? Effect.void : Effect.fail(e),
              ),
            );
          const jsonStr = yield* Schema.encode(Schema.compose(Schema.parseJson(), MetadataIndex))(
            index,
          );
          // Atomic write: temp file then rename
          const tempPath = `${metadataPath}.tmp.${Date.now()}`;
          yield* fs.writeFileString(tempPath, jsonStr);
          yield* fs.rename(tempPath, metadataPath);
        }).pipe(Effect.orElse(() => Effect.void));

      // Save updates cache and persists
      const save = (index: MetadataIndex): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Ref.set(cacheRef, { index, dirty: false });
          yield* saveToDisk(index);
        });

      // Flush dirty cache to disk
      const flush = (): Effect.Effect<void> =>
        Effect.gen(function* () {
          const cache = yield* Ref.get(cacheRef);
          if (cache.dirty && cache.index !== null) {
            yield* saveToDisk(cache.index);
            yield* Ref.update(cacheRef, (c) => ({ ...c, dirty: false }));
          }
        });

      // Update cache without immediate persist (mark dirty)
      const updateCache = (index: MetadataIndex): Effect.Effect<void> =>
        Ref.set(cacheRef, { index, dirty: true });

      const add = (metadata: RepoMetadata): Effect.Effect<void> =>
        Effect.gen(function* () {
          const index = yield* load();
          const filtered = index.repos.filter((r) => !specMatches(r.spec, metadata.spec));
          const newIndex: MetadataIndex = {
            ...index,
            repos: [...filtered, metadata],
          };
          yield* save(newIndex);
        });

      const addMany = (metadata: readonly RepoMetadata[]): Effect.Effect<void> =>
        Effect.gen(function* () {
          const index = yield* load();
          let repos = [...index.repos];
          for (const m of metadata) {
            repos = repos.filter((r) => !specMatches(r.spec, m.spec));
            repos.push(m);
          }
          yield* save({ ...index, repos });
        });

      const remove = (spec: PackageSpec): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          const index = yield* load();
          const originalLength = index.repos.length;
          const filtered = index.repos.filter((r) => !specMatches(r.spec, spec));
          if (filtered.length === originalLength) {
            return false;
          }
          yield* save({ ...index, repos: filtered });
          return true;
        });

      const removeMany = (specs: readonly PackageSpec[]): Effect.Effect<number> =>
        Effect.gen(function* () {
          const index = yield* load();
          const originalLength = index.repos.length;
          const filtered = index.repos.filter(
            (r) => !specs.some((spec) => specMatches(r.spec, spec)),
          );
          const removedCount = originalLength - filtered.length;
          if (removedCount > 0) {
            yield* save({ ...index, repos: filtered });
          }
          return removedCount;
        });

      const find = (spec: PackageSpec): Effect.Effect<RepoMetadata | null> =>
        Effect.gen(function* () {
          const index = yield* load();
          return index.repos.find((r) => specMatches(r.spec, spec)) ?? null;
        });

      const updateAccessTime = (spec: PackageSpec): Effect.Effect<void> =>
        Effect.gen(function* () {
          const index = yield* load();
          const updated = index.repos.map((r) => {
            if (specMatches(r.spec, spec)) {
              return { ...r, lastAccessedAt: new Date().toISOString() };
            }
            return r;
          });
          // Access time updates can be lazy - mark dirty but don't persist immediately
          yield* updateCache({ ...index, repos: updated });
        });

      const findOlderThan = (days: number): Effect.Effect<readonly RepoMetadata[]> =>
        Effect.gen(function* () {
          const index = yield* load();
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          return index.repos.filter((r) => new Date(r.lastAccessedAt).getTime() < cutoff);
        });

      const findLargerThan = (bytes: number): Effect.Effect<readonly RepoMetadata[]> =>
        Effect.gen(function* () {
          const index = yield* load();
          return index.repos.filter((r) => r.sizeBytes > bytes);
        });

      const all = (): Effect.Effect<readonly RepoMetadata[]> =>
        Effect.gen(function* () {
          const index = yield* load();
          return index.repos;
        });

      return MetadataService.of({
        load,
        save,
        add,
        addMany,
        remove,
        removeMany,
        find,
        updateAccessTime,
        findOlderThan,
        findLargerThan,
        all,
        flush,
      });
    }),
  );
}
