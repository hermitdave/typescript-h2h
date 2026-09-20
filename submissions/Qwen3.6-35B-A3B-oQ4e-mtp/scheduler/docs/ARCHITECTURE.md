# In-Memory Task Scheduler — Architecture

## Overview

A production-grade in-memory task scheduler supporting up to 1 million concurrent tasks with:
- **Priority scheduling** (numerical; lower number = higher priority)
- **Execution timestamps** (ISO 8601, parsed to epoch ms)
- **Dependency tracking** (DAG-based, with cycle detection)
- **Dynamic updates** (update, cancel, remove tasks after insertion)
- **Efficient next-task retrieval** (O(1) amortised peek, O(k log n) worst-case)
- **Thread-safe via single-threaded async design** (designed for Node.js event loop)

## Data Structures

### 1. Binary Min-Heap (Event Queue)
**Purpose:** Efficient retrieval of the next task to execute.

**Structure:** Array-based binary heap, each entry is `{ taskId, executeAt, priority, version }`.

**Ordering:** Primary key = `executeAt` (ascending), secondary key = `priority` (ascending), tertiary key = `taskId` (string comparison, for determinism).

**Complexity:**
- Insert: O(log n)
- Peek/Extract min: O(1) / O(log n)
- Update (lazy): O(1) to mark stale, O(log n) on re-insert

**Why a heap:** We always need the earliest-scheduled, highest-priority task. A heap gives O(log n) insert and O(1) peek — optimal for this access pattern.

### 2. Task Registry (Hash Map)
**Purpose:** O(1) lookup by task ID.

**Structure:** `Map<taskId, Task>`

**Complexity:**
- Get: O(1)
- Set: O(1)
- Delete: O(1)

### 3. Dependency Graph (Adjacency Lists)
**Purpose:** Track task dependencies and efficiently propagate completion signals.

**Structure:**
- `dependencies: Map<taskId, Set<dependencyId>>` — forward: what a task depends on
- `dependents: Map<dependencyId, Set<taskId>>` — reverse: which tasks depend on this one

**Complexity:**
- Add dependency: O(1) amortised (Set.add)
- Propagate completion: O(k) where k = number of dependents
- Remove dependency: O(1) amortised (Set.delete)

### 4. Task State Enumeration
```
type TaskState =
  | 'pending'      // scheduled, waiting for dependencies & time
  | 'ready'        // dependencies satisfied, waiting for execution time
  | 'running'      // currently executing
  | 'completed'    // execution finished
  | 'failed'       // execution failed
  | 'cancelled'    // manually cancelled
```

### 5. Stale Entry Tracking (Lazy Removal)
**Purpose:** Avoid O(n) heap rebuilds when tasks are removed or updated.

**Structure:** `Set<taskId>` — IDs of removed/stale heap entries.

**Complexity:** Peek operations skip stale entries; amortised cost is bounded by total insertions.

## Algorithm Design

### Adding a Task
1. Validate input (ID uniqueness, timestamp format, dependency IDs exist if they're already registered).
2. Create Task object, set state to `pending` or `ready`.
3. Insert into binary heap: O(log n).
4. Register in task map: O(1).
5. Add to dependency graph: O(1).
6. If no dependencies, mark as `ready`.
7. If dependencies exist but all are already completed, mark as `ready`.
8. **Cycle detection:** DFS from each dependency to check if any transitively depends on this task. O(V + E) in worst case per add.

### Retrieving Next Executable Task
1. Peek at heap top.
2. If stale, pop and repeat (amortised O(1)).
3. If executeAt > now, return null (nothing ready yet).
4. If dependencies not all completed, return null (not yet ready).
5. Otherwise, return the task.

**Complexity:** O(k log n) worst case where k = stale entries at top. Amortised O(1) per extracted task.

### Executing a Task
1. Validate task exists and is in `pending` or `ready` state.
2. Mark as `running`, remove from heap.
3. Execute caller-provided handler.
4. On completion: mark `completed`, propagate to dependents.
5. For each dependent: if all dependencies completed, mark `ready` and update heap.

**Complexity:** O(1) for the task itself + O(d log n) for d dependents becoming ready.

### Cycle Detection
**When:** On adding a task with dependencies.
**Algorithm:** DFS with three-color marking (white=unvisited, grey=in-progress, black=done).
- For the new task T with dependencies [D1, D2, ...]:
- Perform DFS from each Di through the **reverse dependency graph** (dependents).
- If we encounter T during any DFS, a cycle exists.
- Abort insertion if a cycle would be created.

**Complexity:** O(V + E) where V = registered tasks, E = dependency edges.

### Dynamic Updates
1. **Cancel:** Mark task as `cancelled`, remove from graph, mark heap entry as stale. O(1) + O(degree).
2. **Update task properties:** Remove old entry from heap (stale), update map, re-insert new entry. O(log n).
3. **Update dependencies:** Remove old dependency edges, add new edges, re-evaluate `ready` state. O(degree + log n).

## Complexity Summary

| Operation              | Time Complexity       | Space Complexity |
|-----------------------|-----------------------|-----------------|
| addTask               | O(log n + V + E)      | O(1) amortised  |
| removeTask (cancel)   | O(1) + O(degree)      | O(1)            |
| peekNext              | O(k log n) amortised  | O(1)            |
| executeTask           | O(1 + d log n)        | O(1)            |
| updateTask            | O(log n)              | O(1)            |
| hasCycle              | O(V + E)              | O(V)            |
| getDependents         | O(1) + O(k)           | O(k)            |
| getTasksByState       | O(n)                  | O(n)            |

Where:
- n = number of registered tasks
- V = number of vertices in dependency graph
- E = number of edges (dependency relationships)
- k = number of stale heap entries (amortised to 0)
- d = number of newly-ready dependents
- degree = number of dependency/dependent edges for a task

## Scalability to 1 Million Tasks

### Memory
- Heap: 1M entries × ~64 bytes = ~64 MB
- Task map: 1M entries × ~200 bytes = ~200 MB
- Dependency graphs: worst case O(n²) edges, but typical DAG is O(n × avg_degree)
- **Total estimated:** ~250-500 MB for 1M tasks with moderate dependency depth

### Performance at Scale
- Insert: Still O(log n) = O(log 1M) ≈ 20 comparisons
- Peek: Amortised O(1) — stale entries are bounded by total removes
- Cycle detection: O(V + E) — for 1M tasks, worst case O(1M + E). Mitigated by checking only the subgraph affected by the new edges.
- Execution propagation: O(d log n) — bounded by fan-out of each task

### Optimisations for Scale
1. **Lazy cycle detection:** Only check the subgraph reachable from the new task's dependencies via the reverse graph, not the entire graph.
2. **Batch operations:** Add/remove in batches to amortise graph traversal costs.
3. **Priority bands:** Bucket heap by priority range to reduce heap height for common priorities.
4. **Memory pools:** Pre-allocate heap array capacity to avoid resizing.

### Bottlenecks
- **Cycle detection** becomes expensive with dense dependency graphs. Solution: limit dependency depth or use incremental cycle checking.
- **Propagation storm:** A task with 100K dependents all becoming ready simultaneously. Solution: batch propagation with microtask scheduling.
- **Memory pressure** with O(n²) edges. Solution: sparser graphs, lazy edge creation.

## Error Handling
- Duplicate task IDs: throw `TaskSchedulerError` with `code: 'DUPLICATE_TASK'`
- Missing dependencies: throw `TaskSchedulerError` with `code: 'MISSING_DEPENDENCY'`
- Cycle detection: throw `TaskSchedulerError` with `code: 'CYCLE_DETECTED'`
- Task not found: throw `TaskSchedulerError` with `code: 'TASK_NOT_FOUND'`
- Invalid task state transitions: throw `TaskSchedulerError` with `code: 'INVALID_STATE_TRANSITION'`
