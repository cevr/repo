import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { NotFoundError, specToString } from "../types.js";
import { MetadataService } from "../services/metadata.js";
import { RegistryService } from "../services/registry.js";

const specArg = Args.text({ name: "spec" }).pipe(
  Args.withDescription("Package spec to get path for"),
);

const quietOption = Options.boolean("quiet").pipe(
  Options.withAlias("q"),
  Options.withDefault(false),
  Options.withDescription("Output only the path, exit 1 if not cached"),
);

export const path = Command.make("path", { spec: specArg, quiet: quietOption }, ({ spec, quiet }) =>
  Effect.gen(function* () {
    const registry = yield* RegistryService;
    const metadata = yield* MetadataService;

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
  }).pipe(Effect.catchAll(() => Effect.void)),
);
