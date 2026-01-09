import { Effect, Ref } from "effect"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A recorded call to a mock service method.
 * Used for sequence-based test assertions.
 */
export interface RecordedCall {
  /** Service name (e.g., 'git', 'cache', 'registry') */
  service: string
  /** Method name (e.g., 'clone', 'getPath', 'parseSpec') */
  method: string
  /** Arguments passed to the method */
  args: unknown
  /** Return value (optional, for debugging) */
  result?: unknown
}

/**
 * Expected call for sequence matching.
 * Uses partial matching - only specified fields are checked.
 */
export interface ExpectedCall {
  service: string
  method: string
  /** Partial match on args - uses expect().toMatchObject() */
  match?: Record<string, unknown>
}

// ─── Sequence Ref ─────────────────────────────────────────────────────────────

export type SequenceRef = Ref.Ref<RecordedCall[]>

/**
 * Create a new sequence ref for recording calls.
 */
export function createSequenceRef(): SequenceRef {
  return Ref.unsafeMake<RecordedCall[]>([])
}

/**
 * Record a call to the sequence.
 */
export function recordCall(
  sequenceRef: SequenceRef,
  call: Omit<RecordedCall, "result"> & { result?: unknown }
): Effect.Effect<void> {
  return Ref.update(sequenceRef, (seq) => [...seq, call])
}

/**
 * Get all recorded calls.
 */
export function getSequence(sequenceRef: SequenceRef): Effect.Effect<RecordedCall[]> {
  return Ref.get(sequenceRef)
}
