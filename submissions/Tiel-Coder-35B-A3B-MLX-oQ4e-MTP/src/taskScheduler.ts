/**
 * TaskScheduler — an in-memory, priority-aware task scheduler supporting ~1M
 * tasks with priorities, execution timestamps, dependency tracking, dynamic
 * updates, cycle detection, and O(log n) retrieval of the next runnable task.
 *
 * ## Data structures
 *
 * Everything is keyed by an interned id (a stable `String`). Two binary heaps
 * (index-backed so `remove` and key-updates are O(log n)) plus one authoritative
 * map:
 *
 *  - `tasks`      Map<internedId, Task> — the ground truth of every tracked task.
 *  - `readyHeap`  BinaryHeap ordered by priority (desc), runAt (asc), seq (asc).
 *                 Holds tasks that are runnable AND due. This is the source of
 *                 truth for "what runs next".
 *  - `timeHeap`   BinaryHeap ordered by runAt (asc), seq (asc). Holds tasks that
 *                 are runnable but whose `runAt` is still in the future. Drives
 *                 time-based readiness.
 *  - `waiters`    Map<internedDepId, Set<internedTaskId>> — reverse index: who
 *                 is waiting on a given dependency. Enables O(k log n) re-evaluation
 *                 when a dependency completes.
 *
 * ## State machine
 *
 * A task lives in exactly one place:
 *
 *  - `PENDING`    blocked on outstanding dependencies → in no heap.
 *  - `WAITING`    dependencies satisfied, `runAt` in future → in `timeHeap` only.
 *  - `READY`      dependencies satisfied and `runAt` due → in `readyHeap` only.
 *  - `RUNNING`    dispatched to the caller → in no heap.
 *  - `DONE`/`CANCELLED` → in no heap.
 *
 * Membership is reconciled reactively: every structural change calls exactly one
 * of `markReady/markWaiting/markPending/markRunning`, which performs the two
 * heap operations the transition requires. Because a task's heap is fully
 * determined by its state, no separate "location" bookkeeping is needed.
 *
 * ## Complexity
 *
 *  - `add` / `remove`:      O(k log n) — k = number of dependency edges touched.
 *  - `addDependency`:       O(V + E) worst-case (cycle detection is a reachability
 *                            walk); heap bookkeeping is O(log n).
 *  - `complete`:            O(k log n) — k = dependents of the completed task.
 *  - `update`:              O(log n) (heap re-key on one task).
 *  - `runNext` / `peek`:    O(log n) / O(1).
 *
 * @typeParam D  payload/result type carried by tasks.
 */

import { BinaryHeap } from './binaryHeap.js';
import { intern, unintern } from './intern.js';
import {
  DuplicateTaskError,
  InvalidArgumentError,
  InvalidTaskStateError,
  TaskSchedulerError,
  UnknownDependencyError,
} from './errors.js';
import {
  TaskState,
  Task,
  TaskId,
  TaskSpec,
  TaskUpdate,
} from './types.js';

interface HeapEntry {
  id: string;
  task: Task;
}

export interface TaskSchedulerOptions {
  /** Injectable clock in epoch ms. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable timer. Defaults to Node/browser `setTimeout`. */
  setTimeoutFn?: (fn: () => void, delay: number) => unknown;
  /** Cancelable timer handle. Defaults to `clearTimeout`. */
  clearTimeoutFn?: (handle: unknown) => void;
}

export class TaskScheduler<D = unknown> {
  private readonly tasks = new Map<string, Task<D>>();
  private readonly waiters = new Map<string, Set<string>>();

  private readonly timeHeap = new BinaryHeap<HeapEntry>((a, b) =>
    a.task.runAt === b.task.runAt ? a.task.seq - b.task.seq : a.task.runAt - b.task.runAt
  );
  private readonly readyHeap = new BinaryHeap<HeapEntry>((a, b) => {
    if (b.task.priority !== a.task.priority) return b.task.priority - a.task.priority;
    if (a.task.runAt !== b.task.runAt) return a.task.runAt - b.task.runAt;
    return a.task.seq - b.task.seq;
  });

  private clock: () => number;
  private readonly setTimeoutFn: (fn: () => void, delay: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly hasCustomClock: boolean;

  private timerScheduled = false;
  private timerHandle: unknown;

  private readonly seq = { current: 0 };

  constructor(options: TaskSchedulerOptions = {}) {
    this.hasCustomClock = options.now !== undefined;
    this.clock = options.now ?? Date.now;
    this.setTimeoutFn =
      options.setTimeoutFn ??
      ((fn: () => void, delay: number) => setTimeout(fn, delay)) as unknown;
    this.clearTimeoutFn =
      options.clearTimeoutFn ??
      ((handle: unknown) => clearTimeout(handle)) as unknown;
  }

  /** Clear the injectable clock/timer overrides (primarily for tests). */
  resetClock(): void {
    this.hasCustomClock = false;
    this.clock = Date.now;
    this.setTimeoutFn = ((fn: () => void, delay: number) =>
      setTimeout(fn, delay)) as unknown;
    this.clearTimeoutFn = ((handle: unknown) => clearTimeout(handle)) as unknown;
    this._clearTimer();
  }

  /** Total tracked tasks (including done/cancelled). */
  get size(): number {
    return this.tasks.size;
  }

  /** Tasks not yet done/cancelled (pending, waiting, ready, running). */
  get remaining(): number {
    let n = 0;
    for (const t of this.tasks.values()) {
      if (t.state !== TaskState.DONE && t.state !== TaskState.CANCELLED) n++;
    }
    return n;
  }

  /** Runnable-and-due tasks (readyHeap size). */
  get readyCount(): number {
    return this.readyHeap.size;
  }

  /**
   * Empty the scheduler. Returns the previous size. Detaches all heap entries and
   * dependency bookkeeping; does not touch the intern cache (kept across clears to
   * limit allocations under churn).
   */
  clear(): number {
    const n = this.tasks.size;
    this.tasks.clear();
    this.waiters.clear();
    this.timeHeap.clear();
    this.readyHeap.clear();
    this.timerScheduled = false;
    this.seq.current = 0;
    this._clearTimer();
    return n;
  }

  /**
   * Register and schedule a task. The single entry point for creating work.
   *
   * @throws {DuplicateTaskError}   if the id already exists
   * @throws {InvalidArgumentError} if id is missing, or priority/runAt is non-finite
   * @throws {UnknownDependencyError} if a dependency is not already registered
   */
  add(spec: TaskSpec<D>): Task<D> {
    if (spec === null || typeof spec !== 'object' || spec.id === undefined || spec.id === null) {
      throw new InvalidArgumentError('task spec with an id is required');
    }
    if (typeof spec.priority === 'number' && !Number.isFinite(spec.priority)) {
      throw new InvalidArgumentError('priority must be a finite number');
    }
    if (typeof spec.runAt === 'number' && !Number.isFinite(spec.runAt)) {
      throw new InvalidArgumentError('runAt must be a finite number');
    }

    const id = intern(spec.id);
    if (this.tasks.has(id)) {
      throw new DuplicateTaskError(`task with id "${String(spec.id)}" already exists`);
    }

    const runAt = typeof spec.runAt === 'number' ? spec.runAt : this.clock();
    const priority = typeof spec.priority === 'number' ? spec.priority : 0;
    const deps = Array.isArray(spec.deps) ? spec.deps : [];

    const task: Task<D> = {
      id: spec.id,
      runAt,
      priority,
      deps: [],
      payload: spec.payload,
      state: TaskState.PENDING,
      remainingDeps: 0,
      seq: this.seq.current++,
      createdAt: this.clock(),
      version: 0,
    };

    const blocking = new Set<string>();
    for (const depId of deps) {
      if (depId === spec.id) {
        throw new InvalidArgumentError('task cannot depend on itself');
      }
      const dep = intern(depId);
      if (!this.tasks.has(dep)) {
        throw new UnknownDependencyError(
          `dependency "${String(depId)}" is not registered; register it first or use addDependency later`
        );
      }
      if (dep === id) {
        throw new InvalidArgumentError('task cannot depend on itself');
      }
      blocking.add(dep);
      const set = this.waiters.get(dep) ?? new Set<string>();
      set.add(id);
      this.waiters.set(dep, set);
    }

    task.deps = [...blocking];
    task.remainingDeps = blocking.size;

    this.tasks.set(id, task);

    // A brand-new node has no incoming edges, so it cannot introduce a cycle.
    // (Cycle detection is required at `addDependency`, where edges are added.)

    if (blocking.size === 0) {
      if (runAt <= this.clock()) this._setReady(id);
      else this._setWaiting(id);
    } else {
      task.state = TaskState.PENDING; // no heap membership
    }

    this._updateTimer();
    return task;
  }

  /**
   * Add a dependency edge `taskId -> depId`. Both must already be registered.
   * Idempotent on the edge set; rejects self-edges and cycles.
   *
   * @throws {UnknownDependencyError} if `depId` is not registered
   * @throws {InvalidArgumentError} if the edge is a self-dependency
   */
  addDependency(taskId: TaskId, depId: TaskId): void {
    const id = intern(taskId);
    const dep = intern(depId);
    const task = this.tasks.get(id);
    if (!task) throw new UnknownDependencyError(`task "${String(taskId)}" is not registered`);
    if (!this.tasks.has(dep)) {
      throw new UnknownDependencyError(`dependency "${String(depId)}" is not registered`);
    }
    if (id === dep) throw new InvalidArgumentError('task cannot depend on itself');
    if (task.deps.includes(dep)) return; // idempotent

    // Cycle check: adding `task -> dep` closes a cycle iff `dep` can reach `task`
    // through existing dependency edges.
    if (this._wouldCycle(dep, id)) {
      throw new UnknownDependencyError(
        `adding dependency "${String(depId)}" to "${String(taskId)}" would create a cycle`
      );
    }

    task.deps.push(dep);
    task.remainingDeps += 1;
    const set = this.waiters.get(dep) ?? new Set<string>();
    set.add(id);
    this.waiters.set(dep, set);

    // Adding a blocker can only demote a runnable task to pending.
    if (task.state === TaskState.READY) this._setPending(id);
    else if (task.state === TaskState.WAITING) this._setPending(id);
    // If already RUNNING, it simply carries an extra blocker to completion.

    this._updateTimer();
  }

  /**
   * Update a task's mutable fields (priority, runAt, payload). Re-keys the task
   * in its heap so the change takes effect immediately.
   *
   * @throws {InvalidTaskStateError} if priority/runAt change is requested on a RUNNING task
   * @throws {InvalidArgumentError}  if priority/runAt is non-finite
   */
  update(taskId: TaskId, update: TaskUpdate<D>): void {
    const id = intern(taskId);
    const task = this.tasks.get(id);
    if (!task) throw new UnknownDependencyError(`task "${String(taskId)}" is not registered`);

    const wantsPriority = update.priority !== undefined;
    const wantsRunAt = update.runAt !== undefined;
    const wantsPayload = update.payload !== undefined;

    if (
      (wantsPriority && (typeof update.priority !== 'number' || !Number.isFinite(update.priority))) ||
      (wantsRunAt && (typeof update.runAt !== 'number' || !Number.isFinite(update.runAt)))
    ) {
      throw new InvalidArgumentError('priority/runAt must be a finite number');
    }
    if ((wantsPriority || wantsRunAt) && task.state === TaskState.RUNNING) {
      throw new InvalidTaskStateError('cannot update priority/runAt of a RUNNING task');
    }

    if (wantsPriority) task.priority = update.priority as number;
    if (wantsRunAt) {
      task.runAt = update.runAt as number;
      const due = task.runAt <= this.clock();
      // runAt changes may promote a WAITING task to READY or demote a READY
      // task back to WAITING; within the same state they only re-key the heap.
      if (task.state === TaskState.READY) {
        due ? this._setReady(id) : this._setWaiting(id);
      } else if (task.state === TaskState.WAITING) {
        due ? this._setReady(id) : this._setWaiting(id);
      }
      // PENDING/RUNNING/DONE/CANCELLED carry no heap membership; nothing to do.
    }
    if (wantsPriority && task.state === TaskState.READY) {
      // Re-key the ready heap so the priority change is reflected immediately.
      this._setReady(id);
    }
    if (wantsPayload) task.payload = update.payload;
    task.version++;

    this._updateTimer();
  }

  /**
   * Remove a task and detach it from the graph. Removing a task unblocks its
   * dependents (they lose this as a blocker), mirroring completion. Task must not
   * be RUNNING. Returns the removed task, or undefined if absent.
   *
   * @throws {InvalidTaskStateError} if the task is RUNNING
   */
  remove(taskId: TaskId): Task<D> | undefined {
    const id = intern(taskId);
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (task.state === TaskState.RUNNING) {
      throw new InvalidTaskStateError('cannot remove a RUNNING task; complete it first');
    }

    // Unblock dependents: treat removal like completion of this blocker.
    const waiters = this.waiters.get(id);
    if (waiters) {
      for (const waiterId of waiters) {
        const waiter = this.tasks.get(waiterId);
        if (!waiter) continue;
        const idx = waiter.deps.indexOf(id);
        if (idx !== -1) {
          waiter.deps.splice(idx, 1);
          waiter.remainingDeps -= 1;
        }
        if (waiter.state === TaskState.RUNNING) continue;
        if (waiter.remainingDeps === 0) {
          if (waiter.runAt <= this.clock()) this._setReady(waiterId);
          else this._setWaiting(waiterId);
        } else {
          this._setPending(waiterId);
        }
      }
      this.waiters.delete(id);
    }

    this._setPending(id); // detaches from both heaps
    this.tasks.delete(id);
    this._updateTimer();
    return task;
  }

  /**
   * Complete a RUNNING task with an optional result. Unblocks dependents, which
   * become READY (if due) or WAITING (if runAt is future). Returns the dependents
   * that became runnable directly as a result.
   *
   * @throws {InvalidTaskStateError} if the task is not RUNNING
   */
  complete(taskId: TaskId, result?: D): Task<D>[] {
    const id = intern(taskId);
    const task = this.tasks.get(id);
    if (!task) throw new UnknownDependencyError(`task "${String(taskId)}" is not registered`);
    if (task.state !== TaskState.RUNNING) {
      throw new InvalidTaskStateError(`task "${String(taskId)}" is not running (state: ${task.state})`);
    }

    task.state = TaskState.DONE;
    if (result !== undefined) task.result = result;
    task.completedAt = this.clock();

    const newlyRunnable: Task<D>[] = [];
    const waiters = this.waiters.get(id);
    if (waiters) {
      for (const waiterId of waiters) {
        const waiter = this.tasks.get(waiterId);
        if (!waiter) continue; // was detached
        const idx = waiter.deps.indexOf(id);
        if (idx !== -1) {
          waiter.deps.splice(idx, 1);
          waiter.remainingDeps -= 1;
        }
        if (waiter.state === TaskState.RUNNING) continue; // out-of-order ancestor still running
        if (waiter.remainingDeps === 0) {
          if (waiter.runAt <= this.clock()) {
            this._setReady(waiterId);
            newlyRunnable.push(waiter);
          } else {
            this._setWaiting(waiterId);
          }
        } else {
          this._setPending(waiterId);
        }
      }
    }

    this._updateTimer();
    return newlyRunnable;
  }

  /**
   * Cancel a task; cascades to all not-yet-DONE dependents (they cannot proceed
   * without the cancelled work). Returns the ids of every cancelled task
   * (including the target), as public ids.
   *
   * @throws {TaskSchedulerError} if the task is not registered
   */
  cancel(taskId: TaskId): TaskId[] {
    const id = intern(taskId);
    const task = this.tasks.get(id);
    if (!task) throw new TaskSchedulerError(`task "${String(taskId)}" is not registered`);
    if (task.state === TaskState.DONE) return [];

    const cancelled: string[] = [];
    const queue: string[] = [id];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const curTask = this.tasks.get(cur);
      if (!curTask || curTask.state === TaskState.DONE) continue;
      if (curTask.state !== TaskState.RUNNING) curTask.state = TaskState.CANCELLED;

      if (curTask.state === TaskState.RUNNING) continue; // cannot cascade from running

      const waiters = this.waiters.get(cur);
      if (waiters) {
        for (const w of waiters) queue.push(w);
      }
      cancelled.push(cur);
    }

    for (const c of cancelled) {
      // Cancelled tasks remain registered: callers look them up by public id,
      // and we only know interned strings. Detach them from the heaps and the
      // graph (so they are no longer dispatchable and can't complete dependents)
      // but keep the record visible in CANCELLED state. Do NOT delete it, and
      // do NOT call _setPending (it would clobber CANCELLED with PENDING).
      const waiter = this.tasks.get(c);
      if (waiter) {
        waiter.deps = [];
        waiter.remainingDeps = 0;
        waiter.state = TaskState.CANCELLED;
        this.timeHeap.remove(c);
        this.readyHeap.remove(c);
      }
      this.waiters.delete(c);
    }
    this._updateTimer();
    return cancelled.map((c) => unintern(c));
  }

  /**
   * Process tasks whose `runAt` is due. In production the scheduler invokes this
   * via a timer; use it in tests with a fake clock. Advances every WAITING task
   * whose runAt <= now into the ready heap.
   *
   * This is timer-neutral: it never schedules or reschedules the timer. That is
   * the sole responsibility of {@link TaskScheduler._updateTimer}, so the manual
   * `tick()` used in tests and by the auto-timer path cannot recurse.
   */
  tick(): void {
    const now = this.clock();
    while (this.timeHeap.size > 0) {
      const top = this.timeHeap.peek()!;
      if (top.task.runAt > now) break;
      const entry = this.timeHeap.pop()!;
      const task = this.tasks.get(entry.id)!;
      if (task.state !== TaskState.WAITING) continue; // stale entry (cancelled/removed)
      task.state = TaskState.READY;
      this.readyHeap.push(entry.id, entry);
    }
  }

  /** Next runnable task without mutating state (undefined if none runnable now). */
  next(): Task<D> | undefined {
    return this.readyHeap.peek()?.task;
  }

  /** Alias of {@link TaskScheduler.next}. */
  peek(): Task<D> | undefined {
    return this.next();
  }

  /**
   * Pop the next runnable task and mark it RUNNING. Return undefined if nothing
   * is runnable now. Pair with {@link TaskScheduler.complete}.
   */
  runNext(): Task<D> | undefined {
    const entry = this.readyHeap.pop();
    if (!entry) return undefined;
    const task = this.tasks.get(entry.id);
    if (!task) return undefined; // race safety
    task.state = TaskState.RUNNING;
    return task;
  }

  /** True if a task is runnable and due. */
  hasRunnable(): boolean {
    return this.readyHeap.size > 0;
  }

  /** Current state of a task (undefined if not registered). */
  getState(taskId: TaskId): TaskState | undefined {
    return this.tasks.get(intern(taskId))?.state;
  }

  /** Snapshot of a task (undefined if not registered). */
  get(taskId: TaskId): Task<D> | undefined {
    return this.tasks.get(intern(taskId));
  }

  /**
   * Serialize the schedule to JSON (ids are restored to their original type).
   * Useful for diagnostics and persistence previews.
   */
  toJSON(): unknown {
    const snapshot: Record<string, unknown> = {};
    for (const [id, task] of this.tasks) {
      snapshot[String(unintern(id))] = {
        id: task.id,
        priority: task.priority,
        runAt: task.runAt,
        deps: task.deps.map((d) => unintern(d)),
        state: task.state,
        remainingDeps: task.remainingDeps,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        version: task.version,
      };
    }
    return {
      size: this.tasks.size,
      remaining: this.remaining,
      readyCount: this.readyHeap.size,
      tasks: snapshot,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _edges(): Map<string, Set<string>> {
    const edges = new Map<string, Set<string>>();
    for (const [id, task] of this.tasks) edges.set(id, task.deps as Set<string>);
    return edges;
  }

  /** Can `from` reach `to` by following dependency edges? (early-exit DFS). */
  private _wouldCycle(from: string, to: string): boolean {
    if (from === to) return true;
    const seen = new Set<string>();
    const stack = [from];
    seen.add(from);
    while (stack.length > 0) {
      const node = stack.pop()!;
      const deps = this._edges().get(node);
      if (!deps) continue;
      for (const dep of deps) {
        if (dep === to) return true;
        if (!seen.has(dep)) {
          seen.add(dep);
          stack.push(dep);
        }
      }
    }
    return false;
  }

  private _setReady(id: string): void {
    const task = this.tasks.get(id)!;
    task.state = TaskState.READY;
    this.timeHeap.remove(id);
    this.readyHeap.remove(id); // idempotent: remove if already here (re-key)
    this.readyHeap.push(id, { id, task });
  }

  private _setWaiting(id: string): void {
    const task = this.tasks.get(id)!;
    task.state = TaskState.WAITING;
    this.readyHeap.remove(id);
    this.timeHeap.remove(id); // idempotent: remove if already here (re-key)
    this.timeHeap.push(id, { id, task });
  }

  private _setPending(id: string): void {
    const task = this.tasks.get(id)!;
    task.state = TaskState.PENDING;
    this.timeHeap.remove(id);
    this.readyHeap.remove(id);
  }

  private _setRunning(id: string): void {
    const task = this.tasks.get(id)!;
    task.state = TaskState.RUNNING;
    this.timeHeap.remove(id);
    this.readyHeap.remove(id);
  }

  /**
   * Keep the timer tuned to the earliest future task. On a non-custom clock this
   * only ever *schedules* a timer (one level); the actual drain runs in `_drain`,
   * which calls `tick()` exactly once and never re-enters `_updateTimer`, so there
   * is no recursion.
   */
  private _updateTimer(): void {
    if (this.hasCustomClock) return;
    const future = this.timeHeap.peek();
    if (future && future.task.runAt > this.clock()) {
      this._clearTimer();
      this.timerScheduled = true;
      this.timerHandle = this.setTimeoutFn(
        () => {
          this.timerScheduled = false;
          this._drain();
        },
        future.task.runAt - this.clock()
      );
      return;
    }
    // No future task: drain whatever is due now (once), then stop.
    this._clearTimer();
    this._drain();
  }

  private _drain(): void {
    this.tick();
  }

  private _clearTimer(): void {
    if (this.timerScheduled) {
      this.clearTimeoutFn(this.timerHandle);
      this.timerScheduled = false;
    }
  }
}
