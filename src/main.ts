#!/usr/bin/env bun
// @effect-diagnostics strictEffectProvide:off
import { Command } from "effect/unstable/cli";
import { BunServices, BunRuntime } from "@effect/platform-bun";
import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Layer } from "effect";

import { rootCommand } from "./commands/root.js";

import { CacheService } from "./services/cache.js";
import { MetadataService } from "./services/metadata.js";
import { GitService } from "./services/git.js";
import { RegistryService } from "./services/registry.js";

// Layer composition:
// 1. CacheService + MetadataService need FileSystem+Path (from BunServices)
// 2. GitService needs ChildProcessSpawner (from BunServices)
// 3. RegistryService needs GitService + CacheService + HttpClient + FileSystem + ChildProcessSpawner

const PlatformLayer = Layer.mergeAll(BunServices.layer, FetchHttpClient.layer);

const CoreServicesLayer = Layer.mergeAll(
  CacheService.layer,
  MetadataService.layer,
  GitService.layer,
).pipe(Layer.provide(PlatformLayer));

const RegistryLayer = RegistryService.layer.pipe(
  Layer.provide(CoreServicesLayer),
  Layer.provide(PlatformLayer),
);

const MainLayer = Layer.mergeAll(CoreServicesLayer, RegistryLayer, PlatformLayer);

Command.run(rootCommand, { version: "1.0.0" }).pipe(Effect.provide(MainLayer), BunRuntime.runMain);
