# Production Scalability Discussion

## Architecture Decisions

### Why Binary Heap over Priority Queue Library?
- **Zero dependencies** — critical for production reliability
- **Full control** over lazy deletion strategy
- **Memory predictable** — no hidden allocations

### Why Lazy Deletion over Eager Removal?
- Eager removal from heap is O(n) worst-case
- Lazy deletion amortizes cost across operations
- For 1M tasks with moderate cancellation, heap stays manageable

### Why 3-Color DFS for Cycle Detection?
- O(V + E) — optimal for directed graph cycle detection
- No recursion depth issues with iterative implementation
- Memory efficient: single color map

## Production Considerations

### 1. Memory Management
```typescript
// For 1M tasks, expect ~500MB
// GC pressure from frequent object creation
// Solution: Object pooling for high-throughput scenarios
```

### 2. Concurrency
```typescript
// Single-threaded by design (Node.js)
// For multi-worker:
// - Option A: Mutex around scheduler operations
// - Option B: Partition tasks by key (sharding)
// - Option C: Leader-follower with message queue
```

### 3. Persistence
```typescript
// In-memory only — no durability
// For production: checkpoint to Redis/database
// Recovery: replay from last checkpoint
```

### 4. Backpressure
```typescript
// When maxTasks reached, caller gets error
// Alternative: Reject new tasks with specific error code
// Consider: Queue backlog strategy for overflow
```

## Optimization Paths

### Path 1: Batch Heap Build
```typescript
// Instead of n × O(log n), use O(n) heapify
// Build heap from array in linear time
private buildHeap(tasks: Task[]): void {
  this.heap = tasks;
  for (let i = Math.floor(tasks.length / 2) - 1; i >= 0; i--) {
    this.sinkDown(i);
  }
}
```

### Path 2: Arena Allocation
```typescript
// Pre-allocate fixed-size arrays
// Avoid GC pauses from object creation
// Trade: More complex, less flexible
```

### Path 3: Periodic Compaction
```typescript
// Every N operations, rebuild heap from scratch
// Removes accumulated cancelled tasks
private shouldCompact(): boolean {
  return this.heap.size > this.tasks.size * 1.5;
}
```

## Benchmark Targets

| Metric | Target | Notes |
|--------|--------|-------|
| addTask (1M) | < 2s | Batch mode |
| popNextTask | < 1ms | 99th percentile |
| completeTask (10 deps) | < 10ms | Average case |
| Memory (1M tasks) | < 1GB | With 10% cancellation |
| Cycle detection (1M) | < 1s | Sparse graph |

## Failure Modes & Mitigations

| Failure | Mitigation |
|---------|------------|
| Memory exhaustion | Set maxTasks, monitor RSS |
| Long GC pauses | Object pooling, Generational GC |
| Cycle explosion | Depth limit on DFS, iterative approach |
| Cascade cancellation stack overflow | Iterative DFS with explicit stack |
| Concurrent corruption | Mutex, single-threaded design |

## Operational Recommendations

1. **Monitoring**: Expose `getState()` metrics (ready/pending/running counts)
2. **Alerting**: Trigger on `MAX_TASKS_EXCEEDED` errors
3. **Circuit breaking**: Reject new tasks when ready queue > threshold
4. **Graceful shutdown**: Complete in-flight tasks before shutdown
5. **Health checks**: Periodic `getNextTask()` to verify scheduler health
