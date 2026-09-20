export enum Priority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
  BACKGROUND = 4
}

export enum TaskStatus {
  PENDING = 'pending',
  READY = 'ready',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface TaskConfig {
  name?: string;
  description?: string;
  priority?: Priority;
  scheduledAt?: number;
  data?: Record<string, unknown>;
  dependencies?: string[];
  retries?: number;
  timeout?: number;
  tags?: string[];
}

export interface Task {
  id: string;
  name: string;
  description?: string;
  priority: Priority;
  status: TaskStatus;
  scheduledAt: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  data?: Record<string, unknown>;
  dependencies: Set<string>;
  dependents: Set<string>;
  retries: number;
  maxRetries: number;
  timeout?: number;
  tags?: Set<string>;
  error?: string;
  attempts: number;
}

export interface TaskMetrics {
  totalTasks: number;
  pendingTasks: number;
  readyTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  averageWaitTime: number;
  averageExecutionTime: number;
}
