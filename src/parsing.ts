import { Effect, Option } from "effect";
import type { PackageSpec, Registry } from "./types.js";
import { SpecParseError } from "./types.js";

// ─── Parse Result ─────────────────────────────────────────────────────────────

export type ParseResult = PackageSpec | { error: string };

// ─── Registry-Specific Parsers ────────────────────────────────────────────────

export function parseGithubSpec(input: string): ParseResult {
  // Handle owner/repo@ref or owner/repo#ref
  const refMatch = input.match(/^([^@#]+)[@#](.+)$/);
  if (refMatch !== null) {
    const [, name, ref] = refMatch;
    if (name === undefined || !name.includes("/")) {
      return { error: "GitHub spec must be owner/repo format" };
    }
    return {
      registry: "github" as Registry,
      // Normalize to lowercase for case-insensitive matching
      name: name.toLowerCase(),
      // ref is guaranteed to exist when refMatch matches
      version: Option.some(ref as string),
    };
  }

  if (!input.includes("/")) {
    return { error: "GitHub spec must be owner/repo format" };
  }

  return {
    registry: "github" as Registry,
    // Normalize to lowercase for case-insensitive matching
    name: input.toLowerCase(),
    version: Option.none(),
  };
}

export function parseNpmSpec(input: string): ParseResult {
  // Handle scoped packages: @scope/package@version
  if (input.startsWith("@")) {
    const match = input.match(/^(@[^@]+)(?:@(.+))?$/);
    if (match === null) {
      return { error: "Invalid scoped npm package spec" };
    }
    const [, name, version] = match;
    return {
      registry: "npm" as Registry,
      // name is guaranteed to exist when match succeeds
      name: name as string,
      version: version !== undefined ? Option.some(version) : Option.none(),
    };
  }

  // Handle regular packages: package@version
  const parts = input.split("@");
  if (parts.length > 2) {
    return { error: "Invalid npm package spec" };
  }

  const [name, version] = parts;
  if (name === undefined || name.length === 0) {
    return { error: "Package name is required" };
  }

  return {
    registry: "npm" as Registry,
    name,
    version: version !== undefined ? Option.some(version) : Option.none(),
  };
}

export function parsePypiSpec(input: string): ParseResult {
  // Handle package@version or package==version
  const match = input.match(/^([^@=]+)(?:[@=]=?(.+))?$/);
  if (match === null) {
    return { error: "Invalid PyPI package spec" };
  }

  const [, name, version] = match;
  if (name === undefined || name.length === 0) {
    return { error: "Package name is required" };
  }

  return {
    registry: "pypi" as Registry,
    name: name.trim(),
    version: version !== undefined ? Option.some(version.trim()) : Option.none(),
  };
}

export function parseCratesSpec(input: string): ParseResult {
  const parts = input.split("@");
  if (parts.length > 2) {
    return { error: "Invalid crates.io spec" };
  }

  const [name, version] = parts;
  if (name === undefined || name.length === 0) {
    return { error: "Crate name is required" };
  }

  return {
    registry: "crates" as Registry,
    name: name.trim(),
    version: version !== undefined ? Option.some(version.trim()) : Option.none(),
  };
}

// ─── Unified Parser ───────────────────────────────────────────────────────────

/**
 * Parse a package spec string into a PackageSpec.
 * Supports prefixes: npm:, pypi:, pip:, crates:, cargo:, rust:, github:
 * Without prefix: "/" -> GitHub, else npm
 */
export function parseSpecSync(input: string): ParseResult {
  const trimmed = input.trim();

  // Check for registry prefixes
  if (trimmed.startsWith("npm:")) {
    return parseNpmSpec(trimmed.slice(4));
  }
  if (trimmed.startsWith("pypi:") || trimmed.startsWith("pip:")) {
    const prefix = trimmed.startsWith("pypi:") ? "pypi:" : "pip:";
    return parsePypiSpec(trimmed.slice(prefix.length));
  }
  if (
    trimmed.startsWith("crates:") ||
    trimmed.startsWith("cargo:") ||
    trimmed.startsWith("rust:")
  ) {
    const prefixLen = trimmed.indexOf(":") + 1;
    return parseCratesSpec(trimmed.slice(prefixLen));
  }
  if (trimmed.startsWith("github:")) {
    return parseGithubSpec(trimmed.slice(7));
  }

  // Check if it looks like a GitHub repo (contains /)
  if (trimmed.includes("/") && !trimmed.startsWith("@")) {
    return parseGithubSpec(trimmed);
  }

  // Default: treat as npm package if no prefix and no slash
  return parseNpmSpec(trimmed);
}

/**
 * Parse spec as Effect, failing with SpecParseError on invalid input.
 */
export const parseSpec = (input: string): Effect.Effect<PackageSpec, SpecParseError> =>
  Effect.sync(() => parseSpecSync(input)).pipe(
    Effect.flatMap((result) => {
      if ("error" in result) {
        return Effect.fail(new SpecParseError({ input, message: result.error }));
      }
      return Effect.succeed(result);
    }),
  );

/**
 * Parse spec synchronously, throwing SpecParseError on invalid input.
 */
export function parseSpecOrThrow(input: string): PackageSpec {
  const result = parseSpecSync(input);
  if ("error" in result) {
    throw new SpecParseError({ input, message: result.error });
  }
  return result;
}
