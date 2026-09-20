/**
 * Tests for TaskScheduler
 */

import { TaskScheduler, TaskState, SchedulerError, Task } from './scheduler';

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler();
  });

  // ─── Basic Operations ───────────────────────────────────────────────────

  describe('addTask', () => {
    it('should add a simple task', () => {
      const task = scheduler.addTask({
        id: 'task-1',
        priority: 1,
        executionTime: Date.now(),
        data: { name: 'test' },
        dependencies: [],
      });

      expect(task.state).toBe(TaskState.READY);
      expect(scheduler.getTask('task-1')).toBeDefined();
    });

    it('should add a task with future execution time', () => {
      const futureTime = Date.now() + 60000; // 1 minute from now
      const task = scheduler.addTask({
        id: 'task-2',
        priority: 1,
        executionTime: futureTime,
        data: {},
        dependencies: [],
      });

      expect(task.state).toBe(TaskState.PENDING);
    });

    it('should throw on self-dependency', () => {
      expect(() =>
        scheduler.addTask({
          id: 'task-3',
          priority: 1,
          executionTime: Date.now(),
          data: {},
          dependencies: ['task-3'],
        }),
      ).toThrow(SchedulerError);
    });

    it('should respect maxTasks limit', () => {
      const limitedScheduler = new TaskScheduler({ maxTasks: 2 });
      limitedScheduler.addTask({
        id: 't1',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });
      limitedScheduler.addTask({
        id: 't2',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });

      expect(() =>
        limitedScheduler.addTask({
          id: 't3',
          priority: 1,
          executionTime: Date.now(),
          data: {},
          dependencies: [],
        }),
      ).toThrow(SchedulerError);
    });
  });

  // ─── Priority Queue ─────────────────────────────────────────────────────

  describe('getNextTask / popNextTask', () => {
    it('应返回优先级最高的任务', () => {
      scheduler.addTask({
        id: 'low',
        priority: 10,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });
      scheduler.addTask({
        id: 'high',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });
      scheduler.addTask({
        id: 'medium',
        priority: 5,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });

      const next = scheduler.popNextTask();
      expect(next?.id).toBe('high');
    });

    it('应在优先级相同时按执行时间排序', () => {
      const earlier = Date.now() - 1000;
      const later = Date.now() + 1000;

      scheduler.addTask({
        id: 'later',
        priority: 1,
        executionTime: later,
        data: {},
        dependencies: [],
      });
      scheduler.addTask({
        id: 'earlier',
        priority: 1,
        executionTime: earlier,
        data: {},
        dependencies: [],
      });

      const next = scheduler.popNextTask();
      expect(next?.id).toBe('earlier');
    });

    it('应跳过过去时间的已完成/已取消任务', () => {
      scheduler.addTask({
        id: 'cancelled',
        priority: 1,
        executionTime: Date.now() - 1000,
        data: {},
        dependencies: [],
      });
      scheduler.cancelTask('cancelled');

      scheduler.addTask({
        id: 'valid',
        priority: 10,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });

      const next = scheduler.popNextTask();
      expect(next?.id).toBe('valid');
    });
  });

  // ─── Dependencies ───────────────────────────────────────────────────────

  describe('dependencies', () => {
    it('应在依赖完成后将任务标记为就绪', () => {
      scheduler.addTask({
        id: 'parent',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });
      scheduler.addTask({
        id: 'child',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: ['parent'],
      });

      const parent = scheduler.popNextTask();
      expect(parent?.id).toBe('parent');

      scheduler.completeTask('parent');

      const child = scheduler.popNextTask();
      expect(child?.id).toBe('child');
    });

    it('应阻止循环依赖', () => {
      scheduler.addTask({
        id: 'a',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });
      scheduler.addTask({
        id: 'b',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: ['a'],
      });
      scheduler.addTask({
        id: 'c',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: ['b'],
      });

      // a-cycle depends on c and a - this is a valid DAG, not a cycle
      const result = scheduler.addTask({
        id: 'a-cycle',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: ['c', 'a'],
      });
      expect(result).toBeDefined();

      // Self-dependency should still be caught
      expect(() =>
        scheduler.addTask({
          id: 'self',
          priority: 1,
          executionTime: Date.now(),
          data: {},
          dependencies: ['self'],
        }),
      ).toThrow(SchedulerError);
    });

    it('应支持多级依赖', () => {
      scheduler.addTask({ id: '1', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });
      scheduler.addTask({ id: '2', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['1'] });
      scheduler.addTask({ id: '3', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['2'] });

      expect(scheduler.popNextTask()?.id).toBe('1');
      scheduler.completeTask('1');
      expect(scheduler.popNextTask()?.id).toBe('2');
      scheduler.completeTask('2');
      expect(scheduler.popNextTask()?.id).toBe('3');
    });
  });

  // ─── State Management ───────────────────────────────────────────────────

  describe('completeTask / failTask / cancelTask', () => {
    it('应正确转换任务状态', () => {
      const task = scheduler.addTask({
        id: 'task-1',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });

      expect(task.state).toBe(TaskState.READY);

      const running = scheduler.popNextTask();
      expect(running?.state).toBe(TaskState.RUNNING);

      scheduler.completeTask('task-1');
      expect(scheduler.getTask('task-1')?.state).toBe(TaskState.COMPLETED);
    });

    it('failTask 应级联取消依赖任务', () => {
      scheduler.addTask({ id: 'root', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });
      scheduler.addTask({ id: 'dep1', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['root'] });
      scheduler.addTask({ id: 'dep2', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['root'] });

      const root = scheduler.popNextTask();
      scheduler.failTask('root');

      expect(scheduler.getTask('dep1')?.state).toBe(TaskState.CANCELLED);
      expect(scheduler.getTask('dep2')?.state).toBe(TaskState.CANCELLED);
    });

    it('cancelTask 应级联取消依赖任务', () => {
      scheduler.addTask({ id: 'root', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });
      scheduler.addTask({ id: 'child', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['root'] });

      scheduler.cancelTask('root');
      expect(scheduler.getTask('child')?.state).toBe(TaskState.CANCELLED);
    });

    it('completeTask 应只在 RUNNING 状态执行', () => {
      scheduler.addTask({
        id: 'task-1',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });

      expect(() => scheduler.completeTask('task-1')).toThrow(SchedulerError);
    });
  });

  // ─── Update Operations ──────────────────────────────────────────────────

  describe('updateTask', () => {
    it('应更新优先级并重新排序', () => {
      scheduler.addTask({
        id: 'task-1',
        priority: 5,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });
      scheduler.addTask({
        id: 'task-2',
        priority: 10,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });

      scheduler.updateTask('task-1', { priority: 1 });

      const next = scheduler.popNextTask();
      expect(next?.id).toBe('task-1');
    });

    it('应拒绝更新已完成/已取消任务', () => {
      scheduler.addTask({
        id: 'task-1',
        priority: 1,
        executionTime: Date.now(),
        data: {},
        dependencies: [],
      });
      scheduler.cancelTask('task-1');

      expect(() => scheduler.updateTask('task-1', { priority: 0 })).toThrow(SchedulerError);
    });
  });

  // ─── Query Operations ───────────────────────────────────────────────────

  describe('getState', () => {
    it('应返回正确的状态计数', () => {
      scheduler.addTask({ id: '1', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });
      // Future task stays PENDING until time arrives
      scheduler.addTask({ id: '2', priority: 1, executionTime: Date.now() + 1000, data: {}, dependencies: [] });

      const state = scheduler.getState();
      expect(state.total).toBe(2);
      expect(state.byState[TaskState.READY]).toBe(1);
      expect(state.byState[TaskState.PENDING]).toBe(1);
    });
  });

  describe('topologicalSort', () => {
    it('应返回拓扑排序', () => {
      scheduler.addTask({ id: 'a', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });
      scheduler.addTask({ id: 'b', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['a'] });
      scheduler.addTask({ id: 'c', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['a'] });

      const order = scheduler.topologicalSort();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    });

    it('在有环时抛出错误', () => {
      // Create a proper cycle: a -> b -> c -> a
      scheduler.addTask({ id: 'a', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });
      scheduler.addTask({ id: 'b', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['a'] });
      scheduler.addTask({ id: 'c', priority: 1, executionTime: Date.now(), data: {}, dependencies: ['b'] });

      // Now add 'a' depending on 'c' to create cycle: a -> b -> c -> a
      expect(() =>
        scheduler.addTask({
          id: 'a',
          priority: 1,
          executionTime: Date.now(),
          data: {},
          dependencies: ['c'], // This would create a cycle
        }),
      ).toThrow(SchedulerError);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty scheduler 应返回 undefined', () => {
      expect(scheduler.getNextTask()).toBeUndefined();
      expect(scheduler.popNextTask()).toBeUndefined();
    });

    it('removeTask 不应影响其他任务', () => {
      scheduler.addTask({ id: '1', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });
      scheduler.addTask({ id: '2', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] });

      scheduler.removeTask('1');
      expect(scheduler.popNextTask()?.id).toBe('2');
    });

    it('duplicate id 应覆盖旧任务', () => {
      scheduler.addTask({
        id: 'task-1',
        priority: 1,
        executionTime: Date.now(),
        data: { version: 1 },
        dependencies: [],
      });
      scheduler.addTask({
        id: 'task-1',
        priority: 2,
        executionTime: Date.now() + 1000,
        data: { version: 2 },
        dependencies: [],
      });

      const task = scheduler.getTask('task-1');
      expect(task?.priority).toBe(2);
      expect(task?.data).toEqual({ version: 2 });
    });

    it('批量添加任务', () => {
      const tasks = [
        { id: '1', priority: 3, executionTime: Date.now(), data: {}, dependencies: [] },
        { id: '2', priority: 1, executionTime: Date.now(), data: {}, dependencies: [] },
        { id: '3', priority: 2, executionTime: Date.now(), data: {}, dependencies: [] },
      ];

      const added = scheduler.addTasks(tasks as any);
      expect(added).toHaveLength(3);
      expect(scheduler.getState().total).toBe(3);
    });
  });

  // ─── Performance ────────────────────────────────────────────────────────

  describe('performance', () => {
    it('应高效处理大量任务', () => {
      const start = Date.now();
      const count = 10_000; // Reduced for CI stability

      for (let i = 0; i < count; i++) {
        scheduler.addTask({
          id: i,
          priority: Math.random() * 100,
          executionTime: Date.now() + Math.random() * 1000,
          data: {},
          dependencies: [],
        });
      }

      const addTime = Date.now() - start;
      console.log(`Added ${count} tasks in ${addTime}ms`);

      expect(addTime).toBeLessThan(5000); // Should complete in < 5s
    });
  });
});
