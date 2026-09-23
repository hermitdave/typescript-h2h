import { TaskScheduler, TaskPriority, TaskStatus } from './index';

async function example() {
    const scheduler = new TaskScheduler();

    // Add some tasks
    const task1 = scheduler.addTask({
        id: 'task-1',
        priority: TaskPriority.HIGH,
        executeAt: Date.now() + 1000,
        dependencies: [],
        payload: { type: 'email' }
    });

    const task2 = scheduler.addTask({
        id: 'task-2',
        priority: TaskPriority.MEDIUM,
        executeAt: Date.now() + 2000,
        dependencies: ['task-1'],
        payload: { type: 'notification' }
    });

    const task3 = scheduler.addTask({
        id: 'task-3',
        priority: TaskPriority.LOW,
        executeAt: Date.now() + 3000,
        dependencies: ['task-1', 'task-2'],
        payload: { type: 'report' }
    });

    console.log('Tasks added:', scheduler.size);
    console.log('Ready tasks:', scheduler.readyCount);
    console.log('Stats:', scheduler.getStats());

    // Get next executable task
    const nextTask = scheduler.getNextExecutable();
    console.log('Next task:', nextTask?.id);

    // Complete task-1
    scheduler.completeTask('task-1', { success: true });
    console.log('After completing task-1, ready tasks:', scheduler.readyCount);

    // Try to add a task that would create a cycle
    try {
        scheduler.addTask({
            id: 'task-4',
            dependencies: ['task-5']
        });
        scheduler.addTask({
            id: 'task-5',
            dependencies: ['task-4']  // Creates cycle!
        });
    } catch (e) {
        console.log('Cycle detected:', (e as Error).message);
    }

    // Check for cycles
    const { valid, cycleTasks } = scheduler.validateGraph();
    console.log('Graph valid:', valid);
    if (!valid) {
        console.log('Cycle tasks:', cycleTasks);
    }
}

example().catch(console.error);
