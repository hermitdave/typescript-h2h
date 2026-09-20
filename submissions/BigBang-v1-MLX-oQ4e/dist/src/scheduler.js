"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
const heap_1 = require("./heap");
// ----------------------------------------------------------------------
// Heap comparators
// ----------------------------------------------------------------------
// `cmp(a, b) > 0` means `a` should sit *above* `b` (a is "greater").
function readyComparator(a, b) {
    // Max-heap by priority: higher priority sits above.
    if (a.task.priority !== b.task.priority) {
        return a.task.priority - b.task.priority; // >0 when a.priority > b.priority
    }
    // Then earlier scheduled time first.
    if (a.task.scheduledAt !== b.task.scheduledAt) {
        return b.task.scheduledAt - a.task.scheduledAt; // >0 when a.time < b.time
    }
    // Deterministic tie-break: lower id above.
    return b.task.id.localeCompare(a.task.id); // >0 when a.id < b.id
}
function deferredComparator(a, b) {
    // Min-heap by scheduled time: earlier time sits above.
    if (a.task.scheduledAt !== b.task.scheduledAt) {
        return b.task.scheduledAt - a.task.scheduledAt; // >0 when a.time < b.time
    }
    // Then higher priority first.
    if (a.task.priority !== b.task.priority) {
        return a.task.priority - b.task.priority; // >0 when a.priority > b.priority
    }
    return b.task.id.localeCompare(a.task.id);
}
// ----------------------------------------------------------------------
// Scheduler
// ----------------------------------------------------------------------
class TaskScheduler {
    constructor(now) {
        this.tasks = new Map();
        this.forward = new Map(); // task -> its dependencies
        this.reverse = new Map(); // task -> dependents
        this.readyHeap = new heap_1.BinaryHeap(readyComparator);
        this.deferredHeap = new heap_1.BinaryHeap(deferredComparator);
        this.nextIdSeq = 0;
        this.listeners = new Set();
        this.now = Date.now();
        this.now = now ?? Date.now();
    }
    // ------------------------------------------------------------------ time
    setTime(now) { this.now = now; }
    getTime() { return this.now; }
    // ----------------------------------------------------------- task CRUD
    addTask(input) {
        const id = input.id ?? this.generateId();
        if (this.tasks.has(id))
            throw new Error(`Task ${id} already exists`);
        const deps = new Set(input.deps ?? []);
        if (deps.has(id))
            throw new Error(`Task ${id} cannot depend on itself`);
        if (this.detectCycle(id, deps))
            throw new Error(`Cycle detected for task ${id}`);
        const task = {
            id,
            priority: input.priority,
            scheduledAt: input.scheduledAt,
            deps: Array.from(deps),
            depsSet: new Set(deps),
            payload: input.payload,
            status: 'pending',
            createdAt: Date.now(),
            version: 0,
            depStatus: new Map(),
        };
        this.tasks.set(id, task);
        this.bumpVersion(id);
        this.forward.set(id, deps);
        for (const dep of deps) {
            const rev = this.reverse.get(dep) ?? new Set();
            rev.add(id);
            this.reverse.set(dep, rev);
        }
        this.initDepStatus(task, deps);
        this.evaluateAndMove(id);
        return id;
    }
    updateTask(id, patch) {
        const task = this.tasks.get(id);
        if (!task)
            throw new Error(`Task ${id} not found`);
        const isReconfigurable = task.status === 'pending' || task.status === 'blocked';
        if (task.status === 'running') {
            if (patch.payload !== undefined)
                task.payload = patch.payload;
            if (patch.deps !== undefined || patch.priority !== undefined || patch.scheduledAt !== undefined) {
                throw new Error('Cannot change deps/priority/scheduledAt of a running task');
            }
            return;
        }
        if (!isReconfigurable) { // terminal (completed/failed/cancelled)
            if (patch.payload !== undefined)
                task.payload = patch.payload;
            if (patch.deps !== undefined || patch.priority !== undefined || patch.scheduledAt !== undefined) {
                throw new Error('Cannot change deps/priority/scheduledAt of a terminal task');
            }
            return;
        }
        const newDeps = patch.deps !== undefined ? new Set(patch.deps) : new Set(task.deps);
        if (newDeps.has(id))
            throw new Error(`Task ${id} cannot depend on itself`);
        if (this.detectCycle(id, newDeps))
            throw new Error(`Cycle detected for task ${id}`);
        task.deps = Array.from(newDeps);
        task.depsSet = newDeps;
        if (patch.priority !== undefined)
            task.priority = patch.priority;
        if (patch.scheduledAt !== undefined)
            task.scheduledAt = patch.scheduledAt;
        if (patch.payload !== undefined)
            task.payload = patch.payload;
        task.version = this.bumpVersion(id);
        this.initDepStatus(task, newDeps);
        this.evaluateAndMove(id);
    }
    removeTask(id) { this.cancelTask(id); }
    cancelTask(id) { this.setTaskStatus(id, 'cancelled'); }
    completeTask(id, result) { this.setTaskStatus(id, 'completed', result); }
    failTask(id, error) { this.setTaskStatus(id, 'failed', undefined, error); }
    resetTask(id) {
        const task = this.tasks.get(id);
        if (!task)
            throw new Error(`Task ${id} not found`);
        if (task.status === 'pending')
            return;
        const oldStatus = task.status;
        task.status = 'pending';
        task.result = undefined;
        task.error = undefined;
        task.depsSet = new Set(task.deps);
        // Clear blocked state: re-init depStatus to all pending (deps may have
        // changed while the task was blocked; this gives a fresh evaluation).
        const ds = new Map();
        for (const dep of task.deps)
            ds.set(dep, 'pending');
        task.depStatus = ds;
        this.evaluateAndMove(id);
        this.fireStatusChange(id, oldStatus, 'pending');
    }
    // ------------------------------------------------ dependency manipulation
    addDependency(taskId, depId) {
        const task = this.tasks.get(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        if (depId === taskId)
            throw new Error('Self-dependency not allowed');
        if (task.depsSet.has(depId))
            return;
        const newDeps = new Set(task.depsSet).add(depId);
        if (this.detectCycle(taskId, newDeps))
            throw new Error(`Cycle detected adding dep ${depId} to ${taskId}`);
        task.deps = Array.from(newDeps);
        task.depsSet = newDeps;
        this.bumpVersion(taskId);
        const rev = this.reverse.get(depId) ?? new Set();
        rev.add(taskId);
        this.reverse.set(depId, rev);
        this.initDepStatus(task, newDeps);
        this.evaluateAndMove(taskId);
    }
    removeDependency(taskId, depId) {
        const task = this.tasks.get(taskId);
        if (!task)
            throw new Error(`Task ${taskId} not found`);
        if (!task.depsSet.has(depId))
            return;
        task.depsSet.delete(depId);
        task.deps = Array.from(task.depsSet);
        const rev = this.reverse.get(depId);
        if (rev)
            rev.delete(taskId);
        this.bumpVersion(taskId);
        this.initDepStatus(task, task.depsSet);
        this.evaluateAndMove(taskId);
    }
    // ----------------------------------------------------------- retrieval
    dequeueNextExecutable(now) {
        const t0 = now ?? this.now;
        this.moveDeferredToReady(t0);
        while (this.readyHeap.size > 0) {
            const entry = this.readyHeap.pop();
            if (!entry)
                continue;
            const task = this.tasks.get(entry.task.id);
            if (!task)
                continue;
            if (task.status !== 'pending')
                continue; // terminal / running
            if (entry.seq !== task.version)
                continue; // stale (version bumped)
            task.status = 'running';
            task.version = this.bumpVersion(task.id);
            this.fireStatusChange(task.id, 'pending', 'running');
            return task;
        }
        return null;
    }
    peekNextExecutable(now) {
        const t0 = now ?? this.now;
        this.moveDeferredToReady(t0);
        while (this.readyHeap.size > 0) {
            const entry = this.readyHeap.peek();
            if (!entry)
                return null;
            const task = this.tasks.get(entry.task.id);
            const valid = task && task.status === 'pending' && entry.seq === task.version;
            if (valid)
                return task;
            this.readyHeap.pop(); // stale entry at top -> discard
        }
        return null;
    }
    getExecutableTasks(now) {
        const t0 = now ?? this.now;
        this.moveDeferredToReady(t0);
        const result = [];
        const temp = [];
        while (this.readyHeap.size > 0) {
            const entry = this.readyHeap.pop();
            if (!entry)
                break;
            const task = this.tasks.get(entry.task.id);
            const valid = task && task.status === 'pending' && entry.seq === task.version;
            if (valid)
                result.push(task);
            temp.push(entry);
        }
        for (const e of temp)
            this.readyHeap.push(e);
        return result;
    }
    getDeferredTasks(now) {
        const t0 = now ?? this.now;
        this.moveDeferredToReady(t0);
        const result = [];
        const temp = [];
        while (this.deferredHeap.size > 0) {
            const entry = this.deferredHeap.pop();
            if (!entry)
                break;
            const task = this.tasks.get(entry.task.id);
            const valid = task && task.status === 'pending' && entry.seq === task.version;
            if (valid)
                result.push(task);
            temp.push(entry);
        }
        for (const e of temp)
            this.deferredHeap.push(e);
        return result;
    }
    getPendingTasks() {
        const result = [];
        for (const task of this.tasks.values()) {
            if (task.status === 'pending')
                result.push(task);
        }
        return result;
    }
    getBlockedTasks() {
        const result = [];
        for (const task of this.tasks.values()) {
            if (task.status === 'blocked')
                result.push(task);
        }
        return result;
    }
    getTask(id) { return this.tasks.get(id); }
    getTaskCount() { return this.tasks.size; }
    // --------------------------------------------------------------- events
    subscribeStatusChange(cb) {
        this.listeners.add(cb);
        return () => { this.listeners.delete(cb); };
    }
    // ------------------------------------------------------------- internals
    generateId() { return `t${this.nextIdSeq++}`; }
    bumpVersion(id) {
        const task = this.tasks.get(id);
        task.version = (task.version ?? 0) + 1;
        return task.version;
    }
    getStatusCounts(task) {
        let completed = 0, failed = 0, pending = 0;
        for (const s of task.depStatus.values()) {
            if (s === 'completed')
                completed++;
            else if (s === 'failed')
                failed++;
            else
                pending++;
        }
        return { completed, failed, pending };
    }
    isReady(task) {
        const c = this.getStatusCounts(task);
        return c.failed === 0 && c.completed === task.deps.length;
    }
    isBlocked(task) {
        return Array.from(task.depStatus.values()).some(s => s === 'failed');
    }
    /**
     * Cycle detection: does any dependency `d` (or `d`'s transitive deps) reach
     * `targetId` through the forward graph? A path d -> ... -> targetId together
     * with the new edge targetId -> d forms a cycle. We DFS from each dep
     * following `forward[node]`; reaching `targetId` means the dep already
     * (transitively) depends on targetId -> cycle.
     */
    detectCycle(targetId, deps) {
        const visited = new Set();
        for (const dep of deps) {
            if (this.dfsReaches(dep, targetId, visited))
                return true;
        }
        return false;
    }
    dfsReaches(start, target, visited) {
        const stack = [start];
        while (stack.length > 0) {
            const node = stack.pop();
            if (node === target)
                return true;
            if (visited.has(node))
                continue;
            visited.add(node);
            const edges = this.forward.get(node);
            if (edges) {
                for (const nxt of edges) {
                    if (!visited.has(nxt))
                        stack.push(nxt);
                }
            }
        }
        return false;
    }
    /** Initialise `task.depStatus` from the current status of dep tasks. */
    initDepStatus(task, deps) {
        const ds = new Map();
        for (const dep of deps) {
            const dt = this.tasks.get(dep);
            if (!dt) {
                ds.set(dep, 'pending');
                continue;
            } // forward reference
            if (dt.status === 'completed')
                ds.set(dep, 'completed');
            else if (dt.status === 'failed' || dt.status === 'cancelled')
                ds.set(dep, 'failed');
            else
                ds.set(dep, 'pending');
        }
        task.depStatus = ds;
    }
    /** Push a ready task onto the ready or deferred heap. */
    moveToReadyOrDeferred(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== 'pending')
            return;
        const entry = { task, seq: task.version };
        if (task.scheduledAt <= this.now)
            this.readyHeap.push(entry);
        else
            this.deferredHeap.push(entry);
    }
    /** Re-evaluate a task and move it to a heap when it becomes ready. */
    evaluateAndMove(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== 'pending')
            return;
        if (!this.isReady(task))
            return;
        this.moveToReadyOrDeferred(id);
    }
    /**
     * Move deferred tasks whose scheduled time has arrived into the ready heap.
     * Stops at the first still-future task (deferred heap is time-ordered).
     */
    moveDeferredToReady(now) {
        while (this.deferredHeap.size > 0) {
            const entry = this.deferredHeap.peek();
            if (!entry)
                break;
            const task = this.tasks.get(entry.task.id);
            const valid = task && task.status === 'pending' && entry.seq === task.version;
            if (!valid) {
                this.deferredHeap.pop();
                continue;
            }
            if (task.scheduledAt > now)
                break;
            this.deferredHeap.pop();
            this.readyHeap.push(entry);
        }
    }
    /**
     * Set a terminal status and propagate completion/failure to dependents.
     */
    setTaskStatus(id, status, result, error) {
        const task = this.tasks.get(id);
        if (!task)
            throw new Error(`Task ${id} not found`);
        const oldStatus = task.status;
        if (oldStatus === status)
            return;
        task.status = status;
        task.result = result;
        task.error = error;
        this.fireStatusChange(id, oldStatus, status);
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            this.propagate(id, status, error);
        }
    }
    /**
     * When a task reaches a terminal status, update its dependents:
     *   - completed dep -> dependent may become ready
     *   - failed/cancelled dep -> dependent becomes blocked
     */
    propagate(id, status, error) {
        const dependents = this.reverse.get(id);
        if (!dependents)
            return;
        for (const depId of dependents) {
            const dep = this.tasks.get(depId);
            if (!dep || dep.status === 'blocked' || dep.status === 'completed' || dep.status === 'failed' || dep.status === 'cancelled')
                continue;
            if (dep.status !== 'pending')
                continue;
            const prevStatus = dep.status;
            if (status === 'completed') {
                const wasReady = this.isReady(dep);
                dep.depStatus.set(id, 'completed');
                if (!wasReady && this.isReady(dep)) {
                    this.moveToReadyOrDeferred(depId);
                }
            }
            else if (status === 'failed' || status === 'cancelled') {
                dep.depStatus.set(id, 'failed');
                if (this.isBlocked(dep)) {
                    dep.status = 'blocked';
                    dep.error = error;
                }
            }
            if (dep.status !== prevStatus) {
                this.fireStatusChange(depId, prevStatus, dep.status);
            }
        }
    }
    fireStatusChange(id, oldStatus, newStatus, payload) {
        for (const cb of this.listeners) {
            try {
                cb(id, oldStatus, newStatus, payload);
            }
            catch (err) {
                void err;
            }
        }
    }
}
exports.TaskScheduler = TaskScheduler;
exports.default = TaskScheduler;
//# sourceMappingURL=scheduler.js.map