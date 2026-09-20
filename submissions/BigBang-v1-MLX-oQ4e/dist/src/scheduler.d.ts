import { Task, TaskInput, TaskPatch, StatusListener } from './types';
export declare class TaskScheduler {
    private tasks;
    private forward;
    private reverse;
    private readyHeap;
    private deferredHeap;
    private nextIdSeq;
    private listeners;
    private now;
    constructor(now?: number);
    setTime(now: number): void;
    getTime(): number;
    addTask(input: TaskInput): string;
    updateTask(id: string, patch: TaskPatch): void;
    removeTask(id: string): void;
    cancelTask(id: string): void;
    completeTask(id: string, result?: any): void;
    failTask(id: string, error?: any): void;
    resetTask(id: string): void;
    addDependency(taskId: string, depId: string): void;
    removeDependency(taskId: string, depId: string): void;
    dequeueNextExecutable(now?: number): Task | null;
    peekNextExecutable(now?: number): Task | null;
    getExecutableTasks(now?: number): Task[];
    getDeferredTasks(now?: number): Task[];
    getPendingTasks(): Task[];
    getBlockedTasks(): Task[];
    getTask(id: string): Task | undefined;
    getTaskCount(): number;
    subscribeStatusChange(cb: StatusListener): () => void;
    private generateId;
    private bumpVersion;
    private getStatusCounts;
    private isReady;
    private isBlocked;
    /**
     * Cycle detection: does any dependency `d` (or `d`'s transitive deps) reach
     * `targetId` through the forward graph? A path d -> ... -> targetId together
     * with the new edge targetId -> d forms a cycle. We DFS from each dep
     * following `forward[node]`; reaching `targetId` means the dep already
     * (transitively) depends on targetId -> cycle.
     */
    private detectCycle;
    private dfsReaches;
    /** Initialise `task.depStatus` from the current status of dep tasks. */
    private initDepStatus;
    /** Push a ready task onto the ready or deferred heap. */
    private moveToReadyOrDeferred;
    /** Re-evaluate a task and move it to a heap when it becomes ready. */
    private evaluateAndMove;
    /**
     * Move deferred tasks whose scheduled time has arrived into the ready heap.
     * Stops at the first still-future task (deferred heap is time-ordered).
     */
    private moveDeferredToReady;
    /**
     * Set a terminal status and propagate completion/failure to dependents.
     */
    private setTaskStatus;
    /**
     * When a task reaches a terminal status, update its dependents:
     *   - completed dep -> dependent may become ready
     *   - failed/cancelled dep -> dependent becomes blocked
     */
    private propagate;
    private fireStatusChange;
}
export default TaskScheduler;
//# sourceMappingURL=scheduler.d.ts.map