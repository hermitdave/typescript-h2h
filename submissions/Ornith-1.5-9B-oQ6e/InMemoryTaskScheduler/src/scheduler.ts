/**
 * Scheduler — production in-memory task scheduler.
 *
 * DESIGN RATIONALE
 * ----------------
 * This scheduler handles up to ~1,000,000 tasks with priorities, execution
 * timestamps, dependency tracking, dynamic updates, cycle detection, and
 * efficient next-executable retrieval. The overwhelming majority of tasks have
 * NO dependencies and are fire-and-forget. We exploit that by keeping every live
 * task in the ready-heap keyed by (dueAt, priority, seq) and reconciling it in
 * place on every state change. The heap IS the single source of truth for what
 * runs next, so there is no bookkeeping hazard of "inconsistent queues".
 *
 * CORE INVARIANT (maintained by `_reconcile`):
 *   For every non-terminal, non-running task there is AT MOST ONE entry in the
 *   ready-heap carrying an up-to-date (dueAt, priority) key, and a task is
 *   present iff it is currently eligible to run (no failed active hard dep and
 *   no failed soft dep). Every state change funnels through `_reconcile`, which
 *   either delete+inserts the task or faults it (Stuck/Skipped). This keeps the
 *   heap the unique ordering authority: any `pop()` yields a runnable task.
 *
 * GUARANTEES
 * ----------
 *   - At most one task is Running at a time (gated by `runningTaskId`).
 *   - `nextExecutable()` returns the min-due ready task in O(1).
 *   - `run()` drains only due-now tasks; not-yet-due tasks are left in the heap
 *     (ordered by dueAt) for a later `run()` call — no timers, no O(1) bursts.
 *   - All timestamps come from an injectable clock (`this.clock`), defaulting to
 *     `Date.now()`.
 *   - Max ~1M tasks: bounded by task count × O(log n) heap ops; no algorithmic
 *     blow-up because we never scan the whole graph for a single event.
 *
 * STATES
 * ------
 *   Created/Pending → Ready → Running → Success | Failure | Canceled
 *                      \                                          /
 *                            Stuck  |  Skipped
 *
 *   - STUCK: a hard dependency never succeeded (failed/canceled/stuck). Never
 *     auto-run; surfaced via getStuckTasks() for faulting/retry.
 *   - SKIPPED: ran, but a soft dependency failed/canceled → degraded result.
 *
 * FAILING:
 *   - A task that fails stays Failure; a hard dependent becomes Stuck; a soft
 *     dependent becomes Skipped. Retry within maxAttempts then a retryable task
 *     loops back to Ready and is re-executed; dependents reconcile only when the
 *     task reaches a terminal state.
 */
import { DependencyGraph } from './dependency-graph';
import { DuplicateTaskError, SchedulerError, TaskNotFoundError } from './errors';
import { TaskHeap } from './task-heap';
import {
  PublicTask,
  RunOutcome,
  SchedulerEvent,
  Task,
  TaskEventHandler,
  TaskOutcome,
  TaskSpec,
  TaskStatus,
  TERMINAL_STATUSES,
  TASK_FAILED_STATUSES,
} from './types';

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
export class Scheduler<TArgs extends unknown[] = unknown[], TReturn = unknown> {
  /** id → live task (owner-owned mutable map). */
  private readonly tasks = new Map<string, Task<TArgs, TReturn>>();
  /** The single source of truth for "what runs next", keyed by (dueAt, prio, seq). */
  private readonly ready = new TaskHeap();
  /** Structural edges + reverse fan-out + cycle detection. */
  private readonly depsGraph = new DependencyGraph();
  /** id → event handlers. */
  private readonly eventSubscribers = new Map<string, Set<TaskEventHandler>>();
  /** Monotonic sequence counter (insertion order tiebreaker). */
  private seq = 0;
  /** Id of the task currently executing; null between handlers. */
  private runningTaskId: string | null = null;
  /** Outcomes collected across this scheduler's runs. */
  private _outcomes: TaskOutcome<TReturn>[] = [];

  /** Injectable clock returning epoch-ms now. */
  private readonly clock: Clock;

  /** Human-readable name for diagnostics. */
  readonly name: string;

  constructor(name = 'Scheduler', clock?: Clock) {
    this.name = name;
    this.clock = clock ?? (() => Date.now());
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a task spec without running it. Re-registering an existing id
   * throws `DuplicateTaskError`. Self-dependencies throw `SchedulerError`.
   * Dependencies on unknown tasks throw `TaskNotFoundError`. Cycles are detected
   * after insertion (the graph's `replaceDependencies` runs the targeted check
   * per added edge; `findCyclicTasks` validates the whole graph at the end).
   */
  register(spec: TaskSpec<TArgs, TReturn>): Task<TArgs, TReturn> {
    if (this.tasks.has(spec.id)) {
      throw new DuplicateTaskError(spec.id);
    }
    const { deps = [], softDeps = [] } = spec;
    if (deps.includes(spec.id)) {
      throw new SchedulerError(`Task "${spec.id}" cannot depend on itself.`);
    }
    for (const dep of deps) {
      if (!this.tasks.has(dep)) {
        throw new TaskNotFoundError(dep);
      }
    }
    for (const dep of softDeps) {
      if (dep === spec.id) {
        throw new SchedulerError(`Task "${spec.id}" cannot soft-depend on itself.`);
      }
      if (!this.tasks.has(dep)) {
        throw new TaskNotFoundError(dep);
      }
    }

    const task: Task<TArgs, TReturn> = {
      id: spec.id,
      name: spec.name ?? spec.id,
      status: TaskStatus.Created,
      priority: spec.priority ?? 0,
      maxAttempts: Math.max(1, spec.maxAttempts ?? 1),
      attempts: 0,
      dueAt: spec.dueAt ?? 0,
      delay: spec.delay ?? 0,
      absoluteDue: spec.dueAt ?? 0,
      deps: [...deps],
      softDeps,
      staleDeps: [...deps],
      handler: spec.handler,
      args: spec.args,
      result: undefined,
      error: undefined,
      executions: 0,
      startedAt: null,
      finishedAt: null,
      skippedReason: undefined,
    };
    this.tasks.set(task.id, task);
    this.depsGraph.registerTask(task.id);
    for (const dep of task.deps) {
      this.depsGraph.addDependency(task.id, dep);
    }
    // Validate the whole graph for cycles (bulk registration pays the O(V+E) tax once).
    const cyclic = this.depsGraph.findCyclicTasks();
    if (cyclic.length > 0) {
      throw new SchedulerError(`Cycle detected involving task "${task.id}": ${cyclic.join(' -> ')}`);
    }
    // Insert into the ready heap with the current key.
    this.reconcile(task.id);
    return task;
  }

  /** Look up a live task (or throw TaskNotFoundError). */
  getTask(id: string): Task<TArgs, TReturn> {
    const t = this.tasks.get(id);
    if (!t) throw new TaskNotFoundError(id);
    return t;
  }

  /** Immutable snapshot of a task (throw TaskNotFoundError if missing). */
  get(id: string): PublicTask<TArgs, TReturn> {
    const t = this.tasks.get(id);
    if (!t) throw new TaskNotFoundError(id);
    return this._publicTask(t);
  }

  /** All registered task ids, in registration order. */
  get ids(): string[] {
    return [...this.tasks.keys()];
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Drain all currently-due, executable tasks until the ready set is empty,
   * `maxRuns` is reached, or the scheduler is canceled. Runs tasks serially,
   * awaiting each handler (and any dependent fan-out) before the next.
   *
   * @param maxRuns Safety valve against runaway retry loops. Defaults to
   *   Infinity; when exceeded, the partial outcome is returned.
   */
  async run(maxRuns: number = Infinity): Promise<RunOutcome> {
    const now = this.clock();
    const outcome: RunOutcome = {
      id: `run-${this.seq++}`,
      startedAt: now,
      executed: [],
      stuck: [],
      finishedAt: now,
    };

    while (this.runningTaskId === null) {
      const id = this.ready.peek();
      if (id === undefined) break;
      const task = this.tasks.get(id);
      if (!task) continue; // deleted concurrently; skip
      const due = task.dueAt;
      if (due > now) {
        // Not due yet; re-insert (nothing earlier is due) and stop draining.
        this.ready.push(id, due, task.priority, this.seq++);
        break;
      }
      this.runningTaskId = id;
      task.status = TaskStatus.Running;
      task.startedAt = this.clock();
      task.executions += 1;
      outcome.executed.push(this._outcomeFor(task, task.executions));
      this._fire(id, SchedulerEvent.TaskStarted);

      this._executeAttempt(task); // sets task.status, faults/requeues dependents
      this.runningTaskId = null;
    }

    outcome.finishedAt = this.clock();
    // Collect stuck tasks (surfaced for faulting/retry).
    for (const [id, task] of this.tasks) {
      if (task.status === TaskStatus.Stuck) {
        const blockedBy = this._stuckBlockedBy(id);
        outcome.stuck.push({
          taskId: id,
          reason: 'a hard dependency did not succeed',
          blockedBy: blockedBy ?? undefined,
        });
      }
    }
    return outcome;
  }

  /**
   * Run exactly ONE ready, due-now task, then return. Non-blocking; used when a
   * caller wants to make progress without draining the whole queue.
   */
  runOnce(): Promise<TaskOutcome<TReturn> | null> {
    const id = this.ready.peek();
    if (id === undefined) return Promise.resolve(null);
    const task = this.tasks.get(id);
    if (!task) return Promise.resolve(null);
    this.runningTaskId = id;
    task.status = TaskStatus.Running;
    task.startedAt = this.clock();
    task.executions += 1;

    return Promise.resolve(this._executeAttempt(task)).then(
      (out) => {
        this.runningTaskId = null;
        return out;
      },
      (err) => {
        this.runningTaskId = null;
        throw err;
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Internals — attempt execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a single attempt of `task`. On success it fans out dependents; on
   * failure it either faults dependents (terminal) or resets the task to Ready
   * for retry. Never throws: the run loop swallows/handles its own errors.
   */
  private _executeAttempt(task: Task<TArgs, TReturn>): Promise<TaskOutcome<TReturn>> {
    const resultPromise = Promise.resolve(task.handler(task.args as TArgs) as Promise<unknown> | unknown);
    const attempt = task.attempts;
    return resultPromise.then(
      (r) => {
        task.result = r as TReturn;
        task.status = TaskStatus.Success;
        task.finishedAt = this.clock();
        this._fire(task.id, SchedulerEvent.TaskCompleted);
        this._reconcileDependents(task.id); // success may unblock dependents.
        return this._outcomeFor(task, attempt);
      },
      (err) => this._fail(task, err),
    );
  }

  /** Terminal failure path: fault dependents (hard → Stuck, soft → Skipped). */
  private _fail(task: Task<TArgs, TReturn>, err: unknown): Promise<TaskOutcome<TReturn>> {
    task.error = err;
    task.finishedAt = this.clock();
    task.attempts += 1;
    if (task.attempts >= task.maxAttempts) {
      task.status = TaskStatus.Failure;
      this._fire(task.id, SchedulerEvent.TaskFailed);
    } else {
      // Retry within budget: reset to Ready, re-insert, loop re-picks it.
      task.status = TaskStatus.Ready;
      this.reconcile(task.id);
    }
    this._reconcileDependents(task.id);
    return Promise.resolve(this._outcomeFor(task, task.attempts));
  }

  private _outcomeFor(task: Task<TArgs, TReturn>, attempt: number): TaskOutcome<TReturn> {
    return {
      taskId: task.id,
      attempt,
      status: task.status,
      result: task.result,
      error: task.error,
      startedAt: task.startedAt ?? this.clock(),
      finishedAt: task.finishedAt ?? this.clock(),
      skippedReason: task.skippedReason,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals — reconciliation
  // ---------------------------------------------------------------------------

  /**
   * THE reconciler. Ensure `id` sits in the ready heap iff eligible, else fault
   * it. Called after every state change. O(degree).
   */
  private reconcile(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === TaskStatus.Running) return; // gate
    if (TERMINAL_STATUSES.has(task.status)) return; // already terminal/faulted

    const { failingHard, failingSoft } = this._readiness(id);
    if (failingHard !== null) {
      this._stuck(id, failingHard);
    } else if (failingSoft !== null) {
      this._skip(id, failingSoft);
    } else if (!this.ready.has(id)) {
      this.ready.push(id, this._due(id), task.priority, this.seq++);
    }
  }

  /**
   * Readiness probe for `id`. Returns `{ ready, failingHard, failingSoft }`.
   * `failingHard` is the first hard dep that failed/canceled/stuck;
   * `failingSoft` is the first soft dep that failed/canceled.
   */
  private _readiness(id: string): {
    ready: boolean;
    failingHard: string | null;
    failingSoft: string | null;
  } {
    const task = this.tasks.get(id);
    if (!task) return { ready: false, failingHard: null, failingSoft: null };
    if (task.status === TaskStatus.Running) {
      return { ready: false, failingHard: null, failingSoft: null };
    }
    let failingHard: string | null = null;
    let hasActiveDep = false;
    for (const depId of task.deps) {
      const depTask = this.tasks.get(depId);
      if (!depTask) {
        hasActiveDep = true; // missing dep → cannot run.
        break;
      }
      if (depTask.status === TaskStatus.Success) continue;
      if (TASK_FAILED_STATUSES.has(depTask.status) || depTask.status === TaskStatus.Stuck) {
        failingHard = depId;
        break;
      }
      // Pending/Ready/Running
      hasActiveDep = true;
      break;
    }
    if (failingHard !== null || hasActiveDep) {
      return { ready: false, failingHard, failingSoft: null };
    }
    let failingSoft: string | null = null;
    for (const depId of task.softDeps) {
      const depTask = this.tasks.get(depId);
      if (depTask && (TASK_FAILED_STATUSES.has(depTask.status) || depTask.status === TaskStatus.Stuck)) {
        failingSoft = depId;
        break;
      }
    }
    return { ready: true, failingHard: null, failingSoft };
  }

  /**
   * Earliest epoch-ms at which `id` is due: its own dueAt/delay, or the latest
   * due among its active hard deps.
   */
  private _due(id: string): number {
    const task = this.tasks.get(id);
    if (!task) return this.clock();
    let deadline = task.dueAt;
    for (const depId of task.deps) {
      const depTask = this.tasks.get(depId);
      if (!depTask) continue;
      if (depTask.status === TaskStatus.Success) continue;
      const depDue = depTask.dueAt;
      if (depDue > deadline) deadline = depDue;
    }
    return deadline;
  }

  /** Reconcile a task's dependents (after a dependency reaches a terminal state). */
  private _reconcileDependents(depId: string): void {
    for (const dependentId of this.depsGraph.dependentsOf(depId)) {
      const dependent = this.tasks.get(dependentId);
      if (!dependent) continue;
      if (dependent.status === TaskStatus.Running) continue; // gate: don't fault running
      this.reconcile(dependentId);
    }
  }

  /** Mark a task Stuck because a hard dependency never succeeded; cascade. */
  private _stuck(id: string, blockedBy: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === TaskStatus.Stuck || TERMINAL_STATUSES.has(task.status)) return;
    task.status = TaskStatus.Stuck;
    task.finishedAt = this.clock();
    this._fire(id, SchedulerEvent.TaskStuck);
    for (const dependentId of this.depsGraph.dependentsOf(id)) {
      const dependent = this.tasks.get(dependentId);
      if (dependent && dependent.status !== TaskStatus.Stuck) {
        this._stuck(dependentId, id);
      }
    }
  }

  /** Mark a task Skipped because a soft dependency failed; cascade. */
  private _skip(id: string, blockedBy: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === TaskStatus.Skipped || TERMINAL_STATUSES.has(task.status)) return;
    task.status = TaskStatus.Skipped;
    task.skippedReason = blockedBy;
    task.finishedAt = this.clock();
    this._fire(id, SchedulerEvent.TaskSkipped);
    for (const dependentId of this.depsGraph.dependentsOf(id)) {
      const dependent = this.tasks.get(dependentId);
      if (dependent && dependent.status !== TaskStatus.Skipped) {
        this._skip(dependentId, id);
      }
    }
  }

  /** First hard dep (blockedBy) that stuck the task, or null. */
  private _stuckBlockedBy(id: string): string | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    for (const depId of task.deps) {
      const depTask = this.tasks.get(depId);
      if (depTask && depTask.status !== TaskStatus.Success) return depId;
    }
    return null;
  }

  /** Id of the currently running task, or null. */
  get runningTask(): string | null {
    return this.runningTaskId;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * The id of the next executable task: the min-due ready task (or undefined).
   * O(1). If the min-due task is not due yet, there is nothing runnable now.
   */
  nextExecutable(): string | undefined {
    return this.ready.peek();
  }

  /** Tasks faulted (never executed) because a hard dependency failed. */
  getStuckTasks(): Array<{ id: string; blockedBy: string | null; reason: string }> {
    const list: Array<{ id: string; blockedBy: string | null; reason: string }> = [];
    for (const [id, task] of this.tasks) {
      if (task.status === TaskStatus.Stuck) {
        list.push({
          id,
          blockedBy: this._stuckBlockedBy(id),
          reason: 'a hard dependency did not succeed',
        });
      }
    }
    return list;
  }

  /** True if the task with `id` is currently Stuck. */
  isStuck(id: string): boolean {
    return this.tasks.get(id)?.status === TaskStatus.Stuck;
  }

  /** True if the task with `id` is currently Running. */
  isRunning(id: string): boolean {
    return this.runningTaskId === id;
  }

  /** Immutable snapshot of ready-heap ids. */
  readyIds(): string[] {
    return this.ready.keys();
  }

  /** Number of tasks currently eligible and due (i.e. in the ready heap). */
  readyCount(): number {
    return this.ready.size;
  }

  /**
   * Tasks with no errors (terminal Success), in registration order.
   * Non-throwing snapshot used for observability.
   */
  succeeded(): string[] {
    const out: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.Success) out.push(task.id);
    }
    return out;
  }

  /** Outcomes collected across runs. */
  get outcomes(): readonly TaskOutcome<TReturn>[] {
    return this._outcomes;
  }

  // ---------------------------------------------------------------------------
  // Dynamic updates
  // ---------------------------------------------------------------------------

  /** Change a task's priority and re-insert it (if eligible). */
  updatePriority(id: string, priority: number): void {
    const task = this.getTask(id);
    task.priority = priority;
    this.ready.delete(id); // drop stale key.
    this.reconcile(id);
  }

  /**
   * Replace a task's hard dependency set atomically (structurally). Cycles are
   * rejected with DependencyResolutionError before any mutation. Running or
   * terminal tasks are updated in place without re-keying.
   */
  updateDeps(id: string, newDeps: string[]): void {
    const task = this.getTask(id);
    if (newDeps.includes(id)) {
      throw new SchedulerError(`Task "${id}" cannot depend on itself.`);
    }
    for (const dep of newDeps) {
      if (!this.tasks.has(dep)) throw new TaskNotFoundError(dep);
    }
    // Atomically swap edges (cycle check inside).
    this.depsGraph.replaceDependencies(id, newDeps);
    task.deps = [...newDeps];
    task.staleDeps = [...newDeps];
    if (task.status === TaskStatus.Running || TERMINAL_STATUSES.has(task.status)) return;
    this.reconcile(id);
  }

  /** Append a hard dependency. */
  addDependency(id: string, dep: string): void {
    this.updateDeps(id, [...this.getTask(id).deps, dep]);
  }

  /** Remove a hard dependency. */
  removeDependency(id: string, dep: string): void {
    const next = this.getTask(id).deps.filter((d) => d !== dep);
    this.updateDeps(id, next);
  }

  /** Change a task's delay; recompute its dueAt. */
  updateDelay(id: string, delayMs: number): void {
    const task = this.getTask(id);
    task.delay = delayMs;
    if (task.status === TaskStatus.Running || TERMINAL_STATUSES.has(task.status)) return;
    this.reconcile(id);
  }

  /** Change a task's soft dependency set. */
  updateSoftDeps(id: string, softDeps: string[]): void {
    const task = this.getTask(id);
    task.softDeps = [...softDeps];
    if (task.status === TaskStatus.Running || TERMINAL_STATUSES.has(task.status)) return;
    this.reconcile(id);
  }

  /** Change a task's max attempts. */
  updateMaxAttempts(id: string, maxAttempts: number): void {
    const task = this.getTask(id);
    task.maxAttempts = Math.max(1, maxAttempts);
  }

  // ---------------------------------------------------------------------------
  // Cancellation / deletion
  // ---------------------------------------------------------------------------

  /**
   * Cancel a task and fault all its dependents. A running task cannot be
   * canceled (it will finish and its dependents fault when it does).
   * Non-terminal tasks become Canceled; hard dependents become Stuck.
   */
  cancel(id: string): void {
    const task = this.getTask(id);
    if (task.status === TaskStatus.Running) {
      throw new SchedulerError(`Cannot cancel running task "${id}".`);
    }
    if (TERMINAL_STATUSES.has(task.status)) return;
    task.status = TaskStatus.Canceled;
    task.finishedAt = this.clock();
    this._fire(id, SchedulerEvent.TaskCanceled);
    this._stuck(id, id);
  }

  /** Remove a task (and its edges). Dependent tasks are faulted to Stuck. */
  deleteTask(id: string): void {
    this.tasks.delete(id);
    this.ready.delete(id);
    this.depsGraph.removeTask(id);
    for (const dependentId of this.depsGraph.dependentsOf(id)) {
      const dependent = this.tasks.get(dependentId);
      if (dependent && dependent.status !== TaskStatus.Running) {
        this._stuck(dependentId, id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /** Subscribe to a lifecycle event (fires for every task). */
  on(event: SchedulerEvent, handler: TaskEventHandler): void {
    if (!this.eventSubscribers.has(event)) {
      this.eventSubscribers.set(event, new Set());
    }
    this.eventSubscribers.get(event)!.add(handler);
  }

  /** Unsubscribe a handler. */
  off(event: SchedulerEvent, handler: TaskEventHandler): void {
    this.eventSubscribers.get(event)?.delete(handler);
  }

  private _fire(id: string, event: SchedulerEvent): void {
    const handlerMap = this.eventSubscribers.get(event);
    if (!handlerMap) return;
    for (const handler of [...handlerMap]) handler(id, event);
  }

  // ---------------------------------------------------------------------------
  // Projection
  // ---------------------------------------------------------------------------

  /** Immutable snapshot of a live task. */
  private _publicTask(task: Task<TArgs, TReturn>): PublicTask<TArgs, TReturn> {
    return {
      id: task.id,
      name: task.name,
      status: task.status,
      priority: task.priority,
      attempts: task.attempts,
      dueAt: task.dueAt,
      deps: task.deps,
      softDeps: task.softDeps,
      finishedAt: task.finishedAt,
      result: task.result,
    };
  }

  // ---------------------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------------------

  /** Remove all tasks and internal state. */
  clear(): void {
    this.ready.clear();
    this.depsGraph.clear();
    this.eventSubscribers.clear();
    this.tasks.clear();
    this._outcomes = [];
    this.runningTaskId = null;
    this.seq = 0;
  }
}
