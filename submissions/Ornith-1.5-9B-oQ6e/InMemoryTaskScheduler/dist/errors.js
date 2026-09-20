/**
 * Domain errors raised by the scheduler. These are intentional, user-facing
 * failures (as opposed to thrown JS exceptions from handlers, which are
 * surfaced via {@link Task.error}). Catching `SchedulerError` lets callers
 * build structured retry / faulting logic without over-catching everything.
 */
export class SchedulerError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SchedulerError';
    }
}
export class TaskNotFoundError extends SchedulerError {
    constructor(id) {
        super(`No task registered with id "${id}"`);
        this.name = 'TaskNotFoundError';
    }
}
export class DuplicateTaskError extends SchedulerError {
    constructor(id) {
        super(`A task with id "${id}" already exists; remove it or register under a new id`);
        this.name = 'DuplicateTaskError';
    }
}
export class DependencyResolutionError extends SchedulerError {
    constructor(taskId, cycle) {
        super(`Cycle detected involving task "${taskId}": ${cycle.join(' -> ')}`);
        this.taskId = taskId;
        this.cycle = cycle;
        this.name = 'DependencyResolutionError';
    }
}
export class InvalidConfigurationError extends SchedulerError {
    constructor(message) {
        super(message);
        this.name = 'InvalidConfigurationError';
    }
}
