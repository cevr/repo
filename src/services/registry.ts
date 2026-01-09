import { Context, Effect, Layer, Option } from "effect"
import type { PackageSpec, Registry } from "../types.js"
import { SpecParseError, RegistryError, NetworkError } from "../types.js"
import { GitService } from "./git.js"
import { CacheService } from "./cache.js"

// Fetch options
export interface FetchOptions {
  fullHistory?: boolean
}

// Service interface
export class RegistryService extends Context.Tag("@repo/RegistryService")<
  RegistryService,
  {
    readonly parseSpec: (
      input: string
    ) => Effect.Effect<PackageSpec, SpecParseError>
    readonly fetch: (
      spec: PackageSpec,
      destPath: string,
      options?: FetchOptions
    ) => Effect.Effect<void, RegistryError | NetworkError>
  }
>() {
  // Live layer
  static readonly layer = Layer.effect(
    RegistryService,
    Effect.gen(function* () {
      const cache = yield* CacheService
      const git = yield* GitService

      const parseSpec = (
        input: string
      ): Effect.Effect<PackageSpec, SpecParseError> =>
        Effect.sync(() => {
          const trimmed = input.trim()

          // Check for registry prefixes
          if (trimmed.startsWith("npm:")) {
            return parseNpmSpec(trimmed.slice(4))
          }
          if (trimmed.startsWith("pypi:") || trimmed.startsWith("pip:")) {
            const prefix = trimmed.startsWith("pypi:") ? "pypi:" : "pip:"
            return parsePypiSpec(trimmed.slice(prefix.length))
          }
          if (
            trimmed.startsWith("crates:") ||
            trimmed.startsWith("cargo:") ||
            trimmed.startsWith("rust:")
          ) {
            const prefixLen = trimmed.indexOf(":") + 1
            return parseCratesSpec(trimmed.slice(prefixLen))
          }
          if (trimmed.startsWith("github:")) {
            return parseGithubSpec(trimmed.slice(7))
          }

          // Check if it looks like a GitHub repo (contains /)
          if (trimmed.includes("/") && !trimmed.startsWith("@")) {
            return parseGithubSpec(trimmed)
          }

          // Default: treat as npm package if no prefix and no slash
          return parseNpmSpec(trimmed)
        }).pipe(
          Effect.flatMap((result) => {
            if ("error" in result) {
              return Effect.fail(
                new SpecParseError({ input, message: result.error })
              )
            }
            return Effect.succeed(result)
          })
        )

      // Create a layer with the acquired GitService for providing to fetch helpers
      const gitLayer = Layer.succeed(GitService, git)

      const fetch = (spec: PackageSpec, destPath: string, options?: FetchOptions) =>
        Effect.gen(function* () {
          yield* cache.ensureDir(destPath).pipe(
            Effect.mapError(
              (e) =>
                new RegistryError({
                  registry: spec.registry,
                  operation: "ensureDir",
                  cause: e,
                })
            )
          )

          const depth = options?.fullHistory ? undefined : 100

          switch (spec.registry) {
            case "github":
              yield* fetchGithub(spec, destPath, depth).pipe(Effect.provide(gitLayer))
              break
            case "npm":
              yield* fetchNpm(spec, destPath, depth).pipe(Effect.provide(gitLayer))
              break
            case "pypi":
              yield* fetchPypi(spec, destPath, depth).pipe(Effect.provide(gitLayer))
              break
            case "crates":
              yield* fetchCrates(spec, destPath, depth).pipe(Effect.provide(gitLayer))
              break
          }
        })

      return RegistryService.of({ parseSpec, fetch })
    })
  )

}

// Parser helpers

type ParseResult = PackageSpec | { error: string }

function parseGithubSpec(input: string): ParseResult {
  // Handle owner/repo@ref or owner/repo#ref
  const refMatch = input.match(/^([^@#]+)[@#](.+)$/)
  if (refMatch) {
    const [, name, ref] = refMatch
    if (!name?.includes("/")) {
      return { error: "GitHub spec must be owner/repo format" }
    }
    return {
      registry: "github" as Registry,
      name: name,
      version: Option.some(ref!),
    }
  }

  if (!input.includes("/")) {
    return { error: "GitHub spec must be owner/repo format" }
  }

  return {
    registry: "github" as Registry,
    name: input,
    version: Option.none(),
  }
}

function parseNpmSpec(input: string): ParseResult {
  // Handle scoped packages: @scope/package@version
  if (input.startsWith("@")) {
    const match = input.match(/^(@[^@]+)(?:@(.+))?$/)
    if (!match) {
      return { error: "Invalid scoped npm package spec" }
    }
    const [, name, version] = match
    return {
      registry: "npm" as Registry,
      name: name!,
      version: version ? Option.some(version) : Option.none(),
    }
  }

  // Handle regular packages: package@version
  const parts = input.split("@")
  if (parts.length > 2) {
    return { error: "Invalid npm package spec" }
  }

  const [name, version] = parts
  if (!name) {
    return { error: "Package name is required" }
  }

  return {
    registry: "npm" as Registry,
    name,
    version: version ? Option.some(version) : Option.none(),
  }
}

function parsePypiSpec(input: string): ParseResult {
  // Handle package@version or package==version
  const match = input.match(/^([^@=]+)(?:[@=]=?(.+))?$/)
  if (!match) {
    return { error: "Invalid PyPI package spec" }
  }

  const [, name, version] = match
  if (!name) {
    return { error: "Package name is required" }
  }

  return {
    registry: "pypi" as Registry,
    name: name.trim(),
    version: version ? Option.some(version.trim()) : Option.none(),
  }
}

function parseCratesSpec(input: string): ParseResult {
  const parts = input.split("@")
  if (parts.length > 2) {
    return { error: "Invalid crates.io spec" }
  }

  const [name, version] = parts
  if (!name) {
    return { error: "Crate name is required" }
  }

  return {
    registry: "crates" as Registry,
    name: name.trim(),
    version: version ? Option.some(version.trim()) : Option.none(),
  }
}

// Fetch helpers - these access GitService from context

function fetchGithub(
  spec: PackageSpec,
  destPath: string,
  depth?: number
): Effect.Effect<void, RegistryError, GitService> {
  return Effect.gen(function* () {
    const git = yield* GitService
    const url = `https://github.com/${spec.name}.git`
    const ref = Option.getOrUndefined(spec.version)

    const cloneOptions: { depth?: number; ref?: string } = {}
    if (depth) cloneOptions.depth = depth
    if (ref) cloneOptions.ref = ref

    yield* git
      .clone(url, destPath, cloneOptions)
      .pipe(
        Effect.mapError(
          (e) =>
            new RegistryError({
              registry: "github",
              operation: "clone",
              cause: e,
            })
        )
      )
  })
}

// Supported git hosts and their URL patterns
type GitHost = "github" | "gitlab" | "bitbucket" | "codeberg" | "sourcehut"

interface RepoInfo {
  host: GitHost
  owner: string
  repo: string
}

// Extract repository info from various git hosting URL formats
function extractRepoInfo(
  repository: { type?: string; url?: string } | string | undefined
): RepoInfo | null {
  if (!repository) return null

  const url = typeof repository === "string" ? repository : repository.url
  if (!url) return null

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
  ]

  for (const { host, pattern } of hostPatterns) {
    const match = url.match(pattern)
    if (match?.[1] && match?.[2]) {
      return {
        host,
        owner: match[1],
        repo: match[2].replace(/\.git$/, ""),
      }
    }
  }

  return null
}

// Get clone URL for a repository
function getCloneUrl(info: RepoInfo): string {
  switch (info.host) {
    case "github":
      return `https://github.com/${info.owner}/${info.repo}.git`
    case "gitlab":
      return `https://gitlab.com/${info.owner}/${info.repo}.git`
    case "bitbucket":
      return `https://bitbucket.org/${info.owner}/${info.repo}.git`
    case "codeberg":
      return `https://codeberg.org/${info.owner}/${info.repo}.git`
    case "sourcehut":
      return `https://git.sr.ht/~${info.owner}/${info.repo}`
  }
}

// Clone from any supported git host
function cloneFromRepoInfo(
  info: RepoInfo,
  destPath: string,
  ref: string | undefined,
  depth?: number
): Effect.Effect<void, RegistryError, GitService> {
  return Effect.gen(function* () {
    const git = yield* GitService
    const url = getCloneUrl(info)

    const cloneOptions: { depth?: number; ref?: string } = {}
    if (depth) cloneOptions.depth = depth
    if (ref) cloneOptions.ref = ref

    yield* git
      .clone(url, destPath, cloneOptions)
      .pipe(
        Effect.mapError(
          (e) =>
            new RegistryError({
              registry: "github",
              operation: "clone",
              cause: e,
            })
        )
      )
  })
}

function fetchNpm(
  spec: PackageSpec,
  destPath: string,
  depth?: number
): Effect.Effect<void, RegistryError | NetworkError, GitService> {
  return Effect.gen(function* () {
    // Query npm registry for package info
    const version = Option.getOrElse(spec.version, () => "latest")
    const url = `https://registry.npmjs.org/${spec.name}`

    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (cause) => new NetworkError({ url, cause }),
    })

    if (!response.ok) {
      return yield* Effect.fail(
        new RegistryError({
          registry: "npm",
          operation: "fetch-metadata",
          cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
        })
      )
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
      versions: Record<string, { dist: { tarball: string } }>
      "dist-tags": Record<string, string>
      repository?: { type?: string; url?: string } | string
    }

    // Resolve version
    const resolvedVersion =
      version === "latest"
        ? data["dist-tags"]?.["latest"]
        : version in data.versions
          ? version
          : data["dist-tags"]?.[version]

    if (!resolvedVersion || !data.versions[resolvedVersion]) {
      return yield* Effect.fail(
        new RegistryError({
          registry: "npm",
          operation: "resolve-version",
          cause: new Error(`Version ${version} not found`),
        })
      )
    }

    // Try to find source repo URL (GitHub, GitLab, etc.)
    const repoInfo = extractRepoInfo(data.repository)

    if (repoInfo) {
      // Try to clone from source repo first
      const gitRef = resolvedVersion.startsWith("v") ? resolvedVersion : `v${resolvedVersion}`
      const cloneResult = yield* cloneFromRepoInfo(
        repoInfo,
        destPath,
        gitRef,
        depth
      ).pipe(Effect.either)

      if (cloneResult._tag === "Right") {
        return // Success - cloned from source repo
      }
      // Clone failed, fall back to tarball
    }

    // Fallback: download tarball
    const tarballUrl = data.versions[resolvedVersion]?.dist?.tarball
    if (!tarballUrl) {
      return yield* Effect.fail(
        new RegistryError({
          registry: "npm",
          operation: "get-tarball-url",
          cause: new Error("No tarball URL found"),
        })
      )
    }

    yield* downloadAndExtractTarball(tarballUrl, destPath, "npm")
  })
}

function fetchPypi(
  spec: PackageSpec,
  destPath: string,
  depth?: number
): Effect.Effect<void, RegistryError | NetworkError, GitService> {
  return Effect.gen(function* () {
    const version = Option.getOrUndefined(spec.version)
    const url = version
      ? `https://pypi.org/pypi/${spec.name}/${version}/json`
      : `https://pypi.org/pypi/${spec.name}/json`

    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (cause) => new NetworkError({ url, cause }),
    })

    if (!response.ok) {
      return yield* Effect.fail(
        new RegistryError({
          registry: "pypi",
          operation: "fetch-metadata",
          cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
        })
      )
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
      urls: Array<{ packagetype: string; url: string }>
      info: {
        project_urls?: Record<string, string>
        home_page?: string
        version: string
      }
    }

    // Try to find source repo URL first (GitHub, GitLab, etc.)
    const repoInfo = extractRepoInfoFromPypi(data.info)

    if (repoInfo) {
      // Try to clone from source repo first
      const resolvedVersion = data.info.version
      const gitRef = resolvedVersion.startsWith("v") ? resolvedVersion : `v${resolvedVersion}`
      const cloneResult = yield* cloneFromRepoInfo(
        repoInfo,
        destPath,
        gitRef,
        depth
      ).pipe(Effect.either)

      if (cloneResult._tag === "Right") {
        return // Success - cloned from source repo
      }
      // Clone failed, fall back to tarball
    }

    // Fallback: download tarball
    const sdist = data.urls.find((u) => u.packagetype === "sdist")
    const wheel = data.urls.find((u) => u.packagetype === "bdist_wheel")
    const tarballUrl = sdist?.url ?? wheel?.url

    if (!tarballUrl) {
      return yield* Effect.fail(
        new RegistryError({
          registry: "pypi",
          operation: "get-download-url",
          cause: new Error("No source distribution found"),
        })
      )
    }

    yield* downloadAndExtractTarball(tarballUrl, destPath, "pypi")
  })
}

// Extract repo info from PyPI project info (supports GitHub, GitLab, etc.)
function extractRepoInfoFromPypi(info: {
  project_urls?: Record<string, string>
  home_page?: string
}): RepoInfo | null {
  const urls = [
    info.project_urls?.["Source"],
    info.project_urls?.["Source Code"],
    info.project_urls?.["GitHub"],
    info.project_urls?.["GitLab"],
    info.project_urls?.["Repository"],
    info.project_urls?.["Code"],
    info.home_page,
  ]

  for (const url of urls) {
    if (url) {
      const result = extractRepoInfo(url)
      if (result) return result
    }
  }

  return null
}

function fetchCrates(
  spec: PackageSpec,
  destPath: string,
  depth?: number
): Effect.Effect<void, RegistryError | NetworkError, GitService> {
  return Effect.gen(function* () {
    const url = `https://crates.io/api/v1/crates/${spec.name}`

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: {
            "User-Agent": "repo-cli/1.0.0",
          },
        }),
      catch: (cause) => new NetworkError({ url, cause }),
    })

    if (!response.ok) {
      return yield* Effect.fail(
        new RegistryError({
          registry: "crates",
          operation: "fetch-metadata",
          cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
        })
      )
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
      crate: { repository?: string; homepage?: string }
      versions: Array<{ num: string; dl_path: string }>
    }

    const version = Option.getOrUndefined(spec.version)
    const versionInfo = version
      ? data.versions.find((v) => v.num === version)
      : data.versions[0] // latest

    if (!versionInfo) {
      return yield* Effect.fail(
        new RegistryError({
          registry: "crates",
          operation: "resolve-version",
          cause: new Error(`Version ${version ?? "latest"} not found`),
        })
      )
    }

    // Try to find source repo URL first (GitHub, GitLab, etc.)
    const repoInfo = extractRepoInfo(data.crate.repository) ?? extractRepoInfo(data.crate.homepage)

    if (repoInfo) {
      // Try to clone from source repo first
      const resolvedVersion = versionInfo.num
      const gitRef = resolvedVersion.startsWith("v") ? resolvedVersion : `v${resolvedVersion}`
      const cloneResult = yield* cloneFromRepoInfo(
        repoInfo,
        destPath,
        gitRef,
        depth
      ).pipe(Effect.either)

      if (cloneResult._tag === "Right") {
        return // Success - cloned from source repo
      }
      // Clone failed, fall back to tarball
    }

    // Fallback: download tarball
    const tarballUrl = `https://crates.io${versionInfo.dl_path}`
    yield* downloadAndExtractTarball(tarballUrl, destPath, "crates")
  })
}

function downloadAndExtractTarball(
  url: string,
  destPath: string,
  registry: Registry
): Effect.Effect<void, RegistryError | NetworkError> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url),
      catch: (cause) => new NetworkError({ url, cause }),
    })

    if (!response.ok) {
      return yield* Effect.fail(
        new RegistryError({
          registry,
          operation: "download-tarball",
          cause: new Error(`HTTP ${response.status}: ${response.statusText}`),
        })
      )
    }

    const buffer = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: (cause) =>
        new RegistryError({
          registry,
          operation: "read-tarball",
          cause,
        }),
    })

    // Use bun to extract tarball
    const tempFile = `/tmp/repo-${Date.now()}.tgz`
    yield* Effect.tryPromise({
      try: async () => {
        await Bun.write(tempFile, buffer)
      },
      catch: (cause) =>
        new RegistryError({
          registry,
          operation: "write-temp",
          cause,
        }),
    })

    // Extract using tar
    const proc = Bun.spawn(
      ["tar", "-xzf", tempFile, "-C", destPath, "--strip-components=1"],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    )

    const exitCode = yield* Effect.tryPromise({
      try: () => proc.exited,
      catch: (cause) =>
        new RegistryError({
          registry,
          operation: "extract-tarball",
          cause,
        }),
    })

    // Clean up temp file
    yield* Effect.tryPromise({
      try: async () => {
        const { unlink } = await import("node:fs/promises")
        await unlink(tempFile)
      },
      catch: () =>
        new RegistryError({
          registry,
          operation: "cleanup-temp",
          cause: new Error("Failed to cleanup temp file"),
        }),
    }).pipe(Effect.ignore)

    if (exitCode !== 0) {
      return yield* Effect.fail(
        new RegistryError({
          registry,
          operation: "extract-tarball",
          cause: new Error(`tar exited with code ${exitCode}`),
        })
      )
    }
  })
}
