/**
 * Task Scheduler — Core Implementation
 *
 * A production-ready in-memory task scheduler supporting:
 * - Priority-based execution ordering
 * - Timestamp-based scheduling
 * - DAG-based dependency tracking with cycle detection
 * - Dynamic updates and cancellations
 * - O(1) peek for next executable task
 * - Lazy stale entry removal
 */

import { BinaryHeap, HeapEntry } from './binary-heap';
import {
  createDependencyGraph,
  hasCycle,
  removeEdges,
  addEdges as addEdgesToGraph,
  updateEdges as updateEdgesInGraph,
  getDependents,
  areAllDependenciesMet,
  getTotalEdges,
  DependencyGraph,
} from './cycle-detection';
import {
  Task,
  TaskSchedulerError,
  TaskSchedulerOptions,
  SchedulerStats,
  NextTaskResult,
  TaskState,
  ExecutionMeta,
  AddTaskInput,
  UpdateTaskInput,
} from './types';

type InternalTask = Task<unknown>;

export class TaskScheduler<Context = unknown> {
  private tasks: Map<string, InternalTask>;
  private heap: BinaryHeap;
  private dependencies: DependencyGraph;
  private maxTasks: number;
  private versionCounter: number;
  private executionPromise: Promise<InternalTask | null> | null = null;

  constructor(options: TaskSchedulerOptions = {}) {
    this.maxTasks = options.maxTasks ?? 1_000_000;
    this.tasks = new Map();
    this.heap = new BinaryHeap(options.initialHeapCapacity ?? 256);
    this.dependencies = createDependencyGraph();
    this.versionCounter = 0;
  }

  addTask(input: AddTaskInput<Context>): void {
    const {
      id,
      handler,
      dependencies = [],
      priority = 0,
      executeAt,
      context,
      metadata,
    } = input;

    this.validateCapacity();

    if (this.tasks.has(id)) {
      throw TaskSchedulerError.DuplicateTask(id);
    }

    for (const depId of dependencies) {
      if (!this.tasks.has(depId)) {
        throw TaskSchedulerError.MissingDependency(id, depId);
      }
    }

    if (dependencies.length > 0) {
      const cycle = hasCycle(this.dependencies, id, dependencies);
      if (cycle !== null) {
        throw TaskSchedulerError.CycleDetected(id, cycle);
      }
    }

    const now = new Date();
    const taskTime = executeAt
      ? (typeof executeAt === 'number' ? executeAt : new Date(executeAt).getTime())
      : null;

    const task: InternalTask = {
      id,
      handler: handler as InternalTask['handler'],
      priority,
      executeAt: executeAt ? new Date(executeAt) : null,
      executeAtEpoch: taskTime,
      dependencies,
      context: context as unknown,
      state: 'pending',
      createdAt: now,
      stateChangedAt: now,
      retryCount: input.retryCount ?? 0,
      version: this.versionCounter++,
      cancelled: false,
      metadata: metadata ?? {},
      error: null,
    };

    this.tasks.set(id, task);

    if (dependencies.length > 0) {
      addEdgesToGraph(this.dependencies, id, dependencies);
    }

    if (
      task.dependencies.length === 0 ||
      areAllDependenciesMet(this.dependencies, this.tasks, task.id)
    ) {
      task.state = 'ready';
      this.heap.insert(createHeapEntry(task));
    }
  }

  peekNext(): NextTaskResult | null {
    let entry = this.heap.peek();

    while (entry && this.isStale(entry.taskId)) {
      this.heap.extractMin();
      entry = this.heap.peek();
    }

    if (!entry) return null;

    const task = this.tasks.get(entry.taskId);
    if (
      !task ||
      task.cancelled ||
      task.state === 'completed' ||
      task.state === 'failed'
    ) {
      return null;
    }

    const now = Date.now();
    if (task.executeAtEpoch !== null && task.executeAtEpoch > now) {
      return null;
    }

    if (!areAllDependenciesMet(this.dependencies, this.tasks, task.id)) {
      return null;
    }

    return {
      task,
      waitingMs: task.executeAtEpoch ? task.executeAtEpoch - now : 0,
    };
  }

  async executeNext(): Promise<InternalTask | null> {
    if (this.executionPromise) {
      await this.executionPromise;
      return this.executeNext();
    }

    const run = async (): Promise<InternalTask | null> => {
      let entry = this.heap.peek();
      let targetTask: InternalTask | null = null;

      while (entry) {
        const task = this.tasks.get(entry.taskId);

        if (
          !task ||
          task.cancelled ||
          task.state === 'completed' ||
          task.state === 'failed'
        ) {
          // Remove the stale root entry and restructure the heap.
          // Do NOT use extractMin() here — it would skip further stale
          // entries and pop the first non-stale one away from the heap.
          this.heap.removeRoot();
          entry = this.heap.peek();
          continue;
        }

        const now = Date.now();
        if (task.executeAtEpoch !== null && task.executeAtEpoch > now) {
          // Future task — remove it and keep searching for a ready task
          this.heap.removeRoot();
          entry = this.heap.peek();
          continue;
        }

        // Found a ready, due task — extract and return it
        this.heap.extractMin();
        targetTask = task;
        break;
      }

      if (!targetTask) return null;

      targetTask.state = 'running';
      targetTask.stateChangedAt = new Date();

      const meta: ExecutionMeta = {
        startedAt: Date.now(),
        startedAtIso: new Date().toISOString(),
      };

      try {
        await targetTask.handler(targetTask.context, meta);
        targetTask.state = 'completed';
        targetTask.stateChangedAt = new Date();
        this.propagateCompletion(targetTask.id);
        return targetTask;
      } catch (err) {
        targetTask.state = 'failed';
        targetTask.error = err instanceof Error ? err : new Error(String(err));
        targetTask.stateChangedAt = new Date();
        return targetTask;
      }
    };

    this.executionPromise = run();
    const result = await this.executionPromise;
    this.executionPromise = null;
    return result;
  }

  async executeUntilEmpty(): Promise<InternalTask[]> {
    const executed: InternalTask[] = [];
    while (true) {
      const result = await this.executeNext();
      if (!result) break;
      executed.push(result);
    }
    return executed;
  }

  cancelTask(taskId: string): InternalTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const allowedStates: TaskState[] = ['pending', 'ready', 'running'];
    if (!allowedStates.includes(task.state)) {
      throw TaskSchedulerError.InvalidStateTransition(
        taskId,
        task.state,
        'cancelled',
      );
    }

    task.state = 'cancelled';
    task.cancelled = true;
    task.stateChangedAt = new Date();
    this.heap.markStale(taskId);
    removeEdges(this.dependencies, taskId);
    this.tryReadyDependents(taskId);
    return task;
  }

  removeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    this.tasks.delete(taskId);
    this.heap.markStale(taskId);

    // Remove from dependency graph and update dependents
    const dependentIds = getDependents(this.dependencies, taskId);
    for (const depId of dependentIds) {
      const dependentTask = this.tasks.get(depId);
      if (!dependentTask) continue;
      // Remove the deleted task from this dependent's dependency list
      const idx = dependentTask.dependencies.indexOf(taskId);
      if (idx !== -1) {
        dependentTask.dependencies.splice(idx, 1);
      }
    }
    removeEdges(this.dependencies, taskId);

    // Check if any dependents are now ready (no more dependencies)
    for (const depId of dependentIds) {
      const dependentTask = this.tasks.get(depId);
      if (!dependentTask || dependentTask.state !== 'pending') continue;
      if (dependentTask.dependencies.length === 0) {
        dependentTask.state = 'ready';
        dependentTask.stateChangedAt = new Date();
        this.heap.insert(createHeapEntry(dependentTask));
      }
    }

    return true;
  }

  updateTask(taskId: string, updates: UpdateTaskInput): InternalTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (updates.priority !== undefined) {
      task.priority = updates.priority;
      this.heap.reinsert(createHeapEntry(task));
    }

    if (updates.executeAt !== undefined && updates.executeAt !== null) {
      task.executeAt = new Date(updates.executeAt);
      task.executeAtEpoch = new Date(updates.executeAt).getTime();
      this.heap.reinsert(createHeapEntry(task));
    }

    if (updates.dependencies !== undefined) {
      const oldDeps = task.dependencies.slice();

      for (const depId of updates.dependencies) {
        if (!this.tasks.has(depId)) {
          throw TaskSchedulerError.MissingDependency(taskId, depId);
        }
      }

      if (updates.dependencies.length > 0) {
        const cycle = hasCycle(
          this.dependencies,
          taskId,
          updates.dependencies,
        );
        if (cycle !== null) {
          throw TaskSchedulerError.CycleDetected(taskId, cycle);
        }
      }

      updateEdgesInGraph(
        this.dependencies,
        taskId,
        oldDeps,
        updates.dependencies,
      );
      task.dependencies = updates.dependencies;

      if (this.isReady(task)) {
        task.state = 'ready';
        this.heap.reinsert(createHeapEntry(task));
      }
    }

    if (updates.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...updates.metadata };
    }

    task.version++;
    task.stateChangedAt = new Date();
    return task;
  }

  getTask(taskId: string): InternalTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  getTasksByState(state: TaskState): InternalTask[] {
    return [...this.tasks.values()].filter((t) => t.state === state);
  }

  getAllTasks(): InternalTask[] {
    return [...this.tasks.values()];
  }

  getStats(): SchedulerStats {
    const stateCounts: Record<TaskState, number> = {
      pending: 0,
      ready: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of this.tasks.values()) {
      stateCounts[task.state]++;
    }

    return {
      totalTasks: this.tasks.size,
      stateCounts,
      totalDependencyEdges: getTotalEdges(this.dependencies),
      staleEntries: this.heap.staleCount,
    };
  }

  clear(): void {
    this.tasks.clear();
    this.heap = new BinaryHeap(256);
    this.dependencies = createDependencyGraph();
    this.versionCounter = 0;
  }

  private isReady(task: InternalTask): boolean {
    if (task.state !== 'pending') return false;
    if (task.dependencies.length === 0) return true;
    return areAllDependenciesMet(this.dependencies, this.tasks, task.id);
  }

  private isStale(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return true;
    return (
      task.state === 'cancelled' ||
      task.state === 'completed' ||
      task.state === 'failed'
    );
  }

  private propagateCompletion(taskId: string): void {
    const dependentIds = getDependents(this.dependencies, taskId);
    for (const depId of dependentIds) {
      const task = this.tasks.get(depId);
      if (!task || task.state !== 'pending') continue;
      if (this.isReady(task)) {
        task.state = 'ready';
        task.stateChangedAt = new Date();
        this.heap.insert(createHeapEntry(task));
      }
    }
  }

  private tryReadyDependents(taskId: string): void {
    const dependentIds = getDependents(this.dependencies, taskId);
    for (const depId of dependentIds) {
      const task = this.tasks.get(depId);
      if (!task || task.state !== 'pending') continue;
      if (this.isReady(task)) {
        task.state = 'ready';
        task.stateChangedAt = new Date();
        this.heap.insert(createHeapEntry(task));
      }
    }
  }

  private validateCapacity(): void {
    if (this.tasks.size >= this.maxTasks) {
      throw TaskSchedulerError.MaxTasksReached(
        this.tasks.size,
        this.maxTasks,
      );
    }
  }
}

function createHeapEntry(task: InternalTask): HeapEntry {
  return {
    taskId: task.id,
    executeAtEpoch: task.executeAtEpoch,
    priority: task.priority,
    version: task.version,
  };
}
