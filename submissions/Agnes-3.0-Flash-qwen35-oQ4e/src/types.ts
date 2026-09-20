/**
 * Core type definitions for the task scheduler.
 *
 * Edge semantics (used consistently everywhere):
 *   "task X depends on task Y"  <=>  forward edge Y -> X
 *   (Y must complete before X may run)
 *
 * The forward-edge index is `dependents`: dependents.get(Y) is the set of
 * tasks that depend on Y. The reverse index lives on the record itself
 * (record.deps). The two indices must stay in lockstep — every mutator
 * updates both sides of an edge, and audit() verifies the invariant.
 */

export const TaskState = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
} as const;

export type TaskStateValue = (typeof TaskState)[keyof typeof TaskState];

/** A live task record. `version` invalidates stale ready-heap entries on every
 *  mutation that affects schedulability (state, unmet, priority, scheduledAt,
 *  dependency-set changes). Structural level changes deliberately do NOT bump
 *  it — levels do not affect schedulability, and bumping would silently drop
 *  valid heap entries. */
export interface TaskRecord {
  id: string;
  /** Urgency rank. Higher value = more urgent. Primary heap sort key. */
  priority: number;
  /** Execution timestamp (epoch ms). Secondary heap sort key (earlier first). */
  scheduledAt: number;
  state: TaskStateValue;
  /** Count of declared dependencies that are not yet satisfied (state !== COMPLETED). */
  unmet: number;
  /** Declared dependency ids (reverse-edge index). */
  deps: Set<string>;
  /** Longest-path topological level: 0 for sources, max(dep level)+1 otherwise.
   *  Powers the O(1) cycle fast path and cheap level cascades. */
  level: number;
  /** Monotonically increasing; bumped on every schedulability-affecting mutation. */
  version: number;
  /** Opaque application payload; untouched by scheduler bookkeeping. */
  payload?: unknown;
}

/** Specification accepted by addTask. */
export interface TaskSpec {
  id: string;
  priority: number;
  scheduledAt: number;
  payload?: unknown;
  /** Ids of tasks this task depends on (must already exist). */
  deps?: readonly string[];
}

/** An entry in the ready heap. Stores the ordering keys plus the record version
 *  at insertion time so lazily-deleted entries can be recognised as stale. */
export interface HeapEntry {
  id: string;
  version: number;
  priority: number;
  scheduledAt: number;
}
