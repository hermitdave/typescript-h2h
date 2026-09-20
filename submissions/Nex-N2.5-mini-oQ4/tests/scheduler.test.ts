import { describe, expect, it } from 'vitest';

import {
  InMemoryTaskScheduler,
  TaskDependencyCycleError,
  TaskError,
  TaskHasDependentsError,
  TaskInput,
  TaskNotFoundError,
  TaskNotExecutableError,
  TaskSnapshot,
  TaskTimeError,
  TaskValidationError,
} from '../src/index';

const NOW = 100;

function add(
  scheduler: InMemoryTaskScheduler,
  input: TaskInput,
  dependencies: readonly string[] = [],
): void {
  scheduler.addTask(input, dependencies);
}

describe('InMemoryTaskScheduler', () => {
  it('orders ready tasks by priority, then execution time', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'low', priority: 10, executeAt: 10 });
    add(scheduler, { id: 'medium', priority: 5, executeAt: 10 });
    add(scheduler, { id: 'high', priority: 20, executeAt: 20 });
    add(scheduler, { id: 'urgent', priority: 30, executeAt: 0 });

    expect(scheduler.peekNextTask(NOW)?.id).toBe('urgent');
    expect(scheduler.takeNextTask()?.id).toBe('urgent');
    expect(scheduler.takeNextTask()?.id).toBe('high');
    expect(scheduler.takeNextTask()?.id).toBe('low');
    expect(scheduler.takeNextTask()?.id).toBe('medium');
  });

  it('uses lexical identifiers for deterministic equal-key ties', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'zeta', priority: 1, executeAt: 10 });
    add(scheduler, { id: 'alpha', priority: 1, executeAt: 10 });

    expect(scheduler.peekNextTask(NOW)?.id).toBe('alpha');
  });

  it('does not return a task before its execution time', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'ready', priority: 1, executeAt: NOW + 1 });

    expect(scheduler.peekNextTask(NOW)).toBeUndefined();
    expect(scheduler.peekNextTask(NOW + 1)?.id).toBe('ready');
  });

  it('promotes due future tasks when explicit time advances', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'future', priority: 1, executeAt: 1_000 });
    add(scheduler, { id: 'earlier', priority: 1, executeAt: 100 });

    expect(scheduler.peekNextTask(100)?.id).toBe('earlier');
    expect(scheduler.takeNextTask()?.id).toBe('earlier');
    expect(scheduler.peekNextTask(1_000)?.id).toBe('future');
  });

  it('rejects clock regression', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'task', priority: 1, executeAt: 10 });

    scheduler.peekNextTask(100);
    expect(() => scheduler.peekNextTask(99)).toThrow(TaskTimeError);
  });

  it('updates an executable task priority in place', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'first', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'second', priority: 2, executeAt: 0 });

    scheduler.updateTask('first', { priority: 5 });

    expect(scheduler.peekNextTask(NOW)?.id).toBe('first');
  });

  it('moves an executable task between the ready heaps', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'due', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'later', priority: 1, executeAt: NOW });

    scheduler.updateTask('due', { executeAt: 1_000 });

    expect(scheduler.peekNextTask(NOW)?.id).toBe('later');
    scheduler.takeNextTask();
    expect(scheduler.peekNextTask(1_000)?.id).toBe('due');
  });

  it('rejects invalid updates without changing task state', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'valid', priority: 1, executeAt: 10 });

    expect(() =>
      scheduler.updateTask('valid', { priority: Number.NaN }),
    ).toThrow(TaskValidationError);
    expect(() =>
      scheduler.updateTask('valid', { executeAt: Number.POSITIVE_INFINITY }),
    ).toThrow(TaskValidationError);
    expect(scheduler.getTask('valid')).toMatchObject({
      priority: 1,
      executeAt: 10,
    });
  });

  it('hides a task until every active dependency completes', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'dependency-a', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'dependency-b', priority: 1, executeAt: 0 });
    add(
      scheduler,
      { id: 'dependent', priority: 1, executeAt: 0 },
      ['dependency-a', 'dependency-b'],
    );

    expect(scheduler.peekNextTask(NOW)?.id).toBe('dependency-a');
    expect(scheduler.getTask('dependent')?.remainingDependencies).toBe(2);
  });

  it('ignores dependencies completed before their edge was created', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'completed', priority: 1, executeAt: 0 });
    scheduler.startTask('completed');
    scheduler.completeTask('completed');
    add(scheduler, { id: 'dependent', priority: 1, executeAt: 0 }, ['completed']);

    expect(scheduler.peekNextTask(NOW)?.id).toBe('dependent');
  });

  it('releases all dependants when a dependency completes', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 });
    add(
      scheduler,
      { id: 'first-dependent', priority: 1, executeAt: 0 },
      ['dependency'],
    );
    add(
      scheduler,
      { id: 'second-dependent', priority: 1, executeAt: 0 },
      ['dependency'],
    );

    scheduler.startTask('dependency');
    scheduler.completeTask('dependency');

    expect(scheduler.peekNextTask(NOW)?.id).toBe('first-dependent');
    expect(scheduler.takeNextTask()?.id).toBe('first-dependent');
    expect(scheduler.peekNextTask(NOW)?.id).toBe('second-dependent');
  });

  it('tracks dependency and dependant back references exactly', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'first', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'second', priority: 1, executeAt: 0 }, ['first']);
    add(scheduler, { id: 'third', priority: 1, executeAt: 0 }, ['second']);

    expect(scheduler.getTask('first')?.dependentCount).toBe(1);
    expect(scheduler.getTask('second')?.dependentCount).toBe(1);
    expect(scheduler.getTask('third')?.dependencies).toEqual(['second']);
  });

  it('adds one dependency dynamically and promotes the dependent', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'dependent', priority: 1, executeAt: 0 });

    scheduler.addDependency('dependent', 'dependency');
    scheduler.startTask('dependency');
    scheduler.completeTask('dependency');

    expect(scheduler.getTask('dependent')?.remainingDependencies).toBe(0);
    expect(scheduler.peekNextTask(NOW)?.id).toBe('dependent');
  });

  it('keeps a blocked future task outside the executable heap', () => {
    const scheduler = new InMemoryTaskScheduler({ now: 100 });
    add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 });
    add(
      scheduler,
      { id: 'dependent', priority: 1, executeAt: 1_000 },
      ['dependency'],
    );

    expect(scheduler.peekNextTask(1_000)?.id).toBe('dependency');
    expect(scheduler.takeNextTask()?.id).toBe('dependency');
    expect(scheduler.getTask('dependent')?.status).toBe('PENDING');
    expect(scheduler.getTask('dependent')?.remainingDependencies).toBe(1);
  });

  it('promotes a blocked task after its last active dependency completes', () => {
    const scheduler = new InMemoryTaskScheduler({ now: 100 });
    add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 });
    add(
      scheduler,
      { id: 'dependent', priority: 1, executeAt: 1_000 },
      ['dependency'],
    );

    scheduler.peekNextTask(1_000);
    scheduler.startTask('dependency');
    scheduler.completeTask('dependency');

    expect(scheduler.peekNextTask(1_000)?.id).toBe('dependent');
  });

  it('rejects a newly introduced cycle without changing the graph', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'first', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'second', priority: 1, executeAt: 0 }, ['first']);
    add(scheduler, { id: 'third', priority: 1, executeAt: 0 }, ['second']);

    expect(() => scheduler.addDependency('first', 'third')).toThrow(
      TaskDependencyCycleError,
    );
    expect(scheduler.getTask('third')?.dependencies).toEqual(['second']);
    expect(scheduler.peekNextTask(NOW)?.id).toBe('first');
  });

  it('detects deep cycles iteratively without stack overflow', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    for (let index = 0; index < 50_000; index += 1) {
      add(scheduler, { id: `task-${index}`, priority: 0, executeAt: 0 });
    }
    for (let index = 1; index < 50_000; index += 1) {
      scheduler.addDependency(`task-${index}`, `task-${index - 1}`);
    }

    expect(() => scheduler.addDependency('task-0', 'task-49999')).toThrow(
      TaskDependencyCycleError,
    );
    expect(scheduler.getTask('task-0')?.dependencies).toEqual([]);
  });

  it('rejects a cycle introduced by multiple replacement edges atomically', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'first', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'second', priority: 1, executeAt: 0 });

    scheduler.updateTask('first', { dependencies: ['second'] });

    expect(() =>
      scheduler.updateTask('second', { dependencies: ['first'] }),
    ).toThrow(TaskDependencyCycleError);
    expect(scheduler.getTask('first')?.dependencies).toEqual(['second']);
    expect(scheduler.getTask('second')?.dependencies).toEqual([]);
  });
  it('atomically replaces the whole dependency set', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'first', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'second', priority: 1, executeAt: 0 }, ['first']);
    add(scheduler, { id: 'third', priority: 1, executeAt: 0 }, ['first']);

    expect(() =>
      scheduler.updateTask('second', { dependencies: ['third'] }),
    ).not.toThrow();
    expect(scheduler.getTask('second')?.dependencies).toEqual(['third']);
    expect(() =>
      scheduler.updateTask('third', { dependencies: ['second'] }),
    ).toThrow(TaskDependencyCycleError);
    expect(scheduler.getTask('second')?.dependencies).toEqual(['third']);
    expect(scheduler.getTask('third')?.dependencies).toEqual(['first']);
  });

  it('removes a leaf task and updates predecessor metadata', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'leaf', priority: 1, executeAt: 0 });

    scheduler.removeTask('leaf');

    expect(scheduler.getTask('leaf')).toBeUndefined();
    const dependency = scheduler.getTask('dependency');
    expect(dependency).toBeDefined();
    expect(dependency!.dependentCount).toBe(0);
    expect(scheduler.taskCount).toBe(1);
    expect(scheduler.peekNextTask(NOW)?.id).toBe('dependency');
    expect(() => scheduler.addDependency('dependency', 'leaf')).toThrow(
      TaskNotFoundError,
    );
  });

  it('removes one dependency and releases a task at the last edge', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'dependency-a', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'dependency-b', priority: 1, executeAt: 0 });
    add(
      scheduler,
      { id: 'dependent', priority: 1, executeAt: 0 },
      ['dependency-a', 'dependency-b'],
    );

    scheduler.removeDependency('dependent', 'dependency-a');
    expect(scheduler.getTask('dependent')?.remainingDependencies).toBe(1);
    expect(scheduler.peekNextTask(NOW)?.id).toBe('dependency-a');
    expect(scheduler.takeNextTask()?.id).toBe('dependency-a');
    expect(scheduler.takeNextTask()?.id).toBe('dependency-b');

    scheduler.removeDependency('dependent', 'dependency-b');
    expect(scheduler.peekNextTask(NOW)?.id).toBe('dependent');
  });

  it('adds and removes an already completed dependency harmlessly', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 });
    scheduler.startTask('dependency');
    scheduler.completeTask('dependency');
    add(scheduler, { id: 'dependent', priority: 1, executeAt: 0 });

    scheduler.addDependency('dependent', 'dependency');
    scheduler.removeDependency('dependent', 'dependency');

    expect(scheduler.peekNextTask(NOW)?.id).toBe('dependent');
  });

  it('claims the next task and transitions it to running', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'ready', priority: 1, executeAt: 0 });

    expect(scheduler.takeNextTask()?.id).toBe('ready');
    expect(scheduler.getTask('ready')?.status).toBe('RUNNING');
  });

  it('rejects explicit starts for future, blocked, or running tasks', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'future', priority: 1, executeAt: NOW + 1 });
    add(
      scheduler,
      { id: 'dependency', priority: 1, executeAt: 0 },
    );
    add(
      scheduler,
      { id: 'dependent', priority: 1, executeAt: 0 },
      ['dependency'],
    );
    scheduler.startTask('dependency');

    expect(() => scheduler.startTask('future')).toThrow(
      TaskNotExecutableError,
    );
    expect(() => scheduler.startTask('dependent')).toThrow(
      TaskNotExecutableError,
    );
    expect(() => scheduler.startTask('dependency')).toThrow(
      TaskNotExecutableError,
    );
  });

  it('completes a task after it has been claimed', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'pending', priority: 1, executeAt: 0 });
    add(scheduler, { id: 'running', priority: 1, executeAt: 0 });

    expect(() => scheduler.completeTask('pending')).toThrow(
      TaskNotExecutableError,
    );
    scheduler.startTask('running');
    expect(() => scheduler.completeTask('running')).not.toThrow();
    expect(scheduler.getTask('running')?.status).toBe('COMPLETED');
  });

  it('rejects deleting a task that has dependants', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 });
    add(
      scheduler,
      { id: 'dependent', priority: 1, executeAt: 0 },
      ['dependency'],
    );

    expect(() => scheduler.removeTask('dependency')).toThrow(
      TaskHasDependentsError,
    );
  });

  it('returns undefined for a removed task and frozen snapshots', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });
    add(scheduler, { id: 'completed', priority: 1, executeAt: 0 });
    scheduler.startTask('completed');
    scheduler.completeTask('completed');

    const snapshot = scheduler.getTask('completed') as TaskSnapshot;
    scheduler.removeTask('completed');
    expect(scheduler.getTask('completed')).toBeUndefined();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.dependencies)).toBe(true);
  });

  it('rejects invalid tasks, duplicate ids, and duplicate dependencies', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });

    expect(() =>
      add(scheduler, { id: '', priority: 1, executeAt: 0 }),
    ).toThrow(TaskValidationError);
    expect(() => add(scheduler, { id: 'valid', priority: 1, executeAt: 0 }))
      .not.toThrow();
    expect(() =>
      add(scheduler, { id: 'valid', priority: 1, executeAt: 0 }),
    ).toThrow(TaskValidationError);
    expect(() =>
      add(scheduler, { id: 'dependency', priority: 1, executeAt: 0 }),
    ).not.toThrow();
    expect(() =>
      add(scheduler, { id: 'invalid-dependencies', priority: 1, executeAt: 0 }, [
        'dependency',
        'dependency',
      ]),
    ).toThrow(TaskValidationError);
  });

  it('stores one million independent tasks', () => {
    const scheduler = new InMemoryTaskScheduler({ now: NOW });

    for (let index = 0; index < 1_000_000; index += 1) {
      add(
        scheduler,
        { id: `task-${index}`, priority: 0, executeAt: NOW },
      );
    }

    expect(scheduler.taskCount).toBe(1_000_000);
    expect(scheduler.peekNextTask(NOW)?.id).toBe('task-0');
  });
});
