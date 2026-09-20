import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskScheduler } from '../src/scheduler';
import { Priority, TaskStatus } from '../src/types';

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Task Creation', () => {
    it('should create a basic task', () => {
      const task = scheduler.createTask({
        name: 'Test Task',
        priority: Priority.HIGH,
      });

      expect(task.id).toBeDefined();
      expect(task.name).toBe('Test Task');
      expect(task.priority).toBe(Priority.HIGH);
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.createdAt).toBeDefined();
    });

    it('should create task with dependencies', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({
        name: 'Task 2',
        dependencies: [task1.id],
      });

      expect(task2.dependencies.has(task1.id)).toBe(true);
      expect(task1.dependents.has(task2.id)).toBe(true);
    });

    it('should detect cycles on creation', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({ name: 'Task 2' });

      scheduler.updateTask(task1.id, { dependencies: [task2.id] });
      
      expect(() => {
        scheduler.updateTask(task2.id, { dependencies: [task1.id] });
      }).toThrow('Cycle detected');
    });

    it('should throw error for non-existent dependency', () => {
      expect(() => {
        scheduler.createTask({
          name: 'Task with bad dep',
          dependencies: ['non-existent'],
        });
      }).toThrow('Dependency task non-existent does not exist');
    });
  });

  describe('Task Execution', () => {
    it('should get next executable task', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const task1 = scheduler.createTask({
        name: 'Task 1',
        priority: Priority.HIGH,
        scheduledAt: now,
      });

      const nextTask = scheduler.getNextExecutableTask();
      expect(nextTask?.id).toBe(task1.id);
    });

    it('should respect priority ordering', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const task1 = scheduler.createTask({
        name: 'Low Priority',
        priority: Priority.LOW,
        scheduledAt: now,
      });

      const task2 = scheduler.createTask({
        name: 'High Priority',
        priority: Priority.HIGH,
        scheduledAt: now,
      });

      const task3 = scheduler.createTask({
        name: 'Medium Priority',
        priority: Priority.MEDIUM,
        scheduledAt: now,
      });

      const first = scheduler.getNextExecutableTask();
      expect(first?.id).toBe(task2.id);

      const second = scheduler.getNextExecutableTask();
      expect(second?.id).toBe(task3.id);

      const third = scheduler.getNextExecutableTask();
      expect(third?.id).toBe(task1.id);
    });

    it('should respect scheduled time', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const task1 = scheduler.createTask({
        name: 'Future Task',
        scheduledAt: now + 10000,
      });

      const task2 = scheduler.createTask({
        name: 'Now Task',
        scheduledAt: now,
      });

      const nextTask = scheduler.getNextExecutableTask();
      expect(nextTask?.id).toBe(task2.id);

      vi.advanceTimersByTime(10000);
      const futureTask = scheduler.getNextExecutableTask();
      expect(futureTask?.id).toBe(task1.id);
    });

    it('should not execute tasks with unmet dependencies', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({
        name: 'Task 2',
        dependencies: [task1.id],
      });

      const nextTask = scheduler.getNextExecutableTask();
      expect(nextTask?.id).toBe(task1.id);
      expect(nextTask?.id).not.toBe(task2.id);
    });
  });

  describe('Task State Transitions', () => {
    it('should start task', () => {
      const task = scheduler.createTask({ name: 'Test' });
      scheduler.getNextExecutableTask();

      const started = scheduler.startTask(task.id);
      expect(started.status).toBe(TaskStatus.RUNNING);
      expect(started.startedAt).toBeDefined();
    });

    it('should complete task', () => {
      const task = scheduler.createTask({ name: 'Test' });
      scheduler.startTask(task.id);

      const completed = scheduler.completeTask(task.id);
      expect(completed.status).toBe(TaskStatus.COMPLETED);
      expect(completed.completedAt).toBeDefined();
    });

    it('should fail task with retry', () => {
      const task = scheduler.createTask({
        name: 'Test',
        retries: 2,
      });

      scheduler.startTask(task.id);
      scheduler.failTask(task.id, 'Error');

      const updatedTask = scheduler.getTask(task.id);
      expect(updatedTask?.status).toBe(TaskStatus.PENDING);
      expect(updatedTask?.attempts).toBe(2);
    });

    it('should cancel task and dependents', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({
        name: 'Task 2',
        dependencies: [task1.id],
      });

      scheduler.cancelTask(task1.id);

      expect(scheduler.getTask(task1.id)?.status).toBe(TaskStatus.CANCELLED);
      expect(scheduler.getTask(task2.id)?.status).toBe(TaskStatus.CANCELLED);
    });
  });

  describe('Dependency Management', () => {
    it('should make task ready when dependencies complete', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({
        name: 'Task 2',
        dependencies: [task1.id],
      });

      scheduler.startTask(task1.id);
      scheduler.completeTask(task1.id);

      const nextTask = scheduler.getNextExecutableTask();
      expect(nextTask?.id).toBe(task2.id);
    });

    it('should handle complex dependency chains', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({
        name: 'Task 2',
        dependencies: [task1.id],
      });
      const task3 = scheduler.createTask({
        name: 'Task 3',
        dependencies: [task1.id, task2.id],
      });
      const task4 = scheduler.createTask({
        name: 'Task 4',
        dependencies: [task3.id],
      });

      // Execute in order
      let task = scheduler.getNextExecutableTask();
      expect(task?.id).toBe(task1.id);

      scheduler.startTask(task!.id);
      scheduler.completeTask(task!.id);

      task = scheduler.getNextExecutableTask();
      expect(task?.id).toBe(task2.id);

      scheduler.startTask(task!.id);
      scheduler.completeTask(task!.id);

      task = scheduler.getNextExecutableTask();
      expect(task?.id).toBe(task3.id);
    });
  });

  describe('Metrics', () => {
    it('should track metrics correctly', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({ name: 'Task 2' });

      let metrics = scheduler.getMetrics();
      expect(metrics.totalTasks).toBe(2);
      expect(metrics.pendingTasks).toBe(2);

      scheduler.getNextExecutableTask();
      scheduler.startTask(task1.id);
      
      metrics = scheduler.getMetrics();
      expect(metrics.readyTasks).toBe(1);
      expect(metrics.runningTasks).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle task with no name', () => {
      const task = scheduler.createTask({});
      expect(task.name).toMatch(/^task-/);
    });

    it('should handle updating completed task', () => {
      const task = scheduler.createTask({ name: 'Test' });
      scheduler.startTask(task.id);
      scheduler.completeTask(task.id);

      expect(() => {
        scheduler.updateTask(task.id, { name: 'Updated' });
      }).toThrow('Cannot update completed');
    });

    it('should handle deleting task with dependents', () => {
      const task1 = scheduler.createTask({ name: 'Task 1' });
      const task2 = scheduler.createTask({
        name: 'Task 2',
        dependencies: [task1.id],
      });

      scheduler.deleteTask(task1.id);
      const updatedTask2 = scheduler.getTask(task2.id);
      expect(updatedTask2?.dependencies.size).toBe(0);
    });

    it('should handle bulk creation', () => {
      const tasks = scheduler.bulkCreate([
        { name: 'Task 1' },
        { name: 'Task 2' },
        { name: 'Task 3' },
      ]);

      expect(tasks.length).toBe(3);
      expect(scheduler.getMetrics().totalTasks).toBe(3);
    });
  });

  describe('Scalability', () => {
    it('should handle 10,000 tasks efficiently', () => {
      const start = Date.now();
      const tasks = scheduler.bulkCreate(
        Array.from({ length: 10000 }, (_, i) => ({
          name: `Task ${i}`,
          priority: i % 5 === 0 ? Priority.HIGH : Priority.MEDIUM,
        }))
      );
      const duration = Date.now() - start;

      expect(tasks.length).toBe(10000);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should cleanup old completed tasks', () => {
      const task = scheduler.createTask({ name: 'Old Task' });
      scheduler.startTask(task.id);
      
      vi.advanceTimersByTime(10000);
      scheduler.completeTask(task.id);

      const removed = scheduler.cleanupCompletedTasks(5000);
      expect(removed).toBe(1);
      expect(scheduler.getTask(task.id)).toBeUndefined();
    });
  });
});
