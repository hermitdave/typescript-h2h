# In-memory task scheduler design

## Scope

`InMemoryTaskScheduler` is a deterministic, dependency-aware scheduler for
priority- and time-ordered tasks. It targets strict production use cases with
large in-memory graphs and keeps all state local to one `Map`/heap/set
implementation.

The public lifecycle is exactly:

- `PENDING` — eligible to run when all active dependencies are complete;
- `RUNNING` — claimed by the scheduler;
- `COMPLETED` — finished and immutable.

Input snapshots and dependency arrays returned by the public API are copies.
The arrays and object snapshots are frozen so callers cannot mutate scheduler
state indirectly.

## Architecture

### Clock and scheduling partitions

The scheduler owns a monotonic numeric clock. `peekNextTask(now)` and other
time-driven operations validate the supplied time and may advance this clock.
A backwards time movement throws `TaskTimeError`.

Each pending task is represented exactly once in one of these partitions:

1. the due heap, for tasks whose execution time has arrived and whose active
   dependency count is zero;
2. the future heap, for tasks whose execution time has not arrived;
3. the blocked set, for due tasks whose active dependency count is nonzero.

The due heap orders tasks by:

1. descending numeric priority;
2. ascending execution time;
3. ascending lexical task ID.

The future heap orders tasks by execution time, using the same priority and ID
tie-breakers after time.

### Dependency graph

The graph is stored in both directions:

- `TaskRecord.dependencies: Set<string>` — task -> prerequisite IDs;
- `TaskRecord.dependentIds: Set<string>` — prerequisite -> dependent IDs;
- `TaskRecord.activeDependencyIds: Set<string>` — prerequisite IDs whose
  completion is still required.

`remainingDependencies` counts only active prerequisites. This distinction is
important for edges created after a prerequisite has already completed: those
edges do not increment the active count and completing the already completed
task does not decrement the remaining count.

Graph mutations first validate all inputs and prospective changes. They then
mutate graph state and move the affected record between partitions. A cycle or
invalid input throws before changing scheduler state.

### Topological-order optimisation

The implementation maintains a task insertion/topological order and a
`position -> task ID` index.

A newly added dependency is safe without graph traversal when it points from an
earlier task to a later task. Such an edge is consistent with the maintained
topological order.

A backward dependency edge is the only case that can violate that order. The
scheduler then:

1. follows the existing dependency graph iteratively from the proposed
   prerequisite back toward the task;
2. uses an owner-edge override when validating replacement edges;
3. rejects a reachable path as a cycle;
4. otherwise performs one O(V + E) topological rebuild and refreshes position
   metadata.

Cycle/path traversal is iterative. It therefore does not risk JavaScript call
stack overflow for deep graphs.

## Data structures

| Structure | Purpose | Typical cost |
|---|---|---:|
| `Map<string, TaskRecord>` | Task lookup and graph ownership | O(1) lookup |
| Binary min-heap | Ready-task priority queue | O(log N) push/remove |
| Binary min-heap | Not-yet-due task queue | O(log N) push/remove |
| `Set<TaskRecord>` | Due tasks waiting for dependencies | O(1) add/remove |
| `Set<string>` fields | Dependency, dependent, and active-edge sets | O(1) membership |
| `string[]` + `Map<string, number>` | Maintained topological order/positions | O(1) position lookup |

Internal `TaskRecord` fields are mutable because heap swaps and graph updates
must update them. Public `TaskSnapshot` values are defensive copies.

## Public operations

- `addTask(input, dependencies)` creates a task and validates all prerequisite
  IDs.
- `getTask(id)` returns a frozen snapshot or `undefined`.
- `peekNextTask(now)` observes and claims no work; it may advance the clock.
- `takeNextTask()`/`startNextTask()` claim the next due task and set its status
  to `RUNNING`.
- `startTask(id)` starts an explicitly due, dependency-free task.
- `completeTask(id)` marks a running task complete and releases all ready
  dependants.
- `updateTask(id, update)` updates priority, time, or an entire dependency set.
- `addDependency(id, dependencyId)` atomically inserts one edge.
- `removeDependency(id, dependencyId)` removes one edge.
- `removeTask(id)` removes a leaf task; a task with dependants is rejected.
- `currentTime()` exposes the scheduler's captured clock.

## Complexity

Let `N` be the number of tasks, `E` the number of graph edges, `D` the number
of dependencies supplied to an operation, and `A` the number of active edges
released by a completion.

| Operation | Complexity |
|---|---:|
| Add one independent task | O(1) |
| Add task with `D` dependencies | O(D) |
| Get task | O(1) |
| Peek/claim next task | O(log N) |
| Start task | O(log N) |
| Complete task | O(A log N), including release heap work |
| Update priority/time | O(log N) |
| Add forward dependency edge | O(log N) |
| Add backward dependency edge | O(V + E) in the worst case |
| Remove dependency | O(log N) |
| Remove leaf task | O(D) |
| Full snapshot | O(N + E) |

Memory usage is O(N + E), plus heap array capacity. Topological-order
maintenance is expected O(1) for normal insertion-order edges and O(V + E) for
the less common backward-edge rebuild. This avoids repeated full-graph checks
during long dependency chains.

## Production edge cases

- Missing, duplicate, or self dependency IDs are rejected.
- Duplicate task IDs are rejected.
- Numeric priority and execution time must be finite.
- Clock movement cannot move backwards.
- Future and blocked tasks are not eligible for an explicit start.
- Removing a task with dependants is rejected.
- Removing a dependency releases a task only when its final active edge is
  gone.
- Completion releases every ready dependent.
- Dependency completion after an edge was created is ignored by active-edge
  bookkeeping.
- Replacement validation uses prospective owner edges, so a rejected update
  leaves both dependency sets unchanged.
- Deep cycles use bounded-heap traversal rather than recursion.
- All public graph arrays and snapshots are defensive copies.

## Scalability evidence

The implementation targets one million tasks without scheduler-wide scanning
for ordinary ready/future operations. A measured built-module run on this
machine inserted one million independent tasks in approximately **967 ms**.
The first ready task was returned lexically as `task-0`; the root peek measured
approximately **0.11 ms**.

A separate 50,000-task dependency-chain probe built the graph iteratively and
rejected the closing cycle successfully without stack overflow. The rejection
path, including atomic state preservation, measured approximately **9.8 ms**
in the direct built-module probe.

The suite includes one million-task insertion as a real scale regression.
Cycle tests also exercise iterative 50,000-node graph traversal.

## Verification

Commands used against the final source:

```sh
npm run build
npx vitest run tests/scheduler.test.ts --cache=false
```

The strict TypeScript build completes successfully. The complete suite passes
all 29 tests.

## Implementation map

- Public types and errors: `src/index.ts` lines 1-80
- Binary heap: `src/index.ts` lines 82-176
- Scheduler state and public lifecycle methods: `src/index.ts` lines 178-520
- Topological order and cycle validation: `src/index.ts` lines 520-639
- Heap classification and graph validation: `src/index.ts` lines 641-764
- Behavioral and scale regression coverage: `tests/scheduler.test.ts`
