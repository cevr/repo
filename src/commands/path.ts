import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { NotFoundError, specToString } from "../types.js";
import { MetadataService } from "../services/metadata.js";
import { RegistryService } from "../services/registry.js";
import { GitService } from "../services/git.js";

const specArg = Argument.string("spec").pipe(
  Argument.withDescription("Package spec to get path for"),
);

const quietFlag = Flag.boolean("quiet").pipe(
  Flag.withAlias("q"),
  Flag.withDefault(false),
  Flag.withDescription("Output only the path, exit 1 if not cached"),
);

export const path = Command.make("path", { spec: specArg, quiet: quietFlag }, ({ spec, quiet }) =>
  Effect.gen(function* () {
    const registry = yield* RegistryService;
    const metadata = yield* MetadataService;
    const git = yield* GitService;

    const parsedSpec = yield* registry.parseSpec(spec);
    const existing = yield* metadata.find(parsedSpec);

    if (existing === null) {
      if (!quiet) {
        yield* Console.error(`Not cached: ${specToString(parsedSpec)}`);
        yield* Console.error(`Run: repo fetch ${spec}`);
      }
      return yield* new NotFoundError({ spec: parsedSpec });
    }

    yield* Console.log(existing.path);
    yield* metadata.updateAccessTime(parsedSpec);

    // Refresh refs for git repos (best-effort)
    const isGit = yield* git.isGitRepo(existing.path);
    if (isGit) {
      yield* git.fetchRefs(existing.path).pipe(Effect.catch(() => Effect.void));
    }
  }).pipe(Effect.catch(() => Effect.void)),
);
