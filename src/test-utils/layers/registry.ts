import { Effect, Layer, Option, Ref } from "effect";
import { RegistryService } from "../../services/registry.js";
import type { PackageSpec, Registry } from "../../types.js";
import { SpecParseError } from "../../types.js";
import { recordCall, type SequenceRef } from "../sequence.js";

// ─── Mock State ───────────────────────────────────────────────────────────────

export interface MockRegistryState {
  fetchedSpecs: Map<string, PackageSpec>;
}

export const defaultMockRegistryState: MockRegistryState = {
  fetchedSpecs: new Map(),
};

// ─── Mock Implementation ──────────────────────────────────────────────────────

export interface CreateMockRegistryServiceOptions {
  initialState?: Partial<MockRegistryState>;
  sequenceRef?: SequenceRef;
}

export function createMockRegistryService(options: CreateMockRegistryServiceOptions = {}): {
  layer: Layer.Layer<RegistryService>;
  stateRef: Ref.Ref<MockRegistryState>;
  getState: () => Effect.Effect<MockRegistryState>;
} {
  const initialState = options.initialState ?? {};
  const sequenceRef = options.sequenceRef;

  const state: MockRegistryState = {
    ...defaultMockRegistryState,
    ...initialState,
    fetchedSpecs: new Map(initialState.fetchedSpecs ?? []),
  };
  const stateRef = Ref.unsafeMake(state);

  const record = (method: string, args: unknown, result?: unknown): Effect.Effect<void> =>
    sequenceRef !== undefined
      ? recordCall(sequenceRef, { service: "registry", method, args, result })
      : Effect.void;

  const layer = Layer.succeed(
    RegistryService,
    RegistryService.of({
      parseSpec: (input) =>
        Effect.gen(function* () {
          const result = parseSpecSync(input);
          yield* record("parseSpec", { input }, result);
          return result;
        }),

      fetch: (spec, destPath, options) =>
        Effect.gen(function* () {
          yield* record("fetch", { spec, destPath, options });
          yield* Ref.update(stateRef, (s) => {
            const newFetched = new Map(s.fetchedSpecs);
            newFetched.set(destPath, spec);
            return { ...s, fetchedSpecs: newFetched };
          });
        }),
    }),
  );

  return {
    layer,
    stateRef,
    getState: () => Ref.get(stateRef),
  };
}

// ─── Spec Parsing (copied from registry.ts for test layer) ────────────────────

type ParseResult = PackageSpec | { error: string };

function parseGithubSpec(input: string): ParseResult {
  const refMatch = input.match(/^([^@#]+)[@#](.+)$/);
  if (refMatch !== null) {
    const [, name, ref] = refMatch;
    if (name === undefined || !name.includes("/")) {
      return { error: "GitHub spec must be owner/repo format" };
    }
    return {
      registry: "github" as Registry,
      name: name,
      // ref is guaranteed to exist when refMatch matches
      version: Option.some(ref as string),
    };
  }

  if (!input.includes("/")) {
    return { error: "GitHub spec must be owner/repo format" };
  }

  return {
    registry: "github" as Registry,
    name: input,
    version: Option.none(),
  };
}

function parseNpmSpec(input: string): ParseResult {
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

function parsePypiSpec(input: string): ParseResult {
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

function parseCratesSpec(input: string): ParseResult {
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

function parseSpecSync(input: string): PackageSpec {
  const trimmed = input.trim();

  let result: ParseResult;

  if (trimmed.startsWith("npm:")) {
    result = parseNpmSpec(trimmed.slice(4));
  } else if (trimmed.startsWith("pypi:") || trimmed.startsWith("pip:")) {
    const prefix = trimmed.startsWith("pypi:") ? "pypi:" : "pip:";
    result = parsePypiSpec(trimmed.slice(prefix.length));
  } else if (
    trimmed.startsWith("crates:") ||
    trimmed.startsWith("cargo:") ||
    trimmed.startsWith("rust:")
  ) {
    const prefixLen = trimmed.indexOf(":") + 1;
    result = parseCratesSpec(trimmed.slice(prefixLen));
  } else if (trimmed.startsWith("github:")) {
    result = parseGithubSpec(trimmed.slice(7));
  } else if (trimmed.includes("/") && !trimmed.startsWith("@")) {
    result = parseGithubSpec(trimmed);
  } else {
    result = parseNpmSpec(trimmed);
  }

  if ("error" in result) {
    throw new SpecParseError({ input, message: result.error });
  }

  return result;
}

// ─── Preset Configurations ────────────────────────────────────────────────────

export const MockRegistryServiceDefault = createMockRegistryService();
