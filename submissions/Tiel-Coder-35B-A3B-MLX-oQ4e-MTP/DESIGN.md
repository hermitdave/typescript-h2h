# TaskScheduler — Design Document

An in-memory, priority-aware task scheduler in TypeScript. Targets **~1,000,000**
in-flight tasks with:

- Priorities and per-task execution timestamps (`runAt`).
- Directed dependencies (`task` depends on `dep`), added at construction time or
  via an edge-mutation API.
- Dynamic updates: priority and `runAt` changes take effect immediately.
- Cycle detection on edge insertion.
- O(log n) retrieval of the next executable task; O(1) peek.
- Cancellation with cascade; deterministic tie-breaking.

The design is **reactive**: a task's heap membership is *fully determined* by its
lifecycle state, so every structural mutation performs the smallest set of heap
operations required to reach that state. There is no separate "location" bookkeeping
that can drift out of sync.

## 1. Architecture

The scheduler is a thin control layer over three structures:

```
                ┌─────────────────────────────────────────────────────────┐
   user ──────▶ │ TaskScheduler                                            │
                │                                                          │
   add ────────▶│  tasks   Map<internedId, Task>  (authoritative truth)    │
   update ─────▶│  readyHeap BinaryHeap  (priority desc, runAt asc, seq asc)│
   complete ▶───│  timeHeap  BinaryHeap  (runAt asc, seq asc)               │
   cancel ─────▶│  waiters   Map<internedDepId, Set<internedTaskId>>         │
                │                 reverse dependency index                    │
                └─────────────────────────────────────────────────────────┘
```

### Supporting modules

| Module            | Responsibility                                                        |
| ----------------- | --------------------------------------------------------------------- |
| `binaryHeap.ts`   | Index-backed binary min/max heap with O(log n) `remove` / re-key.    |
| `intern.ts`       | Id → stable-string interning so heap keys are always strings.         |
| `errors.ts`       | Typed error hierarchy (`DuplicateTaskError`, `InvalidArgumentError`,  |
|                   | `InvalidTaskStateError`, `UnknownDependencyError`, `TaskSchedulerError`). |
| `types.ts`        | Public data model: `TaskState`, `TaskSpec`, `Task`, `TaskUpdate`, `TaskId`. |
| `taskScheduler.ts`| The scheduler orchestration described here.                            |

Interning (a string table) lets the public API accept `string | number` ids while
the heap internals — which need comparable string keys — stay uniform.

## 2. Data Structures

### 2.1 Two index-backed binary heaps

`BinaryHeap<K>` is a standard binary heap with an **id → position index map**, so
`remove(id)` and re-keying an existing element run in O(log n) instead of scanning
O(n). Both heaps store `HeapEntry = { id: string, task: Task }`:

- **`readyHeap`** — max-priority order. Comparison: higher `priority` first, then
  earlier `runAt`, then earlier insertion `seq` (FIFO). Contains exactly the tasks
  that are **READY** (dependencies satisfied *and* `runAt` due). This heap is the
  single source of truth for "what runs next."
- **`timeHeap`** — min `runAt` order, tie-broken by `seq`. Contains exactly the
  tasks that are **WAITING** (dependencies satisfied but `runAt` still in the
  future). Drives time-based readiness.

### 2.2 Authoritative state map

`tasks: Map<internedId, Task>` holds every tracked task (`Task` includes the public
fields plus internal bookkeeping: `remainingDeps`, `seq`, `state`, `version`, etc.).
Heap membership is *derived*, not stored.

### 2.3 Reverse-dependency index

`waiters: Map<internedDepId, Set<internedTaskId>>` lets a `complete(id)` / `remove(id)`
look up exactly the dependents to re-evaluate, in O(k) where k is the out-degree — no
graph scan.

## 3. State Machine

Every task is in exactly one state, and each state maps to a unique heap location:

| State        | Heap location            | Meaning                              |
| ------------ | ------------------------ | ------------------------------------ |
| `PENDING`    | no heap                  | ≥1 outstanding dependency            |
| `WAITING`    | `timeHeap` only          | deps satisfied, `runAt` future        |
| `READY`      | `readyHeap` only         | deps satisfied, `runAt` due           |
| `RUNNING`    | no heap                  | handed to caller via `runNext`        |
| `DONE`       | no heap                  | completed                              |
| `CANCELLED`  | no heap                  | cancelled (possibly cascaded)          |

Four private transitions reconcile membership:

- `_setReady` / `_setWaiting` — two heap ops each (`remove` from the stale heap,
  `push` into the new one; both `remove` calls are idempotent so re-keying within
  one state only costs one `push`).
- `_setPending` / `_setRunning` — remove from both heaps.

Because membership equals state, the invariant "no task is in two heaps" can never
drift.

## 4. Public API

| Method                        | Effect                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| `add(spec)`                   | Register a task; throws on dup id, missing id, non-finite priority, |
|                                 | non-finite runAt, unregistered dep, self-dep.                        |
| `update(id, patch)`           | Change `priority` / `runAt` / `payload`; re-key in O(log n).        |
| `addDependency(from, to)`     | Add edge `from` depends on `to`; idempotent; rejects self-edges and |
|                                 | cycles.                                                              |
| `complete(id, result?)`       | Mark a RUNNING task DONE; returns dependents newly promoted to READY |
|                                 | (and re-keyed).                                                      |
| `remove(id)`                  | Detach a task; unblocks its dependents; throws if RUNNING.          |
| `cancel(id)`                  | Cascade CANCELLED across not-yet-DONE dependents; returns all        |
|                                 | cancelled public ids.                                                |
| `tick()`                      | Promote WAITING tasks whose `runAt ≤ now` to READY. Timer-neutral.  |
| `runNext()`                   | Pop the highest-priority READY task, mark RUNNING, return it. O(log n). |
| `next()` / `peek()`           | Highest-priority READY task without mutation. O(1).                 |
| `getState`, `get`, `toJSON`   | Introspection / serialization.                                        |
| `clear()`                     | Empty everything (keeps the intern table); returns prior size.      |

In production, `_updateTimer` schedules a `setTimeout` to the earliest future
`runAt`; on fire, `_drain` calls `tick()` **once**. `tick()` itself never touches
timers, so the auto-path cannot recurse even if a task is immediately runnable.

## 5. Complexity Analysis

Let **n** = number of tracked tasks, **m** = number of dependency edges.

| Operation            | Complexity              | Notes                                                       |
| -------------------- | ----------------------- | ----------------------------------------------------------- |
| `peek` / `next`      | **O(1)**                | Root of `readyHeap`.                                        |
| `runNext`            | **O(log n)**            | One heap `pop`.                                             |
| `add`                | **O(k log n)**          | k = deps added (at most one push + O(1) re-key per edge).   |
| `update`             | **O(log n)**            | Re-key a single task.                                       |
| `complete`           | **O(k log n)**          | k = immediate dependents re-evaluated.                      |
| `remove`             | **O(k log n)**          | k = dependents re-evaluated (deps mutated in O(1) each).    |
| `cancel`             | **O(k log n)**          | k = tasks in the cancelled subtree.                          |
| `addDependency`      | **O(V + E)** worst case | The cycle check is a reachability DFS; heap bookkeeping is  |
|                      |                         | O(log n). Only when the edge is actually inserted.          |
| `tick`               | **O(r log n)**          | r = tasks promoted because their `runAt` is due.            |
| `clear`              | **O(n)**                | Flushes all maps/heaps.                                     |

Heap-size amortization: the two heaps together hold at most `remaining` entries
(the ready and time subsets are disjoint), so `n` in the bounds above is really the
number of in-flight (non-terminal, non-pending) tasks — typically much smaller than
total tracked.

## 6. Edge Cases & Correctness Guarantees

- **Cycles.** `add` inserts a brand-new node with no incoming edge, so a new
  dependency edge can only create a cycle at `addDependency`. The check
  `_wouldCycle(from, to)` walks dependency edges from `to` to see if it can already
  reach `from` — a standard reachability test. Self-edges are rejected outright.
  Because `add` never adds incoming edges, cycles are impossible there.
- **Complete-before-running.** `complete` throws if the task is not `RUNNING`
  (`InvalidTaskStateError`). Completing a `DONE` task on a second call also throws
  (state guard).
- **Cancellation cascade.** A RUNNING ancestor cannot be cancelled; the cascade is
  a bounded BFS over not-yet-DONE dependents and terminates because of a visited
  set. Cancelled tasks are **kept registered** (state `CANCELLED`, detached from
  heaps/graph) so callers can still inspect them by public id — they are not wiped
  from `tasks`.
- **Dependency ordering under concurrency.** `complete` re-evaluates dependents in
  order, skipping any that are already `RUNNING` (an out-of-order ancestor still in
  flight). This preserves correctness for tasks with partial completion.
- **Duplicate/absent ids.** `add` rejects duplicate ids; `remove`/`complete` behave
  correctly for unknown ids (remove → `undefined`, complete → throws).
- **Non-finite inputs.** `NaN`/`Infinity` priority/runAt are rejected as
  `InvalidArgumentError` at `add` and `update`.
- **Deterministic tie-breaks.** Equal priority + equal `runAt` resolve by insertion
  order (`seq`), giving FIFO behavior. Equal-priority future tasks resolve by
  earliest `runAt` first.
- **Heap-stale-entry safety.** `tick` skips entries whose current state is not
  `WAITING` (they may have been cancelled/removed/renamed), preventing stale
  re-insertion.
- **Timer non-recursion.** `tick` is deliberately timer-neutral; `_updateTimer`
  schedules at most one timer and `_drain` calls `tick` once, so a self-promoting
  never re-arms itself and blows the stack.

## 7. Scalability Discussion

**Working set.** Heap membership tracks *in-flight* (waiting + ready) tasks, not
done/cancelled ones. Even at 1M total tracked tasks, only the due/future subset
populates the heaps, so `runNext`, `complete`, and `update` stay cheap in practice.
The `tasks` map dominates memory (one object + entry per tracked task ≈ a few MB at
1M), and the intern table grows with the number of *distinct* ids ever seen.

**Memory.** Each task is one small object; the two heaps hold at most `remaining`
entries each; `waiters` holds one set entry per edge. For 1M tasks with O(1) edges
this is a few dozen MB — comfortable. Interleave churn (add/remove/re-add) is
dampened because the intern table is retained across `clear()` calls.

**Activation/latency.** Only tasks with a future `runAt` need timer maintenance.
`_updateTimer` arms a single `setTimeout` for the *earliest* such task; when it fires,
`tick` drains every task that is due at that instant in one pass. Idle time spans
cost nothing. There is no busy-poll, no polling loop, and no per-task timer.

**Bounded re-evaluation.** Completing or removing a task touches only its direct
dependents — an O(k) work-isolation property that keeps hot paths local and avoids
re-scanning the whole DAG. This is what makes `complete` survive large fan-out.

**Cycle-detection cost.** The one deliberately heavier operation is `addDependency`
(O(V+E) for the reachability walk). That is acceptable for a control-plane action;
it is not on the per-task hot path (`runNext`/`complete`). Cycle checks can be made
incremental later (e.g. a topological ordering cached per weakly-connected
component) if edge insertions become a hotspot.

**Concurrency.** This is a single-threaded, synchronous scheduler — there are no
locks and no atomicity gaps because no await points exist inside an operation. To
scale past a single thread, the public surface partitions by independent sub-graphs
or by worker; each partition runs its own `TaskScheduler`. The injectable clock and
timer hooks (`now`, `setTimeoutFn`, `clearTimeoutFn`) make this transparent to swap
in a message-passing boundary without touching the core logic.

**Node specifics.** `setTimeout` delay is clamped to a 32-bit signed int; for
scheduled work beyond ~24 days, arm the timer for the near term and re-arm in
`_drain` when the scheduled time is still further out. This is already implicit in
the design (`_updateTimer` only arms for the *earliest future* gap), but the clamp
should be bounded explicitly in `_updateTimer` if sub-day timers are required.

## 8. How to Run

```bash
npm install --save-dev tsx     # dev-only: runs the .ts test suite
node --import tsx --test --test-reporter=spec test/*.test.ts
```

The production code uses `.js` import specifiers per the `NodeNext` module setting
in `tsconfig.json`; `tsx` is the only dev dependency, and it rewrites the specifiers
on the fly for the test run.
