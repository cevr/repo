import { Effect, Layer, Ref } from "effect";
import { RegistryService } from "../../services/registry.js";
import type { PackageSpec } from "../../types.js";
import { parseSpecOrThrow } from "../../parsing.js";
import { recordCall, type SequenceRef } from "../sequence.js";

// ─── Mock State ───────────────────────────────────────────────────────────────

export interface MockRegistryState {
  fetchedSpecs: Map<string, PackageSpec>;
}

export const defaultMockRegistryState: MockRegistryState = {
  fetchedSpecs: new Map(),
};

// ─── Mock Implementation ──────────────────────────────────────────────────────

export interface CreateMockRegistryServiceOptions {
  initialState?: Partial<MockRegistryState>;
  sequenceRef?: SequenceRef;
}

export function createMockRegistryService(options: CreateMockRegistryServiceOptions = {}): {
  layer: Layer.Layer<RegistryService>;
  stateRef: Ref.Ref<MockRegistryState>;
  getState: () => Effect.Effect<MockRegistryState>;
} {
  const initialState = options.initialState ?? {};
  const sequenceRef = options.sequenceRef;

  const state: MockRegistryState = {
    ...defaultMockRegistryState,
    ...initialState,
    fetchedSpecs: new Map(initialState.fetchedSpecs ?? []),
  };
  const stateRef = Ref.unsafeMake(state);

  const record = (method: string, args: unknown, result?: unknown): Effect.Effect<void> =>
    sequenceRef !== undefined
      ? recordCall(sequenceRef, { service: "registry", method, args, result })
      : Effect.void;

  const layer = Layer.succeed(
    RegistryService,
    RegistryService.of({
      parseSpec: (input) =>
        Effect.gen(function* () {
          const result = parseSpecOrThrow(input);
          yield* record("parseSpec", { input }, result);
          return result;
        }),

      fetch: (spec, destPath, options) =>
        Effect.gen(function* () {
          yield* record("fetch", { spec, destPath, options });
          yield* Ref.update(stateRef, (s) => {
            const newFetched = new Map(s.fetchedSpecs);
            newFetched.set(destPath, spec);
            return { ...s, fetchedSpecs: newFetched };
          });
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

export const MockRegistryServiceDefault = createMockRegistryService();
