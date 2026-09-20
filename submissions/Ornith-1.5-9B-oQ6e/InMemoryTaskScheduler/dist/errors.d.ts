/**
 * Domain errors raised by the scheduler. These are intentional, user-facing
 * failures (as opposed to thrown JS exceptions from handlers, which are
 * surfaced via {@link Task.error}). Catching `SchedulerError` lets callers
 * build structured retry / faulting logic without over-catching everything.
 */
export declare class SchedulerError extends Error {
    constructor(message: string);
}
export declare class TaskNotFoundError extends SchedulerError {
    constructor(id: string);
}
export declare class DuplicateTaskError extends SchedulerError {
    constructor(id: string);
}
export declare class DependencyResolutionError extends SchedulerError {
    readonly taskId: string;
    readonly cycle: string[];
    constructor(taskId: string, cycle: string[]);
}
export declare class InvalidConfigurationError extends SchedulerError {
    constructor(message: string);
}
