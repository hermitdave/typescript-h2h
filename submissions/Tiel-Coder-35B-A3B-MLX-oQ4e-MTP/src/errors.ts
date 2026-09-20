/**
 * Error hierarchy for the scheduler. Catch {@link TaskSchedulerError} for a
 * common base, or the specific subclasses for precise handling.
 */

export class TaskSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskSchedulerError';
  }
}

export class DuplicateTaskError extends TaskSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateTaskError';
  }
}

export class UnknownTaskError extends TaskSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownTaskError';
  }
}

export class UnknownDependencyError extends TaskSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownDependencyError';
  }
}

export class DuplicatedDependencyError extends TaskSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicatedDependencyError';
  }
}

export class CycleDetectedError extends TaskSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'CycleDetectedError';
  }
}

export class InvalidArgumentError extends TaskSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
}

export class InvalidTaskStateError extends TaskSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaskStateError';
  }
}
