import type { Ref } from "effect";
import { Layer } from "effect";

import type { CacheService } from "../services/cache.js";
import type { GitService } from "../services/git.js";
import type { MetadataService } from "../services/metadata.js";
import type { RegistryService } from "../services/registry.js";
import {
  createMockCacheService,
  createMockGitService,
  createMockMetadataService,
  createMockRegistryService,
  type MockCacheState,
  type MockGitState,
  type MockMetadataState,
  type MockRegistryState,
} from "./layers/index.js";
import { createSequenceRef, type RecordedCall } from "./sequence.js";

// ─── Re-exports ────────────────────────────────────────────────────────────────

export * from "./layers/index.js";
export * from "./sequence.js";
export * from "./run-cli.js";

// ─── Test Layer Types ──────────────────────────────────────────────────────────

/** All services provided by the test layer */
export type TestServices = GitService | CacheService | MetadataService | RegistryService;

// ─── Test Layer Composition ────────────────────────────────────────────────────

export interface CreateTestLayerOptions {
  /** Initial git state */
  git?: Partial<MockGitState>;
  /** Initial cache state */
  cache?: Partial<MockCacheState>;
  /** Initial metadata state */
  metadata?: Partial<MockMetadataState>;
  /** Initial registry state */
  registry?: Partial<MockRegistryState>;
}

export interface TestLayerResult {
  /** Combined layer providing all test services */
  layer: Layer.Layer<TestServices>;
  /** Git mock utilities for state inspection */
  git: ReturnType<typeof createMockGitService>;
  /** Cache mock utilities for state inspection */
  cache: ReturnType<typeof createMockCacheService>;
  /** Metadata mock utilities for state inspection */
  metadata: ReturnType<typeof createMockMetadataService>;
  /** Registry mock utilities for state inspection */
  registry: ReturnType<typeof createMockRegistryService>;
  /** Sequence ref for recording all service calls in order */
  sequenceRef: Ref.Ref<RecordedCall[]>;
}

/**
 * Creates a complete test layer with all mock services.
 *
 * @example
 * ```ts
 * const { layer, git, cache, sequenceRef } = createTestLayer({
 *   git: { defaultBranch: 'main' },
 *   cache: { cacheDir: '/custom/cache' },
 * });
 *
 * const result = yield* someCommand.pipe(Effect.provide(layer));
 *
 * // Verify git state
 * const gitState = yield* git.getState();
 * expect(gitState.clonedRepos.size).toBe(1);
 *
 * // Verify call sequence
 * const calls = yield* Ref.get(sequenceRef);
 * expect(calls[0].service).toBe('registry');
 * ```
 */
export function createTestLayer(options: CreateTestLayerOptions = {}): TestLayerResult {
  const sequenceRef = createSequenceRef();

  const git = createMockGitService({
    ...(options.git && { initialState: options.git }),
    sequenceRef,
  });
  const cache = createMockCacheService({
    ...(options.cache && { initialState: options.cache }),
    sequenceRef,
  });
  const metadata = createMockMetadataService({
    ...(options.metadata && { initialState: options.metadata }),
    sequenceRef,
  });
  const registry = createMockRegistryService({
    ...(options.registry && { initialState: options.registry }),
    sequenceRef,
  });

  const layer = Layer.mergeAll(git.layer, cache.layer, metadata.layer, registry.layer);

  return {
    layer,
    git,
    cache,
    metadata,
    registry,
    sequenceRef,
  };
}
