/**
 * Public types for the in-memory task scheduler.
 */

export type TaskId = string;

export type TaskStatus = "pending" | "completed" | "cancelled";

/**
 * A snapshot of a task as returned to callers. The scheduler's internals
 * (live heap slots, reverse index, seq, etc.) are never exposed.
 */
export interface TaskSnapshot {
  /** Stable unique identifier assigned by the scheduler or provided by the caller. */
  id: TaskId;
  /** Caller-supplied name; omit for unnamed tasks. */
  name?: string;
  /** Lower numeric priority executes sooner. */
  priority: number;
  /** Epoch ms at which the task is (or was) eligible for execution. */
  dueTime: number;
  /** Lifecycle state. */
  status: TaskStatus;
  /** Epoch ms when the task was queued. */
  createdAt: number;
  /** Epoch ms when the task was removed from the queue via getNextTask(). */
  pickedAt: number | null;
  /** Epoch ms when the task was completed. */
  completedAt: number | null;
  /** Remaining unmet prerequisites; 0 for executable tasks. */
  dependencyCount: number;
  /** Total number of prerequisites registered. */
  totalDependencies: number;
  /** Number of tasks that depend on this one. */
  dependentsCount: number;
  /** Opaque failure payload, returned unchanged on snapshots. */
  data?: unknown;
}

/** Options accepted by {@link TaskScheduler.addTask}. */
export interface AddTaskOptions {
  id?: TaskId;
  name?: string;
  /** Lower numeric priority executes sooner. Defaults to the scheduler defaultPriority. */
  priority?: number;
  /** Earliest execution timestamp (epoch ms or Date). Defaults to Infinity = immediately. */
  dueTime?: number | Date;
  /** Prerequisite task ids; defaults to none (immediately executable). */
  dependencies?: readonly TaskId[];
  /** Opaque payload, echoed in snapshots. */
  data?: unknown;
}

/** Runtime telemetry, exported via {@link TaskScheduler.getMetrics}. */
export interface SchedulerMetrics {
  /** Tasks ever added to the scheduler. */
  created: number;
  /** All tasks currently held (pending + completed + cancelled). */
  total: number;
  /** Pending tasks with 0 unmet dependencies (queued in the heap). */
  executable: number;
  /** Pending tasks blocked on unfinished prerequisites. */
  blocked: number;
  /** All pending tasks (executable + blocked). */
  pending: number;
  /** Completed tasks. */
  completed: number;
  /** Cancelled tasks. */
  cancelled: number;
  /** Priority/timestamp updates applied since insertion. */
  updatesApplied: number;
}

/** Options accepted by the {@link TaskScheduler} constructor. */
export interface TaskSchedulerOptions {
  /** Default priority when addTask omits one. */
  defaultPriority?: number;
  /** Allow addDependency on a task id that does not exist yet. Defaults to false. */
  autoCreateMissing?: boolean;
  /** Max in-flight completions; 1 = cooperative pull-based polling. Defaults to 1. */
  maxWorkers?: number;
}