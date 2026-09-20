import { TaskScheduler } from './scheduler';
import { Task, Priority, TaskStatus } from './types';

function exampleUsage(): void {
  const scheduler = new TaskScheduler();

  // Create tasks with priorities and dependencies
  const task1 = scheduler.createTask({
    name: 'Process payment',
    priority: Priority.HIGH,
    scheduledAt: Date.now() + 1000,
  });

  const task2 = scheduler.createTask({
    name: 'Send confirmation',
    priority: Priority.MEDIUM,
    scheduledAt: Date.now() + 2000,
    dependencies: [task1.id],
  });

  const task3 = scheduler.createTask({
    name: 'Update inventory',
    priority: Priority.LOW,
    scheduledAt: Date.now() + 1500,
  });

  console.log('Created tasks:', task1.id, task2.id, task3.id);

  // Get next executable task
  const nextTask = scheduler.getNextExecutableTask();
  console.log('Next executable task:', nextTask?.name);

  // Complete task
  if (nextTask) {
    scheduler.completeTask(nextTask.id);
  }

  // Get next executable task after completion
  const nextTask2 = scheduler.getNextExecutableTask();
  console.log('Next executable task after completion:', nextTask2?.name);
}

if (require.main === module) {
  exampleUsage();
}

export { TaskScheduler, Task, Priority, TaskStatus };
