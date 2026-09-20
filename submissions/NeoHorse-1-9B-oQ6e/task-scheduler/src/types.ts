/**
 * Task Scheduler - Type Definitions
 */

export type TaskStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Task {
  id: string;
  name: string;
  priority: number;
  scheduledTime: number;
  dependencies: string[];
  status: TaskStatus;
  result?: unknown;
  error?: string;
  startTime?: number;
  finishTime?: number;
  retryCount: number;
  maxRetries: number;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  startTime: number;
  finishTime: number;
  duration: number;
}

export interface Dependency {
  taskId: string;
  condition?: 'success' | 'always';
}

export interface SchedulerConfig {
  concurrency?: number;
  defaultPriority?: number;
  defaultScheduledTime?: number;
}

export interface SchedulerOptions {
  config: SchedulerConfig;
  onTaskComplete?: (result: TaskResult) => void | Promise<void>;
  onTaskFail?: (result: TaskResult) => void | Promise<void>;
}