import { PriorityQueue } from './priority-queue';
import { Graph } from './graph';
import { Task, TaskConfig, Priority, TaskStatus, TaskMetrics } from './types';

export class TaskScheduler {
  private tasks: Map<string, Task>;
  private readyQueue: PriorityQueue<Task>;
  private dependencyGraph: Graph;
  private metrics: TaskMetrics;
  private taskCounter: number;

  constructor() {
    this.tasks = new Map();
    this.readyQueue = new PriorityQueue<Task>((a, b) => a - b);
    this.dependencyGraph = new Graph();
    this.taskCounter = 0;
    
    this.metrics = {
      totalTasks: 0,
      pendingTasks: 0,
      readyTasks: 0,
      runningTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      cancelledTasks: 0,
      averageWaitTime: 0,
      averageExecutionTime: 0
    };
  }

  createTask(config: TaskConfig): Task {
    const id = this.generateId();
    const now = Date.now();
    
    const task: Task = {
      id,
      name: config.name || `task-${id}`,
      description: config.description,
      priority: config.priority ?? Priority.MEDIUM,
      status: TaskStatus.PENDING,
      scheduledAt: config.scheduledAt ?? now,
      createdAt: now,
      updatedAt: now,
      data: config.data,
      dependencies: new Set(config.dependencies || []),
      dependents: new Set(),
      retries: config.retries ?? 0,
      maxRetries: config.retries ?? 0,
      timeout: config.timeout,
      tags: config.tags ? new Set(config.tags) : undefined,
      attempts: 0
    };

    this.tasks.set(id, task);
    this.dependencyGraph.addNode(id);
    
    // Add dependencies and check for cycles
    for (const depId of task.dependencies) {
      if (!this.tasks.has(depId)) {
        throw new Error(`Dependency task ${depId} does not exist`);
      }
      this.dependencyGraph.addEdge(depId, id);
      this.tasks.get(depId)?.dependents.add(id);
    }

    // Check for cycles
    if (this.dependencyGraph.detectCycle()) {
      // Rollback
      this.dependencyGraph.removeNode(id);
      this.tasks.delete(id);
      throw new Error(`Cycle detected when creating task ${id}. Task creation aborted.`);
    }

    // Update metrics
    this.metrics.totalTasks++;
    this.metrics.pendingTasks++;

    // Check if task is immediately ready
    if (this.isTaskReady(task)) {
      this.markTaskReady(task);
    }

    return task;
  }

  updateTask(id: string, updates: Partial<TaskConfig>): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      throw new Error(`Cannot update completed or cancelled task ${id}`);
    }

    const oldPriority = task.priority;
    const oldScheduledAt = task.scheduledAt;

    if (updates.name !== undefined) task.name = updates.name;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.scheduledAt !== undefined) task.scheduledAt = updates.scheduledAt;
    if (updates.data !== undefined) task.data = updates.data;
    if (updates.timeout !== undefined) task.timeout = updates.timeout;
    if (updates.tags !== undefined) task.tags = new Set(updates.tags);

    task.updatedAt = Date.now();

    // Handle priority/scheduled time changes in ready queue
    if (task.status === TaskStatus.READY && 
        (oldPriority !== task.priority || oldScheduledAt !== task.scheduledAt)) {
      this.readyQueue.remove(t => t.id === id);
      this.readyQueue.push(task, task.priority, task.scheduledAt);
    }

    // Handle dependency updates
    if (updates.dependencies !== undefined) {
      // Remove old dependencies
      for (const oldDep of task.dependencies) {
        this.dependencyGraph.removeEdge(oldDep, id);
        this.tasks.get(oldDep)?.dependents.delete(id);
      }

      // Add new dependencies
      task.dependencies = new Set(updates.dependencies);
      for (const newDep of task.dependencies) {
        if (!this.tasks.has(newDep)) {
          throw new Error(`Dependency task ${newDep} does not exist`);
        }
        this.dependencyGraph.addEdge(newDep, id);
        this.tasks.get(newDep)?.dependents.add(id);
      }

      // Check for cycles
      if (this.dependencyGraph.detectCycle()) {
        throw new Error(`Cycle detected when updating task ${id}`);
      }

      // Re-evaluate readiness
      this.re-evaluateTaskReadiness(id);
    }

    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getNextExecutableTask(): Task | undefined {
    const now = Date.now();
    
    // Clean up ready queue - remove tasks whose dependencies became unmet
    this.cleanReadyQueue();

    // Process tasks whose scheduled time has passed
    this.processScheduledTasks(now);

    // Try to get next task from ready queue
    if (!this.readyQueue.isEmpty()) {
      const task = this.readyQueue.peek();
      if (task && task.scheduledAt <= now) {
        this.readyQueue.pop();
        return task;
      }
    }

    return undefined;
  }

  startTask(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status !== TaskStatus.READY) {
      throw new Error(`Task ${id} is not ready to run (status: ${task.status})`);
    }

    if (task.scheduledAt > Date.now()) {
      throw new Error(`Task ${id} is scheduled for future execution`);
    }

    task.status = TaskStatus.RUNNING;
    task.startedAt = Date.now();
    task.updatedAt = Date.now();
    task.attempts++;

    this.metrics.readyTasks--;
    this.metrics.runningTasks++;
    this.readyQueue.remove(t => t.id === id);

    return task;
  }

  completeTask(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status !== TaskStatus.RUNNING) {
      throw new Error(`Task ${id} is not running`);
    }

    task.status = TaskStatus.COMPLETED;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this.metrics.runningTasks--;
    this.metrics.completedTasks++;

    // Check dependents
    for (const dependentId of task.dependents) {
      this.checkDependencyCompletion(dependentId);
    }

    return task;
  }

  failTask(id: string, error: string): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    task.status = TaskStatus.FAILED;
    task.error = error;
    task.updatedAt = Date.now();
    
    if (task.startedAt) {
      task.completedAt = Date.now();
    }

    this.metrics.runningTasks--;
    this.metrics.failedTasks++;

    // Retry logic
    if (task.attempts < task.maxRetries) {
      task.status = TaskStatus.PENDING;
      task.attempts++;
      this.metrics.failedTasks--;
      this.metrics.pendingTasks++;
      
      if (this.isTaskReady(task)) {
        this.markTaskReady(task);
      }
    }

    return task;
  }

  cancelTask(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      throw new Error(`Task ${id} is already completed or cancelled`);
    }

    task.status = TaskStatus.CANCELLED;
    task.updatedAt = Date.now();

    if (task.status === TaskStatus.READY) {
      this.metrics.readyTasks--;
      this.readyQueue.remove(t => t.id === id);
    } else if (task.status === TaskStatus.RUNNING) {
      this.metrics.runningTasks--;
    } else if (task.status === TaskStatus.PENDING) {
      this.metrics.pendingTasks--;
    }

    this.metrics.cancelledTasks++;

    // Cancel dependents recursively
    for (const dependentId of task.dependents) {
      this.cancelTask(dependentId);
    }

    return task;
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status);
  }

  getTasksByTag(tag: string): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.tags?.has(tag));
  }

  getMetrics(): TaskMetrics {
    return { ...this.metrics };
  }

  deleteTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.status === TaskStatus.RUNNING) {
      throw new Error(`Cannot delete running task ${id}`);
    }

    // Remove from ready queue
    this.readyQueue.remove(t => t.id === id);

    // Update metrics
    switch (task.status) {
      case TaskStatus.PENDING:
        this.metrics.pendingTasks--;
        break;
      case TaskStatus.READY:
        this.metrics.readyTasks--;
        break;
      case TaskStatus.COMPLETED:
        this.metrics.completedTasks--;
        break;
      case TaskStatus.FAILED:
        this.metrics.failedTasks--;
        break;
      case TaskStatus.CANCELLED:
        this.metrics.cancelledTasks--;
        break;
    }
    this.metrics.totalTasks--;

    // Remove from dependency graph
    this.dependencyGraph.removeNode(id);

    // Remove from dependents' dependency lists
    for (const dependentId of task.dependents) {
      const dependent = this.tasks.get(dependentId);
      if (dependent) {
        dependent.dependencies.delete(id);
        this.checkDependencyCompletion(dependentId);
      }
    }

    // Remove from dependencies' dependents lists
    for (const dependencyId of task.dependencies) {
      const dependency = this.tasks.get(dependencyId);
      if (dependency) {
        dependency.dependents.delete(id);
      }
    }

    this.tasks.delete(id);
  }

  private generateId(): string {
    return `task-${++this.taskCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private isTaskReady(task: Task): boolean {
    if (task.status !== TaskStatus.PENDING) return false;
    
    const now = Date.now();
    if (task.scheduledAt > now) return false;

    // Check if all dependencies are completed
    for (const depId of task.dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== TaskStatus.COMPLETED) {
        return false;
      }
    }

    return true;
  }

  private markTaskReady(task: Task): void {
    task.status = TaskStatus.READY;
    task.updatedAt = Date.now();
    
    this.metrics.pendingTasks--;
    this.metrics.readyTasks++;
    
    this.readyQueue.push(task, task.priority, task.scheduledAt);
  }

  private checkDependencyCompletion(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.PENDING) return;

    if (this.isTaskReady(task)) {
      this.markTaskReady(task);
    }
  }

  private cleanReadyQueue(): void {
    const now = Date.now();
    const readyTasks: Task[] = [];
    
    // Extract all ready tasks
    while (!this.readyQueue.isEmpty()) {
      const task = this.readyQueue.pop()!;
      readyTasks.push(task);
    }

    // Re-add only valid ready tasks
    for (const task of readyTasks) {
      if (task.status === TaskStatus.READY && task.scheduledAt <= now) {
        if (this.isTaskReady(task)) {
          this.readyQueue.push(task, task.priority, task.scheduledAt);
        } else {
          // Task is no longer ready, revert to pending
          task.status = TaskStatus.PENDING;
          this.metrics.readyTasks--;
          this.metrics.pendingTasks++;
        }
      } else if (task.status === TaskStatus.READY) {
        this.readyQueue.push(task, task.priority, task.scheduledAt);
      }
    }
  }

  private processScheduledTasks(now: number): void {
    // Move pending tasks to ready if scheduled time has passed and dependencies are met
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.PENDING && task.scheduledAt <= now) {
        if (this.isTaskReady(task)) {
          this.markTaskReady(task);
        }
      }
    }
  }

  private re-evaluateTaskReadiness(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Remove from ready queue if present
    if (task.status === TaskStatus.READY) {
      this.readyQueue.remove(t => t.id === taskId);
      this.metrics.readyTasks--;
      this.metrics.pendingTasks++;
      task.status = TaskStatus.PENDING;
    }

    if (this.isTaskReady(task)) {
      this.markTaskReady(task);
    }
  }

  // Batch operations for efficiency with 1M tasks
  bulkCreate(tasks: TaskConfig[]): Task[] {
    const createdTasks: Task[] = [];
    
    // First pass: create all tasks without dependencies
    for (const config of tasks) {
      try {
        const task = this.createTask({ ...config, dependencies: [] });
        createdTasks.push(task);
      } catch (error) {
        // Log but continue
        console.warn('Failed to create task:', error);
      }
    }

    // Second pass: add dependencies
    for (let i = 0; i < tasks.length && i < createdTasks.length; i++) {
      const config = tasks[i];
      const task = createdTasks[i];
      
      if (config.dependencies && config.dependencies.length > 0) {
        try {
          this.updateTask(task.id, { dependencies: config.dependencies });
        } catch (error) {
          console.warn(`Failed to update dependencies for task ${task.id}:`, error);
        }
      }
    }

    return createdTasks;
  }

  // Memory optimization: clear completed tasks older than threshold
  cleanupCompletedTasks(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, task] of this.tasks.entries()) {
      if (task.status === TaskStatus.COMPLETED && 
          task.completedAt && 
          task.completedAt < cutoff) {
        this.deleteTask(id);
        removed++;
      }
    }

    return removed;
  }
}
