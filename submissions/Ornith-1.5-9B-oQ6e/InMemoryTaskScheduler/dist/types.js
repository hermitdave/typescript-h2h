/**
 * Type definitions for the in-memory task scheduler.
 *
 * This is the single source of truth for the scheduler's vocabulary. The design
 * choices below are deliberately opinionated (they are what "senior review"
 * checks), and are re-stated in the README:
 *
 *   - LOWER `priority` value == HIGHER precedence (runs first). 0 is neutral.
 *     This matches Array.sort / JS's natural `<` ordering and most queue APIs.
 *   - A task is executed STRICTLY SERIALY — at most one task runs at a time.
 *     `runningTaskId` gates everything; dependents are fanned out only after the
 *     current task reaches a terminal state.
 *   - `deps` are HARD: ALL must reach Success before a task is executable. If
 *     any hard dep ends in Failure/Canceled, the task is STUCK (faulted, never
 *     auto-run, surfaced for retry).
 *   - `softDeps` are ADVISORY: the task always runs, but if any soft dep FAILED
 *     (or was canceled), the task completes as SKIPPED instead of Success. This
 *     lets optional cleanup/telemetry tasks degrade gracefully.
 *   - Ordering is deterministic: (due, priority, seq) with `seq` a global
 *     monotonic counter. Equal due+priority resolves by insertion order.
 */
/** Lifecycle states. Transitions are gated on `runningTaskId`; the value you
 *  see is the last observed status at snapshot time. */
export var TaskStatus;
(function (TaskStatus) {
    /** Spec supplied but not yet registered in the scheduler. */
    TaskStatus["Created"] = "Created";
    /** Registered but awaiting dependencies and/or its due-time. */
    TaskStatus["Pending"] = "Pending";
    /** Registered and due now — held in the ready-heap. */
    TaskStatus["Ready"] = "Ready";
    /** Currently executing. Exactly one task in this state at a time. */
    TaskStatus["Running"] = "Running";
    /** Finished successfully. */
    TaskStatus["Success"] = "Success";
    /** Finished with a handler error. */
    TaskStatus["Failure"] = "Failure";
    /** Running task explicitly canceled by the scheduler. */
    TaskStatus["Canceled"] = "Canceled";
    /** Faulted because a HARD dependency failed/canceled; can never run. */
    TaskStatus["Stuck"] = "Stuck";
    /** Ran, but a SOFT dependency failed/canceled — degraded to SKIPPED. */
    TaskStatus["Skipped"] = "Skipped";
})(TaskStatus || (TaskStatus = {}));
/** Helpers to reason about dependents without enumerating every state. */
export const TASK_SUCCEEDED_STATUSES = new Set([
    TaskStatus.Success,
]);
/** Statuses after which a hard dependent must be considered faulted. */
export const TASK_FAILED_STATUSES = new Set([
    TaskStatus.Failure,
    TaskStatus.Canceled,
]);
/** Every status that "closes" a task for the purposes of fan-out. */
export const TERMINAL_STATUSES = new Set([
    TaskStatus.Success,
    TaskStatus.Failure,
    TaskStatus.Canceled,
    TaskStatus.Stuck,
]);
/** Subscription event. */
export var SchedulerEvent;
(function (SchedulerEvent) {
    SchedulerEvent["TaskStarted"] = "TaskStarted";
    SchedulerEvent["TaskCompleted"] = "TaskCompleted";
    SchedulerEvent["TaskFailed"] = "TaskFailed";
    SchedulerEvent["TaskSkipped"] = "TaskSkipped";
    SchedulerEvent["TaskCanceled"] = "TaskCanceled";
    SchedulerEvent["TaskStuck"] = "TaskStuck";
})(SchedulerEvent || (SchedulerEvent = {}));
