import { PublicTask, RunOutcome, SchedulerEvent, Task, TaskEventHandler, TaskOutcome, TaskSpec } from './types';
/** Injectable clock returning epoch-ms now. */
export type Clock = () => number;
/**
 * Production in-memory task scheduler. Generic over handler argument tuple
 * {@link TArgs} and return type {@link TReturn}.
 *
 * @example
 *   const s = new Scheduler();
 *   s.register({ id: 'a', handler: () => console.log('a') });
 *   s.register({ id: 'b', deps: ['a'], handler: () => { void a; } });
 *   const { executed } = await s.run();
 */
export declare class Scheduler<TArgs extends unknown[] = unknown[], TReturn = unknown> {
    /** id → live task (owner-owned mutable map). */
    private readonly tasks;
    /** The single source of truth for "what runs next", keyed by (dueAt, prio, seq). */
    private readonly ready;
    /** Structural edges + reverse fan-out + cycle detection. */
    private readonly depsGraph;
    /** id → event handlers. */
    private readonly eventSubscribers;
    /** Monotonic sequence counter (insertion order tiebreaker). */
    private seq;
    /** Id of the task currently executing; null between handlers. */
    private runningTaskId;
    /** Outcomes collected across this scheduler's runs. */
    private _outcomes;
    /** Injectable clock returning epoch-ms now. */
    private readonly clock;
    /** Human-readable name for diagnostics. */
    readonly name: string;
    constructor(name?: string, clock?: Clock);
    /**
     * Register a task spec without running it. Re-registering an existing id
     * throws `DuplicateTaskError`. Self-dependencies throw `SchedulerError`.
     * Dependencies on unknown tasks throw `TaskNotFoundError`. Cycles are detected
     * after insertion (the graph's `replaceDependencies` runs the targeted check
     * per added edge; `findCyclicTasks` validates the whole graph at the end).
     */
    register(spec: TaskSpec<TArgs, TReturn>): Task<TArgs, TReturn>;
    /** Look up a live task (or throw TaskNotFoundError). */
    getTask(id: string): Task<TArgs, TReturn>;
    /** Immutable snapshot of a task (throw TaskNotFoundError if missing). */
    get(id: string): PublicTask<TArgs, TReturn>;
    /** All registered task ids, in registration order. */
    get ids(): string[];
    /**
     * Drain all currently-due, executable tasks until the ready set is empty,
     * `maxRuns` is reached, or the scheduler is canceled. Runs tasks serially,
     * awaiting each handler (and any dependent fan-out) before the next.
     *
     * @param maxRuns Safety valve against runaway retry loops. Defaults to
     *   Infinity; when exceeded, the partial outcome is returned.
     */
    run(maxRuns?: number): Promise<RunOutcome>;
    /**
     * Run exactly ONE ready, due-now task, then return. Non-blocking; used when a
     * caller wants to make progress without draining the whole queue.
     */
    runOnce(): Promise<TaskOutcome<TReturn> | null>;
    /**
     * Execute a single attempt of `task`. On success it fans out dependents; on
     * failure it either faults dependents (terminal) or resets the task to Ready
     * for retry. Never throws: the run loop swallows/handles its own errors.
     */
    private _executeAttempt;
    /** Terminal failure path: fault dependents (hard → Stuck, soft → Skipped). */
    private _fail;
    private _outcomeFor;
    /**
     * THE reconciler. Ensure `id` sits in the ready heap iff eligible, else fault
     * it. Called after every state change. O(degree).
     */
    private reconcile;
    /**
     * Readiness probe for `id`. Returns `{ ready, failingHard, failingSoft }`.
     * `failingHard` is the first hard dep that failed/canceled/stuck;
     * `failingSoft` is the first soft dep that failed/canceled.
     */
    private _readiness;
    /**
     * Earliest epoch-ms at which `id` is due: its own dueAt/delay, or the latest
     * due among its active hard deps.
     */
    private _due;
    /** Reconcile a task's dependents (after a dependency reaches a terminal state). */
    private _reconcileDependents;
    /** Mark a task Stuck because a hard dependency never succeeded; cascade. */
    private _stuck;
    /** Mark a task Skipped because a soft dependency failed; cascade. */
    private _skip;
    /** First hard dep (blockedBy) that stuck the task, or null. */
    private _stuckBlockedBy;
    /** Id of the currently running task, or null. */
    get runningTask(): string | null;
    /**
     * The id of the next executable task: the min-due ready task (or undefined).
     * O(1). If the min-due task is not due yet, there is nothing runnable now.
     */
    nextExecutable(): string | undefined;
    /** Tasks faulted (never executed) because a hard dependency failed. */
    getStuckTasks(): Array<{
        id: string;
        blockedBy: string | null;
        reason: string;
    }>;
    /** True if the task with `id` is currently Stuck. */
    isStuck(id: string): boolean;
    /** True if the task with `id` is currently Running. */
    isRunning(id: string): boolean;
    /** Immutable snapshot of ready-heap ids. */
    readyIds(): string[];
    /** Number of tasks currently eligible and due (i.e. in the ready heap). */
    readyCount(): number;
    /**
     * Tasks with no errors (terminal Success), in registration order.
     * Non-throwing snapshot used for observability.
     */
    succeeded(): string[];
    /** Outcomes collected across runs. */
    get outcomes(): readonly TaskOutcome<TReturn>[];
    /** Change a task's priority and re-insert it (if eligible). */
    updatePriority(id: string, priority: number): void;
    /**
     * Replace a task's hard dependency set atomically (structurally). Cycles are
     * rejected with DependencyResolutionError before any mutation. Running or
     * terminal tasks are updated in place without re-keying.
     */
    updateDeps(id: string, newDeps: string[]): void;
    /** Append a hard dependency. */
    addDependency(id: string, dep: string): void;
    /** Remove a hard dependency. */
    removeDependency(id: string, dep: string): void;
    /** Change a task's delay; recompute its dueAt. */
    updateDelay(id: string, delayMs: number): void;
    /** Change a task's soft dependency set. */
    updateSoftDeps(id: string, softDeps: string[]): void;
    /** Change a task's max attempts. */
    updateMaxAttempts(id: string, maxAttempts: number): void;
    /**
     * Cancel a task and fault all its dependents. A running task cannot be
     * canceled (it will finish and its dependents fault when it does).
     * Non-terminal tasks become Canceled; hard dependents become Stuck.
     */
    cancel(id: string): void;
    /** Remove a task (and its edges). Dependent tasks are faulted to Stuck. */
    deleteTask(id: string): void;
    /** Subscribe to a lifecycle event (fires for every task). */
    on(event: SchedulerEvent, handler: TaskEventHandler): void;
    /** Unsubscribe a handler. */
    off(event: SchedulerEvent, handler: TaskEventHandler): void;
    private _fire;
    /** Immutable snapshot of a live task. */
    private _publicTask;
    /** Remove all tasks and internal state. */
    clear(): void;
}
