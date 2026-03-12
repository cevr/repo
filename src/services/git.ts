import { Effect, Layer, ServiceMap } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { GitError } from "../types.js";

export class GitService extends ServiceMap.Service<
  GitService,
  {
    readonly clone: (
      url: string,
      dest: string,
      options?: { depth?: number; ref?: string },
    ) => Effect.Effect<void, GitError>;
    readonly update: (path: string) => Effect.Effect<void, GitError>;
    readonly fetchRefs: (path: string) => Effect.Effect<void, GitError>;
    readonly isGitRepo: (path: string) => Effect.Effect<boolean>;
    readonly getDefaultBranch: (url: string) => Effect.Effect<string, GitError>;
    readonly getCurrentRef: (path: string) => Effect.Effect<string, GitError>;
  }
>()("@cvr/repo/services/git/GitService") {
  static readonly layer = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      return {
        clone: (url, dest, options) =>
          Effect.gen(function* () {
            const args = ["clone"];

            if (options?.depth !== undefined) {
              args.push("--depth", String(options.depth));
            }

            if (options?.ref !== undefined) {
              args.push("--branch", options.ref);
            }

            args.push(url, dest);

            const exitCode = yield* spawner
              .exitCode(ChildProcess.make("git", args))
              .pipe(
                Effect.mapError((cause) => new GitError({ operation: "clone", repo: url, cause })),
              );

            if (exitCode !== 0) {
              // If ref failed, try without it (fallback to default branch)
              if (options?.ref !== undefined) {
                // Remove failed clone dest before retry
                yield* spawner.exitCode(ChildProcess.make("rm", ["-rf", dest])).pipe(Effect.ignore);

                const fallbackArgs = ["clone"];
                if (options.depth !== undefined) {
                  fallbackArgs.push("--depth", String(options.depth));
                }
                fallbackArgs.push(url, dest);

                const fallbackResult = yield* spawner
                  .exitCode(ChildProcess.make("git", fallbackArgs))
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new GitError({
                          operation: "clone-fallback",
                          repo: url,
                          cause,
                        }),
                    ),
                  );

                if (fallbackResult !== 0) {
                  return yield* new GitError({
                    operation: "clone",
                    repo: url,
                    cause: new Error(`git clone failed with exit code ${fallbackResult}`),
                  });
                }
              } else {
                return yield* new GitError({
                  operation: "clone",
                  repo: url,
                  cause: new Error(`git clone failed with exit code ${exitCode}`),
                });
              }
            }
          }),

        fetchRefs: (path) =>
          Effect.gen(function* () {
            const exitCode = yield* spawner
              .exitCode(ChildProcess.make("git", ["-C", path, "fetch", "--all", "--prune"]))
              .pipe(
                Effect.mapError((cause) => new GitError({ operation: "fetch", repo: path, cause })),
              );

            if (exitCode !== 0) {
              return yield* new GitError({
                operation: "fetch",
                repo: path,
                cause: new Error(`git fetch failed with exit code ${exitCode}`),
              });
            }
          }),

        update: (path) =>
          Effect.gen(function* () {
            const fetchExit = yield* spawner
              .exitCode(ChildProcess.make("git", ["-C", path, "fetch", "--all", "--prune"]))
              .pipe(
                Effect.mapError((cause) => new GitError({ operation: "fetch", repo: path, cause })),
              );

            if (fetchExit !== 0) {
              return yield* new GitError({
                operation: "fetch",
                repo: path,
                cause: new Error(`git fetch failed with exit code ${fetchExit}`),
              });
            }

            const resetExit = yield* spawner
              .exitCode(ChildProcess.make("git", ["-C", path, "reset", "--hard", "origin/HEAD"]))
              .pipe(
                Effect.mapError((cause) => new GitError({ operation: "reset", repo: path, cause })),
              );

            if (resetExit !== 0) {
              const upstreamExit = yield* spawner
                .exitCode(ChildProcess.make("git", ["-C", path, "reset", "--hard", "@{upstream}"]))
                .pipe(
                  Effect.mapError(
                    (cause) => new GitError({ operation: "reset-upstream", repo: path, cause }),
                  ),
                );

              if (upstreamExit !== 0) {
                return yield* new GitError({
                  operation: "reset",
                  repo: path,
                  cause: new Error(`git reset failed with exit code ${upstreamExit}`),
                });
              }
            }
          }),

        isGitRepo: (path) =>
          spawner.exitCode(ChildProcess.make("git", ["-C", path, "rev-parse", "--git-dir"])).pipe(
            Effect.map((exitCode) => exitCode === 0),
            Effect.orElseSucceed(() => false),
          ),

        getDefaultBranch: (url) =>
          Effect.gen(function* () {
            const output = yield* spawner
              .string(ChildProcess.make("git", ["ls-remote", "--symref", url, "HEAD"]))
              .pipe(
                Effect.mapError(
                  (cause) => new GitError({ operation: "getDefaultBranch", repo: url, cause }),
                ),
              );

            const match = output.match(/ref: refs\/heads\/(\S+)/);
            if (match !== null && match[1] !== undefined) {
              return match[1];
            }
            return "main";
          }),

        getCurrentRef: (path) =>
          Effect.gen(function* () {
            const output = yield* spawner
              .string(ChildProcess.make("git", ["-C", path, "describe", "--tags", "--always"]))
              .pipe(
                Effect.mapError(
                  (cause) => new GitError({ operation: "getCurrentRef", repo: path, cause }),
                ),
              );

            const trimmed = output.trim();
            return trimmed.length > 0 ? trimmed : "unknown";
          }),
      };
    }),
  );
}
