#!/usr/bin/env bun
// @effect-diagnostics strictEffectProvide:off
import { Command } from "effect/unstable/cli";
import { BunServices, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { rootCommand } from "./commands/root.js";

import { CacheService } from "./services/cache.js";
import { MetadataService } from "./services/metadata.js";
import { GitService } from "./services/git.js";
import { RegistryService } from "./services/registry.js";

// Layer composition:
// 1. CacheService.layer and MetadataService.layer need FileSystem+Path (from BunServices)
// 2. GitService.layer is standalone (no deps)
// 3. RegistryService.layer needs GitService + CacheService

// First, provide BunServices to the platform-dependent services
const PlatformServicesLayer = Layer.mergeAll(CacheService.layer, MetadataService.layer).pipe(
  Layer.provide(BunServices.layer),
);

// GitService is standalone
const GitLayer = GitService.layer;

// RegistryService needs Git and Cache
const RegistryLayer = RegistryService.layer.pipe(
  Layer.provide(GitLayer),
  Layer.provide(PlatformServicesLayer),
);

// All services together, merged with BunServices for CLI
const MainLayer = Layer.mergeAll(PlatformServicesLayer, GitLayer, RegistryLayer, BunServices.layer);

// CLI runner — v4: Command.run reads args from Stdio (provided by BunServices)
Command.run(rootCommand, { version: "1.0.0" }).pipe(Effect.provide(MainLayer), BunRuntime.runMain);
