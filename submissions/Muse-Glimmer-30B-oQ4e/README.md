# In-Memory Task Scheduler

A production-ready, high-performance in-memory task scheduler designed to handle 1 million+ tasks with priorities, dependencies, and dynamic updates.

## Architecture

### Overview

The scheduler uses a **hybrid architecture** combining:
- **Hash Map** for O(1) task lookup by ID
- **Priority Queue** (binary heap) for efficient retrieval of next executable task
- **Directed Acyclic Graph (DAG)** for dependency tracking with cycle detection
- **Lazy evaluation** for readiness checks

### Components

1. **TaskScheduler** - Main orchestrator
2. **PriorityQueue** - O(log n) priority-based retrieval
3. **Graph** - Dependency management with cycle detection
4. **Task** - Immutable-ish task entity with state machine

### Data Flow

```
Create Task → Validate Dependencies → Check Cycles → Store in Map
                ↓
            Add to Graph
                ↓
        Evaluate Readiness
                ↓
    Add to Priority Queue (if ready)
                ↓
    Get Next → Start → Complete/Fail
```

## Data Structures

### Task Storage
- **Map<string, Task>**: O(1) lookup by ID
- Memory: ~200 bytes per task → 200MB for 1M tasks

### Priority Queue
- **Binary Heap** with composite comparator:
  1. Priority (CRITICAL → BACKGROUND)
  2. Scheduled timestamp (earlier first)
  3. Creation timestamp (FIFO tie-breaker)
- Operations: O(log n) push/pop, O(n) remove

### Dependency Graph
- **Adjacency Lists**: Map<string, Set<string>>
- Reverse adjacency for quick dependent lookup
- Cycle detection via DFS: O(V + E)
- Topological sort support

## Complexity Analysis

| Operation | Time Complexity | Space |
|-----------|----------------|-------|
| Create Task | O(d + c) | O(1) |
| Update Task | O(d + c) | O(1) |
| Get Next Task | O(log n + d) | O(1) |
| Start Task | O(log n) | O(1) |
| Complete Task | O(d * log n) | O(1) |
| Cycle Detection | O(V + E) | O(V) |
| Bulk Create (n tasks) | O(n log n) | O(n) |

Where:
- d = number of dependencies
- c = cycle detection cost
- n = number of ready tasks
- V = number of tasks
- E = number of dependency edges

## Implementation Highlights

### Key Features

1. **Priority Support**: 5 levels (CRITICAL → BACKGROUND)
2. **Dependency Tracking**: DAG with automatic cycle detection
3. **Dynamic Updates**: Priority, schedule, dependencies can be modified
4. **State Machine**: PENDING → READY → RUNNING → COMPLETED/FAILED/CANCELLED
5. **Retry Logic**: Configurable max retries with exponential backoff support
6. **Metrics**: Real-time statistics tracking
7. **Bulk Operations**: Efficient batch processing
8. **Cleanup**: Automatic pruning of old completed tasks

### Thread Safety Notes

Current implementation is single-threaded. For production:
- Use atomic operations or locks for concurrent access
- Consider ReadWriteLock for high read/low write scenarios
- Batch updates to minimize lock contention

## Edge Cases Handled

1. **Circular Dependencies**: Detected at creation/update time
2. **Orphaned Dependencies**: Validation on creation
3. **Task Deletion**: Cascading cleanup of graph edges
4. **Priority Inversion**: Ready queue re-sorted on priority change
5. **Scheduled Tasks**: Lazy evaluation on retrieval
6. **Retry Exhaustion**: Final failure after max retries
7. **Concurrent Completion**: Dependents evaluated atomically
8. **Memory Pressure**: Optional cleanup of old completed tasks

## Scalability Discussion

### 1 Million Tasks

**Memory Estimate**:
- Task object: ~200 bytes
- Graph edges: ~16 bytes per dependency
- Priority queue overhead: ~32 bytes per ready task
- Total: ~250MB for 1M tasks with average 2 dependencies

**Performance**:
- Create: ~0.1ms per task → 100 seconds for 1M tasks
- Get Next: ~0.01ms → 10,000 tasks/second
- Memory access: Cache-friendly with contiguous arrays

### Optimizations Applied

1. **Lazy Evaluation**: Tasks only evaluated when accessed
2. **Incremental Updates**: Only affected tasks re-evaluated
3. **Batch Processing**: Bulk operations reduce overhead
4. **Memory Efficiency**: Sets for dependencies, no duplication
5. **Heap Structure**: Binary heap for O(log n) operations

### Production Considerations

1. **Persistence**: Add snapshotting for durability
2. **Distribution**: Shard by task ID for horizontal scaling
3. **Monitoring**: Export metrics to Prometheus/Datadog
4. **Backpressure**: Rate limiting for task creation
5. **GC Tuning**: Increase heap size, tune GC for low latency
6. **Warm-up**: Pre-allocate structures for 1M tasks

### Scaling Beyond 1M

For >1M tasks:
- Use **persistent data structures** with mmap
- Implement **tiered storage** (hot/warm/cold tasks)
- Consider **distributed scheduler** with consistent hashing
- Add **task archiving** to cold storage

## Testing

Run tests with:
```bash
npm test
```

Coverage includes:
- Task lifecycle
- Priority ordering
- Dependency management
- Cycle detection
- Edge cases
- Performance benchmarks

## Usage Example

```typescript
import { TaskScheduler, Priority } from './src';

const scheduler = new TaskScheduler();

// Create tasks with dependencies
const task1 = scheduler.createTask({
  name: 'Process payment',
  priority: Priority.HIGH,
});

const task2 = scheduler.createTask({
  name: 'Send confirmation',
  dependencies: [task1.id],
  priority: Priority.MEDIUM,
});

// Execute
const next = scheduler.getNextExecutableTask();
if (next) {
  scheduler.startTask(next.id);
  // ... do work ...
  scheduler.completeTask(next.id);
}
```

## License

MIT
