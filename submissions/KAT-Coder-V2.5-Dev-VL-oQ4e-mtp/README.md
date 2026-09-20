# Production-Ready In-Memory Task Scheduler

A TypeScript implementation of a production-grade in-memory task scheduler supporting 1M+ tasks.

## Features

- **Priority-based execution**: Lower number = higher priority
- **Execution timestamp scheduling**: Tasks execute at specified time
- **Dependency tracking**: Tasks wait for dependencies to complete
- **Cycle detection**: DFS-based detection prevents circular dependencies
- **Dynamic updates**: Change priority/time of running tasks
- **Lazy deletion**: Efficient cancellation without O(n) heap rebuild
- **Memory efficient**: ~500MB for 1M tasks

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full design details.

### Data Structures

| Structure | Purpose | Complexity |
|-----------|---------|------------|
| `Map<TaskId, Task>` | Task lookup | O(1) |
| `MinHeap<Task>` | Priority queue | O(log n) |
| `Map<TaskId, Set<TaskId>>` | Reverse dependency graph | O(1) access |
| `Map<TaskId, number>` | Dependency count (in-degree) | O(1) |

## API

```typescript
const scheduler = new TaskScheduler({
  maxTasks: 1_000_000,
  enableCycleDetection: true,
  lazyDeletion: true,
});

// Add task
const task = scheduler.addTask({
  id: 'task-1',
  priority: 1,
  executionTime: Date.now(),
  data: { payload: '...' },
  dependencies: [], // [] or ['task-0']
});

// Get next task
const next = scheduler.popNextTask();

// Mark complete (releases dependents)
scheduler.completeTask('task-1');

// Cancel with cascade
scheduler.cancelTask('task-1', { cascade: true });

// Update priority
scheduler.updateTask('task-1', { priority: 0 });
```

## Running Tests

```bash
npm test
```

24 tests covering:
- Basic operations (add, pop, complete)
- Priority ordering
- Dependency resolution
- Cycle detection
- State management
- Edge cases (empty scheduler, duplicates, etc.)
- Performance (10K tasks in ~2.7s)

## Complexity

| Operation | Time |
|-----------|------|
| `addTask()` | O(log n) |
| `popNextTask()` | O(log n) |
| `completeTask()` | O(d log n) |
| `hasCycle()` | O(V + E) |
| `topologicalSort()` | O(V + E) |

## Files

| File | Description |
|------|-------------|
| `src/scheduler.ts` | Main implementation |
| `src/scheduler.spec.ts` | 24 unit tests |
| `ARCHITECTURE.md` | Design decisions |
| `COMPLEXITY.md` | Time/space analysis |
| `EDGE_CASES.md` | Error handling |
| `SCALABILITY.md` | Production considerations |
