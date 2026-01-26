import { Console, Effect, Schema } from "effect";

/**
 * Type guard for tagged errors (Effect Data.TaggedError instances)
 */
export const isTaggedError = (e: unknown): e is { _tag: string; message?: string } =>
  typeof e === "object" &&
  e !== null &&
  "_tag" in e &&
  typeof (e as { _tag: unknown })._tag === "string";

/**
 * Shared error handler for commands.
 * Formats tagged errors with their tag and JSON payload, others as strings.
 */
export const handleCommandError = (error: unknown) =>
  Effect.gen(function* () {
    if (isTaggedError(error)) {
      const jsonStr = yield* Schema.encode(Schema.parseJson())(error).pipe(
        Effect.orElseSucceed(() => String(error)),
      );
      yield* Console.error(`Error [${error._tag}]: ${jsonStr}`);
    } else {
      yield* Console.error(`Error: ${String(error)}`);
    }
  });
