#!/usr/bin/env bun
// @effect-diagnostics strictEffectProvide:off
import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { fetch } from "./commands/fetch.js"
import { list } from "./commands/list.js"
import { search } from "./commands/search.js"
import { remove } from "./commands/remove.js"
import { clean } from "./commands/clean.js"
import { prune } from "./commands/prune.js"
import { stats } from "./commands/stats.js"
import { open } from "./commands/open.js"
import { path } from "./commands/path.js"
import { info } from "./commands/info.js"

import { CacheService } from "./services/cache.js"
import { MetadataService } from "./services/metadata.js"
import { GitService } from "./services/git.js"
import { RegistryService } from "./services/registry.js"

// Layer composition:
// 1. CacheService.layer and MetadataService.layer need FileSystem+Path (from BunContext)
// 2. GitService.layer is standalone (no deps)
// 3. RegistryService.layer needs GitService + CacheService

// First, provide BunContext to the platform-dependent services
const PlatformServicesLayer = Layer.mergeAll(
  CacheService.layer,
  MetadataService.layer
).pipe(Layer.provide(BunContext.layer))

// GitService is standalone
const GitLayer = GitService.layer

// RegistryService needs Git and Cache
const RegistryLayer = RegistryService.layer.pipe(
  Layer.provide(GitLayer),
  Layer.provide(PlatformServicesLayer)
)

// All services together, merged with BunContext for CLI
const MainLayer = Layer.mergeAll(
  PlatformServicesLayer,
  GitLayer,
  RegistryLayer,
  BunContext.layer
)

// Root command
const repo = Command.make("repo").pipe(
  Command.withDescription("Multi-registry source code cache manager"),
  Command.withSubcommands([
    fetch,
    list,
    search,
    remove,
    clean,
    prune,
    stats,
    open,
    path,
    info,
  ])
)

// CLI runner
const cli = Command.run(repo, {
  name: "repo",
  version: "1.0.0",
})

// Run with all services
cli(process.argv).pipe(
  Effect.provide(MainLayer),
  BunRuntime.runMain
)
