// @effect-diagnostics strictEffectProvide:off
import { Command } from "@effect/cli"
import { BunContext } from "@effect/platform-bun"
import { Effect, Either, Layer, Ref } from "effect"
import { expect } from "vitest"

import { fetch } from "../commands/fetch.js"
import { list } from "../commands/list.js"
import { search } from "../commands/search.js"
import { remove } from "../commands/remove.js"
import { clean } from "../commands/clean.js"
import { prune } from "../commands/prune.js"
import { stats } from "../commands/stats.js"
import { open } from "../commands/open.js"
import { path } from "../commands/path.js"
import { info } from "../commands/info.js"

import { createTestLayer, type CreateTestLayerOptions } from "./index.js"
import type { ExpectedCall, RecordedCall } from "./sequence.js"

// ─── Root Command ──────────────────────────────────────────────────────────────

const rootCommand = Command.make("repo").pipe(
  Command.withDescription("Multi-registry source code cache manager"),
  Command.withSubcommands([fetch, list, search, remove, clean, prune, stats, open, path, info])
)

// ─── Re-export types ───────────────────────────────────────────────────────────

export type { ExpectedCall } from "./sequence.js"

// ─── Sequence Matching ────────────────────────────────────────────────────────

function assertSequenceContains(actual: RecordedCall[], expected: ExpectedCall[]): void {
  let actualIndex = 0

  for (const exp of expected) {
    let found = false

    while (actualIndex < actual.length) {
      const act = actual[actualIndex]!
      actualIndex++

      if (act.service === exp.service && act.method === exp.method) {
        if (exp.match !== undefined) {
          expect(act.args).toMatchObject(exp.match)
        }
        found = true
        break
      }
    }

    if (!found) {
      const remainingCalls = actual.slice(Math.max(0, actualIndex - 1))
      const formattedCalls = remainingCalls.map((c) => `  ${c.service}.${c.method}`).join("\n")
      throw new Error(
        `Expected ${exp.service}.${exp.method} not found in sequence.\n` +
          `Remaining calls:\n${formattedCalls || "  (none)"}\n` +
          `Full sequence:\n${actual.map((c) => `  ${c.service}.${c.method}`).join("\n")}`
      )
    }
  }
}

// ─── CLI Test Runner ──────────────────────────────────────────────────────────

export class CliTestRunner {
  constructor(
    private args: string[],
    private options: CreateTestLayerOptions
  ) {}

  expectSequence(expected: ExpectedCall[]): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const { layer, sequenceRef } = createTestLayer(this.options)

      const cli = Command.run(rootCommand, { name: "repo", version: "0.0.0-test" })
      const argv = ["bun", "repo", ...this.args]
      const fullLayer = layer.pipe(Layer.provideMerge(BunContext.layer))
      yield* cli(argv).pipe(Effect.provide(fullLayer), Effect.either)

      const actual = yield* Ref.get(sequenceRef)
      assertSequenceContains(actual, expected)
    })
  }

  expectError(errorTag: string): Effect.Effect<void> {
    return Effect.gen(this, function* () {
      const { layer } = createTestLayer(this.options)

      const cli = Command.run(rootCommand, { name: "repo", version: "0.0.0-test" })
      const fullLayer = layer.pipe(Layer.provideMerge(BunContext.layer))
      const result = yield* cli(["bun", "repo", ...this.args]).pipe(
        Effect.provide(fullLayer),
        Effect.either
      )

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) {
        const error = result.left as { _tag?: string }
        expect(error._tag).toBe(errorTag)
      }
    })
  }

  expectSuccess(): Effect.Effect<void> {
    return this.expectSequence([])
  }

  getSequence(): Effect.Effect<RecordedCall[]> {
    return Effect.gen(this, function* () {
      const { layer, sequenceRef } = createTestLayer(this.options)

      const cli = Command.run(rootCommand, { name: "repo", version: "0.0.0-test" })
      const fullLayer = layer.pipe(Layer.provideMerge(BunContext.layer))
      yield* cli(["bun", "repo", ...this.args]).pipe(
        Effect.provide(fullLayer),
        Effect.either
      )

      return yield* Ref.get(sequenceRef)
    })
  }
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Creates a CLI test runner with the given arguments and options.
 *
 * IMPORTANT: Due to @effect/cli parser behavior, options with space-separated values
 * must come BEFORE positional arguments. Alternatively, use equals syntax (--option=value).
 *
 * @example
 * ```ts
 * // CORRECT: options before positional arg
 * runCli('fetch -f vercel/next.js', {...})
 *
 * // CORRECT: equals syntax
 * runCli('fetch vercel/next.js --force', {...})
 *
 * // Full example:
 * it.effect('fetches a GitHub repo', () =>
 *   runCli('fetch vercel/next.js', {
 *     cache: { cacheDir: '/tmp/test' },
 *   }).expectSequence([
 *     { service: 'registry', method: 'parseSpec' },
 *     { service: 'cache', method: 'getPath' },
 *     { service: 'cache', method: 'exists' },
 *     { service: 'git', method: 'clone' },
 *     { service: 'metadata', method: 'add' },
 *   ])
 * );
 * ```
 */
export function runCli(args: string, options: CreateTestLayerOptions = {}): CliTestRunner {
  return new CliTestRunner(args.split(/\s+/), options)
}
