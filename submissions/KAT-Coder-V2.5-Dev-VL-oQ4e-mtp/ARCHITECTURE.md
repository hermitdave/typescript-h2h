# In-Memory Task Scheduler — Architecture

## Overview

A production-grade, in-memory task scheduler supporting up to 1M tasks with:
- Priority-based execution ordering
- Execution timestamp scheduling
- Dependency tracking with cycle detection
- Dynamic task updates and cancellation
- O(log n) task insertion/retrieval, O(1) lookup

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   TaskScheduler                         │
├─────────────────────────────────────────────────────────┤
│  TaskMap (Map<TaskId, Task>)            O(1) lookup    │
│  ReadyQueue (Binary Min-Heap)           O(log n) push  │
│                                                   O(1) peek │
│  DependencyGraph (Map<TaskId, Set<TaskId>>)             │
│  ReverseGraph (Map<TaskId, Set<TaskId>>)                │
│  TaskState (enum: pending | ready | running |          │
│             completed | failed | cancelled)             │
└─────────────────────────────────────────────────────────┘
```

## Core Data Structures

### 1. TaskMap
- `Map<TaskId, Task>`
- Provides O(1) access to any task by ID
- Updated on every mutation (add, update, complete, cancel)

### 2. ReadyQueue (Binary Min-Heap)
- Stores `Task` objects ordered by `(executionTime ASC, priority ASC)`
- O(log n) insertion, O(1) peek for next executable task
- Lazy deletion: removed tasks are filtered during pop

### 3. DependencyGraph
- `Map<TaskId, Set<TaskId>>` — outgoing edges (task → its dependencies)
- `Map<TaskId, Set<TaskId>>` — incoming edges (task → tasks depending on it)
- O(1) check for "all deps satisfied" using a counter per task

### 4. TaskState Enum
```typescript
enum TaskState {
  PENDING = 'pending',       // added, not yet ready (deps not met or future time)
  READY = 'ready',           // deps met, executionTime <= now, in ready queue
  RUNNING = 'running',       // currently executing
  COMPLETED = 'completed',   // finished successfully
  FAILED = 'failed',         // execution failed
  CANCELLED = 'cancelled',   // removed by user
}
```

## Key Operations

| Operation | Complexity | Description |
|-----------|------------|-------------|
| `addTask()` | O(log n) | Insert + cycle check + dependency resolution |
| `getNextTask()` | O(1) | Peek at top of ready queue |
| `popNextTask()` | O(log n) | Remove and return top task |
| `completeTask()` | O(d log n) | Mark done, release dependents (d = dependents) |
| `cancelTask()` | O(d log n) | Remove task, release dependents |
| `updateTask()` | O(log n) | Re-heapify if priority/time changed |
| `hasCycle()` | O(V+E) | DFS with 3-coloring |

## Cycle Detection Strategy

Uses DFS with 3-color marking:
- **WHITE**: unvisited
- **GRAY**: in current DFS path (ancestor)
- **BLACK**: fully processed

If we encounter a GRAY node during DFS, a cycle exists. This is O(V + E) where V = tasks, E = dependency edges.

## Handling 1M Tasks

- Heap operations are O(log 1M) ≈ 20 comparisons — acceptable
- Memory: ~1M tasks × ~500 bytes = ~500MB (well within modern server RAM)
- Lazy deletion in heap avoids O(n) cleanup on cancel
- Batch operations support bulk add/update

## Concurrency Model

Thread-safe via:
- Single-threaded event loop (Node.js)
- Optional: Mutex wrapper for multi-worker scenarios
- No shared mutable state between tasks
