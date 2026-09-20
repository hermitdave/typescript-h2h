/**
 * Type definitions for the In-Memory Task Scheduler.
 *
 * Supports:
 *  - Priorities (lower number = higher priority)
 *  - Execution timestamps (ISO 8601 or epoch ms)
 *  - Dependency tracking (DAG-based)
 *  - Dynamic updates (update, cancel, remove)
 */

// ─── Task States ──────────────────────────────────────────────────────────────

export type TaskState =
  | 'pending'      // registered, waiting for dependencies to complete
  | 'ready'        // dependencies met, waiting for executeAt time
  | 'running'      // currently executing
  | 'completed'    // finished execution
  | 'failed'       // execution raised an unhandled error
  | 'cancelled';   // manually cancelled by caller

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface Task<Context = unknown> {
  /** Unique task identifier */
  id: string;

  /** Callback executed when task is run. Receives context + resolve/reject. */
  handler: (
    ctx: Context,
    meta: ExecutionMeta,
  ) => Promise<unknown> | unknown;

  /** Absolute priority. Lower number → higher priority. Default: 0 */
  priority: number;

  /** Earliest time this task should execute (ISO 8601 string or epoch ms).
   *  If null, task is eligible immediately once dependencies are met. */
  executeAt: Date | null;

  /** Millisecond epoch of `executeAt`, precomputed for fast comparisons */
  executeAtEpoch: number | null;

  /** IDs of tasks that MUST complete before this task becomes ready */
  dependencies: string[];

  /** Arbitrary user context passed to the handler */
  context: Context;

  /** Current lifecycle state */
  state: TaskState;

  /** Timestamp when the task was registered */
  createdAt: Date;

  /** Timestamp when the task entered its current state */
  stateChangedAt: Date;

  /** Number of times this task has been retried */
  retryCount: number;

  /** Unique monotonic version number for stale-entry detection */
  version: number;

  /** Set to true when the task has been cancelled */
  cancelled: boolean;

  /** Arbitrary user metadata attached to the task */
  metadata: Record<string, unknown>;

  /** Error thrown during execution, if any */
  error: Error | null;
}

// ─── Execution Metadata ───────────────────────────────────────────────────────

export interface ExecutionMeta {
  /** When execution started (milliseconds since epoch) */
  startedAt: number;

  /** Wall-clock ISO string when execution started */
  startedAtIso: string;
}

// ─── Scheduler Options ────────────────────────────────────────────────────────

export interface TaskSchedulerOptions {
  /** Maximum task count before `addTask` throws. Default: 1_000_000 */
  maxTasks?: number;

  /** Initial heap capacity. Default: 256 */
  initialHeapCapacity?: number;
}

// ─── Scheduler Stats ──────────────────────────────────────────────────────────

export interface SchedulerStats {
  /** Total tasks registered (including completed / failed / cancelled) */
  totalTasks: number;

  /** Tasks in each state */
  stateCounts: Record<TaskState, number>;

  /** Total dependency edges in the graph */
  totalDependencyEdges: number;

  /** Number of stale heap entries waiting to be lazily cleaned */
  staleEntries: number;
}

// ─── Scheduler Error ──────────────────────────────────────────────────────────

export interface SchedulerErrorDetail {
  taskId?: string;
  code: string;
  message: string;
}

export class TaskSchedulerError extends Error {
  public readonly code: string;
  public readonly taskId?: string;

  constructor(detail: SchedulerErrorDetail) {
    super(detail.message);
    this.name = 'TaskSchedulerError';
    this.code = detail.code;
    this.taskId = detail.taskId;
  }

  static DuplicateTask(taskId: string): TaskSchedulerError {
    return new TaskSchedulerError({
      taskId,
      code: 'DUPLICATE_TASK',
      message: `Task with id "${taskId}" is already registered`,
    });
  }

  static MissingDependency(taskId: string, missingId: string): TaskSchedulerError {
    return new TaskSchedulerError({
      taskId,
      code: 'MISSING_DEPENDENCY',
      message: `Task "${taskId}" depends on "${missingId}" which is not registered`,
    });
  }

  static CycleDetected(taskId: string, cyclePath: string[]): TaskSchedulerError {
    return new TaskSchedulerError({
      taskId,
      code: 'CYCLE_DETECTED',
      message: `Adding task "${taskId}" would create a cycle: ${cyclePath.join(' → ')}`,
    });
  }

  static TaskNotFound(taskId: string, operation: string): TaskSchedulerError {
    return new TaskSchedulerError({
      taskId,
      code: 'TASK_NOT_FOUND',
      message: `Cannot ${operation}: task "${taskId}" not found`,
    });
  }

  static InvalidStateTransition(taskId: string, from: TaskState, to: TaskState): TaskSchedulerError {
    return new TaskSchedulerError({
      taskId,
      code: 'INVALID_STATE_TRANSITION',
      message: `Task "${taskId}" cannot transition from "${from}" to "${to}"`,
    });
  }

  static MaxTasksReached(current: number, max: number): TaskSchedulerError {
    return new TaskSchedulerError({
      code: 'MAX_TASKS_REACHED',
      message: `Cannot add more tasks: limit ${max} reached (${current} currently registered)`,
    });
  }

  static MaxHeapExhausted(taskId: string): TaskSchedulerError {
    return new TaskSchedulerError({
      taskId,
      code: 'MAX_HEAP_EXHAUSTED',
      message: `Task "${taskId}" is not in a state that allows execution. It may have been cancelled or already executed.`,
    });
  }
}

// ─── Add Task Input ───────────────────────────────────────────────────────────

export interface AddTaskInput<Context = unknown> {
  id: string;
  handler: Task<Context>['handler'];
  priority?: number;
  executeAt?: string | Date | number | null;
  dependencies?: string[];
  context?: Context;
  metadata?: Record<string, unknown>;
  retryCount?: number;
}

// ─── Update Task Input ────────────────────────────────────────────────────────

export interface UpdateTaskInput {
  priority?: number;
  executeAt?: string | Date | number | null;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Next Task Result ─────────────────────────────────────────────────────────

export interface NextTaskResult {
  task: Task;
  waitingMs: number; // milliseconds until execution, negative if overdue
}
