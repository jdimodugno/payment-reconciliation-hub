/**
 * Result<T, E> — Type for operations that can fail in expected ways.
 *
 * Why this exists (PRINCIPLE T5):
 *
 * Throwing exceptions is fine for bugs and unexpected failures, but bad
 * for domain errors that are part of the expected flow (e.g., "duplicate
 * transaction", "insufficient funds", "rate limit hit").
 *
 * Result<T, E> makes failure a first-class part of the type signature.
 * Callers MUST handle both cases. No silent swallowing.
 *
 * Inspired by Rust's Result, F#'s Result, and the "Parse, don't validate"
 * philosophy (see resources/learning-paths.md → T5).
 *
 * INTENTIONALLY INCOMPLETE: implement when you encounter your first
 * domain error case that doesn't fit clean exception throwing.
 *
 * Don't use this everywhere. Use it where:
 * - The failure is expected and part of the domain
 * - The caller will likely want to inspect the error type
 * - Exceptions would propagate through layers that shouldn't care
 */

export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * Type guard / pattern matching helper.
 *
 * @example
 *   const result = parseAmount('1.50');
 *   if (isOk(result)) {
 *     console.log(result.value);  // typed as the success value
 *   } else {
 *     console.log(result.error);  // typed as the error
 *   }
 */
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  !result.ok;
