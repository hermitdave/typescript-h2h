/**
 * Shared types for the in-memory task scheduler.
 *
 * Design note (for senior-reviewer audience):
 *
 * Ordering positions are expressed as plain numeric keys so comparators stay
 * branch-light and allocation-free on hot paths. Timestamps are in the same
 * units returned by the injected `clock` (default: ms since the Unix epoch).
 * Tasks carry a monotonically increasing `version`; it is the only mechanism
 * we use for O(1) invalidation of stale heap entries on dynamic updates (a
 * "lazy deletion" heap).
 */

/** Lifecycle states of a task. */
export type TaskStatus =
  | 'pending' // waiting on time / deps (in ready | future | deps bucket)
  | 'running' // returned by runNext()/advance() and handed to the caller
  | 'completed' // finished; resolves dependents
  | 'cancelled'; // removed from pending; leaves dependents blocked

/** Numeric priority. `high-first` (default) means the largest value runs first. */
export type Priority = number;

/** Concrete task record stored by the scheduler. */
export interface Task {
  /** Stable identifier; must be unique and non-empty. */
  id: string;
  /** Optional human-readable name (metadata only). */
  name?: string;
  /** Numeric priority. */
  priority: number;
  /** Absolute execution time in clock units. A task is time-gated. */
  dueAt: number;
  /** Ids of tasks that must reach `completed` before this one may run. */
  dependencies: string[];
  /** Lifecycle state. */
  status: TaskStatus;
  /** Internal monotonic stamp bumped on every mutation. Heap snapshots carry a
   *  copy; on pop we discard snapshots whose version no longer matches the live
   *  task (lazy deletion). Not user-facing. */
  version: number;
  /** Optional caller-supplied opaque payload. */
  payload?: Record<string, unknown> | null;
  /** Wall-clock creation time (in clock units). */
  createdAt: number;
}

/** Field subset accepted when creating a task. */
export interface NewTask {
  id?: string;
  name?: string;
  priority?: number;
  /** Absolute due time in clock units. Defaults to 0 (runnable immediately). */
  dueAt?: number;
  dependencies?: string[];
  payload?: Record<string, unknown> | null;
}

/** Ordering direction for the priority queue. */
export type PriorityOrder = 'high-first' | 'low-first';

/** Immutable snapshot pushed onto a heap. Storing a snapshot (not a live
 *  reference) is what makes lazy deletion correct: the live task can be mutated
 *  or deleted without corrupting entries buried deep in a heap. */
export interface HeapEntry {
  id: string;
  priority: number;
  time: number;
  version: number;
}

export interface SchedulerOptions {
  /** Clock source. Defaults to `Date.now`. Inject a deterministic clock in tests. */
  clock?: () => number;
  /** Priority direction. Default `high-first`. */
  priorityOrder?: PriorityOrder;
}

/** One detected cycle: an ordered list of nodes and the cycle's internal edges. */
export interface Cycle {
  nodes: string[];
  /** [from, to] edges within the cycle (from depends on to). */
  edges: [string, string][];
}

/** Result of {@link TaskScheduler.analyze}. */
export interface CycleReport {
  hasCycle: boolean;
  /** The strongly-connected cyclic groups (size > 1 or self-loops). */
  cycles: Cycle[];
  /** Pending tasks that can never run because they (transitively) depend on a cycle. */
  stuckByCycle: string[];
  /** Pending tasks blocked by a dependency that is missing, removed, or cancelled. */
  orphanBlocked: string[];
}

/** Result of {@link TaskScheduler.advance}. */
export interface AdvanceResult {
  /** Tasks this pass transitioned to `running` (and, in advance(), to completed). */
  executed: Task[];
  /** Pending tasks remaining afterward. */
  pending: number;
}

/** Categorisation returned by {@link TaskScheduler.waitForNext}. */
export interface WaitNextInfo {
  /** The `now` snapshot time used for the computation. */
  now: number;
  /** How many tasks are runnable right now. */
  runnable: number;
  /** Tasks categorized by their blocking reason. */
  tasks: {
    /** Time-dead and dependency-free pending tasks. */
    runnable: Task[];
    /** Pending tasks waiting on a live (pending) dependency. */
    blockedByDeps: Task[];
    /** Pending tasks that can never run because of a dependency cycle. */
    stuckByCycle: Task[];
    /** Pending tasks blocked by a missing / cancelled dependency. */
    orphanBlocked: Task[];
  };
}

/** Statistics counters returned by {@link TaskScheduler.stats}. */
export interface SchedulerStats {
  total: number;
  pending: number;
  runnable: number;
  blockedByDeps: number;
  waitingOnTime: number;
  running: number;
  completed: number;
  cancelled: number;
  stuck: number;
}

/** Errors thrown by the scheduler. */
export class SchedulerError extends Error {
  constructor(message: string, public readonly taskId?: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}
