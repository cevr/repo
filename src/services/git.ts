import { Context, Effect, Layer } from "effect"
import { GitError } from "../types.js"

// Service interface
export class GitService extends Context.Tag("@repo/GitService")<
  GitService,
  {
    readonly clone: (
      url: string,
      dest: string,
      options?: { depth?: number; ref?: string }
    ) => Effect.Effect<void, GitError>
    readonly update: (path: string) => Effect.Effect<void, GitError>
    readonly isGitRepo: (path: string) => Effect.Effect<boolean>
    readonly getDefaultBranch: (url: string) => Effect.Effect<string, GitError>
    readonly getCurrentRef: (path: string) => Effect.Effect<string, GitError>
  }
>() {
  // Live layer using real git
  static readonly layer = Layer.succeed(
    GitService,
    GitService.of({
      clone: (url, dest, options) =>
        Effect.gen(function* () {
          const args = ["clone"]

          if (options?.depth) {
            args.push("--depth", String(options.depth))
          }

          if (options?.ref) {
            args.push("--branch", options.ref)
          }

          args.push(url, dest)

          const proc = Bun.spawn(["git", ...args], {
            stdout: "pipe",
            stderr: "pipe",
          })

          const exitCode = yield* Effect.tryPromise({
            try: () => proc.exited,
            catch: (cause) =>
              new GitError({ operation: "clone", repo: url, cause }),
          })

          if (exitCode !== 0) {
            // If ref failed, try without it (fallback to default branch)
            if (options?.ref) {
              const fallbackArgs = ["clone"]
              if (options.depth) {
                fallbackArgs.push("--depth", String(options.depth))
              }
              fallbackArgs.push(url, dest)

              const fallbackProc = Bun.spawn(["git", ...fallbackArgs], {
                stdout: "pipe",
                stderr: "pipe",
              })

              const fallbackResult = yield* Effect.tryPromise({
                try: () => fallbackProc.exited,
                catch: (cause) =>
                  new GitError({
                    operation: "clone-fallback",
                    repo: url,
                    cause,
                  }),
              })

              if (fallbackResult !== 0) {
                return yield* Effect.fail(
                  new GitError({
                    operation: "clone",
                    repo: url,
                    cause: new Error(
                      `git clone failed with exit code ${fallbackResult}`
                    ),
                  })
                )
              }
            } else {
              return yield* Effect.fail(
                new GitError({
                  operation: "clone",
                  repo: url,
                  cause: new Error(`git clone failed with exit code ${exitCode}`),
                })
              )
            }
          }
        }),

      update: (path) =>
        Effect.gen(function* () {
          // Fetch all updates
          const fetchProc = Bun.spawn(["git", "-C", path, "fetch", "--all", "--prune"], {
            stdout: "pipe",
            stderr: "pipe",
          })

          const fetchExit = yield* Effect.tryPromise({
            try: () => fetchProc.exited,
            catch: (cause) =>
              new GitError({ operation: "fetch", repo: path, cause }),
          })

          if (fetchExit !== 0) {
            return yield* Effect.fail(
              new GitError({
                operation: "fetch",
                repo: path,
                cause: new Error(`git fetch failed with exit code ${fetchExit}`),
              })
            )
          }

          // Reset to origin/HEAD (or current branch's upstream)
          const resetProc = Bun.spawn(
            ["git", "-C", path, "reset", "--hard", "origin/HEAD"],
            {
              stdout: "pipe",
              stderr: "pipe",
            }
          )

          const resetExit = yield* Effect.tryPromise({
            try: () => resetProc.exited,
            catch: (cause) =>
              new GitError({ operation: "reset", repo: path, cause }),
          })

          if (resetExit !== 0) {
            // Try resetting to @{upstream} instead
            const upstreamProc = Bun.spawn(
              ["git", "-C", path, "reset", "--hard", "@{upstream}"],
              {
                stdout: "pipe",
                stderr: "pipe",
              }
            )

            const upstreamExit = yield* Effect.tryPromise({
              try: () => upstreamProc.exited,
              catch: (cause) =>
                new GitError({ operation: "reset-upstream", repo: path, cause }),
            })

            if (upstreamExit !== 0) {
              return yield* Effect.fail(
                new GitError({
                  operation: "reset",
                  repo: path,
                  cause: new Error(`git reset failed with exit code ${upstreamExit}`),
                })
              )
            }
          }
        }),

      isGitRepo: (path) =>
        Effect.gen(function* () {
          const proc = Bun.spawn(["git", "-C", path, "rev-parse", "--git-dir"], {
            stdout: "pipe",
            stderr: "pipe",
          })

          const exitCode = yield* Effect.tryPromise({
            try: () => proc.exited,
            catch: () => 1, // Not a git repo
          })

          return exitCode === 0
        }),

      getDefaultBranch: (url) =>
        Effect.gen(function* () {
          const proc = Bun.spawn(["git", "ls-remote", "--symref", url, "HEAD"], {
            stdout: "pipe",
            stderr: "pipe",
          })

          const output = yield* Effect.tryPromise({
            try: async () => {
              const stdout = await new Response(proc.stdout).text()
              await proc.exited
              return stdout
            },
            catch: (cause) =>
              new GitError({ operation: "getDefaultBranch", repo: url, cause }),
          })

          // Parse output like: ref: refs/heads/main\tHEAD
          const match = output.match(/ref: refs\/heads\/(\S+)/)
          if (match?.[1]) {
            return match[1]
          }
          return "main" // fallback
        }),

      getCurrentRef: (path) =>
        Effect.gen(function* () {
          const proc = Bun.spawn(
            ["git", "-C", path, "describe", "--tags", "--always"],
            {
              stdout: "pipe",
              stderr: "pipe",
            }
          )

          const output = yield* Effect.tryPromise({
            try: async () => {
              const stdout = await new Response(proc.stdout).text()
              await proc.exited
              return stdout.trim()
            },
            catch: (cause) =>
              new GitError({ operation: "getCurrentRef", repo: path, cause }),
          })

          return output || "unknown"
        }),
    })
  )

  // Test layer using mock
  static readonly testLayer = Layer.sync(GitService, () => {
    const clonedRepos = new Map<string, { url: string; ref?: string }>()

    return GitService.of({
      clone: (url, dest, options) =>
        Effect.sync(() => {
          const entry: { url: string; ref?: string } = { url }
          if (options?.ref) entry.ref = options.ref
          clonedRepos.set(dest, entry)
        }),

      update: () => Effect.void,

      isGitRepo: (path) => Effect.succeed(clonedRepos.has(path)),

      getDefaultBranch: () => Effect.succeed("main"),

      getCurrentRef: () => Effect.succeed("v1.0.0"),
    })
  })
}
