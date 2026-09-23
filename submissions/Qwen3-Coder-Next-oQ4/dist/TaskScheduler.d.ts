import { Task, SchedulerStats, SchedulerConfig } from './types';
/**
 * In-memory task scheduler
 * Supports 1M+ tasks with priorities, timestamps, dependencies, and dynamic updates
 */
export declare class TaskScheduler {
    private tasks;
    private priorityQueue;
    private dependencyGraph;
    private config;
    private readyTasks;
    private events;
    private cycleDetectedCount;
    constructor(config?: SchedulerConfig);
    /**
     * Get the number of tasks in the scheduler
     */
    get size(): number;
    /**
     * Get the number of pending/ready tasks
     */
    get pendingSize(): number;
    /**
     * Get the number of ready tasks (dependencies satisfied)
     */
    get readyCount(): number;
    /**
     * Get all tasks
     */
    getAllTasks(): Task[];
    /**
     * Get a task by ID
     */
    getTask(taskId: string): Task | undefined;
    /**
     * Check if a task exists
     */
    hasTask(taskId: string): boolean;
    /**
     * Get the next executable task
     * Time complexity: O(log n) amortized
     */
    getNextExecutable(): Task | undefined;
    /**
     * Add a task to the scheduler
     * Time complexity: O(log n) amortized
     */
    addTask(task: Partial<Task> & {
        id: string;
    }): Task;
    /**
     * Update an existing task
     * Time complexity: O(log n) amortized
     */
    updateTask(taskId: string, updates: Partial<Task>): boolean;
    /**
     * Remove a task
     */
    removeTask(taskId: string): boolean;
    /**
     * Mark a task as completed
     */
    completeTask(taskId: string, output?: unknown): boolean;
    /**
     * Mark a task as failed
     */
    failTask(taskId: string, error: string): boolean;
    /**
     * Mark a task as cancelled
     */
    cancelTask(taskId: string): boolean;
    /**
     * Mark a task as running
     */
    startTask(taskId: string): boolean;
    /**
     * Get statistics
     */
    getStats(): SchedulerStats;
    /**
     * Check if the scheduler has cycles
     */
    hasCycles(): boolean;
    /**
     * Get tasks involved in cycles
     */
    getCycleTasks(): string[];
    /**
     * Bulk insert tasks
     */
    addTasks(tasks: Array<Partial<Task> & {
        id: string;
    }>): Task[];
    /**
     * Validate dependencies
     */
    private validateDependencies;
    /**
     * Update ready status of a task
     */
    private updateReadyStatus;
    /**
     * Revert dependency changes on error
     */
    private revertDependencyChanges;
    /**
     * Emit an event
     */
    private emitEvent;
    /**
     * Get recent events
     */
    getRecentEvents(count?: number): SchedulerEvent[];
    /**
     * Clear events
     */
    clearEvents(): void;
    /**
     * Validate the entire graph for cycles
     */
    validateGraph(): {
        valid: boolean;
        cycleTasks: string[];
    };
}
export type SchedulerEvent = {
    type: 'task_added';
    task: Task;
} | {
    type: 'task_removed';
    taskId: string;
} | {
    type: 'task_ready';
    task: Task;
} | {
    type: 'task_unready';
    task: Task;
} | {
    type: 'task_started';
    task: Task;
} | {
    type: 'task_completed';
    task: Task;
    result: unknown;
} | {
    type: 'task_failed';
    task: Task;
    error: string;
} | {
    type: 'task_cancelled';
    task: Task;
} | {
    type: 'task_updated';
    task: Task;
} | {
    type: 'cycle_detected';
    tasks: string[];
} | {
    type: 'error';
    error: Error;
};
