/**
 * Public entry point for the in-memory task scheduler.
 *
 * Usage:
 *
 * ```ts
 * import { TaskScheduler } from 'in-memory-task-scheduler';
 *
 * const scheduler = new TaskScheduler();
 * const task = scheduler.createTask({ id: 'job-1', priority: 5 });
 * const next = scheduler.runNext();
 * scheduler.completeTask(next!.id);
 * ```
 */

export { TaskScheduler } from './TaskScheduler.js';
export { SchedulerError } from './types.js';
export { MinHeap } from './MinHeap.js';

export type {
  Task,
  NewTask,
  HeapEntry,
  PriorityOrder,
  SchedulerOptions,
  TaskStatus,
  CycleReport,
  Cycle,
  SchedulerStats,
  AdvanceResult,
  WaitNextInfo,
} from './types.js';

export type {
  SchedulerEvent,
  CompleteEvent,
  CancelEvent,
  RemoveEvent,
  EventPayload,
} from './TaskScheduler.js';

export type { Comparator } from './MinHeap.js';
