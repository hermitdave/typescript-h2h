/**
 * Test utilities for task scheduler
 */

/**
 * Wait for a specified time
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock task
 */
export function createMockTask(
    id: string,
    overrides: Partial<import('../src/types').Task> = {}
): import('../src/types').Task {
    return {
        id,
        priority: overrides.priority ?? 50,
        executeAt: overrides.executeAt ?? Date.now(),
        dependencies: overrides.dependencies ?? [],
        payload: overrides.payload,
        status: overrides.status ?? 'pending',
        createdAt: overrides.createdAt ?? Date.now(),
        updatedAt: overrides.updatedAt ?? Date.now(),
        startedAt: overrides.startedAt,
        completedAt: overrides.completedAt,
        error: overrides.error
    };
}

/**
 * Create a batch of tasks
 */
export function createTaskBatch(
    count: number,
    prefix: string = 'task',
    startId: number = 1
): Array<import('../src/types').Task> {
    return Array.from({ length: count }, (_, i) =>
        createMockTask(`${prefix}-${startId + i}`, {
            executeAt: Date.now() + i * 1000,
            priority: 50
        })
    );
}

/**
 * Generate a large number of tasks for stress testing
 */
export function generateLargeBatch(
    count: number
): Array<{ id: string; priority: number; dependencies: string[] }> {
    const tasks: Array<{ id: string; priority: number; dependencies: string[] }> = [];
    
    for (let i = 0; i < count; i++) {
        const deps: string[] = [];
        
        // Add some random dependencies (limit to prevent too many)
        if (i > 0) {
            const numDeps = Math.random() < 0.3 ? Math.floor(Math.random() * 3) + 1 : 0;
            for (let j = 0; j < numDeps; j++) {
                const depIdx = Math.floor(Math.random() * i);
                if (!deps.includes(`task-${depIdx}`)) {
                    deps.push(`task-${depIdx}`);
                }
            }
        }
        
        tasks.push({
            id: `task-${i}`,
            priority: Math.floor(Math.random() * 100),
            dependencies: deps
        });
    }
    
    return tasks;
}
