import { Console, Effect } from "effect";

/**
 * Type guard for tagged errors (Effect Schema.TaggedErrorClass instances)
 */
export const isTaggedError = (e: unknown): e is { _tag: string; message?: string } =>
  typeof e === "object" &&
  e !== null &&
  "_tag" in e &&
  typeof (e as { _tag: unknown })._tag === "string";

/**
 * Shared error handler for commands.
 * Formats tagged errors as human-readable messages.
 */
export const handleCommandError = (error: unknown) =>
  Effect.gen(function* () {
    if (isTaggedError(error)) {
      const e = error as Record<string, unknown>;
      switch (error._tag) {
        case "@cvr/repo/types/SpecParseError":
          yield* Console.error(
            `Error: "${e.input}" is not a valid package spec. Try: owner/repo, npm:package, pypi:package`,
          );
          break;
        case "@cvr/repo/types/RegistryError":
          yield* Console.error(
            `Error: Failed to ${e.operation} from ${e.registry}: ${String(e.cause)}`,
          );
          break;
        case "@cvr/repo/types/GitError":
          yield* Console.error(`Error: Git ${e.operation} failed on ${e.repo}: ${String(e.cause)}`);
          break;
        case "@cvr/repo/types/NetworkError":
          yield* Console.error(`Error: Network request failed: ${e.url}`);
          break;
        default:
          yield* Console.error(`Error: ${error.message ?? error._tag}`);
      }
    } else {
      yield* Console.error(`Error: ${String(error)}`);
    }
  });
