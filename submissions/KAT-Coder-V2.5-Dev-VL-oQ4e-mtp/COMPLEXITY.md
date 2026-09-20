# Task Scheduler — Complexity Analysis

## Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| `addTask()` | O(log n) | Heap push + cycle detection (DFS) |
| `getNextTask()` | O(1) amortized | Heap peek + lazy cleanup |
| `popNextTask()` | O(log n) | Heap pop |
| `completeTask()` | O(d log n) | d = number of dependents |
| `failTask()` | O(d log n) | Includes cascade cancellation |
| `cancelTask()` | O(d log n) | Includes cascade cancellation |
| `updateTask()` | O(log n) | Heap re-insert |
| `hasCycle()` | O(V + E) | DFS with 3-color marking |
| `topologicalSort()` | O(V + E) | Kahn's algorithm |
| `getState()` | O(n) | Linear scan of task map |
| `removeTask()` | O(d log n) | Heap cleanup + dependent updates |
| `clear()` | O(1) | Map/Heap reset |

Where:
- n = total tasks
- V = vertices (tasks)
- E = edges (dependencies)
- d = out-degree (number of dependents)

## Space Complexity

| Structure | Complexity |
|-----------|------------|
| TaskMap | O(n) |
| Heap | O(n) |
| dependencyCount | O(n) |
| dependents (reverse graph) | O(E) |
| **Total** | **O(n + E)** |

For sparse dependency graphs (E << n²), this is effectively O(n).

## Operations Breakdown

### addTask() — Detailed
```
1. Map.set()           → O(1)
2. dependencyCount.set → O(1)
3. Build reverse graph → O(d) where d = dependencies.length
4. hasCycle()          → O(V + E)
5. moveToReady()       → O(log n) if no deps, O(1) if deps exist
```
**Total: O(V + E + log n)** — dominated by cycle detection.

### completeTask() — Detailed
```
1. Find task           → O(1)
2. Update state        → O(1)
3. Iterate dependents  → O(d)
4. For each dependent: check state + update count + heap push → O(d * log n)
```
**Total: O(d log n)**

### popNextTask() — Detailed
```
1. drainReadyQueue()   → O(k log n) where k = tasks to clean
2. heap.pop()          → O(log n)
```
**Total: O(k log n)** — typically k is small due to lazy deletion.

## Scalability Analysis

### 1M Tasks Scenario
- **Memory**: ~500MB (1M × 500 bytes average)
- **Heap operations**: O(log 1M) ≈ 20 comparisons
- **Cycle detection**: O(V + E) — acceptable for sparse graphs

### Bottlenecks
1. **Batch operations**: `addTasks()` is O(n log n) — consider batch heap build (O(n))
2. **Cascade cancellation**: Deep dependency trees can cause deep recursion
3. **Lazy deletion**: Heap can grow with cancelled tasks; periodic full rebuild needed

### Optimizations for Scale
1. **Batch heap build**: O(n) instead of n × O(log n)
2. **Periodic compaction**: Rebuild heap every N operations
3. **Arena allocation**: For extreme performance, use object pools
4. **Lock-free variants**: For concurrent access patterns

## Real-World Performance Estimates

| Operation | 1K tasks | 10K tasks | 100K tasks | 1M tasks |
|-----------|----------|-----------|------------|----------|
| addTask | <1ms | <1ms | <1ms | ~1ms |
| popNextTask | <1ms | <1ms | <1ms | <1ms |
| completeTask (5 deps) | <1ms | <1ms | ~1ms | ~5ms |
| hasCycle | <1ms | <1ms | ~10ms | ~100ms |
| topologicalSort | <1ms | <1ms | ~10ms | ~100ms |

## Concurrency Model

The scheduler is designed for single-threaded use (Node.js event loop). For multi-worker:

```typescript
// Option 1: Mutex wrapper
const mutex = new Mutex();
async function popTask() {
  await mutex.lock();
  try {
    return scheduler.popNextTask();
  } finally {
    mutex.unlock();
  }
}

// Option 2: Worker pool with message queue
// Each worker has its own scheduler instance
// Coordinator distributes tasks via pub/sub
```
