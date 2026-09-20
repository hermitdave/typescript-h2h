/**
 * Public task model used by {@link TaskScheduler}.
 */

/**
 * A task identifier. Strings are recommended for readability; numbers work too.
 * Internally ids are interned to strings for heap bookkeeping.
 */
export type TaskId = string | number;

/**
 * Lifecycle states of a task.
 *
 * - `PENDING`   submitted, at least one dependency is still outstanding
 * - `WAITING`   dependencies satisfied, but `runAt` is in the future (in the time heap)
 * - `READY`     dependencies satisfied and `runAt` due (in the ready heap)
 * - `RUNNING`   dispatched to the caller via `runNext`/`run`, awaiting `complete`
 * - `DONE`      finished (completed or run to completion)
 * - `CANCELLED` cancelled (possibly cascaded from an ancestor)
 */
export enum TaskState {
  PENDING = 'PENDING',
  WAITING = 'WAITING',
  READY = 'READY',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

/**
 * Input shape for registering a task.
 *
 * @typeParam D  payload/result type carried by the task.
 */
export interface TaskSpec<D = unknown> {
  /** Unique task id. Must not collide with an existing task. */
  id: TaskId;
  /**
   * Priority. Higher number == more urgent. Default `0`.
   * Ties among runnable tasks are broken by earliest `runAt`, then by
   * insertion order (FIFO) for determinism.
   */
  priority?: number;
  /**
   * Earliest time at which the task becomes executable, in epoch milliseconds.
   * Defaults to the scheduler's current time when the task is added.
   */
  runAt?: number;
  /**
   * Dependencies that must reach `DONE` before this task becomes runnable.
   * Every referenced id must already be registered (use {@link TaskScheduler.addDependency}
   * to add edges later, or register the dependency first). Self-dependencies are rejected.
   */
  deps?: TaskId[];
  /** Arbitrary user payload. */
  payload?: D;
}

/**
 * The task object stored by the scheduler (a {@link TaskSpec} plus internal bookkeeping).
 */
export interface Task<D = unknown> extends TaskSpec<D> {
  priority: number;
  runAt: number;
  /** Internal: the set of dependency ids this task depends on. */
  deps: Set<TaskId>;
  state: TaskState;
  /** Internal: number of dependencies not yet completed. */
  remainingDeps: number;
  /** Internal: monotonic insertion sequence, used as a tie-breaker. */
  seq: number;
  /** Internal: creation timestamp (epoch ms). */
  createdAt: number;
  /** Set on completion (epoch ms). */
  completedAt?: number;
  /** Internal monotonic version counter, bumped on every structural update. */
  version: number;
  /** Result captured when the task completed. */
  result?: D;
}

/**
 * A partial update accepted by {@link TaskScheduler.update}.
 */
export interface TaskUpdate<D = unknown> {
  priority?: number;
  runAt?: number;
  payload?: D;
}
