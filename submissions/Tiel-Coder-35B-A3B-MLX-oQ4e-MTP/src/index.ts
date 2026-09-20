/**
 * Public entry point for the scheduler package.
 *
 * @packageDocumentation
 */

export { TaskScheduler } from './taskScheduler.js';
export type { TaskSchedulerOptions } from './taskScheduler.js';
export { BinaryHeap } from './binaryHeap.js';
export type { Compare } from './binaryHeap.js';
export { detectCycle } from './cycleDetection.js';

export {
  TaskSchedulerError,
  DuplicateTaskError,
  UnknownDependencyError,
  UnknownTaskError,
  DuplicatedDependencyError,
  CycleDetectedError,
  InvalidArgumentError,
  InvalidTaskStateError,
} from './errors.js';

export { TaskState } from './types.js';
export type { Task, TaskSpec, TaskUpdate, TaskId } from './types.js';
