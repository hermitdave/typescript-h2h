/**
 * Error hierarchy for the task scheduler.
 *
 * Every error thrown by the scheduler extends {@link TaskSchedulerError} so
 * callers can catch domain failures without coupling to specific causes.
 */
export class TaskSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The task id in the operation does not exist in the scheduler. */
export class TaskNotFoundError extends TaskSchedulerError {}

/** A task with the given id was already added. */
export class DuplicateTaskError extends TaskSchedulerError {}

/** The requested dependency change would introduce a cycle. */
export class CycleError extends TaskSchedulerError {}

/** The operation is not permitted in the task's current state. */
export class InvalidTaskStateError extends TaskSchedulerError {}