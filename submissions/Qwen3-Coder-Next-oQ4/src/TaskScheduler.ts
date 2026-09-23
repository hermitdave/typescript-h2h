import { DependencyGraph } from './DependencyGraph';
import { PairingHeap, TaskPriorityQueue, TaskQueueEntry } from './PairingHeap';
import { Task, TaskPriority, TaskStatus, TaskResult, SchedulerStats, SchedulerConfig, TaskResult as TaskResultInterface } from './types';

/**
 * In-memory task scheduler
 * Supports 1M+ tasks with priorities, timestamps, dependencies, and dynamic updates
 */
export class TaskScheduler {
    private tasks: Map<string, Task> = new Map();
    private priorityQueue: TaskPriorityQueue = new TaskPriorityQueue();
    private dependencyGraph: DependencyGraph = new DependencyGraph();
    private config: SchedulerConfig;
    
    // Tasks that are ready to execute (in-degree = 0)
    private readyTasks: Set<string> = new Set();
    
    // Task events for monitoring
    private events: SchedulerEvent[] = [];
    
    // Statistics
    private cycleDetectedCount: number = 0;
    
    constructor(config: SchedulerConfig = {}) {
        this.config = {
            maxTasks: config.maxTasks ?? 1_000_000,
            defaultPriority: config.defaultPriority ?? TaskPriority.MEDIUM,
            taskRetentionMs: config.taskRetentionMs ?? 24 * 60 * 60 * 1000 // 24 hours
        };
        this.priorityQueue = new TaskPriorityQueue();
    }

    /**
     * Get the number of tasks in the scheduler
     */
    get size(): number {
        return this.tasks.size;
    }

    /**
     * Get the number of pending/ready tasks
     */
    get pendingSize(): number {
        let count = 0;
        for (const task of this.tasks.values()) {
            if (task.status === TaskStatus.PENDING || task.status === TaskStatus.READY) {
                count++;
            }
        }
        return count;
    }

    /**
     * Get the number of ready tasks (dependencies satisfied)
     */
    get readyCount(): number {
        return this.readyTasks.size;
    }

    /**
     * Get all tasks
     */
    getAllTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Get a task by ID
     */
    getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * Check if a task exists
     */
    hasTask(taskId: string): boolean {
        return this.tasks.has(taskId);
    }

    /**
     * Get the next executable task
     * Time complexity: O(log n) amortized
     */
    getNextExecutable(): Task | undefined {
        // Try to get a ready task from the priority queue
        while (!this.priorityQueue.isEmpty()) {
            const entry = this.priorityQueue.extractMin();
            if (!entry) break;

            const task = this.tasks.get(entry.taskId);
            if (!task) continue;

            // Verify task is still ready
            if (task.status === TaskStatus.READY || task.status === TaskStatus.PENDING) {
                if (this.dependencyGraph.isReady(entry.taskId)) {
                    return task;
                }
            }
            // If not ready, skip and continue
        }
        
        return undefined;
    }

    /**
     * Add a task to the scheduler
     * Time complexity: O(log n) amortized
     */
    addTask(task: Partial<Task> & { id: string }): Task {
        // Check max tasks
        if (this.tasks.size >= (this.config?.maxTasks ?? 1000000)) {
            throw new Error(`Maximum tasks (${this.config.maxTasks}) exceeded`);
        }

        // Generate default values
        const now = Date.now();
        const newTask: Task = {
            id: task.id,
            priority: task.priority ?? this.config.defaultPriority ?? TaskPriority.MEDIUM,
            executeAt: task.executeAt ?? now,
            dependencies: task.dependencies ?? [],
            payload: task.payload,
            status: TaskStatus.PENDING,
            createdAt: now,
            updatedAt: now
        };

        // Validate dependencies before adding
        this.validateDependencies(newTask.id, newTask.dependencies);

        // Add to storage
        this.tasks.set(newTask.id, newTask);

        // Add to dependency graph
        this.dependencyGraph.addTask(newTask.id);
        
        // Add dependencies to graph
        for (const depId of newTask.dependencies) {
            this.dependencyGraph.addDependency(newTask.id, depId);
        }

        // Update in-degree and ready status
        this.updateReadyStatus(newTask.id);

        // Add to priority queue
        this.priorityQueue.insert(
            newTask.id,
            newTask.priority,
            newTask.executeAt
        );

        // Emit event
        this.emitEvent({ type: 'task_added', task: newTask });

        return newTask;
    }

    /**
     * Update an existing task
     * Time complexity: O(log n) amortized
     */
    updateTask(taskId: string, updates: Partial<Task>): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        const now = Date.now();
        
        // Handle dependency updates
        if (updates.dependencies !== undefined) {
            // Remove old dependencies
            for (const depId of task.dependencies) {
                if (!updates.dependencies?.includes(depId)) {
                    this.dependencyGraph.removeDependency(taskId, depId);
                }
            }

            // Add new dependencies
            for (const depId of updates.dependencies) {
                if (!task.dependencies.includes(depId)) {
                    // Check for cycles
                    if (this.dependencyGraph.wouldCreateCycle(taskId, depId)) {
                        // Revert changes
                        for (const depId of updates.dependencies) {
                            if (!task.dependencies.includes(depId)) {
                                this.dependencyGraph.addDependency(taskId, depId);
                            }
                        }
                        throw new Error(`Cycle detected`);
                    }
                    this.dependencyGraph.addDependency(taskId, depId);
                }
            }

            // Validate no cycles created
            const cycles = this.dependencyGraph.detectCycles();
            if (cycles && cycles.length > 0) {
                // Revert all changes
                this.revertDependencyChanges(taskId, task.dependencies, updates.dependencies);
                throw new Error(`Cycle detected involving tasks: ${cycles.join(', ')}`);
            }

            // Update in-degree and ready status
            this.updateReadyStatus(taskId);
        }

        // Update other fields
        if (updates.priority !== undefined) {
            task.priority = updates.priority;
            this.priorityQueue.decreaseKey(taskId, task.priority, task.executeAt);
        }

        if (updates.executeAt !== undefined) {
            task.executeAt = updates.executeAt;
            this.priorityQueue.decreaseKey(taskId, task.priority, task.executeAt);
        }

        if (updates.status !== undefined) {
            task.status = updates.status;
        }

        if (updates.payload !== undefined) {
            task.payload = updates.payload;
        }

        task.updatedAt = now;

        // Update ready status
        if (task.status === TaskStatus.PENDING || task.status === TaskStatus.READY) {
            this.updateReadyStatus(taskId);
        }

        this.emitEvent({ type: 'task_updated', task });

        return true;
    }

    /**
     * Remove a task
     */
    removeTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        // Remove from priority queue
        this.priorityQueue.remove(taskId);

        // Remove from dependency graph
        this.dependencyGraph.removeDependency(taskId, task.id); // This is a no-op for self
        
        // Remove from dependents
        const dependents = this.dependencyGraph.getDependents(taskId);
        for (const dependentId of dependents) {
            this.dependencyGraph.removeDependency(dependentId, taskId);
        }

        // Remove from tasks
        this.tasks.delete(taskId);

        // Remove from ready set
        this.readyTasks.delete(taskId);

        // Remove from dependency graph storage
        this.dependencyGraph.removeTask(taskId);

        this.emitEvent({ type: 'task_removed', taskId });

        return true;
    }

    /**
     * Mark a task as completed
     */
    completeTask(taskId: string, output?: unknown): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        task.status = TaskStatus.COMPLETED;
        task.completedAt = Date.now();
        
        // Decrease in-degree for dependent tasks
        const dependents = this.dependencyGraph.getDependents(taskId);
        for (const dependentId of dependents) {
            const newDegree = this.dependencyGraph.decreaseInDegree(dependentId);
            if (newDegree === 0) {
                const dependent = this.tasks.get(dependentId);
                if (dependent) {
                    dependent.status = TaskStatus.READY;
                    this.readyTasks.add(dependentId);
                    this.emitEvent({ type: 'task_ready', task: dependent });
                }
            }
        }

        this.emitEvent({ type: 'task_completed', task, result: output });

        return true;
    }

    /**
     * Mark a task as failed
     */
    failTask(taskId: string, error: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        task.status = TaskStatus.FAILED;
        task.error = error;
        task.completedAt = Date.now();

        this.emitEvent({ type: 'task_failed', task, error });

        return true;
    }

    /**
     * Mark a task as cancelled
     */
    cancelTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task || !task.id) return false;

        task.status = TaskStatus.CANCELLED;
        task.completedAt = Date.now();

        this.emitEvent({ type: 'task_cancelled', task });

        return true;
    }

    /**
     * Mark a task as running
     */
    startTask(taskId: string): boolean {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        if (task.status !== TaskStatus.READY) {
            return false;
        }

        task.status = TaskStatus.RUNNING;
        task.startedAt = Date.now();
        this.readyTasks.delete(taskId);

        this.emitEvent({ type: 'task_started', task });

        return true;
    }

    /**
     * Get statistics
     */
    getStats(): SchedulerStats {
        let pending = 0, ready = 0, running = 0, completed = 0, failed = 0, cancelled = 0;
        let totalDeps = 0;

        for (const task of this.tasks.values()) {
            switch (task.status) {
                case TaskStatus.PENDING: pending++; break;
                case TaskStatus.READY: ready++; break;
                case TaskStatus.RUNNING: running++; break;
                case TaskStatus.COMPLETED: completed++; break;
                case TaskStatus.FAILED: failed++; break;
                case TaskStatus.CANCELLED: cancelled++; break;
            }
        }

        totalDeps = this.dependencyGraph.getTotalEdgeCount();

        return {
            totalTasks: this.tasks.size,
            pendingTasks: pending,
            readyTasks: ready,
            runningTasks: running,
            completedTasks: completed,
            failedTasks: failed,
            cancelledTasks: cancelled,
            totalDependencies: totalDeps,
            cycleDetectedCount: this.cycleDetectedCount
        };
    }

    /**
     * Check if the scheduler has cycles
     */
    hasCycles(): boolean {
        return this.dependencyGraph.hasCycles();
    }

    /**
     * Get tasks involved in cycles
     */
    getCycleTasks(): string[] {
        return this.dependencyGraph.getCycleTasks();
    }

    /**
     * Bulk insert tasks
     */
    addTasks(tasks: Array<Partial<Task> & { id: string }>): Task[] {
        return tasks.map(t => this.addTask(t));
    }

    /**
     * Validate dependencies
     */
    private validateDependencies(taskId: string, dependencies: string[]): void {
        // Self-dependency
        if (dependencies.includes(taskId)) {
            throw new Error(`Task ${taskId} cannot depend on itself`);
        }

        // Check if all dependencies exist
        for (const depId of dependencies) {
            if (!this.tasks.has(depId)) {
                throw new Error(`Dependency ${depId} does not exist`);
            }
        }


    }

    /**
     * Update ready status of a task
     */
    private updateReadyStatus(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        const isReady = this.dependencyGraph.isReady(taskId);
        const isNewReady = isReady && task.status === TaskStatus.PENDING;
        const wasReady = !isReady && task.status === TaskStatus.READY;

        if (isReady) {
            task.status = TaskStatus.READY;
            this.readyTasks.add(taskId);
            if (isNewReady) {
                this.emitEvent({ type: 'task_ready', task });
            }
        } else {
            task.status = TaskStatus.PENDING;
            this.readyTasks.delete(taskId);
            if (wasReady) {
                this.emitEvent({ type: 'task_unready', task });
            }
        }
    }

    /**
     * Revert dependency changes on error
     */
    private revertDependencyChanges(
        taskId: string,
        oldDeps: string[],
        newDeps: string[] | undefined
    ): void {
        // Remove new dependencies
        if (newDeps) {
            for (const depId of newDeps) {
                if (!oldDeps.includes(depId)) {
                    this.dependencyGraph.removeDependency(taskId, depId);
                }
            }
        }

        // Add back old dependencies
        for (const depId of oldDeps) {
            if (!newDeps?.includes(depId)) {
                this.dependencyGraph.addDependency(taskId, depId);
            }
        }
    }

    /**
     * Emit an event
     */
    private emitEvent(event: SchedulerEvent): void {
        this.events.push(event);
        
        if (event.type === 'cycle_detected') {
            this.cycleDetectedCount++;
        }
    }

    /**
     * Get recent events
     */
    getRecentEvents(count: number = 100): SchedulerEvent[] {
        return this.events.slice(-count);
    }

    /**
     * Clear events
     */
    clearEvents(): void {
        this.events = [];
    }

    /**
     * Validate the entire graph for cycles
     */
    validateGraph(): { valid: boolean; cycleTasks: string[] } {
        const cycles = this.dependencyGraph.detectCycles();
        return {
            valid: cycles === null,
            cycleTasks: cycles || []
        };
    }
}

// Add missing event types
export type SchedulerEvent =
    | { type: 'task_added'; task: Task }
    | { type: 'task_removed'; taskId: string }
    | { type: 'task_ready'; task: Task }
    | { type: 'task_unready'; task: Task }
    | { type: 'task_started'; task: Task }
    | { type: 'task_completed'; task: Task; result: unknown }
    | { type: 'task_failed'; task: Task; error: string }
    | { type: 'task_cancelled'; task: Task }
    | { type: 'task_updated'; task: Task }
    | { type: 'cycle_detected'; tasks: string[] }
    | { type: 'error'; error: Error };

// Extend DependencyGraph with removeTask
(DependencyGraph.prototype as any).removeTask = function(taskId: string): void {
    // Remove from dependents
    const dependents = this.dependents.get(taskId);
    if (dependents) {
        for (const depId of dependents) {
            this.removeDependency(depId, taskId);
        }
    }

    // Remove from dependencies
    const dependencies = this.dependencies.get(taskId);
    if (dependencies) {
        for (const depId of dependencies) {
            this.dependents.get(depId)?.delete(taskId);
            this.reverseDependencies.get(depId)?.delete(taskId);
        }
    }

    this.dependents.delete(taskId);
    this.dependencies.delete(taskId);
    this.inDegree.delete(taskId);
    this.reverseDependencies.delete(taskId);
    this.taskCount--;
};
