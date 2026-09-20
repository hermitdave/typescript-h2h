/**
 * Error taxonomy for the in-memory task scheduler.
 *
 * All scheduler errors derive from `SchedulerError` so callers can
 * discriminate wholesale (`err instanceof SchedulerError`). Every failure
 * type below is thrown on invalid input or broken invariants, never for
 * recoverable runtime state (a blocked task is a valid state, not an error).
 */

/** Root error for all scheduler failures. */
export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A task id (or other referenced entity) does not exist. */
export class UnknownTaskError extends SchedulerError {}

/** A task id is used twice. Task ids must be stable within a scheduler instance. */
export class DuplicateTaskError extends SchedulerError {}

/** A task is a prerequisite of itself (directly or through the dependency closure). */
export class SelfDependencyError extends SchedulerError {}

/** Adding a dependency would introduce a cycle. The cycle path is included in the message. */
export class CycleError extends SchedulerError {
  constructor(message: string, readonly cycle: string[]) {
    super(message);
  }
}

/** `completeTask` was called for a task that is already completed or cancelled. */
export class InvalidOperationError extends SchedulerError {}

/** `completeTask` was called for a task that is not ready (dependencies unmet). */
export class NotExecutableError extends SchedulerError {}

/** Input validation failed (bad priority, bad dueTime, etc.). */
export class InvalidInputError extends SchedulerError {}