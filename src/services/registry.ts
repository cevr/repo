// @effect-diagnostics strictEffectProvide:off
import { Clock, Effect, FileSystem, Layer, Option, Result, ServiceMap } from "effect";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { PackageSpec, Registry, SpecParseError } from "../types.js";
import { RegistryError, NetworkError } from "../types.js";
import { parseSpec } from "../parsing.js";
import { GitService } from "./git.js";
import { CacheService } from "./cache.js";

// Service interface
export class RegistryService extends ServiceMap.Service<
  RegistryService,
  {
    readonly parseSpec: (input: string) => Effect.Effect<PackageSpec, SpecParseError>;
    readonly fetch: (
      spec: PackageSpec,
      destPath: string,
    ) => Effect.Effect<void, RegistryError | NetworkError>;
  }
>()("@cvr/repo/services/registry/RegistryService") {
  static readonly layer = Layer.effect(
    RegistryService,
    Effect.gen(function* () {
      const cache = yield* CacheService;
      const git = yield* GitService;
      const client = yield* HttpClient.HttpClient;
      const fsService = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const httpGet = (url: string, headers?: Record<string, string>) =>
        client
          .get(url, headers !== undefined ? { headers } : undefined)
          .pipe(Effect.mapError((cause) => new NetworkError({ url, cause })));

      const cloneFromRepoInfo = (
        info: RepoInfo,
        destPath: string,
        ref: string | undefined,
        depth?: number,
      ) =>
        Effect.gen(function* () {
          const url = getCloneUrl(info);
          const cloneOptions: { depth?: number; ref?: string } = {};
          if (depth !== undefined) cloneOptions.depth = depth;
          if (ref !== undefined) cloneOptions.ref = ref;

          yield* git.clone(url, destPath, cloneOptions).pipe(
            Effect.mapError(
              (e) =>
                new RegistryError({
                  registry: info.host,
                  operation: "clone",
                  cause: e,
                }),
            ),
          );
        });

      const downloadAndExtractTarball = (url: string, destPath: string, registry: Registry) =>
        Effect.gen(function* () {
          const response = yield* httpGet(url);

          if (response.status !== 200) {
            return yield* new RegistryError({
              registry,
              operation: "download-tarball",
              cause: new Error(`HTTP ${response.status}`),
            });
          }

          const buffer = yield* response.arrayBuffer.pipe(
            Effect.mapError(
              (cause) =>
                new RegistryError({
                  registry,
                  operation: "read-tarball",
                  cause,
                }),
            ),
          );

          const now = yield* Clock.currentTimeMillis;
          const tempFile = `/tmp/repo-${now}-${Math.random().toString(36).slice(2)}.tgz`;

          yield* fsService.writeFile(tempFile, new Uint8Array(buffer)).pipe(
            Effect.mapError(
              (cause) =>
                new RegistryError({
                  registry,
                  operation: "write-temp",
                  cause,
                }),
            ),
          );

          const exitCode = yield* spawner
            .exitCode(
              ChildProcess.make("tar", ["-xzf", tempFile, "-C", destPath, "--strip-components=1"]),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new RegistryError({
                    registry,
                    operation: "extract-tarball",
                    cause,
                  }),
              ),
            );

          if (exitCode !== 0) {
            yield* fsService.remove(destPath, { recursive: true }).pipe(Effect.ignore);
            yield* fsService.remove(tempFile).pipe(Effect.ignore);

            return yield* new RegistryError({
              registry,
              operation: "extract-tarball",
              cause: new Error(`tar exited with code ${exitCode}`),
            });
          }

          yield* fsService.remove(tempFile).pipe(Effect.ignore);
        });

      const fetchGithub = (spec: PackageSpec, destPath: string, depth?: number) =>
        Effect.gen(function* () {
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

      const fetchNpm = (spec: PackageSpec, destPath: string, depth?: number) =>
        Effect.gen(function* () {
          const version = Option.getOrElse(spec.version, () => "latest");
          const url = `https://registry.npmjs.org/${spec.name}`;

          const response = yield* httpGet(url);

          if (response.status !== 200) {
            return yield* new RegistryError({
              registry: "npm",
              operation: "fetch-metadata",
              cause: new Error(`HTTP ${response.status}`),
            });
          }

          const data = (yield* response.json.pipe(
            Effect.mapError(
              (cause) =>
                new RegistryError({
                  registry: "npm",
                  operation: "parse-metadata",
                  cause,
                }),
            ),
          )) as {
            versions: Record<string, { dist: { tarball: string } }>;
            "dist-tags": Record<string, string>;
            repository?: { type?: string; url?: string } | string;
          };

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

          const repoInfo = extractRepoInfo(data.repository);

          if (Option.isSome(repoInfo)) {
            const gitRef = resolvedVersion.startsWith("v")
              ? resolvedVersion
              : `v${resolvedVersion}`;
            const cloneResult = yield* cloneFromRepoInfo(
              repoInfo.value,
              destPath,
              gitRef,
              depth,
            ).pipe(Effect.result);

            if (Result.isSuccess(cloneResult)) {
              return;
            }
          }

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

      const fetchPypi = (spec: PackageSpec, destPath: string, depth?: number) =>
        Effect.gen(function* () {
          const version = Option.getOrUndefined(spec.version);
          const url =
            version !== undefined
              ? `https://pypi.org/pypi/${spec.name}/${version}/json`
              : `https://pypi.org/pypi/${spec.name}/json`;

          const response = yield* httpGet(url);

          if (response.status !== 200) {
            return yield* new RegistryError({
              registry: "pypi",
              operation: "fetch-metadata",
              cause: new Error(`HTTP ${response.status}`),
            });
          }

          const data = (yield* response.json.pipe(
            Effect.mapError(
              (cause) =>
                new RegistryError({
                  registry: "pypi",
                  operation: "parse-metadata",
                  cause,
                }),
            ),
          )) as {
            urls: Array<{ packagetype: string; url: string }>;
            info: {
              project_urls?: Record<string, string>;
              home_page?: string;
              version: string;
            };
          };

          const repoInfo = extractRepoInfoFromPypi(data.info);

          if (Option.isSome(repoInfo)) {
            const resolvedVersion = data.info.version;
            const gitRef = resolvedVersion.startsWith("v")
              ? resolvedVersion
              : `v${resolvedVersion}`;
            const cloneResult = yield* cloneFromRepoInfo(
              repoInfo.value,
              destPath,
              gitRef,
              depth,
            ).pipe(Effect.result);

            if (Result.isSuccess(cloneResult)) {
              return;
            }
          }

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

      const fetchCrates = (spec: PackageSpec, destPath: string, depth?: number) =>
        Effect.gen(function* () {
          const url = `https://crates.io/api/v1/crates/${spec.name}`;

          const response = yield* httpGet(url, { "User-Agent": "repo-cli/1.0.0" });

          if (response.status !== 200) {
            return yield* new RegistryError({
              registry: "crates",
              operation: "fetch-metadata",
              cause: new Error(`HTTP ${response.status}`),
            });
          }

          const data = (yield* response.json.pipe(
            Effect.mapError(
              (cause) =>
                new RegistryError({
                  registry: "crates",
                  operation: "parse-metadata",
                  cause,
                }),
            ),
          )) as {
            crate: { repository?: string; homepage?: string };
            versions: Array<{ num: string; dl_path: string }>;
          };

          const version = Option.getOrUndefined(spec.version);
          const versionInfo =
            version !== undefined ? data.versions.find((v) => v.num === version) : data.versions[0];

          if (versionInfo === undefined) {
            return yield* new RegistryError({
              registry: "crates",
              operation: "resolve-version",
              cause: new Error(`Version ${version ?? "latest"} not found`),
            });
          }

          const repoInfoA = extractRepoInfo(data.crate.repository);
          const repoInfo = Option.isSome(repoInfoA)
            ? repoInfoA
            : extractRepoInfo(data.crate.homepage);

          if (Option.isSome(repoInfo)) {
            const resolvedVersion = versionInfo.num;
            const gitRef = resolvedVersion.startsWith("v")
              ? resolvedVersion
              : `v${resolvedVersion}`;
            const cloneResult = yield* cloneFromRepoInfo(
              repoInfo.value,
              destPath,
              gitRef,
              depth,
            ).pipe(Effect.result);

            if (Result.isSuccess(cloneResult)) {
              return;
            }
          }

          const tarballUrl = `https://crates.io${versionInfo.dl_path}`;
          yield* downloadAndExtractTarball(tarballUrl, destPath, "crates");
        });

      const fetch = (spec: PackageSpec, destPath: string) =>
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

          const depth = 100;

          switch (spec.registry) {
            case "github":
              yield* fetchGithub(spec, destPath, depth);
              break;
            case "npm":
              yield* fetchNpm(spec, destPath, depth);
              break;
            case "pypi":
              yield* fetchPypi(spec, destPath, depth);
              break;
            case "crates":
              yield* fetchCrates(spec, destPath, depth);
              break;
          }
        });

      return { parseSpec: parseSpec, fetch };
    }),
  );
}

type GitHost = "github" | "gitlab" | "bitbucket" | "codeberg" | "sourcehut";

interface RepoInfo {
  host: GitHost;
  owner: string;
  repo: string;
}

function extractRepoInfo(
  repository: { type?: string; url?: string } | string | undefined,
): Option.Option<RepoInfo> {
  if (repository === undefined) return Option.none();

  const url = typeof repository === "string" ? repository : repository.url;
  if (url === undefined) return Option.none();

  const hostPatterns: Array<{ host: GitHost; pattern: RegExp }> = [
    { host: "github", pattern: /github\.com[/:]([^/]+)\/([^/.\s#]+)/ },
    { host: "github", pattern: /^github:([^/]+)\/([^/.\s#]+)/ },
    { host: "gitlab", pattern: /gitlab\.com[/:]([^/]+)\/([^/.\s#]+)/ },
    { host: "gitlab", pattern: /^gitlab:([^/]+)\/([^/.\s#]+)/ },
    { host: "bitbucket", pattern: /bitbucket\.org[/:]([^/]+)\/([^/.\s#]+)/ },
    { host: "bitbucket", pattern: /^bitbucket:([^/]+)\/([^/.\s#]+)/ },
    { host: "codeberg", pattern: /codeberg\.org[/:]([^/]+)\/([^/.\s#]+)/ },
    { host: "sourcehut", pattern: /sr\.ht[/:]~([^/]+)\/([^/.\s#]+)/ },
    { host: "sourcehut", pattern: /git\.sr\.ht[/:]~([^/]+)\/([^/.\s#]+)/ },
  ];

  for (const { host, pattern } of hostPatterns) {
    const match = url.match(pattern);
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      return Option.some({
        host,
        owner: match[1],
        repo: match[2].replace(/\.git$/, ""),
      });
    }
  }

  return Option.none();
}

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

function extractRepoInfoFromPypi(info: {
  project_urls?: Record<string, string>;
  home_page?: string;
}): Option.Option<RepoInfo> {
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
      if (Option.isSome(result)) return result;
    }
  }

  return Option.none();
}
