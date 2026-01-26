// @effect-diagnostics strictEffectProvide:off
import { Effect, Option } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runCli } from "../src/test-utils/index.js";

// NOTE: Due to @effect/cli arg ordering quirk, options must come BEFORE positional args.
// See bite CLI tests for details on this parser behavior.

describe("fetch command", () => {
  describe("fresh fetch", () => {
    it.effect("fetches a GitHub repo", () =>
      runCli("fetch vercel/next.js", {}).expectSequence([
        { service: "registry", method: "parseSpec", match: { input: "vercel/next.js" } },
        { service: "metadata", method: "find" },
        { service: "cache", method: "getPath" },
        { service: "cache", method: "ensureDir" },
        { service: "registry", method: "fetch" },
        { service: "cache", method: "getSize" },
        { service: "git", method: "isGitRepo" },
        { service: "metadata", method: "add" },
      ]),
    );

    it.effect("fetches an npm package", () =>
      runCli("fetch npm:lodash@4.17.21", {}).expectSequence([
        { service: "registry", method: "parseSpec", match: { input: "npm:lodash@4.17.21" } },
        { service: "metadata", method: "find" },
        { service: "cache", method: "getPath" },
        { service: "cache", method: "ensureDir" },
        { service: "registry", method: "fetch" },
        { service: "cache", method: "getSize" },
        { service: "metadata", method: "add" },
      ]),
    );
  });

  describe("existing repo", () => {
    it.effect("updates existing git repo when already cached", () =>
      Effect.gen(function* () {
        // Pre-populate metadata with an existing repo
        const spec = {
          registry: "github" as const,
          name: "vercel/next.js",
          version: Option.none<string>(),
        };

        const gitState = new Map([
          ["/tmp/test-repo-cache/vercel/next.js", { url: "https://github.com/vercel/next.js.git" }],
        ]);

        const sequence = yield* runCli("fetch vercel/next.js", {
          git: { clonedRepos: gitState },
          metadata: {
            index: {
              version: 1,
              repos: [
                {
                  spec,
                  fetchedAt: new Date().toISOString(),
                  lastAccessedAt: new Date().toISOString(),
                  sizeBytes: 1000,
                  path: "/tmp/test-repo-cache/vercel/next.js",
                },
              ],
            },
          },
        }).getSequence();

        // Should find existing, check if git repo, and update it
        expect(sequence.some((c) => c.service === "metadata" && c.method === "find")).toBe(true);
        expect(sequence.some((c) => c.service === "git" && c.method === "isGitRepo")).toBe(true);
        // Since it's a git repo, it calls update and then adds updated metadata
        expect(sequence.some((c) => c.service === "git" && c.method === "update")).toBe(true);
        expect(sequence.some((c) => c.service === "metadata" && c.method === "add")).toBe(true);
        // Should NOT do a fresh registry fetch
        expect(sequence.some((c) => c.service === "registry" && c.method === "fetch")).toBe(false);
      }),
    );

    it.effect("force re-fetches when --force is used", () =>
      Effect.gen(function* () {
        const spec = {
          registry: "github" as const,
          name: "vercel/next.js",
          version: Option.none<string>(),
        };

        const sequence = yield* runCli("fetch -f vercel/next.js", {
          metadata: {
            index: {
              version: 1,
              repos: [
                {
                  spec,
                  fetchedAt: new Date().toISOString(),
                  lastAccessedAt: new Date().toISOString(),
                  sizeBytes: 1000,
                  path: "/tmp/test-repo-cache/vercel/next.js",
                },
              ],
            },
          },
        }).getSequence();

        // With --force, should remove existing and re-fetch
        expect(sequence.some((c) => c.service === "cache" && c.method === "remove")).toBe(true);
        expect(sequence.some((c) => c.service === "metadata" && c.method === "remove")).toBe(true);
        expect(sequence.some((c) => c.service === "registry" && c.method === "fetch")).toBe(true);
      }),
    );
  });
});

describe("list command", () => {
  it.effect("lists all cached repos", () =>
    runCli("list", {}).expectSequence([{ service: "metadata", method: "all" }]),
  );

  it.effect("filters by registry", () =>
    runCli("list -r npm", {}).expectSequence([{ service: "metadata", method: "all" }]),
  );
});

describe("remove command", () => {
  it.effect("removes a cached repo", () =>
    Effect.gen(function* () {
      const spec = {
        registry: "github" as const,
        name: "owner/repo",
        version: Option.none<string>(),
      };

      const sequence = yield* runCli("remove owner/repo", {
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec,
                fetchedAt: new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/owner/repo",
              },
            ],
          },
        },
      }).getSequence();

      // Should find the repo, remove from cache, and remove from metadata
      expect(sequence.some((c) => c.service === "registry" && c.method === "parseSpec")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "find")).toBe(true);
      expect(sequence.some((c) => c.service === "cache" && c.method === "remove")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "remove")).toBe(true);
    }),
  );
});

describe("clean command", () => {
  it.effect("removes all cached repos", () =>
    Effect.gen(function* () {
      const spec = {
        registry: "github" as const,
        name: "owner/repo",
        version: Option.none<string>(),
      };

      const sequence = yield* runCli("clean -y", {
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec,
                fetchedAt: new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/owner/repo",
              },
            ],
          },
        },
      }).getSequence();

      expect(sequence.some((c) => c.service === "metadata" && c.method === "all")).toBe(true);
      expect(sequence.some((c) => c.service === "cache" && c.method === "removeAll")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "save")).toBe(true);
    }),
  );

  it.effect("does nothing when cache is empty", () =>
    runCli("clean -y", {}).expectSequence([{ service: "metadata", method: "all" }]),
  );
});

describe("path command", () => {
  it.effect("returns path for cached repo", () =>
    Effect.gen(function* () {
      const spec = {
        registry: "github" as const,
        name: "owner/repo",
        version: Option.none<string>(),
      };

      const sequence = yield* runCli("path owner/repo", {
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec,
                fetchedAt: new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                sizeBytes: 1000,
                path: "/tmp/test-repo-cache/owner/repo",
              },
            ],
          },
        },
      }).getSequence();

      expect(sequence.some((c) => c.service === "registry" && c.method === "parseSpec")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "find")).toBe(true);
    }),
  );
});

describe("info command", () => {
  it.effect("shows info for cached repo", () =>
    Effect.gen(function* () {
      const spec = {
        registry: "github" as const,
        name: "owner/repo",
        version: Option.none<string>(),
      };

      const sequence = yield* runCli("info owner/repo", {
        git: {
          clonedRepos: new Map([
            ["/tmp/test-repo-cache/owner/repo", { url: "https://github.com/owner/repo.git" }],
          ]),
        },
        metadata: {
          index: {
            version: 1,
            repos: [
              {
                spec,
                fetchedAt: new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                sizeBytes: 5000,
                path: "/tmp/test-repo-cache/owner/repo",
              },
            ],
          },
        },
      }).getSequence();

      expect(sequence.some((c) => c.service === "registry" && c.method === "parseSpec")).toBe(true);
      expect(sequence.some((c) => c.service === "metadata" && c.method === "find")).toBe(true);
      expect(sequence.some((c) => c.service === "git" && c.method === "isGitRepo")).toBe(true);
    }),
  );
});

describe("sequence verification", () => {
  it.effect("verifies exact call order", () =>
    runCli("fetch npm:effect", {}).expectSequence([
      { service: "registry", method: "parseSpec" },
      { service: "metadata", method: "find" },
      { service: "cache", method: "getPath" },
      // These happen after checking cache - fresh fetch
      { service: "cache", method: "ensureDir" },
      { service: "registry", method: "fetch" },
      { service: "cache", method: "getSize" },
      { service: "metadata", method: "add" },
    ]),
  );

  it.effect("can inspect full sequence for custom assertions", () =>
    Effect.gen(function* () {
      const sequence = yield* runCli("list", {}).getSequence();

      // Custom assertions on the full sequence
      expect(sequence.length).toBeGreaterThan(0);
      expect(sequence[0]?.service).toBe("metadata");
      expect(sequence[0]?.method).toBe("all");
    }),
  );
});
