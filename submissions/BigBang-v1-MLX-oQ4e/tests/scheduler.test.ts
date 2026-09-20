import { TaskScheduler } from '../src/scheduler';

describe('TaskScheduler: basic add & dequeue', () => {
  test('single task is executable immediately', () => {
    const s = new TaskScheduler(100);
    s.addTask({ priority: 5, scheduledAt: 50 });
    const task = s.dequeueNextExecutable();
    expect(task).not.toBeNull();
    expect(task!.status).toBe('running');
    expect(s.dequeueNextExecutable()).toBeNull();
  });

  test('priority ordering: higher priority dequeued first', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'low', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'high', priority: 10, scheduledAt: 50 });
    s.addTask({ id: 'mid', priority: 5, scheduledAt: 50 });
    const order: string[] = [];
    let task: ReturnType<typeof s.dequeueNextExecutable>;
    while ((task = s.dequeueNextExecutable()) !== null) order.push(task.id);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  test('scheduled time: future tasks are deferred', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 10, scheduledAt: 200 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50 });
    expect(s.dequeueNextExecutable()).not.toBeNull();
    expect(s.dequeueNextExecutable()).toBeNull();
    s.setTime(200);
    const t = s.dequeueNextExecutable();
    expect(t).not.toBeNull();
    expect(t!.id).toBe('a');
    expect(s.dequeueNextExecutable()).toBeNull();
  });

  test('peek does not remove the task', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'x', priority: 1, scheduledAt: 50 });
    const p = s.peekNextExecutable();
    expect(p).not.toBeNull();
    expect(p!.id).toBe('x');
    const d = s.dequeueNextExecutable();
    expect(d).not.toBeNull();
    expect(d!.id).toBe('x');
    expect(s.dequeueNextExecutable()).toBeNull();
  });
});

describe('TaskScheduler: dependencies', () => {
  test('dependent becomes ready when dep completes', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'dep', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'child', priority: 1, scheduledAt: 50, deps: ['dep'] });
    expect(s.getExecutableTasks()).toHaveLength(1);
    s.completeTask('dep');
    const t = s.dequeueNextExecutable();
    expect(t).not.toBeNull();
    expect(t!.id).toBe('child');
  });

  test('order preserved: child cannot run before parent', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'dep', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'child', priority: 100, scheduledAt: 50, deps: ['dep'] });
    const t1 = s.dequeueNextExecutable();
    expect(t1).not.toBeNull();
    expect(t1!.id).toBe('dep');
    s.completeTask('dep');
    const t2 = s.dequeueNextExecutable();
    expect(t2).not.toBeNull();
    expect(t2!.id).toBe('child');
  });

  test('chain of dependencies', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.addTask({ id: 'c', priority: 1, scheduledAt: 50, deps: ['b'] });
    s.completeTask('a');
    expect(s.dequeueNextExecutable()!.id).toBe('b');
    s.completeTask('b');
    expect(s.dequeueNextExecutable()!.id).toBe('c');
  });

  test('multiple dependencies: all must complete', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'c', priority: 1, scheduledAt: 50, deps: ['a', 'b'] });
    s.completeTask('a');
    expect(s.getExecutableTasks()).toHaveLength(1);
    s.completeTask('b');
    expect(s.dequeueNextExecutable()!.id).toBe('c');
  });
});

describe('TaskScheduler: cycle detection', () => {
  test('self-dependency rejected', () => {
    const s = new TaskScheduler(100);
    expect(() => s.addTask({ id: 'a', priority: 1, scheduledAt: 50, deps: ['a'] }))
      .toThrow('cannot depend on itself');
  });

  test('direct cycle rejected', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50, deps: ['b'] });
    expect(() => s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] }))
      .toThrow('Cycle');
  });

  test('transitive cycle rejected', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50, deps: ['c'] });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    expect(() => s.addTask({ id: 'c', priority: 1, scheduledAt: 50, deps: ['b'] }))
      .toThrow('Cycle');
  });

  test('update creating cycle rejected', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    expect(() => s.updateTask('a', { deps: ['b'] })).toThrow('Cycle');
  });

  test('forward reference: adding dep task that creates cycle rejected', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50, deps: ['b'] });
    expect(s.getTaskCount()).toBe(1);
    expect(() => s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] }))
      .toThrow('Cycle');
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50 });
    expect(s.getTaskCount()).toBe(2);
  });

  test('forward reference resolved when dep task added and completed', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50, deps: ['b'] });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50 });
    s.completeTask('b');
    const t = s.dequeueNextExecutable();
    expect(t).not.toBeNull();
    expect(t!.id).toBe('a');
  });
});

describe('TaskScheduler: dynamic updates', () => {
  test('priority update: higher priority surfaces', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 2, scheduledAt: 50 });
    s.updateTask('a', { priority: 10 });
    const t = s.dequeueNextExecutable();
    expect(t).not.toBeNull();
    expect(t!.id).toBe('a');
  });

  test('scheduledAt update: defer to future', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 10, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50 });
    s.updateTask('a', { scheduledAt: 200 });
    expect(s.dequeueNextExecutable()!.id).toBe('b');
    s.setTime(200);
    expect(s.dequeueNextExecutable()!.id).toBe('a');
  });

  test('deps update: add dependency makes task pending', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: [] });
    s.addTask({ id: 'c', priority: 2, scheduledAt: 50 });
    s.addDependency('c', 'b');
    expect(s.getTask('c')!.status).toBe('pending');
    expect(s.getExecutableTasks()).toHaveLength(1);
    s.completeTask('b');
    expect(s.dequeueNextExecutable()!.id).toBe('c');
  });

  test('deps update: remove dependency makes task ready', () => {
    const s = new TaskScheduler(100);
    const dep = s.addTask({ id: 'dep', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'child', priority: 1, scheduledAt: 50, deps: [dep] });
    s.updateTask('child', { deps: [] });
    expect(s.getTask('child')!.status).toBe('pending');
    expect(s.getExecutableTasks()).toContainEqual(expect.objectContaining({ id: 'child' }));
  });

  test('dynamic update does not break heap ordering', () => {
    const s = new TaskScheduler(100);
    for (let i = 0; i < 10; i++) s.addTask({ id: `t${i}`, priority: i, scheduledAt: 50 });
    s.updateTask('t0', { priority: 100 });
    const order: string[] = [];
    let task: ReturnType<typeof s.dequeueNextExecutable>;
    while ((task = s.dequeueNextExecutable()) !== null) order.push(task.id);
    expect(order[0]).toBe('t0');
  });
});

describe('TaskScheduler: complete / fail / cancel / blocked', () => {
  test('complete task and propagate', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.completeTask('a');
    expect(s.getTask('a')!.status).toBe('completed');
    expect(s.getTask('b')!.status).toBe('pending');
  });

  test('fail task blocks dependents', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.failTask('a', 'boom');
    expect(s.getTask('a')!.status).toBe('failed');
    expect(s.getTask('b')!.status).toBe('blocked');
    expect(s.getTask('b')!.error).toBe('boom');
    expect(s.getBlockedTasks()).toHaveLength(1);
    expect(s.getExecutableTasks()).toHaveLength(0);
  });

  test('cancel task blocks dependents', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.cancelTask('a');
    expect(s.getTask('a')!.status).toBe('cancelled');
    expect(s.getTask('b')!.status).toBe('blocked');
  });

  test('resetTask re-queues a blocked/running/completed task', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.failTask('a');
    expect(s.getTask('b')!.status).toBe('blocked');
    s.resetTask('b');
    expect(s.getTask('b')!.status).toBe('pending');
    s.completeTask('a');
    expect(s.dequeueNextExecutable()!.id).toBe('b');
  });

  test('duplicate completeTask on same dep is idempotent', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.completeTask('a');
    s.completeTask('a');
    expect(s.getExecutableTasks()).toHaveLength(1);
    expect(s.getTask('b')!.status).toBe('pending');
  });
});

describe('TaskScheduler: event listeners', () => {
  test('status change listener fires', () => {
    const s = new TaskScheduler(100);
    const logs: [string, string, string][] = [];
    s.subscribeStatusChange((id, old, news) => logs.push([id, old, news]));
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.dequeueNextExecutable();
    expect(logs).toContainEqual(['a', 'pending', 'running']);
  });

  test('listener crash does not break scheduler', () => {
    const s = new TaskScheduler(100);
    s.subscribeStatusChange(() => { throw new Error('boom'); });
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    expect(s.getTaskCount()).toBe(1);
  });
});

describe('TaskScheduler: edge cases', () => {
  test('empty scheduler returns null', () => {
    const s = new TaskScheduler(100);
    expect(s.dequeueNextExecutable()).toBeNull();
    expect(s.peekNextExecutable()).toBeNull();
    expect(s.getExecutableTasks()).toEqual([]);
  });

  test('all tasks terminal returns null', () => {
    const s = new TaskScheduler(100);
    const a = s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.completeTask(a);
    expect(s.dequeueNextExecutable()).toBeNull();
  });

  test('deferred tasks move to ready when time passes', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 200 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50 });
    s.setTime(250);
    const order: string[] = [];
    let task: ReturnType<typeof s.dequeueNextExecutable>;
    while ((task = s.dequeueNextExecutable()) !== null) order.push(task.id);
    expect(order).toEqual(['b', 'a']);
  });

  test('addTask with non-existent dep id is allowed (forward reference)', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50, deps: ['nonexistent'] });
    expect(s.getTask('a')!.status).toBe('pending');
    expect(s.getTask('a')!.depStatus.get('nonexistent')).toBe('pending');
  });

  test('cancel task propagates to dependents', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.cancelTask('a');
    expect(s.getTask('a')!.status).toBe('cancelled');
    expect(s.getTask('b')!.status).toBe('blocked');
    expect(s.getTask('b')!.error).toBeUndefined();
  });

  test('dep completed event is idempotent across multiple dependents', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.addTask({ id: 'c', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.completeTask('a');
    expect(s.getExecutableTasks()).toHaveLength(2);
    s.dequeueNextExecutable();
    s.dequeueNextExecutable();
    expect(s.getExecutableTasks()).toHaveLength(0);
  });

  test('update dependency set to empty clears deps and readies task', () => {
    const s = new TaskScheduler(100);
    const a = s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: [a] });
    s.updateTask('b', { deps: [] });
    expect(s.getTask('b')!.status).toBe('pending');
    expect(s.getTask('b')!.deps).toEqual([]);
    expect(s.getTask('b')!.depsSet.size).toBe(0);
    expect(s.getExecutableTasks()).toContainEqual(expect.objectContaining({ id: 'b' }));
  });

  test('resetTask clears blocked state and re-evaluates', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.addTask({ id: 'b', priority: 1, scheduledAt: 50, deps: ['a'] });
    s.failTask('a');
    expect(s.getTask('b')!.status).toBe('blocked');
    s.resetTask('b');
    expect(s.getTask('b')!.status).toBe('pending');
    expect(s.getTask('b')!.error).toBeUndefined();
    expect(s.getTask('b')!.depStatus.get('a')).toBe('pending');
  });

  test('task id collision throws', () => {
    const s = new TaskScheduler(100);
    s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    expect(() => s.addTask({ id: 'a', priority: 1, scheduledAt: 50 })).toThrow('already exists');
  });

  test('updateTask on terminal task only allows payload change', () => {
    const s = new TaskScheduler(100);
    const a = s.addTask({ id: 'a', priority: 1, scheduledAt: 50 });
    s.completeTask(a);
    s.updateTask(a, { payload: 'x' });
    expect(s.getTask(a)!.payload).toBe('x');
    expect(() => s.updateTask(a, { deps: [] })).toThrow();
  });
});
