# Edge Cases & Error Handling

## 1. Self-Dependency
**Scenario**: Task depends on itself
```typescript
scheduler.addTask({ id: 'a', dependencies: ['a'] })
```
**Handled**: Throws `SchedulerError` with code `SELF_DEPENDENCY`

## 2. Cycle Detection
**Scenario**: A → B → C → A
```typescript
scheduler.addTask({ id: 'a', dependencies: [] })
scheduler.addTask({ id: 'b', dependencies: ['a'] })
scheduler.addTask({ id: 'c', dependencies: ['b'] })
scheduler.addTask({ id: 'a', dependencies: ['c'] }) // Cycle!
```
**Handled**: DFS with 3-color marking detects cycle before insertion

## 3. Missing Dependencies
**Scenario**: Task references non-existent dependency
```typescript
scheduler.addTask({ id: 'b', dependencies: ['missing'] })
```
**Handled**: Task is added but stays PENDING until dependency exists (or rejected in strict mode)

## 4. State Transition Violations
**Scenario**: Calling completeTask on non-RUNNING task
```typescript
scheduler.completeTask('task-1') // Task is PENDING
```
**Handled**: Throws `SchedulerError` with code `INVALID_STATE`

## 5. Duplicate Task IDs
**Scenario**: Adding two tasks with same ID
```typescript
scheduler.addTask({ id: 'a', ... })
scheduler.addTask({ id: 'a', ... }) // Overwrites
```
**Handled**: Second add overwrites first (Map behavior). Consider rejecting if strict.

## 6. Empty Scheduler
**Scenario**: Calling getNextTask on empty scheduler
```typescript
scheduler.getNextTask() // undefined
```
**Handled**: Returns `undefined` gracefully

## 7. Max Tasks Exceeded
**Scenario**: Exceeding maxTasks limit
```typescript
const s = new TaskScheduler({ maxTasks: 100 })
// ... add 101 tasks
```
**Handled**: Throws `SchedulerError` with code `MAX_TASKS_EXCEEDED`

## 8. Cascade Cancellation Depth
**Scenario**: Deep dependency tree cancellation
```
root → a → b → c → d → e (cancel root)
```
**Handled**: Recursive cancellation. Consider iterative approach for very deep trees to avoid stack overflow.

## 9. Future Time Tasks
**Scenario**: Task with executionTime in future
```typescript
scheduler.addTask({ executionTime: Date.now() + 60000 }) // 1 min later
```
**Handled**: Task stays PENDING until time arrives. drainReadyQueue() filters expired tasks.

## 10. Update During Execution
**Scenario**: Updating a task while it's in heap
```typescript
const task = scheduler.popNextTask()
scheduler.updateTask(task.id, { priority: 999 })
```
**Handled**: Safe — task is removed from heap before update, re-added after.

## 11. Concurrent Access
**Scenario**: Multiple workers calling popNextTask simultaneously
**Handled**: Scheduler is NOT thread-safe. Wrap with mutex for concurrent access.

## 12. Large-Scale Performance Degradation
**Scenario**: 1M cancelled tasks pile up in heap
**Handled**: Lazy deletion keeps heap growing. Call `heap.clean()` periodically or use `clear()`.

## 13. Topological Sort on Cyclic Graph
**Scenario**: Calling topologicalSort when cycle exists
**Handled**: Throws `SchedulerError` with code `CYCLE_DETECTED`

## 14. Failed Task Dependencies
**Scenario**: Task fails, what happens to dependents?
**Handled**: By default, dependents are cascaded-canceled. Set `cancelDependents=false` to keep them pending.
