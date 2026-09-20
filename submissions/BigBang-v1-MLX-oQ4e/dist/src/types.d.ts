/**
 * Core types for the in-memory task scheduler.
 *
 * The task model mirrors a real scheduling problem: each task has a unique id,
 * a numeric priority (higher = more important), a scheduled execution time,
 * and a set of dependency task ids. A task becomes executable once every
 * dependency has completed and the wall-clock has passed `scheduledAt`.
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked';
export type DepStatus = 'pending' | 'completed' | 'failed';
export interface Task {
    id: string;
    priority: number;
    scheduledAt: number;
    deps: string[];
    depsSet: Set<string>;
    payload?: any;
    status: TaskStatus;
    result?: any;
    error?: any;
    createdAt: number;
    version: number;
    depStatus: Map<string, DepStatus>;
}
export interface TaskInput {
    priority: number;
    scheduledAt: number;
    deps?: string[];
    payload?: any;
    id?: string;
}
export interface TaskPatch {
    priority?: number;
    scheduledAt?: number;
    deps?: string[];
    payload?: any;
}
export interface HeapEntry {
    task: Task;
    seq: number;
}
export type StatusListener = (id: string, oldStatus: TaskStatus, newStatus: TaskStatus, payload?: any) => void;
//# sourceMappingURL=types.d.ts.map