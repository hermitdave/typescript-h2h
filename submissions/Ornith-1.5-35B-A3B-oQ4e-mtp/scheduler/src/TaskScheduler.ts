/**
 * in-memory-task-scheduler
 * ========================
 * Production-grade in-memory task scheduler for TypeScript.
 *
 * Supports ~1,000,000 live tasks with:
 *   - priority ordering (high-first or low-first)
 *   - absolute execution timestamps (time-gated execution)
 *   - dependency tracking with cascading release
 *   - dynamic updates (priority / due time / dependencies)
 *   - cycle detection (Tarjan SCC) + dangling / orphan reporting
 *   - efficient retrieval of the next executable task (O(log n))
 *
 * ==========================================================================
 * DESIGN PHILOSOPHY
 * ==========================================================================
 * Three concerns, each backed by a structure chosen for its access pattern:
 *
 *   1. Live task records   -> Map<string, Task>    O(1) lookup / delete / scan.
 *   2. Ready queue (prio)  -> MinHeap<HeapEntry>   O(log n) insert/extract, O(1) peek.
 *   3. Future queue (time) -> MinHeap<HeapEntry>   O(log n) insert/extract.
 *   4. Dependency graph    -> Map<string,Set<string>> fwd + reverse edges
 *                              Map<string,number>     remaining-unsatisfied count
 *                              Set<string>             currently-blocked task ids
 *
 * The scalability trick is a LAZY-DELETION HEAP. Updating or deleting a task
 * does NOT mutate entries buried inside a heap (that would be O(n)). Every
 * mutation bumps the task's monotonic `version`; stale snapshots simply become
 * invalid and are discarded the moment they bubble to the heap root. This
 * yields O(log n) updates and O(1) logical-deletes while keeping amortized
 * memory bounded by the number of mutations, not the number of tasks.
 *
 * A pending task is "runnable" exactly when: its status is `pending`, its
 * unsatisfied-dependency count is 0, and its due time has elapsed. Runnable,
 * due tasks live in the ready heap; runnable-but-not-yet-due tasks live in
 * the future heap until their due time passes (promoted lazily). Tasks with
 * remaining dependencies are parked in `blocked` until their deps resolve.
 *
 * Concurrency: single-threaded, synchronous, in-memory (Node's model). Heavy
 * work (full cycle analysis over 1M nodes) returns its result synchronously;
 * the caller owns the wall-clock. See README.md for multi-process deployment.
 */

import { EventEmitter } from 'node:events';

import { MinHeap } from './MinHeap.js';
import { SchedulerError } from './types.js';
import type {
  Task,
  NewTask,
  HeapEntry,
  PriorityOrder,
  SchedulerOptions,
  TaskStatus,
  CycleReport,
  Cycle,
  SchedulerStats,
  AdvanceResult,
  WaitNextInfo,
} from './types.js';

export { SchedulerError };
export type {
  Task,
  NewTask,
  HeapEntry,
  PriorityOrder,
  SchedulerOptions,
  TaskStatus,
  CycleReport,
  Cycle,
  SchedulerStats,
  AdvanceResult,
  WaitNextInfo,
};

/** Lifecycle event emitted to subscribers. Payload always carries `{ id }`. */
export type SchedulerEvent = 'complete' | 'cancel' | 'remove';
export type CompleteEvent = { id: string };
export type CancelEvent = { id: string };
export type RemoveEvent = { id: string };
export type EventPayload = CompleteEvent | CancelEvent | RemoveEvent;

type Comparator<T> = (a: T, b: T) => number;

export class TaskScheduler {
  private readonly tasks = new Map<string, Task>();
  private readonly deps = new Map<string, Set<string>>();
  private readonly dependents = new Map<string, Set<string>>();
  private readonly remaining = new Map<string, number>();
  private readonly blocked = new Set<string>();

  private readyHeap!: MinHeap<HeapEntry>;
  private futureHeap!: MinHeap<HeapEntry>;

  private readonly clock: () => number;
  private readonly priorityOrder: PriorityOrder;
  private readonly emitter: EventEmitter;

  private _version = 0;
  private _newId = 0;

  private readonly readyCmp: Comparator<HeapEntry>;
  private readonly futureCmp: Comparator<HeapEntry>;

  constructor(options: SchedulerOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.priorityOrder = options.priorityOrder ?? 'high-first';
    this.readyCmp = this._buildReadyCmp();
    this.futureCmp = this._buildFutureCmp();
    this.readyHeap = new MinHeap(this.readyCmp);
    this.futureHeap = new MinHeap(this.futureCmp);
    this.emitter = new EventEmitter();
  }

  // =========================================================================
  // COMPARATORS  (smaller result => should run sooner)
  // =========================================================================

  private _buildReadyCmp(): Comparator<HeapEntry> {
    const primary = this.priorityOrder === 'high-first'
      ? (a: HeapEntry, b: HeapEntry) => b.priority - a.priority
      : (a: HeapEntry, b: HeapEntry) => a.priority - b.priority;
    return (a, b) => {
      const p = primary(a, b);
      if (p !== 0) return p;
      if (a.time !== b.time) return a.time - b.time;
      return a.version - b.version;
    };
  }

  private _buildFutureCmp(): Comparator<HeapEntry> {
    const primary = this.priorityOrder === 'high-first'
      ? (a: HeapEntry, b: HeapEntry) => b.priority - a.priority
      : (a: HeapEntry, b: HeapEntry) => a.priority - b.priority;
    return (a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      const p = primary(a, b);
      if (p !== 0) return p;
      return a.version - b.version;
    };
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

  private nextVersion(): number {
    return ++this._version;
  }

  /** Snapshot-encode a task for heap placement. */
  private _snapshot(id: string): HeapEntry {
    const t = this.tasks.get(id)!;
    return { id: t.id, priority: t.priority, time: t.dueAt, version: t.version };
  }

  /** Push a runnable task's snapshot onto the correct heap (time-gated). */
  private _enqueue(id: string, now: number): void {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'pending') return;
    const e = this._snapshot(id);
    if (t.dueAt <= now) this.readyHeap.push(e);
    else this.futureHeap.push(e);
  }

  /** Remove reverse edges pointing at a task (used when it is removed). */
  private _removeReverseEdges(id: string): void {
    for (const d of (this.deps.get(id) ?? [])) {
      const s = this.dependents.get(d);
      if (s) {
        s.delete(id);
        if (s.size === 0) this.dependents.delete(d);
      }
    }
  }

  /** True iff a ready-heap entry names a genuinely runnable, due task. */
  private _isRunnable(e: HeapEntry, now: number): boolean {
    const t = this.tasks.get(e.id);
    if (!t) return false;
    if (t.status !== 'pending') return false;
    if (t.version !== e.version) return false; // stale snapshot
    if (this.remaining.has(e.id)) return false; // became blocked since snapshot
    if (t.dueAt > now) return false; // not yet time-gated
    return true;
  }

  // =========================================================================
  // DEPENDENCY RECONCILIATION
  // =========================================================================

  /**
   * Rebuild a task's dependency satisfaction. Maintains reverse edges, the
   * remaining-unsatisfied count, and the `blocked` set. Called on create and
   * dependency-updates; on the hot path these are the only places the graph
   * mutates, keeping runNext / advance at O(log n).
   */
  private _reconcileDeps(id: string, deps: string[], now: number): void {
    const t = this.tasks.get(id);
    if (!t) return;

    this._removeReverseEdges(id);
    this.deps.set(id, new Set(deps));

    let remaining = 0;
    for (const d of deps) {
      if (d === id) {
        // Self-dependency: never satisfiable while pending; counts as unsatisfied
        // so the task stays parked; analyze() reports the cycle.
        remaining++;
        continue;
      }
      let s = this.dependents.get(d);
      if (!s) {
        s = new Set();
        this.dependents.set(d, s);
      }
      s.add(id);

      const dt = this.tasks.get(d);
      if (dt && dt.status === 'completed') {
        // satisfied
      } else {
        // missing / pending / running / cancelled -> unsatisfied
        remaining++;
      }
    }

    if (remaining === 0) {
      this.remaining.delete(id);
      this.blocked.delete(id);
      this._enqueue(id, now);
    } else {
      this.remaining.set(id, remaining);
      this.blocked.add(id);
    }
  }

  /**
   * Iterative topological ordering of specs so forward references within a batch
   * resolve and reconciliation stays local. Pure optimization; a cycle in the
   * batch is tolerated.
   */
  private _topoSort(byId: Map<string, NewTask>): NewTask[] {
    const ids = [...byId.keys()];
    const indeg = new Map<string, number>();
    const indegAdj = new Map<string, Set<string>>();
    for (const id of ids) indegAdj.set(id, new Set());

    for (const id of ids) {
      const spec = byId.get(id)!;
      const ds = (spec.dependencies ?? []).filter((d) => byId.has(d));
      indeg.set(id, ds.length);
      for (const d of ds) indegAdj.get(d)!.add(id);
    }

    const queue: string[] = [];
    for (const id of ids) if ((indeg.get(id) ?? 0) === 0) queue.push(id);

    const ordered: NewTask[] = [];
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++]!;
      ordered.push(byId.get(cur)!);
      for (const next of indegAdj.get(cur)!) {
        const deg = (indeg.get(next) ?? 0) - 1;
        indeg.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }
    // Append leftover (batch-cycle) members; reconcileDeps handles them.
    const placed = new Set<string>();
    for (const id of ids) if (!placed.has(id)) { placed.add(id); ordered.push(byId.get(id)!); }
    return ordered;
  }

  // =========================================================================
  // CREATION
  // =========================================================================

  /**
   * Create a task and register it. Returns the live Task.
   *
   * @param spec  task spec (see NewTask). `id` is auto-generated if omitted.
   * @throws if the id already exists or is empty.
   */
  createTask(spec: NewTask, now: number = this.clock()): Task {
    if (!spec.id) throw new SchedulerError('Task id must be non-empty');
    if (this.tasks.has(spec.id)) {
      throw new SchedulerError(`Task "${spec.id}" already exists`, spec.id);
    }

    const id = spec.id!;
    const t: Task = {
      id,
      name: spec.name,
      priority: spec.priority ?? 0,
      dueAt: spec.dueAt ?? 0,
      dependencies: spec.dependencies ? [...spec.dependencies] : [],
      status: 'pending',
      version: this._version++,
      createdAt: now,
      payload: spec.payload ?? null,
    };
    this.tasks.set(id, t);
    this.deps.set(id, new Set());
    this._reconcileDeps(id, t.dependencies, now);
    return t;
  }

  /**
   * Batch-create N tasks; faster than N separate createTask calls (one
   * reconciliation pass, forward references within a batch resolve).
   * @throws if any id already exists or is empty.
   */
  createTasks(specs: NewTask[], now: number = this.clock()): Task[] {
    if (!Array.isArray(specs)) throw new SchedulerError('createTasks expects an array');

    const byId = new Map<string, NewTask>();
    for (const s of specs) {
      const id = s.id ?? `task-${this._newId++}`;
      if (!id) throw new SchedulerError('Task id must be non-empty');
      if (this.tasks.has(id)) {
        throw new SchedulerError(`Task "${id}" already exists`, id);
      }
      if (byId.has(id)) {
        throw new SchedulerError(`Duplicate task id within batch: "${id}"`, id);
      }
      byId.set(id, { ...s, id });
    }

    const ordered = this._topoSort(byId);
    const created = new Array(specs.length);

    for (const s of ordered) {
      const id = s.id!;
      const t: Task = {
        id,
        name: s.name,
        priority: s.priority ?? 0,
        dueAt: s.dueAt ?? 0,
        dependencies: s.dependencies ? [...s.dependencies] : [],
        status: 'pending',
        version: this._version++,
        createdAt: now,
        payload: s.payload ?? null,
      };
      this.tasks.set(id, t);
      this.deps.set(id, new Set());
      this._reconcileDeps(id, t.dependencies, now);
    }

    // Preserve the caller's ordering in the return array.
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]!;
      const id = s.id ?? `task-${this._newId++}`;
      created[i] = this.tasks.get(id)!;
    }
    return created;
  }

  // =========================================================================
  // NEXT-EXECUTABLE RETRIEVAL
  // =========================================================================

  /**
   * Return the next runnable task (highest priority, earliest due time, FIFO),
   * transitioning it to `running`. Returns null if nothing can run right now.
   * Amortized O(log n).
   */
  runNext(now: number = this.clock()): Task | null {
    this._promoteFromFuture(now);
    for (;;) {
      const e = this.readyHeap.peek();
      if (e === undefined) return null;
      if (this._isRunnable(e, now)) break;
      this.readyHeap.pop();
    }
    const e = this.readyHeap.peek()!;
    const t = this.tasks.get(e.id)!;
    t.status = 'running';
    return t;
  }

  /** Read-only view of the next runnable task (no state change). */
  peek(now: number = this.clock()): Task | null {
    this._promoteFromFuture(now);
    for (;;) {
      const e = this.readyHeap.peek();
      if (e === undefined) return null;
      if (this._isRunnable(e, now)) break;
      this.readyHeap.pop();
    }
    const e = this.readyHeap.peek();
    if (e === undefined) return null;
    return this.tasks.get(e.id) ?? null;
  }

  /**
   * Iteratively run every currently-runnable task (up to `now`), completing each
   * so its dependents cascade. Great for batch/offline execution and tests.
   */
  advance(now: number = this.clock()): AdvanceResult {
    const executed: Task[] = [];
    let guard = 0;
    for (;;) {
      const t = this.runNext(now);
      if (t === null) break;
      executed.push(t);
      const done = this.completeTask(t.id, now);
      if (done === null) break; // cancelled tasks cannot complete
      if (++guard > this.tasks.size + 1) break; // safety guard
    }
    return { executed, pending: this.pendingCount };
  }

  /**
   * Deterministically report the next task to run and how to wait for it.
   * The `tasks` map is bucketed by blocking reason:
   *   - runnable:       time-dead and dependency-free pending tasks.
   *   - blockedByDeps:  pending tasks waiting on a live (pending) dependency.
   *   - stuckByCycle:   pending tasks that can never run (dependency cycle).
   *   - orphanBlocked:  pending tasks blocked by a missing / cancelled dependency.
   */
  waitForNext(now: number = this.clock()): WaitNextInfo {
    this._promoteFromFuture(now);

    for (;;) {
      const e = this.readyHeap.peek();
      if (e === undefined) break;
      if (this._isRunnable(e, now)) break;
      this.readyHeap.pop();
    }

    const report = this.analyze();
    const info: WaitNextInfo = {
      now,
      runnable: 0,
      tasks: { runnable: [], blockedByDeps: [], stuckByCycle: [], orphanBlocked: [] },
    };

    for (const t of this.tasks.values()) {
      if (t.status !== 'pending') continue;
      if (report.stuckByCycle.includes(t.id)) info.tasks.stuckByCycle.push(t);
      else if (report.orphanBlocked.includes(t.id)) info.tasks.orphanBlocked.push(t);
      else if (this.remaining.has(t.id)) info.tasks.blockedByDeps.push(t);
      else { info.tasks.runnable.push(t); info.runnable++; }
    }
    return info;
  }

  // =========================================================================
  // COMPLETION / CANCELLATION / REMOVAL
  // =========================================================================

  /**
   * Complete a task (from `pending` or `running`) and cascade to dependents.
   * Any dependent whose unsatisfied-dependency count reaches 0 is released into
   * the ready or future heap. Emits `complete`. Returns the completed Task, or
   * null if the task does not exist or is not pending/running.
   */
  completeTask(id: string, now: number = this.clock()): Task | null {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (t.status !== 'pending' && t.status !== 'running') return null;

    t.status = 'completed';
    t.version = this.nextVersion();
    this._emitComplete(id);

    for (const dep of this.dependents.get(id) ?? []) {
      const dt = this.tasks.get(dep);
      if (!dt || (dt.status !== 'pending' && dt.status !== 'running')) continue;
      const rem = this.remaining.get(dep);
      if (rem === undefined) continue; // already runnable
      const next = rem - 1;
      if (next <= 0) {
        this.remaining.delete(dep);
        this.blocked.delete(dep);
        this._enqueue(dep, now);
      } else {
        this.remaining.set(dep, next);
      }
    }
    return this.tasks.get(id)!;
  }

  /**
   * Cancel a task (from `pending` or `running`). Dependents are left parked;
   * {@link analyze} reports them as orphaned. Emits `cancel`. Returns the
   * cancelled Task, or null if not pending.
   */
  cancelTask(id: string): Task | null {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (t.status !== 'pending' && t.status !== 'running') return null;

    t.status = 'cancelled';
    t.version = this.nextVersion();
    this._emitCancel(id);
    // Dependents keep their remaining count -> stay blocked -> orphaned by analyze().
    return this.tasks.get(id)!;
  }

  /**
   * Remove a task and all of its dependency edges, cascading to dependents: each
   * dependent's remaining count is decremented and any that reach 0 are released.
   * Returns the removed Task, or null if it does not exist.
   */
  remove(id: string): Task | null {
    const t = this.tasks.get(id);
    if (!t) return null;

    this._removeReverseEdges(id); // edges from -> id
    this.dependents.delete(id); // reverse edges id -> dependents

    this.deps.delete(id);
    this.remaining.delete(id);
    this.blocked.delete(id);
    this.tasks.delete(id);
    this._emitRemove(id);

    // Cascade: decrement dependents' remaining counts; release any that reach 0.
    const c = this.clock();
    const released: string[] = [];
    for (const [id2, t2] of this.tasks) {
      if (t2.status !== 'pending') continue;
      const rem = this.remaining.get(id2);
      if (rem !== undefined && rem > 0) {
        const next = rem - 1;
        if (next <= 0) {
          this.remaining.delete(id2);
          this.blocked.delete(id2);
          released.push(id2);
        } else {
          this.remaining.set(id2, next);
        }
      }
    }
    for (const dep of released) this._enqueue(dep, c);

    return t;
  }

  /** Release all tasks and internal state; reset counters. */
  clear(): void {
    this.tasks.clear();
    this.deps.clear();
    this.dependents.clear();
    this.remaining.clear();
    this.blocked.clear();
    this.readyHeap.clear();
    this.futureHeap.clear();
    this._newId = 0;
    this._version++;
  }

  // =========================================================================
  // DYNAMIC UPDATES
  // =========================================================================

  /**
   * Dynamically update a pending task's priority / due time / dependencies.
   * Bumps the version so stale heap snapshots are lazily discarded. Returns the
   * updated Task, or throws if the task does not exist or is not pending.
   */
  update(id: string, changes: Partial<Pick<NewTask, 'priority' | 'dueAt' | 'dependencies'>>, now: number = this.clock()): Task {
    const t = this.tasks.get(id);
    if (!t) throw new SchedulerError(`Task "${id}" does not exist`, id);
    // A task that is already `running` (runNext'd but not completed) may be
    // rescheduled or reprioritised; reset it to `pending` so the changes apply
    // cleanly. Non-pending/non-running states (completed/cancelled) are rejected.
    if (t.status === 'running') t.status = 'pending';
    else if (t.status !== 'pending') throw new SchedulerError(`Task "${id}" is not pending`, id);

    this._version++;
    if ('priority' in changes) t.priority = changes.priority!;
    if ('dueAt' in changes) t.dueAt = changes.dueAt!;

    if ('dependencies' in changes) {
      const ds = [...(changes.dependencies ?? [])];
      t.dependencies = ds;
      this._reconcileDeps(id, ds, now);
    } else if (!this.remaining.has(id)) {
      // Still runnable; push a fresh snapshot so the new ordering takes effect.
      this._enqueue(id, now);
    }
    return this.tasks.get(id)!;
  }

  /** Raise a task's priority (high-first) by `amount`. */
  bumpPriority(id: string, amount: number, now: number = this.clock()): Task {
    const t = this.tasks.get(id);
    if (!t) throw new SchedulerError(`Task "${id}" does not exist`, id);
    return this.update(id, { priority: t.priority + amount, dueAt: t.dueAt }, now);
  }

  /** Move a task's due time to `dueAt`. */
  reschedule(id: string, dueAt: number, now: number = this.clock()): Task {
    const t = this.tasks.get(id);
    if (!t) throw new SchedulerError(`Task "${id}" does not exist`, id);
    return this.update(id, { dueAt }, now);
  }

  // =========================================================================
  // TIME-DRIVEN PROMOTION
  // =========================================================================

  /** Move due tasks from the future heap into the ready heap; drop stale entries. */
  private _promoteFromFuture(now: number): void {
    while (true) {
      const e = this.futureHeap.peek();
      if (e === undefined) break;
      const t = this.tasks.get(e.id);
      if (!t || t.status !== 'pending' || t.version !== e.version || this.remaining.has(e.id)) {
        this.futureHeap.pop();
        continue;
      }
      if (e.time > now) break; // not due yet
      this.futureHeap.pop();
      this.readyHeap.push({ id: e.id, priority: t.priority, time: t.dueAt, version: t.version });
    }
  }

  // =========================================================================
  // CYCLE / ORPHAN ANALYSIS (Tarjan SCC)
  // =========================================================================

  /**
   * Detect dependency cycles and tasks that can never run.
   *
   * A task is "stuck" if it can never satisfy its dependencies. Two root causes:
   *   - Cycle: part of (or transitively blocked by) a cyclic SCC.
   *   - Orphan: a dependency is missing, removed, or cancelled.
   *
   * Tarjan SCC runs in O(V+E); transitive-blockers scan is O(V+E).
   */
  analyze(): CycleReport {
    const pending = new Set<string>();
    const adjacency = new Map<string, string[]>();
    for (const [id, t] of this.tasks) {
      if (t.status === 'pending') pending.add(id);
    }

    // Build adjacency restricted to pending -> pending edges (cycles need all
    // members pending).
    for (const id of pending) {
      const ds = this.deps.get(id) ?? [];
      const edges: string[] = [];
      for (const d of ds) if (pending.has(d)) edges.push(d);
      adjacency.set(id, edges);
    }

    const sccs = this._tarjanScc(adjacency, pending);

    const cyclicNodes = new Set<string>();
    const cyclicGroups: string[][] = [];
    for (const scc of sccs) {
      const isSelfLoop = scc.length === 1 && (this.deps.get(scc[0]!)?.has(scc[0]!) ?? false);
      if (scc.length > 1 || isSelfLoop) {
        for (const n of scc) cyclicNodes.add(n);
        cyclicGroups.push(scc);
      }
    }

    // Tasks transitively depending on a cyclic node (via unsatisfied deps).
    const stuckByCycle = new Set<string>(cyclicNodes);
    const queue: string[] = [...cyclicNodes];
    while (queue.length > 0) {
      const c = queue.shift()!;
      for (const dep of this.dependents.get(c) ?? []) {
        if (pending.has(dep) && !stuckByCycle.has(dep)) {
          stuckByCycle.add(dep);
          queue.push(dep);
        }
      }
    }

    // Orphans: pending tasks with a removed / cancelled dependency.
    const orphanBlocked = new Set<string>();
    for (const id of pending) {
      if (stuckByCycle.has(id)) continue;
      const ds = this.deps.get(id) ?? [];
      let hasDeadEdge = false;
      for (const d of ds) {
        const dt = this.tasks.get(d);
        if (!dt || dt.status === 'cancelled') {
          hasDeadEdge = true;
          break;
        }
      }
      if (hasDeadEdge) orphanBlocked.add(id);
    }

    const cycles: Cycle[] = [];
    for (const group of cyclicGroups) {
      const edges: [string, string][] = [];
      for (const id of group) {
        for (const d of (this.deps.get(id) ?? [])) {
          if (cyclicNodes.has(d) && group.includes(d)) edges.push([id, d]);
        }
      }
      cycles.push({ nodes: group, edges });
    }

    const stuckByCycleArr = [...stuckByCycle].sort();
    const orphanBlockedArr = [...orphanBlocked].sort();

    return {
      hasCycle: cyclicNodes.size > 0,
      cycles,
      stuckByCycle: stuckByCycleArr,
      orphanBlocked: orphanBlockedArr,
    };
  }

  /**
   * Iterative Tarjan SCC over the pending subgraph; stack-safe for long chains.
   */
  private _tarjanScc(adjacency: Map<string, string[]>, nodes: Set<string>): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const sccs: string[][] = [];
    let counter = 0;

    for (const start of nodes) {
      if (index.has(start)) continue;

      const callStack: [string, number][] = [];
      callStack.push([start, 0]);
      index.set(start, counter);
      low.set(start, counter);
      onStack.add(start);
      counter++;

      while (callStack.length > 0) {
        const top = callStack[callStack.length - 1]!;
        const [node, ni] = top;
        const neighbors = adjacency.get(node) ?? [];

        if (ni < neighbors.length) {
          callStack[callStack.length - 1]![1] = ni + 1;
          const w = neighbors[ni]!;
          if (!index.has(w)) {
            index.set(w, counter);
            low.set(w, counter);
            onStack.add(w);
            counter++;
            callStack.push([w, 0]);
          } else if (onStack.has(w)) {
            low.set(node, Math.min(low.get(node)!, index.get(w)!));
          }
        } else {
          if (low.get(node) === index.get(node)) {
            // Pop nodes until `node` itself is popped; they form one SCC.
            const comp: string[] = [];
            let w: string | undefined;
            do {
              w = onStack.size === 0 ? undefined : Array.from(onStack).pop();
              if (w === undefined) break;
              onStack.delete(w);
              comp.push(w);
            } while (w !== node);
            sccs.push(comp);
          }
          callStack.pop();
          if (callStack.length > 0) {
            const parent = callStack[callStack.length - 1]![0];
            low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
          }
        }
      }
    }
    return sccs;
  }

  // =========================================================================
  // INSPECTION / STATISTICS
  // =========================================================================

  /** Total number of live tasks (any status). */
  get count(): number {
    return this.tasks.size;
  }

  /** Number of currently-pending tasks. */
  get pendingCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (t.status === 'pending') n++;
    return n;
  }

  /** Number of tasks currently in `running` state. */
  get runningCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (t.status === 'running') n++;
    return n;
  }

  /** Alias for {@link pendingCount}. */
  get size(): number {
    return this.pendingCount;
  }

  /** Number of tasks that can never run (stuck-by-cycle + orphaned). */
  get stuckCount(): number {
    const r = this.analyze();
    return r.stuckByCycle.length + r.orphanBlocked.length;
  }

  /** Current status of a task, or undefined if the id is unknown. */
  status(id: string): TaskStatus | undefined {
    return this.tasks.get(id)?.status;
  }

  /** Fetch the live copy of a task by id. */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** True if the id exists in any status. */
  has(id: string): boolean {
    return this.tasks.has(id);
  }

  /** True if there are no pending or running tasks. */
  isEmpty(): boolean {
    return this.pendingCount === 0 && this.runningCount === 0;
  }

  /** All pending tasks ordered as `runNext` would consume them. */
  listPending(): Task[] {
    const out: Task[] = [];
    for (const t of this.tasks.values()) if (t.status === 'pending') out.push(t);
    out.sort((a, b) =>
      this.readyCmp(
        { id: a.id, priority: a.priority, time: a.dueAt, version: a.version },
        { id: b.id, priority: b.priority, time: b.dueAt, version: b.version },
      ),
    );
    return out;
  }

  /** Live list of a task's upstream dependencies. */
  getDependencies(id: string): string[] {
    return [...(this.deps.get(id) ?? [])];
  }

  /** Live list of a task's downstream dependents. */
  getDependents(id: string): string[] {
    return [...(this.dependents.get(id) ?? [])];
  }

  /** Count of unsatisfied dependencies for a task (0 if none). */
  remainingDeps(id: string): number {
    return this.remaining.get(id) ?? 0;
  }

  /** Aggregate counters in O(n) (+ one O(V+E) cycle analysis for `stuck`). */
  stats(now: number = this.clock()): SchedulerStats {
    const buckets: Required<SchedulerStats> = {
      total: 0,
      pending: 0,
      runnable: 0,
      blockedByDeps: 0,
      waitingOnTime: 0,
      running: 0,
      completed: 0,
      cancelled: 0,
      stuck: 0,
    };

    for (const t of this.tasks.values()) {
      buckets.total++;
      if (t.status === 'pending') buckets.pending++;
      else if (t.status === 'running') buckets.running++;
      else if (t.status === 'completed') buckets.completed++;
      else if (t.status === 'cancelled') buckets.cancelled++;
    }

    const report = this.analyze();
    const stuckSet = new Set<string>([...report.stuckByCycle, ...report.orphanBlocked]);

    for (const t of this.tasks.values()) {
      if (t.status !== 'pending') continue;
      if (stuckSet.has(t.id)) buckets.stuck++;
      else if (this.remaining.has(t.id)) buckets.blockedByDeps++;
      else if (t.dueAt > now) buckets.waitingOnTime++;
      else buckets.runnable++;
    }

    return buckets as SchedulerStats;
  }

  // =========================================================================
  // EVENTS / WAIT
  // =========================================================================

  /**
   * Promise that resolves when a task completes, or rejects if it is
   * cancelled / removed / not pending. Accepts an optional AbortSignal.
   */
  waitFor(taskId: string, options?: { signal?: AbortSignal }): Promise<Task> {
    const t = this.tasks.get(taskId);
    if (!t) return Promise.reject(new SchedulerError(`Task "${taskId}" does not exist`, taskId));
    if (t.status === 'completed') return Promise.resolve(t);
    if (t.status === 'cancelled') return Promise.reject(new SchedulerError(`Task "${taskId}" was cancelled`, taskId));
    if (t.status !== 'pending') return Promise.reject(new SchedulerError(`Task "${taskId}" is not pending`, taskId));

    return new Promise<Task>((resolve, reject) => {
      let settled = false;
      const settleResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(this.tasks.get(taskId) ?? ({} as Task));
      };
      const settleReject = (msg: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new SchedulerError(msg, taskId));
      };
      const onComplete = (e: CompleteEvent) => { if (e.id === taskId) settleResolve(); };
      const onCancel = (e: CancelEvent) => { if (e.id === taskId) settleReject(`Task "${taskId}" was cancelled`); };
      const onRemove = (e: RemoveEvent) => { if (e.id === taskId) settleReject(`Task "${taskId}" was removed`); };
      const onAbort = () => settleReject(`Task "${taskId}" wait was aborted`);

      const cleanup = () => {
        this.off('complete', onComplete);
        this.off('cancel', onCancel);
        this.off('remove', onRemove);
        if (options?.signal) options.signal.removeEventListener('abort', onAbort);
      };

      this.on('complete', onComplete);
      this.on('cancel', onCancel);
      this.on('remove', onRemove);
      if (options?.signal) options.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Subscribe to lifecycle events. */
  on(event: SchedulerEvent, listener: (e: EventPayload) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  /** Unsubscribe a previously-registered listener. */
  off(event: SchedulerEvent, listener: (e: EventPayload) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  /** Number of listeners for an event (diagnostics). */
  listenerCount(event: SchedulerEvent): number {
    return this.emitter.listenerCount(event);
  }

  private _emitComplete(id: string): void {
    if (this.emitter.listenerCount('complete') > 0) this.emitter.emit('complete', { id });
  }
  private _emitCancel(id: string): void {
    if (this.emitter.listenerCount('cancel') > 0) this.emitter.emit('cancel', { id });
  }
  private _emitRemove(id: string): void {
    if (this.emitter.listenerCount('remove') > 0) this.emitter.emit('remove', { id });
  }
}
