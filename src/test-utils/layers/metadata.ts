import { Effect, Layer, Option, Ref } from "effect";
import { MetadataService } from "../../services/metadata.js";
import type { MetadataIndex, PackageSpec } from "../../types.js";
import { recordCall, type SequenceRef } from "../sequence.js";

// ─── Mock State ───────────────────────────────────────────────────────────────

export interface MockMetadataState {
  index: MetadataIndex;
}

export const defaultMockMetadataState: MockMetadataState = {
  index: { version: 1, repos: [] },
};

// ─── Mock Implementation ──────────────────────────────────────────────────────

export interface CreateMockMetadataServiceOptions {
  initialState?: Partial<MockMetadataState>;
  sequenceRef?: SequenceRef;
}

export function createMockMetadataService(options: CreateMockMetadataServiceOptions = {}): {
  layer: Layer.Layer<MetadataService>;
  stateRef: Ref.Ref<MockMetadataState>;
  getState: () => Effect.Effect<MockMetadataState>;
} {
  const initialState = options.initialState ?? {};
  const sequenceRef = options.sequenceRef;

  const state: MockMetadataState = {
    ...defaultMockMetadataState,
    ...initialState,
    index: {
      version: initialState.index?.version ?? 1,
      repos: [...(initialState.index?.repos ?? [])],
    },
  };
  const stateRef = Ref.unsafeMake(state);

  const record = (method: string, args: unknown, result?: unknown): Effect.Effect<void> =>
    sequenceRef !== undefined
      ? recordCall(sequenceRef, { service: "metadata", method, args, result })
      : Effect.void;

  const specMatches = (a: PackageSpec, b: PackageSpec): boolean => {
    if (a.registry !== b.registry || a.name !== b.name) return false;
    const aVersion = Option.getOrElse(a.version, () => "");
    const bVersion = Option.getOrElse(b.version, () => "");
    return aVersion === bVersion;
  };

  const layer = Layer.succeed(
    MetadataService,
    MetadataService.of({
      load: () =>
        Effect.gen(function* () {
          const s = yield* Ref.get(stateRef);
          yield* record("load", {}, s.index);
          return s.index;
        }),

      save: (newIndex) =>
        Effect.gen(function* () {
          yield* record("save", { index: newIndex });
          yield* Ref.update(stateRef, (s) => ({ ...s, index: newIndex }));
        }),

      add: (metadata) =>
        Effect.gen(function* () {
          yield* record("add", { metadata });
          yield* Ref.update(stateRef, (s) => {
            const filtered = s.index.repos.filter((r) => !specMatches(r.spec, metadata.spec));
            return {
              ...s,
              index: { ...s.index, repos: [...filtered, metadata] },
            };
          });
        }),

      remove: (spec) =>
        Effect.gen(function* () {
          const s = yield* Ref.get(stateRef);
          const originalLength = s.index.repos.length;
          const filtered = s.index.repos.filter((r) => !specMatches(r.spec, spec));
          const result = filtered.length < originalLength;
          yield* record("remove", { spec }, result);
          yield* Ref.set(stateRef, {
            ...s,
            index: { ...s.index, repos: filtered },
          });
          return result;
        }),

      find: (spec) =>
        Effect.gen(function* () {
          const s = yield* Ref.get(stateRef);
          const result = s.index.repos.find((r) => specMatches(r.spec, spec)) ?? null;
          yield* record("find", { spec }, result);
          return result;
        }),

      updateAccessTime: (spec) =>
        Effect.gen(function* () {
          yield* record("updateAccessTime", { spec });
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            index: {
              ...s.index,
              repos: s.index.repos.map((r) => {
                if (specMatches(r.spec, spec)) {
                  return { ...r, lastAccessedAt: new Date().toISOString() };
                }
                return r;
              }),
            },
          }));
        }),

      findOlderThan: (days) =>
        Effect.gen(function* () {
          const s = yield* Ref.get(stateRef);
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          const result = s.index.repos.filter((r) => new Date(r.lastAccessedAt).getTime() < cutoff);
          yield* record("findOlderThan", { days }, result);
          return result;
        }),

      findLargerThan: (bytes) =>
        Effect.gen(function* () {
          const s = yield* Ref.get(stateRef);
          const result = s.index.repos.filter((r) => r.sizeBytes > bytes);
          yield* record("findLargerThan", { bytes }, result);
          return result;
        }),

      all: () =>
        Effect.gen(function* () {
          const s = yield* Ref.get(stateRef);
          yield* record("all", {}, s.index.repos);
          return s.index.repos;
        }),
    }),
  );

  return {
    layer,
    stateRef,
    getState: () => Ref.get(stateRef),
  };
}

// ─── Preset Configurations ────────────────────────────────────────────────────

export const MockMetadataServiceDefault = createMockMetadataService();
