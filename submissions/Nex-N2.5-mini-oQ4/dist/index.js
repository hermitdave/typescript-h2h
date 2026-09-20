export class TaskError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TaskError';
    }
}
export class TaskValidationError extends TaskError {
    constructor(message) {
        super(message);
        this.name = 'TaskValidationError';
    }
}
export class TaskNotFoundError extends TaskError {
    constructor(id) {
        super(`Task "${id}" was not found`);
        this.name = 'TaskNotFoundError';
    }
}
export class TaskNotExecutableError extends TaskError {
    constructor(id, status) {
        super(`Task "${id}" cannot be changed because it is ${status.toLowerCase()}`);
        this.name = 'TaskNotExecutableError';
    }
}
export class TaskHasDependentsError extends TaskError {
    constructor(id) {
        super(`Task "${id}" cannot be removed because it has dependants`);
        this.name = 'TaskHasDependentsError';
    }
}
export class TaskDependencyCycleError extends TaskError {
    path;
    constructor(path) {
        super(`Adding this dependency would create a cycle: ${path.join(' -> ')}`);
        this.name = 'TaskDependencyCycleError';
        this.path = [...path];
    }
}
export class TaskTimeError extends TaskError {
    constructor(message) {
        super(message);
        this.name = 'TaskTimeError';
    }
}
class BinaryHeap {
    less;
    entries = [];
    constructor(less) {
        this.less = less;
    }
    get size() {
        return this.entries.length;
    }
    peek() {
        return this.entries[0]?.value;
    }
    push(value) {
        const entry = { value, index: this.entries.length };
        this.entries.push(entry);
        this.siftUp(this.entries.length - 1);
        return this.entries.length - 1;
    }
    removeAt(index) {
        const current = this.entries[index];
        if (!current) {
            return undefined;
        }
        if (this.entries.length === 1) {
            this.entries.pop();
            return current.value;
        }
        const last = this.entries.pop();
        last.index = index;
        this.entries[index] = last;
        if (index > 0 && this.less(last.value, this.entries[index - 1].value)) {
            this.siftUp(index);
        }
        else {
            this.siftDown(index);
        }
        return current.value;
    }
    siftUp(index) {
        while (index > 0) {
            const parent = (index - 1) >>> 1;
            if (!this.less(this.entries[index].value, this.entries[parent].value)) {
                break;
            }
            this.swap(index, parent);
            index = parent;
        }
    }
    siftDown(index) {
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let smallest = index;
            if (left < this.entries.length &&
                this.less(this.entries[left].value, this.entries[smallest].value)) {
                smallest = left;
            }
            if (right < this.entries.length &&
                this.less(this.entries[right].value, this.entries[smallest].value)) {
                smallest = right;
            }
            if (smallest === index) {
                break;
            }
            this.swap(index, smallest);
            index = smallest;
        }
    }
    swap(left, right) {
        const leftEntry = this.entries[left];
        const rightEntry = this.entries[right];
        leftEntry.index = right;
        rightEntry.index = left;
        const leftValue = leftEntry.value;
        leftEntry.value = rightEntry.value;
        rightEntry.value = leftValue;
    }
}
function compareString(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function lessDue(left, right) {
    if (left.input.priority !== right.input.priority) {
        return left.input.priority > right.input.priority;
    }
    if (left.input.executeAt !== right.input.executeAt) {
        return left.input.executeAt < right.input.executeAt;
    }
    return compareString(left.input.id, right.input.id) < 0;
}
function lessFuture(left, right) {
    if (left.input.executeAt !== right.input.executeAt) {
        return left.input.executeAt < right.input.executeAt;
    }
    return lessDue(left, right);
}
export class InMemoryTaskScheduler {
    dueHeap = new BinaryHeap(lessDue);
    futureHeap = new BinaryHeap(lessFuture);
    blocked = new Set();
    tasks = new Map();
    taskOrder = [];
    orderPositions = new Map();
    clock;
    constructor(options = {}) {
        this.clock = options.now ?? Date.now();
        if (!Number.isFinite(this.clock)) {
            throw new TaskValidationError('Scheduler time must be a finite number');
        }
    }
    get taskCount() {
        return this.tasks.size;
    }
    addTask(input, dependencies = []) {
        this.validateInput(input);
        this.validateDependencyList(dependencies, input.id);
        if (this.tasks.has(input.id)) {
            throw new TaskValidationError(`Task "${input.id}" already exists`);
        }
        const record = {
            input: { ...input },
            status: 'PENDING',
            dependencies: new Set(dependencies),
            dependentIds: new Set(),
            activeDependencyIds: new Set(),
            remainingDependencies: 0,
            heapKind: null,
            heapIndex: -1,
        };
        for (const dependencyId of dependencies) {
            const dependency = this.requireKnownTask(dependencyId);
            dependency.dependentIds.add(input.id);
            if (dependency.status !== 'COMPLETED') {
                record.activeDependencyIds.add(dependencyId);
                dependency.activeDependencyIds.add(input.id);
                record.remainingDependencies += 1;
            }
        }
        this.tasks.set(input.id, record);
        this.taskOrder.push(input.id);
        this.orderPositions.set(input.id, this.taskOrder.length - 1);
        this.classify(record);
    }
    getTask(taskId) {
        const record = this.tasks.get(taskId);
        return record ? this.snapshot(record) : undefined;
    }
    peekNextTask(now = this.currentTime()) {
        this.advanceTime(now);
        const record = this.dueHeap.peek();
        return record ? this.snapshot(record) : undefined;
    }
    advanceTime(now) {
        this.validateFinite(now, 'execution time');
        if (now < this.clock) {
            throw new TaskTimeError('Scheduler time cannot move backwards');
        }
        if (now === this.clock) {
            return;
        }
        this.clock = now;
        while (this.futureHeap.peek() !== undefined) {
            const candidate = this.futureHeap.peek();
            if (candidate.input.executeAt > now) {
                break;
            }
            const record = this.futureHeap.removeAt(0);
            record.heapKind = null;
            record.heapIndex = -1;
            this.classify(record);
        }
    }
    currentTime() {
        return this.clock;
    }
    takeNextTask() {
        const now = this.currentTime();
        this.advanceTime(now);
        const record = this.dueHeap.peek();
        if (!record) {
            return undefined;
        }
        this.dueHeap.removeAt(0);
        record.status = 'RUNNING';
        return this.snapshot(record);
    }
    startNextTask() {
        return this.takeNextTask();
    }
    startTask(taskId) {
        const record = this.requirePendingTask(taskId);
        if (record.remainingDependencies !== 0 || record.heapKind !== 'DUE') {
            throw new TaskNotExecutableError(taskId, record.status);
        }
        this.dueHeap.removeAt(record.heapIndex);
        record.status = 'RUNNING';
        return this.snapshot(record);
    }
    completeTask(taskId) {
        const record = this.requireRunningTask(taskId);
        record.status = 'COMPLETED';
        for (const dependencyId of [...record.activeDependencyIds]) {
            const dependent = this.requireKnownRecord(dependencyId);
            if (dependent.status !== 'PENDING') {
                continue;
            }
            dependent.activeDependencyIds.delete(dependencyId);
            dependent.remainingDependencies -= 1;
            if (dependent.remainingDependencies === 0) {
                this.removeFromPartition(dependent);
                this.enqueue(dependent);
            }
        }
        record.activeDependencyIds.clear();
    }
    updateTask(taskId, update) {
        const record = this.requirePendingTask(taskId);
        if (update.priority === undefined &&
            update.executeAt === undefined &&
            update.dependencies === undefined) {
            return;
        }
        if (update.priority !== undefined) {
            this.validateFinite(update.priority, 'priority');
        }
        if (update.executeAt !== undefined) {
            this.validateFinite(update.executeAt, 'executeAt');
        }
        const oldDependencies = record.dependencies;
        const nextDependencies = update.dependencies === undefined
            ? undefined
            : new Set(update.dependencies);
        let needsTopologicalRebuild = false;
        const ownerEdgeOverrides = nextDependencies === undefined
            ? undefined
            : new Map([
                [taskId, nextDependencies],
            ]);
        if (nextDependencies !== undefined) {
            this.validateDependencyList(nextDependencies, taskId);
            for (const dependencyId of nextDependencies) {
                if (!oldDependencies.has(dependencyId) &&
                    this.requiresCycleCheck(taskId, dependencyId)) {
                    needsTopologicalRebuild = true;
                    if (this.hasDependencyCyclePath(dependencyId, taskId, ownerEdgeOverrides)) {
                        throw new TaskDependencyCycleError([
                            taskId,
                            dependencyId,
                        ]);
                    }
                }
            }
        }
        this.removeFromPartition(record);
        if (update.priority !== undefined) {
            record.input.priority = update.priority;
        }
        if (update.executeAt !== undefined) {
            record.input.executeAt = update.executeAt;
        }
        if (nextDependencies !== undefined) {
            this.replaceDependencies(record, nextDependencies);
            if (needsTopologicalRebuild) {
                this.rebuildTopologicalOrder();
            }
        }
        this.classify(record);
    }
    addDependency(taskId, dependencyId) {
        const record = this.requirePendingTask(taskId);
        const dependency = this.requireKnownTask(dependencyId);
        this.validateDependency(taskId, dependencyId);
        if (record.dependencies.has(dependencyId)) {
            return;
        }
        if (this.requiresCycleCheck(taskId, dependencyId)) {
            if (this.hasDependencyCyclePath(dependencyId, taskId)) {
                throw new TaskDependencyCycleError([
                    taskId,
                    dependencyId,
                ]);
            }
            this.removeFromPartition(record);
            record.dependencies.add(dependencyId);
            dependency.dependentIds.add(taskId);
            if (dependency.status !== 'COMPLETED') {
                record.activeDependencyIds.add(dependencyId);
                dependency.activeDependencyIds.add(taskId);
                record.remainingDependencies += 1;
            }
            this.rebuildTopologicalOrder();
            this.classify(record);
            return;
        }
        this.removeFromPartition(record);
        record.dependencies.add(dependencyId);
        dependency.dependentIds.add(taskId);
        if (dependency.status !== 'COMPLETED') {
            record.activeDependencyIds.add(dependencyId);
            dependency.activeDependencyIds.add(taskId);
            record.remainingDependencies += 1;
        }
        this.classify(record);
    }
    removeDependency(taskId, dependencyId) {
        const record = this.requirePendingTask(taskId);
        this.requireKnownTask(dependencyId);
        this.validateDependency(taskId, dependencyId);
        if (!record.dependencies.has(dependencyId)) {
            return;
        }
        this.removeFromPartition(record);
        record.dependencies.delete(dependencyId);
        const dependency = this.requireKnownTask(dependencyId);
        dependency.dependentIds.delete(taskId);
        if (record.activeDependencyIds.delete(dependencyId)) {
            dependency.activeDependencyIds.delete(taskId);
            record.remainingDependencies -= 1;
        }
        this.classify(record);
    }
    removeTask(taskId) {
        const record = this.requireKnownRecord(taskId);
        if (record.dependentIds.size > 0) {
            throw new TaskHasDependentsError(taskId);
        }
        this.removeFromPartition(record);
        for (const dependencyId of record.dependencies) {
            const dependency = this.requireKnownTask(dependencyId);
            dependency.dependentIds.delete(taskId);
            if (record.activeDependencyIds.delete(dependencyId)) {
                dependency.activeDependencyIds.delete(taskId);
                dependency.remainingDependencies -= 1;
            }
        }
        this.tasks.delete(taskId);
        this.orderPositions.delete(taskId);
    }
    replaceDependencies(record, newDependencyIds) {
        const oldDependencies = record.dependencies;
        const nextDependencies = new Set(newDependencyIds);
        record.dependencies = nextDependencies;
        for (const dependencyId of oldDependencies) {
            const dependency = this.requireKnownTask(dependencyId);
            dependency.dependentIds.delete(record.input.id);
            if (record.activeDependencyIds.delete(dependencyId)) {
                dependency.activeDependencyIds.delete(record.input.id);
                dependency.remainingDependencies -= 1;
            }
        }
        for (const dependencyId of nextDependencies) {
            const dependency = this.requireKnownTask(dependencyId);
            dependency.dependentIds.add(record.input.id);
            if (dependency.status !== 'COMPLETED') {
                record.activeDependencyIds.add(dependencyId);
                dependency.activeDependencyIds.add(record.input.id);
                record.remainingDependencies += 1;
            }
        }
    }
    requiresCycleCheck(taskId, dependencyId) {
        const taskPosition = this.orderPositions.get(taskId);
        const dependencyPosition = this.orderPositions.get(dependencyId);
        return dependencyPosition !== undefined
            && taskPosition !== undefined
            && dependencyPosition > taskPosition;
    }
    rebuildTopologicalOrder() {
        const indegrees = new Map();
        for (const record of this.tasks.values()) {
            indegrees.set(record.input.id, record.dependencies.size);
        }
        const pending = [];
        for (const [taskId, indegree] of indegrees) {
            if (indegree === 0) {
                pending.push(taskId);
            }
        }
        const nextOrder = [];
        for (let cursor = 0; cursor < pending.length; cursor += 1) {
            const taskId = pending[cursor];
            nextOrder.push(taskId);
            const task = this.requireKnownRecord(taskId);
            for (const dependentId of task.dependentIds) {
                const dependentDegree = indegrees.get(dependentId);
                if (dependentDegree === undefined) {
                    continue;
                }
                const nextDegree = dependentDegree - 1;
                if (nextDegree < 0) {
                    throw new TaskDependencyCycleError([taskId, dependentId]);
                }
                if (nextDegree === 0) {
                    pending.push(dependentId);
                }
                indegrees.set(dependentId, nextDegree);
            }
        }
        if (nextOrder.length !== this.tasks.size) {
            throw new TaskDependencyCycleError([pending[0] ?? 'unknown']);
        }
        this.taskOrder = nextOrder;
        this.orderPositions.clear();
        for (let index = 0; index < this.taskOrder.length; index += 1) {
            this.orderPositions.set(this.taskOrder[index], index);
        }
    }
    hasDependencyCyclePath(startId, targetId, edgeOverrides) {
        const visited = new Set([startId]);
        const pending = [startId];
        while (pending.length > 0) {
            const currentId = pending.pop();
            if (currentId === targetId) {
                return true;
            }
            const current = this.requireKnownRecord(currentId);
            const outgoing = edgeOverrides?.get(currentId) ?? current.dependencies;
            for (const dependencyId of outgoing) {
                if (!visited.has(dependencyId)) {
                    visited.add(dependencyId);
                    pending.push(dependencyId);
                }
            }
        }
        return false;
    }
    findDependencyCyclePath(startId, targetId, edgeOverrides) {
        const visited = new Set([startId]);
        const parent = new Map([
            [startId, undefined],
        ]);
        const pending = [startId];
        while (pending.length > 0) {
            const currentId = pending.pop();
            if (currentId === targetId) {
                const path = [];
                let cursor = currentId;
                while (cursor !== undefined && cursor !== startId) {
                    const next = parent.get(cursor);
                    if (next === undefined) {
                        return [startId, targetId];
                    }
                    path.push(cursor);
                    cursor = next;
                }
                path.push(startId);
                path.reverse();
                return path;
            }
            const current = this.requireKnownRecord(currentId);
            const outgoing = edgeOverrides?.get(currentId) ?? current.dependencies;
            for (const dependencyId of outgoing) {
                if (!visited.has(dependencyId)) {
                    visited.add(dependencyId);
                    parent.set(dependencyId, currentId);
                    pending.push(dependencyId);
                }
            }
        }
        return [startId, targetId];
    }
    enqueue(record) {
        const heap = record.input.executeAt <= this.clock
            ? this.dueHeap
            : this.futureHeap;
        record.heapKind = record.input.executeAt <= this.clock ? 'DUE' : 'FUTURE';
        record.heapIndex = heap.push(record);
    }
    classify(record) {
        if (record.remainingDependencies === 0) {
            this.enqueue(record);
        }
        else if (record.input.executeAt <= this.clock) {
            this.blocked.add(record);
        }
        else {
            this.futureHeap.push(record);
        }
    }
    removeFromPartition(record) {
        if (record.heapKind === 'DUE') {
            this.dueHeap.removeAt(record.heapIndex);
        }
        else if (record.heapKind === 'FUTURE') {
            this.futureHeap.removeAt(record.heapIndex);
        }
        record.heapKind = null;
        record.heapIndex = -1;
        this.blocked.delete(record);
    }
    requireKnownRecord(taskId) {
        const record = this.tasks.get(taskId);
        if (!record) {
            throw new TaskNotFoundError(taskId);
        }
        return record;
    }
    requireKnownTask(taskId) {
        return this.requireKnownRecord(taskId);
    }
    requirePendingTask(taskId) {
        const record = this.requireKnownRecord(taskId);
        if (record.status !== 'PENDING') {
            throw new TaskNotExecutableError(taskId, record.status);
        }
        return record;
    }
    requireRunningTask(taskId) {
        const record = this.requireKnownRecord(taskId);
        if (record.status !== 'RUNNING') {
            throw new TaskNotExecutableError(taskId, record.status);
        }
        return record;
    }
    validateInput(input) {
        if (typeof input.id !== 'string' || input.id.length === 0) {
            throw new TaskValidationError('Task id must be a non-empty string');
        }
        this.validateFinite(input.priority, 'priority');
        this.validateFinite(input.executeAt, 'executeAt');
    }
    validateDependencyList(dependencies, ownerId) {
        if (dependencies === undefined) {
            return;
        }
        const seen = new Set();
        for (const dependencyId of dependencies) {
            if (typeof dependencyId !== 'string' || dependencyId.length === 0) {
                throw new TaskValidationError('Dependency id must be a non-empty string');
            }
            if (dependencyId === ownerId) {
                throw new TaskValidationError('A task cannot depend on itself');
            }
            if (seen.has(dependencyId)) {
                throw new TaskValidationError('Dependency ids must be unique');
            }
            if (!this.tasks.has(dependencyId)) {
                throw new TaskNotFoundError(dependencyId);
            }
            seen.add(dependencyId);
        }
    }
    validateDependency(taskId, dependencyId) {
        if (typeof taskId !== 'string' || taskId.length === 0) {
            throw new TaskValidationError('Task id must be a non-empty string');
        }
        if (typeof dependencyId !== 'string' || dependencyId.length === 0) {
            throw new TaskValidationError('Dependency id must be a non-empty string');
        }
        if (taskId === dependencyId) {
            throw new TaskValidationError('A task cannot depend on itself');
        }
    }
    validateFinite(value, label) {
        if (!Number.isFinite(value)) {
            throw new TaskValidationError(`${label} must be a finite number`);
        }
    }
    snapshot(record) {
        const dependencies = Object.freeze([...record.dependencies]);
        return Object.freeze({
            id: record.input.id,
            priority: record.input.priority,
            executeAt: record.input.executeAt,
            status: record.status,
            dependencies,
            remainingDependencies: record.remainingDependencies,
            dependentCount: record.dependentIds.size,
        });
    }
}
export default InMemoryTaskScheduler;
