/**
 * Type definitions for the in-memory task scheduler.
 *
 * This is the single source of truth for the scheduler's vocabulary. The design
 * choices below are deliberately opinionated (they are what "senior review"
 * checks), and are re-stated in the README:
 *
 *   - LOWER `priority` value == HIGHER precedence (runs first). 0 is neutral.
 *     This matches Array.sort / JS's natural `<` ordering and most queue APIs.
 *   - A task is executed STRICTLY SERIALY — at most one task runs at a time.
 *     `runningTaskId` gates everything; dependents are fanned out only after the
 *     current task reaches a terminal state.
 *   - `deps` are HARD: ALL must reach Success before a task is executable. If
 *     any hard dep ends in Failure/Canceled, the task is STUCK (faulted, never
 *     auto-run, surfaced for retry).
 *   - `softDeps` are ADVISORY: the task always runs, but if any soft dep FAILED
 *     (or was canceled), the task completes as SKIPPED instead of Success. This
 *     lets optional cleanup/telemetry tasks degrade gracefully.
 *   - Ordering is deterministic: (due, priority, seq) with `seq` a global
 *     monotonic counter. Equal due+priority resolves by insertion order.
 */

/** Lifecycle states. Transitions are gated on `runningTaskId`; the value you
 *  see is the last observed status at snapshot time. */
export enum TaskStatus {
  /** Spec supplied but not yet registered in the scheduler. */
  Created = 'Created',
  /** Registered but awaiting dependencies and/or its due-time. */
  Pending = 'Pending',
  /** Registered and due now — held in the ready-heap. */
  Ready = 'Ready',
  /** Currently executing. Exactly one task in this state at a time. */
  Running = 'Running',
  /** Finished successfully. */
  Success = 'Success',
  /** Finished with a handler error. */
  Failure = 'Failure',
  /** Running task explicitly canceled by the scheduler. */
  Canceled = 'Canceled',
  /** Faulted because a HARD dependency failed/canceled; can never run. */
  Stuck = 'Stuck',
  /** Ran, but a SOFT dependency failed/canceled — degraded to SKIPPED. */
  Skipped = 'Skipped',
}

/** Helpers to reason about dependents without enumerating every state. */
export const TASK_SUCCEEDED_STATUSES: Readonly<Set<TaskStatus>> = new Set([
  TaskStatus.Success,
]);

/** Statuses after which a hard dependent must be considered faulted. */
export const TASK_FAILED_STATUSES: Readonly<Set<TaskStatus>> = new Set([
  TaskStatus.Failure,
  TaskStatus.Canceled,
]);

/** Every status that "closes" a task for the purposes of fan-out. */
export const TERMINAL_STATUSES: Readonly<Set<TaskStatus>> = new Set([
  TaskStatus.Success,
  TaskStatus.Failure,
  TaskStatus.Canceled,
  TaskStatus.Stuck,
]);

/** Specification used to register a task, without running it. */
export interface TaskSpec<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> {
  /** Unique task id. Re-registering an existing id throws. */
  id: string;
  /** Human-readable name; falls back to `id`. */
  name?: string;
  /** Lower = higher precedence. Defaults to 0. */
  priority?: number;
  /** Max execution attempts (handler re-invocations). Must be >= 1. */
  maxAttempts?: number;
  /** Relative delay before the task becomes due. Defaults to 0. */
  delay?: number;
  /** Absolute due epoch-ms; overrides `delay`. Defaults to 0 (run asap). */
  dueAt?: number;
  /** Hard dependency ids — all must reach Success before this runs. */
  deps?: readonly string[];
  /** Soft dependency ids — failure causes this task to be SKIPPED. */
  softDeps?: readonly string[];
  /** The work to run. Receives `args`. May return a promise. */
  handler: (args: TArgs) => TReturn | Promise<TReturn>;
  /** Arguments forwarded to the handler. Defaults to `[]`. */
  args?: TArgs;
}

/**
 * Live, mutable task object held by the scheduler. Consumers are handed
 * {@link PublicTask} snapshots via {@link Scheduler.get}; the live `Task` is
 * mutable because the scheduler owns it and must re-key it in place after
 * dynamic updates. Timestamp fields are owner-written (no `readonly`).
 */
export interface Task<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> {
  readonly id: string;
  readonly name: string;
  status: TaskStatus;
  priority: number;
  maxAttempts: number;
  attempts: number;
  /** Epoch-ms at which this task becomes due (dynamic, recomputed per run). */
  dueAt: number;
  /** Relative delay applied when the task has no active hard deps. */
  delay: number;
  /** Absolute due override, if any (else -1). */
  absoluteDue: number;
  /** Hard dependency ids. */
  deps: string[];
  /** Soft dependency ids. */
  softDeps: readonly string[];
  /** Dependency ids that have been superseded by a dynamic update. */
  staleDeps: string[];
  /** The work to run. Receives `args`. */
  handler: (args: TArgs) => TReturn | Promise<TReturn>;
  /** Arguments forwarded to the handler (overridable). */
  args?: TArgs;
  /** Last successful return value, if any. */
  result?: TReturn;
  /** Error thrown by the handler, if any. */
  error?: unknown;
  /** Monotonic execution count for readiness/timing stats. */
  executions: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Why the task was skipped (soft-dep failure), if any. */
  skippedReason?: string;
}

/** Immutable snapshot returned by {@link Scheduler.get}. */
export interface PublicTask<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus;
  readonly priority: number;
  readonly attempts: number;
  readonly dueAt: number;
  readonly deps: readonly string[];
  readonly softDeps: readonly string[];
  readonly finishedAt: number | null;
  readonly result?: TReturn;
}

/** Single-task run result. */
export interface TaskOutcome<TReturn = unknown> {
  taskId: string;
  attempt: number;
  status: TaskStatus;
  result?: TReturn;
  error?: unknown;
  startedAt: number;
  finishedAt: number;
  skippedReason?: string;
}

/** Result of a drain run. */
export interface RunOutcome {
  /** Monotonic id for this run, unique within the scheduler. */
  id: string;
  startedAt: number;
  finishedAt: number;
  /** Tasks executed (in execution order). */
  executed: TaskOutcome[];
  /** Tasks faulted (never executed) and why. */
  stuck: Array<{ taskId: string; reason: string; blockedBy?: string }>;
}

/** Per-status counters for observability. */
export interface Stats<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> {
  total: number;
  byStatus: Record<TaskStatus, number>;
  running: number;
  ready: number;
  pending: number;
  stuck: number;
  skipped: number;
  /** Tasks with no errors, in execution order. */
  succeeded: string[];
}

/** Subscription event. */
export enum SchedulerEvent {
  TaskStarted = 'TaskStarted',
  TaskCompleted = 'TaskCompleted',
  TaskFailed = 'TaskFailed',
  TaskSkipped = 'TaskSkipped',
  TaskCanceled = 'TaskCanceled',
  TaskStuck = 'TaskStuck',
}

/** A subscription callback receives (taskId, event). */
export type TaskEventHandler = (taskId: string, event: SchedulerEvent) => void;
