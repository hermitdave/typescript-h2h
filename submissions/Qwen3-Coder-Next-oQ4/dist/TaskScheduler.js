"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
const DependencyGraph_1 = require("./DependencyGraph");
const PairingHeap_1 = require("./PairingHeap");
const types_1 = require("./types");
/**
 * In-memory task scheduler
 * Supports 1M+ tasks with priorities, timestamps, dependencies, and dynamic updates
 */
class TaskScheduler {
    constructor(config = {}) {
        this.tasks = new Map();
        this.priorityQueue = new PairingHeap_1.TaskPriorityQueue();
        this.dependencyGraph = new DependencyGraph_1.DependencyGraph();
        // Tasks that are ready to execute (in-degree = 0)
        this.readyTasks = new Set();
        // Task events for monitoring
        this.events = [];
        // Statistics
        this.cycleDetectedCount = 0;
        this.config = {
            maxTasks: config.maxTasks ?? 1000000,
            defaultPriority: config.defaultPriority ?? types_1.TaskPriority.MEDIUM,
            taskRetentionMs: config.taskRetentionMs ?? 24 * 60 * 60 * 1000 // 24 hours
        };
        this.priorityQueue = new PairingHeap_1.TaskPriorityQueue();
    }
    /**
     * Get the number of tasks in the scheduler
     */
    get size() {
        return this.tasks.size;
    }
    /**
     * Get the number of pending/ready tasks
     */
    get pendingSize() {
        let count = 0;
        for (const task of this.tasks.values()) {
            if (task.status === types_1.TaskStatus.PENDING || task.status === types_1.TaskStatus.READY) {
                count++;
            }
        }
        return count;
    }
    /**
     * Get the number of ready tasks (dependencies satisfied)
     */
    get readyCount() {
        return this.readyTasks.size;
    }
    /**
     * Get all tasks
     */
    getAllTasks() {
        return Array.from(this.tasks.values());
    }
    /**
     * Get a task by ID
     */
    getTask(taskId) {
        return this.tasks.get(taskId);
    }
    /**
     * Check if a task exists
     */
    hasTask(taskId) {
        return this.tasks.has(taskId);
    }
    /**
     * Get the next executable task
     * Time complexity: O(log n) amortized
     */
    getNextExecutable() {
        // Try to get a ready task from the priority queue
        while (!this.priorityQueue.isEmpty()) {
            const entry = this.priorityQueue.extractMin();
            if (!entry)
                break;
            const task = this.tasks.get(entry.taskId);
            if (!task)
                continue;
            // Verify task is still ready
            if (task.status === types_1.TaskStatus.READY || task.status === types_1.TaskStatus.PENDING) {
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
    addTask(task) {
        // Check max tasks
        if (this.tasks.size >= (this.config?.maxTasks ?? 1000000)) {
            throw new Error(`Maximum tasks (${this.config.maxTasks}) exceeded`);
        }
        // Generate default values
        const now = Date.now();
        const newTask = {
            id: task.id,
            priority: task.priority ?? this.config.defaultPriority ?? types_1.TaskPriority.MEDIUM,
            executeAt: task.executeAt ?? now,
            dependencies: task.dependencies ?? [],
            payload: task.payload,
            status: types_1.TaskStatus.PENDING,
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
        this.priorityQueue.insert(newTask.id, newTask.priority, newTask.executeAt);
        // Emit event
        this.emitEvent({ type: 'task_added', task: newTask });
        return newTask;
    }
    /**
     * Update an existing task
     * Time complexity: O(log n) amortized
     */
    updateTask(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
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
        if (task.status === types_1.TaskStatus.PENDING || task.status === types_1.TaskStatus.READY) {
            this.updateReadyStatus(taskId);
        }
        this.emitEvent({ type: 'task_updated', task });
        return true;
    }
    /**
     * Remove a task
     */
    removeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
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
    completeTask(taskId, output) {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
        task.status = types_1.TaskStatus.COMPLETED;
        task.completedAt = Date.now();
        // Decrease in-degree for dependent tasks
        const dependents = this.dependencyGraph.getDependents(taskId);
        for (const dependentId of dependents) {
            const newDegree = this.dependencyGraph.decreaseInDegree(dependentId);
            if (newDegree === 0) {
                const dependent = this.tasks.get(dependentId);
                if (dependent) {
                    dependent.status = types_1.TaskStatus.READY;
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
    failTask(taskId, error) {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
        task.status = types_1.TaskStatus.FAILED;
        task.error = error;
        task.completedAt = Date.now();
        this.emitEvent({ type: 'task_failed', task, error });
        return true;
    }
    /**
     * Mark a task as cancelled
     */
    cancelTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task || !task.id)
            return false;
        task.status = types_1.TaskStatus.CANCELLED;
        task.completedAt = Date.now();
        this.emitEvent({ type: 'task_cancelled', task });
        return true;
    }
    /**
     * Mark a task as running
     */
    startTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return false;
        if (task.status !== types_1.TaskStatus.READY) {
            return false;
        }
        task.status = types_1.TaskStatus.RUNNING;
        task.startedAt = Date.now();
        this.readyTasks.delete(taskId);
        this.emitEvent({ type: 'task_started', task });
        return true;
    }
    /**
     * Get statistics
     */
    getStats() {
        let pending = 0, ready = 0, running = 0, completed = 0, failed = 0, cancelled = 0;
        let totalDeps = 0;
        for (const task of this.tasks.values()) {
            switch (task.status) {
                case types_1.TaskStatus.PENDING:
                    pending++;
                    break;
                case types_1.TaskStatus.READY:
                    ready++;
                    break;
                case types_1.TaskStatus.RUNNING:
                    running++;
                    break;
                case types_1.TaskStatus.COMPLETED:
                    completed++;
                    break;
                case types_1.TaskStatus.FAILED:
                    failed++;
                    break;
                case types_1.TaskStatus.CANCELLED:
                    cancelled++;
                    break;
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
    hasCycles() {
        return this.dependencyGraph.hasCycles();
    }
    /**
     * Get tasks involved in cycles
     */
    getCycleTasks() {
        return this.dependencyGraph.getCycleTasks();
    }
    /**
     * Bulk insert tasks
     */
    addTasks(tasks) {
        return tasks.map(t => this.addTask(t));
    }
    /**
     * Validate dependencies
     */
    validateDependencies(taskId, dependencies) {
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
    updateReadyStatus(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        const isReady = this.dependencyGraph.isReady(taskId);
        const isNewReady = isReady && task.status === types_1.TaskStatus.PENDING;
        const wasReady = !isReady && task.status === types_1.TaskStatus.READY;
        if (isReady) {
            task.status = types_1.TaskStatus.READY;
            this.readyTasks.add(taskId);
            if (isNewReady) {
                this.emitEvent({ type: 'task_ready', task });
            }
        }
        else {
            task.status = types_1.TaskStatus.PENDING;
            this.readyTasks.delete(taskId);
            if (wasReady) {
                this.emitEvent({ type: 'task_unready', task });
            }
        }
    }
    /**
     * Revert dependency changes on error
     */
    revertDependencyChanges(taskId, oldDeps, newDeps) {
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
    emitEvent(event) {
        this.events.push(event);
        if (event.type === 'cycle_detected') {
            this.cycleDetectedCount++;
        }
    }
    /**
     * Get recent events
     */
    getRecentEvents(count = 100) {
        return this.events.slice(-count);
    }
    /**
     * Clear events
     */
    clearEvents() {
        this.events = [];
    }
    /**
     * Validate the entire graph for cycles
     */
    validateGraph() {
        const cycles = this.dependencyGraph.detectCycles();
        return {
            valid: cycles === null,
            cycleTasks: cycles || []
        };
    }
}
exports.TaskScheduler = TaskScheduler;
// Extend DependencyGraph with removeTask
DependencyGraph_1.DependencyGraph.prototype.removeTask = function (taskId) {
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
