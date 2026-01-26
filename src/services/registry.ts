// @effect-diagnostics strictEffectProvide:off
import { Context, Effect, Layer, Option } from "effect";
import type { PackageSpec, Registry, SpecParseError } from "../types.js";
import { RegistryError, NetworkError } from "../types.js";
import { parseSpec } from "../parsing.js";
import { GitService } from "./git.js";
import { CacheService } from "./cache.js";

// Fetch options
export interface FetchOptions {
  fullHistory?: boolean;
}

// Service interface
export class RegistryService extends Context.Tag("@cvr/repo/services/registry/RegistryService")<
  RegistryService,
  {
    readonly parseSpec: (input: string) => Effect.Effect<PackageSpec, SpecParseError>;
    readonly fetch: (
      spec: PackageSpec,
      destPath: string,
      options?: FetchOptions,
    ) => Effect.Effect<void, RegistryError | NetworkError>;
  }
>() {
  // Live layer
  static readonly layer = Layer.effect(
    RegistryService,
    Effect.gen(function* () {
      const cache = yield* CacheService;
      const git = yield* GitService;

      const parseSpecFn = parseSpec;

      // Create a layer with the acquired GitService for providing to fetch helpers
      const gitLayer = Layer.succeed(GitService, git);

      const fetch = (spec: PackageSpec, destPath: string, options?: FetchOptions) =>
        Effect.gen(function* () {
          yield* cache.ensureDir(destPath).pipe(
            Effect.mapError(
              (e) =>
                new RegistryError({
                  registry: spec.registry,
                  operation: "ensureDir",
                  cause: e,
                }),
            ),
          );

          const depth = options?.fullHistory === true ? undefined : 100;

          switch (spec.registry) {
            case "github":
              yield* fetchGithub(spec, destPath, depth).pipe(Effect.provide(gitLayer));
              break;
            case "npm":
              yield* fetchNpm(spec, destPath, depth).pipe(Effect.provide(gitLayer));
              break;
            case "pypi":
              yield* fetchPypi(spec, destPath, depth).pipe(Effect.provide(gitLayer));
              break;
            case "crates":
              yield* fetchCrates(spec, destPath, depth).pipe(Effect.provide(gitLayer));
              break;
          }
        });

      return RegistryService.of({ parseSpec: parseSpecFn, fetch });
    }),
  );
}

// Fetch helpers - these access GitService from context

const fetchGithub = Effect.fn("RegistryService.fetchGithub")(function* (
  spec: PackageSpec,
  destPath: string,
  depth?: number,
) {
  const git = yield* GitService;
  const url = `https://github.com/${spec.name}.git`;
  const ref = Option.getOrUndefined(spec.version);

  const cloneOptions: { depth?: number; ref?: string } = {};
  if (depth !== undefined) cloneOptions.depth = depth;
  if (ref !== undefined) cloneOptions.ref = ref;

  yield* git.clone(url, destPath, cloneOptions).pipe(
    Effect.mapError(
      (e) =>
        new RegistryError({
          registry: "github",
          operation: "clone",
          cause: e,
        }),
    ),
  );
});

// Supported git hosts and their URL patterns
type GitHost = "github" | "gitlab" | "bitbucket" | "codeberg" | "sourcehut";

interface RepoInfo {
  host: GitHost;
  owner: string;
  repo: string;
}

// Extract repository info from various git hosting URL formats
function extractRepoInfo(
  repository: { type?: string; url?: string } | string | undefined,
): RepoInfo | null {
  if (repository === undefined) return null;

  const url = typeof repository === "string" ? repository : repository.url;
  if (url === undefined) return null;

  // Patterns for each host
  const hostPatterns: Array<{ host: GitHost; pattern: RegExp }> = [
    // GitHub
    { host: "github", pattern: /github\.com[/:]([^/]+)\/([^/.\s#]+)/ },
    { host: "github", pattern: /^github:([^/]+)\/([^/.\s#]+)/ },
    // GitLab
    { host: "gitlab", pattern: /gitlab\.com[/:]([^/]+)\/([^/.\s#]+)/ },
    { host: "gitlab", pattern: /^gitlab:([^/]+)\/([^/.\s#]+)/ },
    // Bitbucket
    { host: "bitbucket", pattern: /bitbucket\.org[/:]([^/]+)\/([^/.\s#]+)/ },
    { host: "bitbucket", pattern: /^bitbucket:([^/]+)\/([^/.\s#]+)/ },
    // Codeberg
    { host: "codeberg", pattern: /codeberg\.org[/:]([^/]+)\/([^/.\s#]+)/ },
    // Sourcehut
    { host: "sourcehut", pattern: /sr\.ht[/:]~([^/]+)\/([^/.\s#]+)/ },
    { host: "sourcehut", pattern: /git\.sr\.ht[/:]~([^/]+)\/([^/.\s#]+)/ },
  ];

  for (const { host, pattern } of hostPatterns) {
    const match = url.match(pattern);
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      return {
        host,
        owner: match[1],
        repo: match[2].replace(/\.git$/, ""),
      };
    }
  }

  return null;
}

// Get clone URL for a repository
function getCloneUrl(info: RepoInfo): string {
  switch (info.host) {
    case "github":
      return `https://github.com/${info.owner}/${info.repo}.git`;
    case "gitlab":
      return `https://gitlab.com/${info.owner}/${info.repo}.git`;
    case "bitbucket":
      return `https://bitbucket.org/${info.owner}/${info.repo}.git`;
    case "codeberg":
      return `https://codeberg.org/${info.owner}/${info.repo}.git`;
    case "sourcehut":
      return `https://git.sr.ht/~${info.owner}/${info.repo}`;
  }
}

// Clone from any supported git host
const cloneFromRepoInfo = Effect.fn("RegistryService.cloneFromRepoInfo")(function* (
  info: RepoInfo,
  destPath: string,
  ref: string | undefined,
  depth?: number,
) {
  const git = yield* GitService;
  const url = getCloneUrl(info);

  const cloneOptions: { depth?: number; ref?: string } = {};
  if (depth !== undefined) cloneOptions.depth = depth;
  if (ref !== undefined) cloneOptions.ref = ref;

  yield* git.clone(url, destPath, cloneOptions).pipe(
    Effect.mapError(
      (e) =>
        new RegistryError({
          registry: "github",
          operation: "clone",
          cause: e,
        }),
    ),
  );
});

const fetchNpm = Effect.fn("RegistryService.fetchNpm")(function* (
  spec: PackageSpec,
  destPath: string,
  depth?: number,
) {
  // Query npm registry for package info
  const version = Option.getOrElse(spec.version, () => "latest");
  const url = `https://registry.npmjs.org/${spec.name}`;

  const response = yield* Effect.tryPromise({
    try: () => fetch(url),
    catch: (cause) => new NetworkError({ url, cause }),
  });

  if (!response.ok) {
    return yield* new RegistryError({
      registry: "npm",
      operation: "fetch-metadata",
      cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
    });
  }

  const data = (yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new RegistryError({
        registry: "npm",
        operation: "parse-metadata",
        cause,
      }),
  })) as {
    versions: Record<string, { dist: { tarball: string } }>;
    "dist-tags": Record<string, string>;
    repository?: { type?: string; url?: string } | string;
  };

  // Resolve version
  const resolvedVersion =
    version === "latest"
      ? data["dist-tags"]?.["latest"]
      : version in data.versions
        ? version
        : data["dist-tags"]?.[version];

  if (resolvedVersion === undefined || data.versions[resolvedVersion] === undefined) {
    return yield* new RegistryError({
      registry: "npm",
      operation: "resolve-version",
      cause: new Error(`Version ${version} not found`),
    });
  }

  // Try to find source repo URL (GitHub, GitLab, etc.)
  const repoInfo = extractRepoInfo(data.repository);

  if (repoInfo !== null) {
    // Try to clone from source repo first
    const gitRef = resolvedVersion.startsWith("v") ? resolvedVersion : `v${resolvedVersion}`;
    const cloneResult = yield* cloneFromRepoInfo(repoInfo, destPath, gitRef, depth).pipe(
      Effect.either,
    );

    if (cloneResult._tag === "Right") {
      return; // Success - cloned from source repo
    }
    // Clone failed, fall back to tarball
  }

  // Fallback: download tarball
  const tarballUrl = data.versions[resolvedVersion]?.dist?.tarball;
  if (tarballUrl === undefined) {
    return yield* new RegistryError({
      registry: "npm",
      operation: "get-tarball-url",
      cause: new Error("No tarball URL found"),
    });
  }

  yield* downloadAndExtractTarball(tarballUrl, destPath, "npm");
});

const fetchPypi = Effect.fn("RegistryService.fetchPypi")(function* (
  spec: PackageSpec,
  destPath: string,
  depth?: number,
) {
  const version = Option.getOrUndefined(spec.version);
  const url =
    version !== undefined
      ? `https://pypi.org/pypi/${spec.name}/${version}/json`
      : `https://pypi.org/pypi/${spec.name}/json`;

  const response = yield* Effect.tryPromise({
    try: () => fetch(url),
    catch: (cause) => new NetworkError({ url, cause }),
  });

  if (!response.ok) {
    return yield* new RegistryError({
      registry: "pypi",
      operation: "fetch-metadata",
      cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
    });
  }

  const data = (yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new RegistryError({
        registry: "pypi",
        operation: "parse-metadata",
        cause,
      }),
  })) as {
    urls: Array<{ packagetype: string; url: string }>;
    info: {
      project_urls?: Record<string, string>;
      home_page?: string;
      version: string;
    };
  };

  // Try to find source repo URL first (GitHub, GitLab, etc.)
  const repoInfo = extractRepoInfoFromPypi(data.info);

  if (repoInfo !== null) {
    // Try to clone from source repo first
    const resolvedVersion = data.info.version;
    const gitRef = resolvedVersion.startsWith("v") ? resolvedVersion : `v${resolvedVersion}`;
    const cloneResult = yield* cloneFromRepoInfo(repoInfo, destPath, gitRef, depth).pipe(
      Effect.either,
    );

    if (cloneResult._tag === "Right") {
      return; // Success - cloned from source repo
    }
    // Clone failed, fall back to tarball
  }

  // Fallback: download tarball
  const sdist = data.urls.find((u) => u.packagetype === "sdist");
  const wheel = data.urls.find((u) => u.packagetype === "bdist_wheel");
  const tarballUrl = sdist?.url ?? wheel?.url;

  if (tarballUrl === undefined) {
    return yield* new RegistryError({
      registry: "pypi",
      operation: "get-download-url",
      cause: new Error("No source distribution found"),
    });
  }

  yield* downloadAndExtractTarball(tarballUrl, destPath, "pypi");
});

// Extract repo info from PyPI project info (supports GitHub, GitLab, etc.)
function extractRepoInfoFromPypi(info: {
  project_urls?: Record<string, string>;
  home_page?: string;
}): RepoInfo | null {
  const urls = [
    info.project_urls?.["Source"],
    info.project_urls?.["Source Code"],
    info.project_urls?.["GitHub"],
    info.project_urls?.["GitLab"],
    info.project_urls?.["Repository"],
    info.project_urls?.["Code"],
    info.home_page,
  ];

  for (const url of urls) {
    if (url !== undefined) {
      const result = extractRepoInfo(url);
      if (result !== null) return result;
    }
  }

  return null;
}

const fetchCrates = Effect.fn("RegistryService.fetchCrates")(function* (
  spec: PackageSpec,
  destPath: string,
  depth?: number,
) {
  const url = `https://crates.io/api/v1/crates/${spec.name}`;

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(url, {
        headers: {
          "User-Agent": "repo-cli/1.0.0",
        },
      }),
    catch: (cause) => new NetworkError({ url, cause }),
  });

  if (!response.ok) {
    return yield* new RegistryError({
      registry: "crates",
      operation: "fetch-metadata",
      cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
    });
  }

  const data = (yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new RegistryError({
        registry: "crates",
        operation: "parse-metadata",
        cause,
      }),
  })) as {
    crate: { repository?: string; homepage?: string };
    versions: Array<{ num: string; dl_path: string }>;
  };

  const version = Option.getOrUndefined(spec.version);
  const versionInfo =
    version !== undefined ? data.versions.find((v) => v.num === version) : data.versions[0]; // latest

  if (versionInfo === undefined) {
    return yield* new RegistryError({
      registry: "crates",
      operation: "resolve-version",
      cause: new Error(`Version ${version ?? "latest"} not found`),
    });
  }

  // Try to find source repo URL first (GitHub, GitLab, etc.)
  const repoInfo = extractRepoInfo(data.crate.repository) ?? extractRepoInfo(data.crate.homepage);

  if (repoInfo !== null) {
    // Try to clone from source repo first
    const resolvedVersion = versionInfo.num;
    const gitRef = resolvedVersion.startsWith("v") ? resolvedVersion : `v${resolvedVersion}`;
    const cloneResult = yield* cloneFromRepoInfo(repoInfo, destPath, gitRef, depth).pipe(
      Effect.either,
    );

    if (cloneResult._tag === "Right") {
      return; // Success - cloned from source repo
    }
    // Clone failed, fall back to tarball
  }

  // Fallback: download tarball
  const tarballUrl = `https://crates.io${versionInfo.dl_path}`;
  yield* downloadAndExtractTarball(tarballUrl, destPath, "crates");
});

const downloadAndExtractTarball = Effect.fn("RegistryService.downloadAndExtractTarball")(function* (
  url: string,
  destPath: string,
  registry: Registry,
) {
  const response = yield* Effect.tryPromise({
    try: () => fetch(url),
    catch: (cause) => new NetworkError({ url, cause }),
  });

  if (!response.ok) {
    return yield* new RegistryError({
      registry,
      operation: "download-tarball",
      cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
    });
  }

  const buffer = yield* Effect.tryPromise({
    try: () => response.arrayBuffer(),
    catch: (cause) =>
      new RegistryError({
        registry,
        operation: "read-tarball",
        cause,
      }),
  });

  // Use bun to extract tarball - use OS temp dir
  const os = yield* Effect.promise(() => import("node:os"));
  const tempDir = os.tmpdir();
  const tempFile = `${tempDir}/repo-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`;
  yield* Effect.tryPromise({
    try: async () => {
      await Bun.write(tempFile, buffer);
    },
    catch: (cause) =>
      new RegistryError({
        registry,
        operation: "write-temp",
        cause,
      }),
  });

  // Extract using tar
  const proc = Bun.spawn(["tar", "-xzf", tempFile, "-C", destPath, "--strip-components=1"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = yield* Effect.tryPromise({
    try: () => proc.exited,
    catch: (cause) =>
      new RegistryError({
        registry,
        operation: "extract-tarball",
        cause,
      }),
  });

  // Clean up temp file
  yield* Effect.tryPromise({
    try: async () => {
      const { unlink } = await import("node:fs/promises");
      await unlink(tempFile);
    },
    catch: () =>
      new RegistryError({
        registry,
        operation: "cleanup-temp",
        cause: new Error("Failed to cleanup temp file"),
      }),
  }).pipe(Effect.ignore);

  if (exitCode !== 0) {
    return yield* new RegistryError({
      registry,
      operation: "extract-tarball",
      cause: new Error(`tar exited with code ${exitCode}`),
    });
  }
});
