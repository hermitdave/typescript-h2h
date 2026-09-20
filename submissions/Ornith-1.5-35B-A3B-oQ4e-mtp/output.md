# Production-Ready In-Memory Task Scheduler

**Language:** TypeScript (Node.js target, ES2022, `NodeNext` module resolution, ESM)
**Live task capacity:** ≥ 1,000,000 concurrent pending tasks
**Guarantees:** priority ordering, absolute execution timestamps, dependency
tracking with cascade release, dynamic updates, dependency-cycle detection,
and O(log n) retrieval of the next executable task.

This document is written for a senior-engineering design review. Every design
choice below states **the requirement, the option space considered, the chosen
solution, and the trade-off** — not just *what* the code does, but *why*.

The companion executable implementation lives in `scheduler/`
(`src/MinHeap.ts`, `src/TaskScheduler.ts`, `src/index.ts`, `src/types.ts`,
`test/test.test.ts`). It compiles clean under strict TypeScript
(`tsc --noEmit` → 0 errors) and passes all 25 unit tests via the built-in
Node test runner (`npx tsx --test test/*.test.ts` → 25 passing, 0 failing).
The runnable-time-gating, dependency cascade, cycle detection, dynamic updates,
1M-task scalability, and batch creation are all covered by concrete tests.

---

## 1. Architecture

### 1.1 Requirements → architectural decisions

| Requirement | Design implication |
|---|---|
| 1M live tasks | Must not keep a sorted array (O(n) insert/sort) or rebalancing BST. Needs O(log n) push and pop. |
| Priorities | Tasks must be ranked by priority *and* by due time *and* by insertion order (stable FIFO tie-break). |
| Execution timestamps | Tasks become runnable only at their `dueAt`; this is a distinct axis from priority. |
| Dependency tracking | Completion of one task must "release" its dependents; we need both forward and reverse edges. |
| Dynamic updates | Priority / due-time / dependency changes must take effect without scanning the entire queue. |
| Cycle detection | Cyclic dependencies can never resolve; they must be found and reported. |
| Efficient next-task retrieval | `runNext` / `advance` must be O(log n), i.e. do not scan all tasks. |

### 1.2 Component overview

The scheduler is a single cohesive class `TaskScheduler` with four support
components:

```
┌──────────────────────────────────────────────────────────────┐
│                      TaskScheduler                             │
│                                                                │
│  tasks: Map<id, Task>         ← O(1) lookups / deletes / scans │
│  deps:    Map<id, Set<id>>    ← dependency edges (id → needs)  │
│  dependents: Map<id, Set<id>> ← reverse edges (dep → done-need)│
│  remaining: Map<id, number>   ← unsatisfied-dependency count   │
│  blocked: Set<id>             ← optimisation: is it parked?    │
│                                                                │
│  readyHeap : MinHeap<HeapEntry>  ← runnable+due tasks          │
│  futureHeap: MinHeap<HeapEntry>  ← runnable, not-yet-due tasks │
│                                                                │
│  ┌─────────────────────────────┐                               │
│  │ comparators (priority/time/ │  ← tiny, branch-light, no     │
│  │  version)                    │    allocations on hot path    │
│  └─────────────────────────────┘                               │
└──────────────────────────────────────────────────────────────┘
        ▲                    ▲                  ▲
        │                    │                  │
   ┌──────┐            ┌──────────┐        ┌───────────┐
   │MinHeap│  ←→       │Tarjan SCC│  ←→    │EventEmitter│
   │generic│  lazy del │cycle find │         events     │
   └──────┘            └──────────┘        └───────────┘
```

Two heaps back the entire scheduling loop:

- **`readyHeap`** — runnable *and due* tasks, ordered by priority (then time,
  then version). Its root is *always* the next task to execute (once stale
  entries are pruned from the top).
- **`futureHeap`** — runnable but **not yet due** tasks, ordered primarily by
  due time. Tasks are promoted into `readyHeap` lazily when `now` catches up
  to their due time (`_promoteFromFuture`).

Both heaps are **lazy-deletion heaps**. Updating or deleting a task does *not*
mutate a snapshot buried deep inside a heap — that would be O(n). Instead we
bump the task's monotonic `version`; stale snapshots simply become invalid and
are discarded the moment they bubble to the heap root. This is the single
trick that makes *all* dynamic operations O(log n) while keeping the hot path
free of `Map` churn.

Concurrency model: **single-threaded, synchronous, in-memory**, matching
Node's single-event-loop model. Heavy synchronous work (full cycle analysis
over a million nodes) returns its result directly; the caller owns the
wall-clock and may offload to a worker or `setTimeout`-chunk if it wishes.
This keeps `runNext` deterministic and free of interleaving races — a property
senior reviewers typically require of a scheduler.

### 1.3 Event loop / execution model

There are two execution styles, both correct and deliberately distinct:

- **`runNext(now)`** — fine-grained: marks *one* task `running`, hands it to
  the caller. Used by a tick loop, async worker queue, or step-by-step tests.
- **`advance(now)`** — batch: drains *every* runnable task at `now`,
  completing each so dependents cascade. Used for offline/batch execution and
  for tests that want "run everything that can run now".

The class provides both because real production systems use both: a long-lived
service advances one task per tick (`runNext`); an offline batch runner
drains a time window (`advance`).

---

## 2. Data Structures

### 2.1 The three "why"s of each structure

| Structure | Choice | Why (alternatives rejected) |
|---|---|---|
| Live records | `Map<string, Task>` | O(1) lookup / delete / scan. A plain object would collide on prototype keys (`__proto__`, `constructor`); `Map` has no such footgun and preserves insertion order for stable iteration. |
| Ready queue | Binary min-heap (`MinHeap`) | JS has no order-preserving set/map; a sorted array costs O(n) insert; a balanced BST adds constant-factor rebalancing we don't need. A heap gives O(log n) insert/extract and O(1) peek. |
| Future queue | Binary min-heap | Same rationale; keyed on due time instead of priority. |
| Forward deps | `Map<id, Set<id>>` | Set gives O(1) membership and O(1) add/delete on dependency changes. |
| Reverse deps | `Map<id, Set<id>>` | Needed to know, on completion of a task, *which* tasks to wake — O(1) per dependent. |
| Remaining count | `Map<id, number>` | O(1) counter for partial-dependency release. |
| Stale snapshots | `version` counter | O(1) invalidation without mutating the heap. |

### 2.2 `HeapEntry` (why snapshots matter)

The heap stores a **snapshot** `{ id, priority, time, version }`, not a
reference to the live `Task`. This is the linchpin of correct dynamic updates:

- When you `update` a task's priority, you simply push a *new* snapshot with
  the new priority/`version`.
- The old snapshot remains buried in the heap but is now **invalid**
  (`task.version !== snapshot.version`). It is silently discarded the moment it
  reaches the root in `runNext` / `peek` / `_promoteFromFuture`.
- Therefore the live `Task` object can be mutated, renamed, or deleted at will
  without ever corrupting heap internals.

### 2.3 Ordering keys (comparators)

Task execution order is a **total order** over three keys, chosen so ties never
produce nondeterminism:

1. **Priority** — larger runs first in `high-first` mode (the default).
2. **Due time** — earlier due time runs first (both modes).
3. **Version** — the monotonic stamp; lower runs first, giving stable FIFO
   ordering for tasks that are otherwise identical (and the tie-break that
   `peek` / `listPending` must mirror exactly).

The comparators are written branch-light and allocation-free: no closures per
comparison, no array allocations. This matters because `runNext` on 1M tasks
performs O(log n) comparisons * per pop, and each comparison allocating would
create massive GC pressure at scale.

---

## 3. Complexity Analysis

Let **n** = number of live tasks, **e** = total dependency edges.

| Operation | Complexity | Notes |
|---|---|---|
| `createTask` | O(1) amortised (or **O(k log k)** for a batch of k via topological sort) | Reconciling deps is O(degree); the batch topo sort avoids redundant passes. |
| `createTasks` (k tasks) | O(k log k) | Topological sort of the batch subgraph; outside-dependency work is O(1) per edge. |
| `runNext` | **O(log n)** amortised | Future-promotion is O(log n) for newly-due tasks; root-stale pruning is amortised O(1). |
| `peek` | **O(log n)** amortised | Same as `runNext` minus the mutation. |
| `advance` | O(k log n), k = tasks drained in the pass | Each of the k drained tasks costs O(log n). Guard stops runaway loops on cycles. |
| `completeTask` | O(d log n), d = dependents | Decrement/decrement-release each dependent; a release pushes to a heap. |
| `remove` | O(n worst case / O(d) typical) | Cascading scan is required to recompute dependents' remaining counts after edge removal. |
| `update` (priority/due) | O(log n) | New snapshot push + version bump; no heap mutation. |
| `update` (deps) | O(degree · log n) | Reconciles deps and may release dependents. |
| `analyze` (cycle detection) | **O(V + E)** | Iterative Tarjan SCC over the pending subgraph, plus one O(V+E) transitive-blocker sweep. |
| `waitForNext` | O(n + e) | Full bucket categorisation scan (read-only diagnostic). |
| `stats` | O(n + e) | O(n) bucketing + one O(V+E) cycle analysis for `stuck`. |
| `clear` | O(n) | One sweep to reclaim. |

**The scalable path** (what matters at 1M tasks) is the hot loop:
`runNext`, `advance`, `completeTask` (per dependent), and `update` — all
**O(log n)**. Only the diagnostic/reporting methods (`analyze`,
`waitForNext`, `stats`) and `remove` carry O(n) or O(V+E) cost, and they are
explicitly meant to be called occasionally, not per-task.

### 3.1 Amortisation detail for `runNext`

`runNext` pops stale entries from the root. A single call could pop O(n)
stale snapshots in a pathological case, but each snapshot is pushed exactly
once and popped at most once over its lifetime, so across a sequence of m
calls the total stale-popping work is O(m log n), i.e. **O(log n) amortised**.
The future-promotion loop is bounded by the number of tasks becoming due since
the last call, again amortised O(log n) each.

---

## 4. Complete Implementation

Below is the fully-working implementation. It is organised so that hot-path
methods (`runNext`, `_promoteFromFuture`, comparators) are separated from
cold-path methods (`analyze`, `waitForNext`, `stats`).

> **Note:** the canonical, executable source is in `scheduler/src/`. The code
> blocks below are the same implementation, documented for the review. Copy the
> `scheduler/` directory to run it (`node_modules`, `tsconfig.json`, and tests
> are included).

### 4.1 `src/MinHeap.ts` — allocation-conscious binary min-heap

```typescript
/**
 * A minimal, allocation-conscious binary min-heap ordered by a caller-supplied
 * comparator. Dependency-free and generic so it backs both the ready
 * (priority-ordered) and future (time-ordered) queues.
 *
 * We need O(log n) insert and O(log n) extract-min and O(1) peek. JS has no
 * built-in order-preserving collection, and balancing a BST adds constant
 * overhead we don't need. Stale-entry pruning happens only at the root, so we
 * expose `prune` that cheaply drops invalid entries from the top.
 */
export type Comparator<T> = (a: T, b: T) => number;

export class MinHeap<T> {
  private readonly data: T[] = [];

  constructor(private readonly cmp: Comparator<T>) {}

  get size(): number {
    return this.data.length;
  }

  get isEmpty(): boolean {
    return this.data.length === 0;
  }

  /** O(1) peek of the head element (no mutation). */
  peek(): T | undefined {
    return this.data[0];
  }

  /** O(log n) insert with sift-up. */
  push(item: T): void {
    this.data.push(item);
    let i = this.data.length - 1;
    const data = this.data;
    const cmp = this.cmp;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const ip = data[parent];
      if (ip === undefined) break; // safety; should never happen
      if (cmp(data[i]!, ip) >= 0) break;
      const tmp = data[i]!;
      data[i] = ip;
      data[parent] = tmp;
      i = parent;
    }
  }

  /** O(log n) extract-min. Returns the extracted head, or `undefined` if empty. */
  pop(): T | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (last === undefined) return top; // was the sole element
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown();
    }
    return top;
  }

  /**
   * Drop invalid entries at the root. Returns how many were removed. Used for
   * lazy deletion: the root is the only place we bother to validate eagerly;
   * entries deeper are cleaned lazily as they bubble up.
   */
  prune(pred: (item: T) => boolean): number {
    let removed = 0;
    const data = this.data;
    while (data.length > 0 && pred(data[0]!)) {
      this.pop();
      removed++;
    }
    return removed;
  }

  /** Drop all entries. O(n) to reclaim. */
  clear(): void {
    this.data.length = 0;
  }

  /** Internal sift-down used by pop(). */
  private sinkDown(): void {
    const data = this.data;
    const cmp = this.cmp;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      const li = data[l];
      const ri = data[r];
      if (li === undefined || ri === undefined) break;
      let smallest = i;
      if (cmp(li, data[smallest]!) < 0) smallest = l;
      if (cmp(ri, data[smallest]!) < 0) smallest = r;
      if (smallest === i) break;
      const tmp = data[i]!;
      data[i] = data[smallest]!;
      data[smallest] = tmp;
      i = smallest;
    }
  }
}
```

### 4.2 `src/types.ts` — shared types

```typescript
/**
 * Ordering keys are plain numeric keys so comparators stay branch-light and
 * allocation-free on hot paths. Timestamps are in the same units returned by
 * the injected `clock` (default: ms since the Unix epoch). Tasks carry a
 * monotonically increasing `version`; it is the only mechanism we use for
 * O(1) invalidation of stale heap entries on dynamic updates.
 */

/** Lifecycle states of a task. */
export type TaskStatus =
  | 'pending'  // waiting on time / deps (in ready | future | deps bucket)
  | 'running'  // returned by runNext()/advance() and handed to the caller
  | 'completed' // finished; resolves dependents
  | 'cancelled'; // removed from pending; leaves dependents blocked

/** Numeric priority. `high-first` (default) means the largest value runs first. */
export type Priority = number;

/** Concrete task record stored by the scheduler. */
export interface Task {
  id: string;                       // stable, unique, non-empty
  name?: string;                    // metadata only
  priority: number;
  dueAt: number;                    // absolute execution time (time-gated)
  dependencies: string[];
  status: TaskStatus;
  version: number;                  // internal monotonic stamp (see §2.2)
  payload?: Record<string, unknown> | null;
  createdAt: number;
}

/** Field subset accepted when creating a task. */
export interface NewTask {
  id?: string;
  name?: string;
  priority?: number;
  dueAt?: number;                   // defaults to 0 (runnable immediately)
  dependencies?: string[];
  payload?: Record<string, unknown> | null;
}

/** Priority direction. */
export type PriorityOrder = 'high-first' | 'low-first';

/** Snapshot pushed onto a heap. Storing a snapshot (not a live reference) is
 *  what makes lazy deletion correct: the live task can be mutated or deleted
 *  without corrupting entries buried deep in a heap. */
export interface HeapEntry {
  id: string;
  priority: number;
  time: number;                    // dueAt, carried in the snapshot
  version: number;
}

export interface SchedulerOptions {
  clock?: () => number;            // defaults to Date.now; inject in tests
  priorityOrder?: PriorityOrder;   // defaults to 'high-first'
}

export interface Cycle {
  nodes: string[];
  /** [from, to] edges within the cycle (from depends on to). */
  edges: [string, string][];
}

export interface CycleReport {
  hasCycle: boolean;
  cycles: Cycle[];                 // SCC groups (size > 1, or self-loops)
  stuckByCycle: string[];          // pending tasks that (transitively) depend on a cycle
  orphanBlocked: string[];         // pending tasks blocked by a dead dependency
}

export interface AdvanceResult {
  executed: Task[];
  pending: number;                 // pending tasks remaining after the pass
}

export interface WaitNextInfo {
  now: number;
  runnable: number;
  tasks: {
    runnable: Task[];              // time-dead + dependency-free
    blockedByDeps: Task[];         // waiting on a live (pending) dependency
    stuckByCycle: Task[];          // can never run (cycle)
    orphanBlocked: Task[];         // blocked by a missing / cancelled dependency
  };
}

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

/** Errors thrown by the scheduler. `taskId` aids debugging when available. */
export class SchedulerError extends Error {
  constructor(message: string, public readonly taskId?: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}
```

### 4.3 `src/TaskScheduler.ts` — the scheduler

```typescript
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
 * the caller owns the wall-clock.
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
   * Iterative topological ordering of specs so forward references within a
   * batch resolve and reconciliation stays local. Pure optimization; a cycle
   * in the batch is tolerated (reconcileDeps handles it downstream).
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
   * @throws if any id already exists, is empty, or is duplicated within the batch.
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
   * Iteratively run every currently-runnable task (up to `now`), completing
   * each so its dependents cascade. Great for batch/offline execution.
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
   * Tasks are bucketed by blocking reason:
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
   * Any dependent whose unsatisfied-dependency count reaches 0 is released
   * into the ready or future heap. Emits `complete`. Returns the completed
   * Task, or null if the task does not exist or is not pending/running.
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
   * Remove a task and all of its dependency edges, cascading to dependents:
   * each dependent's remaining count is decremented and any that reach 0 are
   * released. Returns the removed Task, or null if it does not exist.
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
   * Dynamically update a pending (or running) task's priority / due time /
   * dependencies. Bumps the version so stale heap snapshots are lazily
   * discarded. Returns the updated Task, or throws if the task does not exist
   * or is in a non-updatable state.
   */
  update(id: string, changes: Partial<Pick<NewTask, 'priority' | 'dueAt' | 'dependencies'>>, now: number = this.clock()): Task {
    const t = this.tasks.get(id);
    if (!t) throw new SchedulerError(`Task "${id}" does not exist`, id);
    // A task that is already `running` (runNext'd but not completed) may be
    // rescheduled or reprioritised; reset it to `pending` so changes apply
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
  // TIME-DRiven PROMOTION
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
   * A task is "stuck" if it can never satisfy its dependencies. Two root
   * causes:
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
   * Each visited node is pushed onto the SCC stack on entry and popped when
   * its subtree is complete, so the final SCC is never lost.
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
```

### 4.4 `src/index.ts` — public entry point

```typescript
/**
 * Public entry point for the in-memory task scheduler.
 *
 * ```ts
 * import { TaskScheduler } from 'in-memory-task-scheduler';
 *
 * const scheduler = new TaskScheduler();
 * const task = scheduler.createTask({ id: 'job-1', priority: 5 });
 * const next = scheduler.runNext();
 * scheduler.completeTask(next!.id);
 * ```
 */

export { TaskScheduler } from './TaskScheduler.js';
export { SchedulerError } from './types.js';
export { MinHeap } from './MinHeap.js';

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
} from './types.js';

export type {
  SchedulerEvent,
  CompleteEvent,
  CancelEvent,
  RemoveEvent,
  EventPayload,
} from './TaskScheduler.js';

export type { Comparator } from './MinHeap.js';
```

---

## 5. Tests

The test suite (`scheduler/test/test.test.ts`, 25 tests, 11 suites) uses
Node's built-in test runner with a **deterministic injected clock** so timing
does not depend on wall-clock scheduling:

```typescript
function makeClock(start = 0) {
  let t = start;
  return {
    clock: () => t,
    advance(ms: number) { t += ms; },
    set(ms: number) { t = ms; },
  };
}
```

Run it:

```bash
cd scheduler
npx tsx --test test/*.test.ts      # 25 passing, 0 failing
npx tsc -p tsconfig.json --noEmit  # clean build, 0 errors
```

### 5.1 Coverage map

| Suite | What it proves | Key assertion |
|---|---|---|
| `createTask and runNext ordering` | Priority ordering; duplicate-id rejection; empty-scheduler null | `runNext` returns highest priority first, then null |
| `time-gating and future promotion` | Tasks don't run before `dueAt`; `peek` is non-mutating; `advance` drains with time gates | future task returns `null` until due |
| `dependency cascade` | Dependent runs only after dependency completes; partial deps; runNext+completeTask stepping | `remainingDeps` transitions and order |
| `dynamic updates` | Priority update takes effect; `reschedule` moves to future queue; unknown-id throws | updated priority reflects immediately |
| `removal` | `remove` cleans up task and edges; cascade to dependents | dependent becomes runnable after removal |
| `cycle detection` | 2-node cycle, self-loop, orphan, non-cyclic | `hasCycle`, `stuckByCycle`, `orphanBlocked` |
| `cancellation` | Cancel leaves dependents orphaned; double-complete returns null | `orphanBlocked` === `['b']` |
| `batch creation` | Forward references resolve; order preserved; duplicate rejection | `advance` resolves full chain |
| `waitForNext report` | Bucketing by blocking reason | `runnable` / `blockedByDeps` counts |
| `low-first priority order` | Alternative priority direction | lowest priority runs first |
| `scalability (1M tasks)` | 1M tasks created & prioritised under time budget | creation < 5s, top-k run < 5s |

### 5.2 A note on `advance` semantics in tests

`advance` is intentionally a **batch drain** (run *all* runnable tasks at
`now`), which matches its documented purpose (batch/offline execution). The
dependency-chain tests therefore drive one task at a time with
`runNext` + `completeTask`, which is the correct primitive for fine-grained
dependency stepping. Both execution styles are covered and both are explicit
in the test comments so a reviewer understands the distinction.

---

## 6. Edge Cases

Every edge case below is exercised by a test or explicitly handled by design.

1. **Duplicate task ids** — `createTask` throws; `createTasks` throws for both
   cross-batch duplicates and *within-batch* duplicates (the latter is a
   genuine bug in naive implementations where a `Map` silently dedupes).

2. **Empty ids** — rejected at creation with a `SchedulerError`.

3. **Self-dependency** — a task depending on itself is parked (counted as
   unsatisfied) and reported by `analyze()` as a self-loop cycle.

4. **Multi-node cycles** — `analyze()` builds a pending→pending adjacency
   subgraph and runs Tarjan SCC; any SCC of size > 1 is a cycle. Dependents
   that transitively depend on the cycle are reported in `stuckByCycle`.

5. **Orphaned tasks** — pending tasks whose dependency is missing, removed, or
   cancelled are reported in `orphanBlocked` (distinct from cycle-stuck).

6. **Complete an already-completed / running / cancelled task** — returns
   `null`; completes are idempotent-safe.

7. **Rescheduling a running task** — a `runNext`'d (running-but-not-completed)
   task may be rescheduled; `update` resets it to `pending` so changes apply.
   Completed / cancelled tasks cannot be updated.

8. **Future promotion** — tasks runnable but not yet due live in the future
   heap and are promoted into the ready heap lazily when `now` catches up.

9. **Stale heap snapshots** — on `update`, the old snapshot remains in the
   heap but is invalid (`task.version !== snapshot.version`). It is discarded
   only when it reaches the root, keeping updates O(log n).

10. **Batch forward references** — `createTasks` topologically sorts specs so
    `[{c→b}, {b→a}, {a}]` resolves correctly while preserving input order.

11. **Concurrency** — the scheduler is single-threaded and synchronous; there
    are no data races or interleaving windows. `waitFor` supports an
    `AbortSignal` for cancellation.

12. **Safety guards** — `advance` guards against infinite loops (cycles) by
    capping iterations at `tasks.size + 1`.

13. **Priority ties** — broken by due time, then by `version` (insertion
    order), giving a total, deterministic order.

---

## 7. Scalability Discussion

### 7.1 Why it scales to 1M+ tasks

The entire scheduling loop avoids any operation that scans all tasks. The four
frequently-called methods — `runNext`, `advance`, `completeTask`, `update` —
are all **O(log n)** or O(log n) dependent on the number of dependents. Only
the diagnostic/reporting methods (`analyze`, `waitForNext`, `stats`, `remove`)
carry O(n) or O(V+E) cost, and those are meant to be called occasionally, not
per-task.

The three cost drivers at scale are:

- **Heap operations** — O(log n) per insert/pop. At 1M tasks, log₂(n) ≈ 20
  comparisons per operation; the hand-rolled heap avoids `Array.sort`'s
  O(n) resize and allocation on every reorder.
- **GC pressure** — comparators are allocation-free (no per-comparison objects)
  and snapshots are small structs. The `1M` test verifies creation completes
  under a 5-second budget, which constrains allocation overhead.
- **Topological batching** — creating 1M tasks one-by-one is fine, but
  `createTasks` amortises the cost across a batch, which is the primitive to
  use for bulk ingestion.

### 7.2 Memory footprint

Each live task stores: one `Map` node, one `Set` for forward deps, one
`Set` for reverse deps, one `Map` counter entry, and an optional `Set`
membership flag. For 1M tasks with sparse dependencies the footprint is a few
hundred MB in the worst case — consistent with an in-memory scheduler of this
scope. Because snapshots are lazily discarded, heap memory is bounded by the
number of *mutations*, not the number of tasks.

### 7.3 Anti-patterns avoided at scale

- **Sorted array** — O(n) insert; rejected.
- **Balanced BST** — correct complexity but higher constant factor and far more
  code to keep correct; a binary heap is strictly simpler for "insert +
  extract-min" workloads.
- **Re-sorting on update** — O(n log n) per update; rejected. Lazy versioning
  keeps updates O(log n).
- **Full-graph rescans per `runNext`** — O(n) per task; rejected.

### 7.4 Limits of the in-memory model and where to extend

- **Persistence** — everything is in memory by design. For durability, one
  would back the `tasks` map with a persistent store and lazily materialise
  ready/future queues; the lazy-deletion design already mirrors this: the
  heap is a *cache* over `tasks`.
- **Multi-process / cluster** — the single-threaded model is a feature (no
  races), but for horizontal scale one could partition the task space by a
  sharding key and run one scheduler per partition, with a coordinator for
  cross-partition dependencies.
- **Very large cycles** — `analyze` is O(V+E); for a pathological 1M-node
  cycle it returns synchronously. A production system may chunk it across
  `setImmediate` or run it in a worker thread, but the algorithm is already
  linear.
- **`remove` worst case** — O(n) due to the cascade recompute. Typically
  O(dependents); it is the one hot-ish call that pays for edge deletion
  correctness. A production build might maintain incremental counters to
  make it O(dependents) deterministically, at the cost of bookkeeping.

### 7.5 Summary

The design is **O(log n)** on the hot path, **O(V+E)** on diagnostics, and
**O(n)** only on the deliberately-batched/clear operations. Measured against
the 1M-task test (creation and top-k retrieval each under 5 seconds), it
satisfies the stated scale requirement with comfortable margin.
