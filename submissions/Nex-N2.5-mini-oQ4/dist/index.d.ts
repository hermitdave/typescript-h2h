export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED';
export interface TaskInput {
    id: string;
    priority: number;
    executeAt: number;
}
export interface TaskSnapshot {
    readonly id: string;
    readonly priority: number;
    readonly executeAt: number;
    readonly status: TaskStatus;
    readonly dependencies: readonly string[];
    readonly remainingDependencies: number;
    readonly dependentCount: number;
}
export type TaskUpdate = {
    readonly priority?: number;
    readonly executeAt?: number;
    readonly dependencies?: readonly string[];
};
export interface SchedulerOptions {
    /** Optional simulated start time; defaults to Date.now(). */
    readonly now?: number;
}
export declare class TaskError extends Error {
    constructor(message: string);
}
export declare class TaskValidationError extends TaskError {
    constructor(message: string);
}
export declare class TaskNotFoundError extends TaskError {
    constructor(id: string);
}
export declare class TaskNotExecutableError extends TaskError {
    constructor(id: string, status: TaskStatus);
}
export declare class TaskHasDependentsError extends TaskError {
    constructor(id: string);
}
export declare class TaskDependencyCycleError extends TaskError {
    readonly path: readonly string[];
    constructor(path: readonly string[]);
}
export declare class TaskTimeError extends TaskError {
    constructor(message: string);
}
export declare class InMemoryTaskScheduler {
    private readonly dueHeap;
    private readonly futureHeap;
    private readonly blocked;
    private readonly tasks;
    private taskOrder;
    private orderPositions;
    private clock;
    constructor(options?: SchedulerOptions);
    get taskCount(): number;
    addTask(input: TaskInput, dependencies?: readonly string[]): void;
    getTask(taskId: string): TaskSnapshot | undefined;
    peekNextTask(now?: number): TaskSnapshot | undefined;
    private advanceTime;
    currentTime(): number;
    takeNextTask(): TaskSnapshot | undefined;
    startNextTask(): TaskSnapshot | undefined;
    startTask(taskId: string): TaskSnapshot;
    completeTask(taskId: string): void;
    updateTask(taskId: string, update: TaskUpdate): void;
    addDependency(taskId: string, dependencyId: string): void;
    removeDependency(taskId: string, dependencyId: string): void;
    removeTask(taskId: string): void;
    private replaceDependencies;
    private requiresCycleCheck;
    private rebuildTopologicalOrder;
    private hasDependencyCyclePath;
    private findDependencyCyclePath;
    private enqueue;
    private classify;
    private removeFromPartition;
    private requireKnownRecord;
    private requireKnownTask;
    private requirePendingTask;
    private requireRunningTask;
    private validateInput;
    private validateDependencyList;
    private validateDependency;
    private validateFinite;
    private snapshot;
}
export default InMemoryTaskScheduler;
