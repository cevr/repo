import { Data, Schema } from "effect";

// Registry types
export type Registry = "github" | "npm" | "pypi" | "crates";

// Package spec - identifies a package/repo across registries
export const PackageSpec = Schema.Struct({
  registry: Schema.Literal("github", "npm", "pypi", "crates"),
  name: Schema.String,
  version: Schema.optionalWith(Schema.String, { as: "Option" }),
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
export class SpecParseError extends Data.TaggedError("@cvr/repo/types/SpecParseError")<{
  readonly input: string;
  readonly message: string;
}> {}

export class RegistryError extends Data.TaggedError("@cvr/repo/types/RegistryError")<{
  readonly registry: Registry;
  readonly operation: string;
  readonly cause: unknown;
}> {}

export class GitError extends Data.TaggedError("@cvr/repo/types/GitError")<{
  readonly operation: string;
  readonly repo: string;
  readonly cause: unknown;
}> {}

export class CacheError extends Data.TaggedError("@cvr/repo/types/CacheError")<{
  readonly operation: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

export class MetadataError extends Data.TaggedError("@cvr/repo/types/MetadataError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export class NotFoundError extends Data.TaggedError("@cvr/repo/types/NotFoundError")<{
  readonly spec: PackageSpec;
}> {}

export class NetworkError extends Data.TaggedError("@cvr/repo/types/NetworkError")<{
  readonly url: string;
  readonly cause: unknown;
}> {}

export class OpenError extends Data.TaggedError("@cvr/repo/types/OpenError")<{
  readonly command: string;
  readonly cause: unknown;
}> {}

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
  const version = spec.version._tag === "Some" ? `@${spec.version.value}` : "";
  return `${prefix}${spec.name}${version}`;
};
