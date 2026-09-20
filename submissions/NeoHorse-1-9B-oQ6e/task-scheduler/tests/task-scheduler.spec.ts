import { describe, it, expect, beforeEach } from 'vitest';
import { TaskScheduler, Task, TaskStatus, createScheduler } from '../index';

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = createScheduler();
  });

  it('adds a task and executes it in priority order', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'low',
      name: 'Low priority',
      priority: 10,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'high',
      name: 'High priority',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });

    const task1 = scheduler.executeNext();
    expect(task1?.id).toBe('high');
    expect(task1?.status).toBe(TaskStatus.COMPLETED);

    const task2 = scheduler.executeNext();
    expect(task2?.id).toBe('low');
    expect(task2?.status).toBe(TaskStatus.COMPLETED);
  });

  it('executes tasks in timestamp order when priorities are equal', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'later',
      name: 'Later',
      priority: 50,
      scheduledTime: now + 1000,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'sooner',
      name: 'Sooner',
      priority: 50,
      scheduledTime: now + 500,
      dependencies: [],
    });

    const task = scheduler.executeNext();
    expect(task?.id).toBe('sooner');
  });

  it('skips stale heap entries during execution', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'cancelled',
      name: 'Cancelled',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'valid',
      name: 'Valid',
      priority: 50,
      scheduledTime: now,
      dependencies: [],
    });

    scheduler.cancelTask('cancelled');

    const task = scheduler.executeNext();
    expect(task?.id).toBe('valid');
  });

  it('waits for dependencies to complete before executing', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'parent',
      name: 'Parent',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'child',
      name: 'Child',
      priority: 100,
      scheduledTime: now,
      dependencies: ['parent'],
    });

    const executed: string[] = [];

    scheduler.onTaskComplete((result) => {
      executed.push(result.taskId);
    });

    const t1 = scheduler.executeNext();
    expect(t1?.id).toBe('parent');

    const t2 = scheduler.executeNext();
    expect(t2?.id).toBe('child');

    expect(executed).toEqual(['parent', 'child']);
  });

  it('handles multiple dependencies', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'a',
      name: 'A',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'b',
      name: 'B',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'c',
      name: 'C',
      priority: 100,
      scheduledTime: now,
      dependencies: ['a', 'b'],
    });

    const executed: string[] = [];

    scheduler.onTaskComplete((result) => {
      executed.push(result.taskId);
    });

    const t1 = scheduler.executeNext();
    expect(t1?.id).toBe('a');

    const t2 = scheduler.executeNext();
    expect(t2?.id).toBe('b');

    const t3 = scheduler.executeNext();
    expect(t3?.id).toBe('c');

    expect(executed).toEqual(['a', 'b', 'c']);
  });

  it('detects cycles in dependency graph', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'a',
      name: 'A',
      priority: 100,
      scheduledTime: now,
      dependencies: ['c'],
    });
    scheduler.addTask({
      id: 'b',
      name: 'B',
      priority: 100,
      scheduledTime: now,
      dependencies: ['a'],
    });
    scheduler.addTask({
      id: 'c',
      name: 'C',
      priority: 100,
      scheduledTime: now,
      dependencies: ['b'],
    });

    const cycles = scheduler.detectCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('detects self-referencing cycle', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'self',
      name: 'Self',
      priority: 100,
      scheduledTime: now,
      dependencies: ['self'],
    });

    const cycles = scheduler.detectCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual(['self']);
  });

  it('does not detect cycles in DAG', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'a',
      name: 'A',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'b',
      name: 'B',
      priority: 100,
      scheduledTime: now,
      dependencies: ['a'],
    });
    scheduler.addTask({
      id: 'c',
      name: 'C',
      priority: 100,
      scheduledTime: now,
      dependencies: ['b'],
    });

    const cycles = scheduler.detectCycles();
    expect(cycles).toHaveLength(0);
  });

  it('updates task priority dynamically', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'low',
      name: 'Low',
      priority: 10,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'medium',
      name: 'Medium',
      priority: 50,
      scheduledTime: now,
      dependencies: [],
    });

    const t1 = scheduler.executeNext();
    expect(t1?.id).toBe('medium');

    scheduler.updateTask({ id: 'low', priority: 100 });

    const t2 = scheduler.executeNext();
    expect(t2?.id).toBe('low');
  });

  it('removes a task and updates dependents', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'parent',
      name: 'Parent',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'child',
      name: 'Child',
      priority: 100,
      scheduledTime: now,
      dependencies: ['parent'],
    });

    const t1 = scheduler.executeNext();
    expect(t1?.id).toBe('parent');

    const readyCount = scheduler.getReadyCount();
    expect(readyCount).toBe(1);

    const t2 = scheduler.executeNext();
    expect(t2?.id).toBe('child');
  });

  it('cancels a task and its dependents', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'parent',
      name: 'Parent',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'child',
      name: 'Child',
      priority: 100,
      scheduledTime: now,
      dependencies: ['parent'],
    });

    scheduler.cancelTask('parent');

    const statistics = scheduler.getStatistics();
    expect(statistics.cancelled).toBe(2);
    expect(statistics.pending).toBe(0);
  });

  it('handles task with no dependencies', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'independent',
      name: 'Independent',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });

    const task = scheduler.executeNext();
    expect(task?.id).toBe('independent');
  });

  it('handles task scheduled in the future', () => {
    const now = Date.now();
    const future = now + 10000;

    scheduler.addTask({
      id: 'future',
      name: 'Future',
      priority: 100,
      scheduledTime: future,
      dependencies: [],
    });

    const task = scheduler.executeNext();
    expect(task).toBe(null);
  });

  it('returns null when no tasks are ready', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'future',
      name: 'Future',
      priority: 100,
      scheduledTime: now + 10000,
      dependencies: [],
    });

    const task = scheduler.executeNext();
    expect(task).toBe(null);
  });

  it('handles 1000 tasks efficiently', () => {
    const now = Date.now();

    for (let i = 0; i < 1000; i++) {
      scheduler.addTask({
        id: 'task-' + i,
        name: 'Task ' + i,
        priority: (i % 100) + 1,
        scheduledTime: now + (i % 10) * 100,
        dependencies: [],
      });
    }

    let executed = 0;
    while (scheduler.getReadyCount() > 0 && executed < 100) {
      scheduler.executeNext();
      executed++;
    }

    expect(executed).toBe(100);
  });

  it('statistics are accurate', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'pending',
      name: 'Pending',
      priority: 100,
      scheduledTime: now + 10000,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'ready',
      name: 'Ready',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });

    const stats = scheduler.getStatistics();
    expect(stats.pending).toBe(1);
    expect(stats.ready).toBe(1);
    expect(stats.total).toBe(2);
  });

  it('getNextTask returns the highest priority ready task', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'low',
      name: 'Low',
      priority: 10,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'high',
      name: 'High',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'medium',
      name: 'Medium',
      priority: 50,
      scheduledTime: now,
      dependencies: [],
    });

    const task = scheduler.getNextTask();
    expect(task?.id).toBe('high');
  });

  it('handles update on pending task', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'task',
      name: 'Task',
      priority: 10,
      scheduledTime: now,
      dependencies: [],
    });

    const updated = scheduler.updateTask({ id: 'task', priority: 100 });
    expect(updated?.priority).toBe(100);

    const task = scheduler.executeNext();
    expect(task?.id).toBe('task');
  });

  it('removeTask returns false for completed task', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'task',
      name: 'Task',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });

    scheduler.executeNext();

    const removed = scheduler.removeTask('task');
    expect(removed).toBe(false);
  });

  it('handles task with failed dependency', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'failing',
      name: 'Failing',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });
    scheduler.addTask({
      id: 'dependent',
      name: 'Dependent',
      priority: 100,
      scheduledTime: now,
      dependencies: ['failing'],
    });

    const t1 = scheduler.executeNext();
    expect(t1?.id).toBe('failing');

    const t2 = scheduler.executeNext();
    expect(t2?.id).toBe('dependent');
  });

  it('reset clears all state', () => {
    const now = Date.now();

    scheduler.addTask({
      id: 'task',
      name: 'Task',
      priority: 100,
      scheduledTime: now,
      dependencies: [],
    });

    scheduler.executeNext();

    scheduler.reset();

    const stats = scheduler.getStatistics();
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.completed).toBe(0);
  });
});

describe('TaskScheduler - Large Scale', () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = createScheduler();
  });

  it('handles 10000 tasks efficiently', () => {
    const now = Date.now();

    for (let i = 0; i < 10000; i++) {
      scheduler.addTask({
        id: 'node-' + i,
        name: 'Node ' + i,
        priority: 50,
        scheduledTime: now + i,
        dependencies: [],
      });
    }

    const stats = scheduler.getStatistics();
    expect(stats.total).toBe(10000);
    expect(stats.pending).toBe(10000);

    let executed = 0;
    while (scheduler.getReadyCount() > 0 && executed < 100) {
      scheduler.executeNext();
      executed++;
    }

    expect(executed).toBe(100);
  });

  it('handles task with many dependencies', () => {
    const now = Date.now();

    for (let i = 0; i < 100; i++) {
      scheduler.addTask({
        id: 'leaf-' + i,
        name: 'Leaf ' + i,
        priority: 50,
        scheduledTime: now,
        dependencies: [],
      });
    }

    scheduler.addTask({
      id: 'root',
      name: 'Root',
      priority: 100,
      scheduledTime: now,
      dependencies: Array.from({ length: 100 }, (_, i) => 'leaf-' + i),
    });

    const stats = scheduler.getStatistics();
    expect(stats.total).toBe(101);

    let executed = 0;
    while (scheduler.getReadyCount() > 0 && executed < 100) {
      scheduler.executeNext();
      executed++;
    }

    expect(executed).toBe(100);

    expect(scheduler.getReadyCount()).toBe(1);

    const root = scheduler.executeNext();
    expect(root?.id).toBe('root');
  });
});
