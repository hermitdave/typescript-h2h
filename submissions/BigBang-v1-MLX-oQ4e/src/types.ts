/**
 * Core types for the in-memory task scheduler.
 *
 * The task model mirrors a real scheduling problem: each task has a unique id,
 * a numeric priority (higher = more important), a scheduled execution time,
 * and a set of dependency task ids. A task becomes executable once every
 * dependency has completed and the wall-clock has passed `scheduledAt`.
 */
export type TaskStatus =
  | 'pending'      // declared, but not yet executable
  | 'running'      // dequeued and awaiting a terminal update
  | 'completed'    // ran successfully
  | 'failed'       // ran but errored
  | 'cancelled'    // removed before running
  | 'blocked';     // waiting on a dependency that has failed/cancelled

export type DepStatus = 'pending' | 'completed' | 'failed';

export interface Task {
  id: string;
  priority: number;
  scheduledAt: number;
  deps: string[];             // declared dependencies (stable, used for reset/rebuild)
  depsSet: Set<string>;       // fast membership check for the current dependency set
  payload?: any;
  status: TaskStatus;
  result?: any;
  error?: any;
  createdAt: number;
  version: number;            // monotonic epoch for lazy-deletion of stale heap entries
  depStatus: Map<string, DepStatus>;
}

export interface TaskInput {
  priority: number;
  scheduledAt: number;
  deps?: string[];
  payload?: any;
  id?: string;                // optional stable id; a unique one is generated if omitted
}

export interface TaskPatch {
  priority?: number;
  scheduledAt?: number;
  deps?: string[];            // replaces the whole dependency set (dynamic reconfiguration)
  payload?: any;
}

export interface HeapEntry {
  task: Task;
  seq: number;                // `task.version` snapshot at push time
}

export type StatusListener = (
  id: string,
  oldStatus: TaskStatus,
  newStatus: TaskStatus,
  payload?: any,
) => void;