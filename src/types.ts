import { Option, Schema } from "effect";

// Registry types
export type Registry = "github" | "npm" | "pypi" | "crates";

// ─── Branded Name Types ───────────────────────────────────────────────────────

// GitHub repo name: owner/repo format (lowercase after parsing normalization)
export const GitHubRepoName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i),
).pipe(Schema.brand("GitHubRepoName"));
export type GitHubRepoName = typeof GitHubRepoName.Type;

// npm package name: @scope/package or package
export const NpmPackageName = Schema.String.check(
  Schema.isPattern(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/),
).pipe(Schema.brand("NpmPackageName"));
export type NpmPackageName = typeof NpmPackageName.Type;

// PyPI package name: letters, numbers, hyphens, underscores, dots
export const PypiPackageName = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/),
).pipe(Schema.brand("PypiPackageName"));
export type PypiPackageName = typeof PypiPackageName.Type;

// Crates.io crate name: letters, numbers, hyphens, underscores
export const CratesPackageName = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
).pipe(Schema.brand("CratesPackageName"));
export type CratesPackageName = typeof CratesPackageName.Type;

// Union of all valid package names (for loose validation)
export const PackageName = Schema.Union([
  GitHubRepoName,
  NpmPackageName,
  PypiPackageName,
  CratesPackageName,
]);
export type PackageName = typeof PackageName.Type;

// ─── Package Spec ─────────────────────────────────────────────────────────────

// Package spec - identifies a package/repo across registries
// Uses plain string for name to allow parsing to handle validation
export const PackageSpec = Schema.Struct({
  registry: Schema.Literals(["github", "npm", "pypi", "crates"]),
  name: Schema.String,
  version: Schema.OptionFromOptional(Schema.String),
});
export type PackageSpec = typeof PackageSpec.Type;

// Metadata stored per-cached entry
export const RepoMetadata = Schema.Struct({
  spec: PackageSpec,
  fetchedAt: Schema.String,
  lastAccessedAt: Schema.String,
  sizeBytes: Schema.Number,
  path: Schema.String,
});
export type RepoMetadata = typeof RepoMetadata.Type;

// Global metadata index
export const MetadataIndex = Schema.Struct({
  version: Schema.Number,
  repos: Schema.Array(RepoMetadata),
});
export type MetadataIndex = typeof MetadataIndex.Type;

// Tagged Errors
export class SpecParseError extends Schema.TaggedErrorClass<SpecParseError>()(
  "@cvr/repo/types/SpecParseError",
  {
    input: Schema.String,
    message: Schema.String,
  },
) {}

export class RegistryError extends Schema.TaggedErrorClass<RegistryError>()(
  "@cvr/repo/types/RegistryError",
  {
    registry: Schema.String,
    operation: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class GitError extends Schema.TaggedErrorClass<GitError>()("@cvr/repo/types/GitError", {
  operation: Schema.String,
  repo: Schema.String,
  cause: Schema.Unknown,
}) {}

export class CacheError extends Schema.TaggedErrorClass<CacheError>()(
  "@cvr/repo/types/CacheError",
  {
    operation: Schema.String,
    path: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class MetadataError extends Schema.TaggedErrorClass<MetadataError>()(
  "@cvr/repo/types/MetadataError",
  {
    operation: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "@cvr/repo/types/NotFoundError",
  {
    spec: PackageSpec,
  },
) {}

export class NetworkError extends Schema.TaggedErrorClass<NetworkError>()(
  "@cvr/repo/types/NetworkError",
  {
    url: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class OpenError extends Schema.TaggedErrorClass<OpenError>()("@cvr/repo/types/OpenError", {
  command: Schema.String,
  cause: Schema.Unknown,
}) {}

// Utility to format bytes
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

// Utility to format relative time
export const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

// Spec display helper
export const specToString = (spec: PackageSpec): string => {
  const prefix = spec.registry === "github" ? "" : `${spec.registry}:`;
  const version = Option.match(spec.version, {
    onNone: () => "",
    onSome: (v) => `@${v}`,
  });
  return `${prefix}${spec.name}${version}`;
};
