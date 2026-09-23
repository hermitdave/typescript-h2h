/**
 * Task priority levels
 */
export declare enum TaskPriority {
    CRITICAL = 100,
    HIGH = 75,
    MEDIUM = 50,
    LOW = 25,
    BACKGROUND = 0
}
/**
 * Task status
 */
export declare enum TaskStatus {
    PENDING = "pending",
    READY = "ready",
    RUNNING = "running",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled"
}
/**
 * Task interface
 */
export interface Task {
    id: string;
    priority: TaskPriority;
    executeAt: number;
    dependencies: string[];
    payload?: Record<string, unknown>;
    status: TaskStatus;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
}
/**
 * Task result
 */
export interface TaskResult {
    taskId: string;
    success: boolean;
    output?: unknown;
    error?: string;
}
/**
 * Scheduler statistics
 */
export interface SchedulerStats {
    totalTasks: number;
    pendingTasks: number;
    readyTasks: number;
    runningTasks: number;
    completedTasks: number;
    failedTasks: number;
    cancelledTasks: number;
    totalDependencies: number;
    cycleDetectedCount: number;
}
/**
 * Configuration for the scheduler
 */
export interface SchedulerConfig {
    maxTasks?: number;
    defaultPriority?: TaskPriority;
    taskRetentionMs?: number;
}
/**
 * Event types for the scheduler
 */
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
    type: 'cycle_detected';
    tasks: string[];
} | {
    type: 'error';
    error: Error;
};
