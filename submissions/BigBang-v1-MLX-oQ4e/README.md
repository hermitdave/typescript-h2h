# In-Memory Task Scheduler

A production-ready, in-memory task scheduler in TypeScript supporting:

- **Priorities** (higher value = more important, run first)
- **Execution timestamps** (`scheduledAt`; tasks become executable only when `now >= scheduledAt`)
- **Dependency tracking** (a task runs only after all its dependencies have completed)
- **Cycle detection** (rejects any add/update that would create a dependency cycle, including through forward references)
- **Dynamic updates** (priority, scheduled time, and dependency set can be changed at runtime)
- **Efficient retrieval of the next executable task** (O(log n) heap pop)

Designed to operate on **~1 million tasks** with O(log n) heap operations and O(k) cycle-detection per add/update (k = number of declared dependencies).

## Architecture

The scheduler is a single class, `TaskScheduler`, backed by a few well-chosen data structures:

| Structure | Purpose |
|-----------|---------|
| `Map<string, Task>` `tasks` | all tasks, keyed by id |
| `Map<string, Set<string>>` `forward` | task → its dependencies |
| `Map<string, Set<string>>` `reverse` | task → the set of tasks that depend on it |
| `BinaryHeap<HeapEntry>` `readyHeap` | max-heap of tasks whose deps are satisfied and `scheduledAt <= now`, ordered by priority → scheduled time → id |
| `BinaryHeap<HeapEntry>` `deferredHeap` | min-heap of tasks whose deps are satisfied but `scheduledAt > now`, ordered by scheduled time → priority → id |

Each `HeapEntry` records the task's `version` (a monotonically increasing epoch) at push time. This enables **lazy deletion**: when a task's priority or scheduled time changes, we bump its version and push a fresh heap entry; the old entry is silently skipped when popped because its version no longer matches the current task version. This avoids O(n) removals from the heap.

### Task life-cycle states

- `pending` — declared, but not yet executable (deps not satisfied, or scheduled in the future, or waiting to be dequeued)
- `running` — removed from the ready heap and awaiting a terminal update
- `completed` / `failed` / `cancelled` — terminal
- `blocked` — waiting on a dependency that has failed or been cancelled

A task is **ready** when every dependency has status `completed` and none has failed/cancelled. Ready tasks with `scheduledAt <= now` go onto `readyHeap`; those with a future `scheduledAt` go onto `deferredHeap` (and are moved to `readyHeap` when time arrives).

### Cycle detection

When adding/updating task `T` with a new dependency set `D`, we run a depth-first search from each `d ∈ D`, following the forward graph `forward[node]`. If any `d` can reach `T`, then `d` (transitively) depends on `T`, and adding the edge `T → d` would create a cycle — the operation is rejected. This correctly handles:

- self-dependencies
- direct cycles (A→B→A)
- transitive cycles (A→B→C→A)
- cycles created by updates
- cycles involving forward references (A depends on non-existent B; when B is later added depending on A, the cycle is detected and rejected)

### Propagation

When a task reaches a terminal status, its dependents are updated:

- a completed dependency increments the dependent's completed count; when all deps are completed, the dependent becomes ready (moved to `readyHeap` or `deferredHeap`)
- a failed/cancelled dependency blocks the dependent

The "move to ready" is guarded so it fires **only on the transition** from not-ready to ready (checked via `wasReady = isReady(dep)` before the dep-status change). This prevents duplicate heap entries from duplicate completion events.

## Complexity

| Operation | Time | Notes |
|-----------|------|-------|
| `addTask` | O(k log n) | k deps; cycle DFS is O(V+E) over the reachable subgraph, bounded by the number of tasks reachable from deps |
| `updateTask` | O(k log n) | same as add (re-validates cycle, re-pushes) |
| `addDependency` / `removeDependency` | O(k log n) | adds/removes one edge, re-validates cycle |
| `completeTask` / `failTask` / `cancelTask` | O(d log n) | d = number of dependents; propagates and re-pushes |
| `dequeueNextExecutable` | O(log n) | heap pop with lazy stale-entry cleanup |
| `peekNextExecutable` | O(log n) amortized | cleans stale entries at the top |
| `getExecutableTasks` | O(n) | must inspect all ready entries (read-only, restores heap) |
| `resetTask` | O(k log n) | re-evaluates and re-queues |

Space: O(n + m + u), where n = tasks, m = dependency edges, u = updates (stale heap entries are lazily reclaimed).

## What the tests cover

`tests/scheduler.test.ts` (36 tests) validates:

- single-task execution, priority ordering, and scheduled-time deferral
- dependency satisfaction (single, multi, chained)
- cycle detection (self, direct, transitive, update-induced, forward-reference-induced)
- dynamic priority / scheduled-time / dependency updates
- complete / fail / cancel propagation and blocked-state handling
- `resetTask` recovery
- event listeners and crash-isolation
- edge cases (empty scheduler, all-terminal, deferred-then-ready, forward references)

`tests/stress.test.ts` adds a 1,000,000-task add-then-drain test.

## Usage

```ts
import { TaskScheduler } from './src';

const s = new TaskScheduler();
s.addTask({ id: 'a', priority: 1, scheduledAt: Date.now(), payload: 'do stuff' });
s.addTask({ id: 'b', priority: 2, scheduledAt: Date.now(), deps: ['a'] });

let task: ReturnType<typeof s.dequeueNextExecutable>;
while ((task = s.dequeueNextExecutable()) !== null) {
  try {
    await runTask(task.id, task.payload);
    s.completeTask(task.id, result);
  } catch (err) {
    s.failTask(task.id, err);
  }
}
```

The scheduler is time-agnostic: call `s.setTime(x)` to inject a fake clock, or pass `new TaskScheduler(now)` to a constructor.

## Repository layout

```
src/
  types.ts        # Task, TaskInput, TaskPatch, HeapEntry, StatusListener
  heap.ts         # generic binary heap (max by comparator)
  scheduler.ts    # TaskScheduler
  index.ts        # re-exports
tests/
  scheduler.test.ts
  stress.test.ts
package.json
tsconfig.json
```

## Notes & design decisions

- **Dependencies must exist at add/update time** in the sense that `deps` references are validated against the existing task set; however, **forward references** are supported — a task may depend on an id that does not yet exist. The dependency is recorded as `pending` and resolved when the dep task is later added. This is how `deps: string[]` is interpreted: as a set of task ids whose *current* status determines the dep status (`completed`/`failed`/`pending`).
- **Dependency sets are replaced** on `updateTask({ deps })` and on `addDependency`/`removeDependency` (granular single-edge mutations).
- **Blocked tasks** are permanent until `resetTask` resets them to pending (this is the recovery mechanism for a task stuck behind a failed dependency).
- **Duplicate completion events** are idempotent: a dependency is only counted once (its status is tracked in `depStatus`).
- Priority update on a running task is rejected (the task is already dequeued); scheduled-time changes on running tasks are also rejected. Payload can always be updated.
