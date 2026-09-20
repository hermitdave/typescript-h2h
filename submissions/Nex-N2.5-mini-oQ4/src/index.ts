export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED';

export interface TaskInput {
  id: string;
  priority: number;
  executeAt: number;
}

export interface TaskSnapshot {
  readonly id: string;
  readonly priority: number;
  readonly executeAt: number;
  readonly status: TaskStatus;
  readonly dependencies: readonly string[];
  readonly remainingDependencies: number;
  readonly dependentCount: number;
}

export type TaskUpdate = {
  readonly priority?: number;
  readonly executeAt?: number;
  readonly dependencies?: readonly string[];
};

export interface SchedulerOptions {
  /** Optional simulated start time; defaults to Date.now(). */
  readonly now?: number;
}

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskError';
  }
}

export class TaskValidationError extends TaskError {
  constructor(message: string) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

export class TaskNotFoundError extends TaskError {
  constructor(id: string) {
    super(`Task "${id}" was not found`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskNotExecutableError extends TaskError {
  constructor(id: string, status: TaskStatus) {
    super(`Task "${id}" cannot be changed because it is ${status.toLowerCase()}`);
    this.name = 'TaskNotExecutableError';
  }
}

export class TaskHasDependentsError extends TaskError {
  constructor(id: string) {
    super(`Task "${id}" cannot be removed because it has dependants`);
    this.name = 'TaskHasDependentsError';
  }
}

export class TaskDependencyCycleError extends TaskError {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`Adding this dependency would create a cycle: ${path.join(' -> ')}`);
    this.name = 'TaskDependencyCycleError';
    this.path = [...path];
  }
}

export class TaskTimeError extends TaskError {
  constructor(message: string) {
    super(message);
    this.name = 'TaskTimeError';
  }
}

type HeapKind = 'DUE' | 'FUTURE' | null;

interface HeapEntry<T> {
  value: T;
  index: number;
}

class BinaryHeap<T> {
  private readonly entries: HeapEntry<T>[] = [];

  constructor(private readonly less: (left: T, right: T) => boolean) {}

  get size(): number {
    return this.entries.length;
  }

  peek(): T | undefined {
    return this.entries[0]?.value;
  }

  push(value: T): number {
    const entry: HeapEntry<T> = { value, index: this.entries.length };
    this.entries.push(entry);
    this.siftUp(this.entries.length - 1);
    return this.entries.length - 1;
  }

  removeAt(index: number): T | undefined {
    const current = this.entries[index];
    if (!current) {
      return undefined;
    }

    if (this.entries.length === 1) {
      this.entries.pop();
      return current.value;
    }

    const last = this.entries.pop()!;
    last.index = index;
    this.entries[index] = last;
    if (index > 0 && this.less(last.value, this.entries[index - 1]!.value)) {
      this.siftUp(index);
    } else {
      this.siftDown(index);
    }
    return current.value;
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!this.less(this.entries[index]!.value, this.entries[parent]!.value)) {
        break;
      }
      this.swap(index, parent);
      index = parent;
    }
  }

  private siftDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        left < this.entries.length &&
        this.less(this.entries[left]!.value, this.entries[smallest]!.value)
      ) {
        smallest = left;
      }
      if (
        right < this.entries.length &&
        this.less(this.entries[right]!.value, this.entries[smallest]!.value)
      ) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(left: number, right: number): void {
    const leftEntry = this.entries[left]!;
    const rightEntry = this.entries[right]!;
    leftEntry.index = right;
    rightEntry.index = left;
    const leftValue = leftEntry.value;
    leftEntry.value = rightEntry.value;
    rightEntry.value = leftValue;
  }
}

interface TaskRecord {
  input: TaskInput;
  status: TaskStatus;
  dependencies: Set<string>;
  dependentIds: Set<string>;
  activeDependencyIds: Set<string>;
  remainingDependencies: number;
  heapKind: HeapKind;
  heapIndex: number;
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lessDue(left: TaskRecord, right: TaskRecord): boolean {
  if (left.input.priority !== right.input.priority) {
    return left.input.priority > right.input.priority;
  }
  if (left.input.executeAt !== right.input.executeAt) {
    return left.input.executeAt < right.input.executeAt;
  }
  return compareString(left.input.id, right.input.id) < 0;
}

function lessFuture(left: TaskRecord, right: TaskRecord): boolean {
  if (left.input.executeAt !== right.input.executeAt) {
    return left.input.executeAt < right.input.executeAt;
  }
  return lessDue(left, right);
}

export class InMemoryTaskScheduler {
  private readonly dueHeap = new BinaryHeap<TaskRecord>(lessDue);
  private readonly futureHeap = new BinaryHeap<TaskRecord>(lessFuture);
  private readonly blocked = new Set<TaskRecord>();
  private readonly tasks = new Map<string, TaskRecord>();
  private taskOrder: string[] = [];
  private orderPositions: Map<string, number> = new Map();
  private clock: number;

  constructor(options: SchedulerOptions = {}) {
    this.clock = options.now ?? Date.now();
    if (!Number.isFinite(this.clock)) {
      throw new TaskValidationError('Scheduler time must be a finite number');
    }
  }

  get taskCount(): number {
    return this.tasks.size;
  }

  addTask(input: TaskInput, dependencies: readonly string[] = []): void {
    this.validateInput(input);
    this.validateDependencyList(dependencies, input.id);
    if (this.tasks.has(input.id)) {
      throw new TaskValidationError(`Task "${input.id}" already exists`);
    }

    const record: TaskRecord = {
      input: { ...input },
      status: 'PENDING',
      dependencies: new Set(dependencies),
      dependentIds: new Set<string>(),
      activeDependencyIds: new Set<string>(),
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

  getTask(taskId: string): TaskSnapshot | undefined {
    const record = this.tasks.get(taskId);
    return record ? this.snapshot(record) : undefined;
  }

  peekNextTask(now: number = this.currentTime()): TaskSnapshot | undefined {
    this.advanceTime(now);
    const record = this.dueHeap.peek();
    return record ? this.snapshot(record) : undefined;
  }

  private advanceTime(now: number): void {
    this.validateFinite(now, 'execution time');
    if (now < this.clock) {
      throw new TaskTimeError('Scheduler time cannot move backwards');
    }
    if (now === this.clock) {
      return;
    }

    this.clock = now;
    while (this.futureHeap.peek() !== undefined) {
      const candidate = this.futureHeap.peek()!;
      if (candidate.input.executeAt > now) {
        break;
      }

      const record = this.futureHeap.removeAt(0)!;
      record.heapKind = null;
      record.heapIndex = -1;
      this.classify(record);
    }
  }

  currentTime(): number {
    return this.clock;
  }

  takeNextTask(): TaskSnapshot | undefined {
    const now = this.currentTime();
    this.advanceTime(now);
    const record = this.dueHeap.peek();
    if (!record) {
      return undefined;
    }

    this.dueHeap.removeAt(0)!;
    record.status = 'RUNNING';
    return this.snapshot(record);
  }

  startNextTask(): TaskSnapshot | undefined {
    return this.takeNextTask();
  }

  startTask(taskId: string): TaskSnapshot {
    const record = this.requirePendingTask(taskId);
    if (record.remainingDependencies !== 0 || record.heapKind !== 'DUE') {
      throw new TaskNotExecutableError(taskId, record.status);
    }

    this.dueHeap.removeAt(record.heapIndex)!;
    record.status = 'RUNNING';
    return this.snapshot(record);
  }

  completeTask(taskId: string): void {
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

  updateTask(taskId: string, update: TaskUpdate): void {
    const record = this.requirePendingTask(taskId);
    if (
      update.priority === undefined &&
      update.executeAt === undefined &&
      update.dependencies === undefined
    ) {
      return;
    }

    if (update.priority !== undefined) {
      this.validateFinite(update.priority, 'priority');
    }
    if (update.executeAt !== undefined) {
      this.validateFinite(update.executeAt, 'executeAt');
    }

    const oldDependencies = record.dependencies;
    const nextDependencies: Set<string> | undefined = update.dependencies === undefined
      ? undefined
      : new Set<string>(update.dependencies);

    let needsTopologicalRebuild = false;
    const ownerEdgeOverrides = nextDependencies === undefined
      ? undefined
      : new Map<string, ReadonlySet<string>>([
        [taskId, nextDependencies],
      ]);
    if (nextDependencies !== undefined) {
      this.validateDependencyList(nextDependencies, taskId);
      for (const dependencyId of nextDependencies) {
        if (
          !oldDependencies.has(dependencyId) &&
          this.requiresCycleCheck(taskId, dependencyId)
        ) {
          needsTopologicalRebuild = true;
          if (this.hasDependencyCyclePath(
            dependencyId,
            taskId,
            ownerEdgeOverrides,
          )) {
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

  addDependency(taskId: string, dependencyId: string): void {
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

  removeDependency(taskId: string, dependencyId: string): void {
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

  removeTask(taskId: string): void {
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

  private replaceDependencies(
    record: TaskRecord,
    newDependencyIds: ReadonlySet<string>,
  ): void {
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

  private requiresCycleCheck(taskId: string, dependencyId: string): boolean {
    const taskPosition = this.orderPositions.get(taskId);
    const dependencyPosition = this.orderPositions.get(dependencyId);
    return dependencyPosition !== undefined
      && taskPosition !== undefined
      && dependencyPosition > taskPosition;
  }

  private rebuildTopologicalOrder(): void {
    const indegrees = new Map<string, number>();
    for (const record of this.tasks.values()) {
      indegrees.set(record.input.id, record.dependencies.size);
    }

    const pending: string[] = [];
    for (const [taskId, indegree] of indegrees) {
      if (indegree === 0) {
        pending.push(taskId);
      }
    }

    const nextOrder: string[] = [];
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const taskId = pending[cursor]!;
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
      this.orderPositions.set(this.taskOrder[index]!, index);
    }
  }

  private hasDependencyCyclePath(
    startId: string,
    targetId: string,
    edgeOverrides?: ReadonlyMap<string, ReadonlySet<string>>,
  ): boolean {
    const visited = new Set<string>([startId]);
    const pending = [startId];
    while (pending.length > 0) {
      const currentId = pending.pop()!;
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

  private findDependencyCyclePath(
    startId: string,
    targetId: string,
    edgeOverrides?: ReadonlyMap<string, ReadonlySet<string>>,
  ): string[] {
    const visited = new Set<string>([startId]);
    const parent = new Map<string, string | undefined>([
      [startId, undefined],
    ]);
    const pending = [startId];

    while (pending.length > 0) {
      const currentId = pending.pop()!;
      if (currentId === targetId) {
        const path: string[] = [];
        let cursor: string | undefined = currentId;
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

  private enqueue(record: TaskRecord): void {
    const heap = record.input.executeAt <= this.clock
      ? this.dueHeap
      : this.futureHeap;
    record.heapKind = record.input.executeAt <= this.clock ? 'DUE' : 'FUTURE';
    record.heapIndex = heap.push(record);
  }

  private classify(record: TaskRecord): void {
    if (record.remainingDependencies === 0) {
      this.enqueue(record);
    } else if (record.input.executeAt <= this.clock) {
      this.blocked.add(record);
    } else {
      this.futureHeap.push(record);
    }
  }

  private removeFromPartition(record: TaskRecord): void {
    if (record.heapKind === 'DUE') {
      this.dueHeap.removeAt(record.heapIndex)!;
    } else if (record.heapKind === 'FUTURE') {
      this.futureHeap.removeAt(record.heapIndex)!;
    }
    record.heapKind = null;
    record.heapIndex = -1;
    this.blocked.delete(record);
  }

  private requireKnownRecord(taskId: string): TaskRecord {
    const record = this.tasks.get(taskId);
    if (!record) {
      throw new TaskNotFoundError(taskId);
    }
    return record;
  }

  private requireKnownTask(taskId: string): TaskRecord {
    return this.requireKnownRecord(taskId);
  }

  private requirePendingTask(taskId: string): TaskRecord {
    const record = this.requireKnownRecord(taskId);
    if (record.status !== 'PENDING') {
      throw new TaskNotExecutableError(taskId, record.status);
    }
    return record;
  }

  private requireRunningTask(taskId: string): TaskRecord {
    const record = this.requireKnownRecord(taskId);
    if (record.status !== 'RUNNING') {
      throw new TaskNotExecutableError(taskId, record.status);
    }
    return record;
  }

  private validateInput(input: TaskInput): void {
    if (typeof input.id !== 'string' || input.id.length === 0) {
      throw new TaskValidationError('Task id must be a non-empty string');
    }
    this.validateFinite(input.priority, 'priority');
    this.validateFinite(input.executeAt, 'executeAt');
  }

  private validateDependencyList(
    dependencies: ReadonlySet<string> | readonly string[] | undefined,
    ownerId: string,
  ): void {
    if (dependencies === undefined) {
      return;
    }

    const seen = new Set<string>();
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

  private validateDependency(taskId: string, dependencyId: string): void {
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

  private validateFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) {
      throw new TaskValidationError(`${label} must be a finite number`);
    }
  }

  private snapshot(record: TaskRecord): TaskSnapshot {
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
