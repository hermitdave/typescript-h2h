/**
 * Dependency Graph - Tracks task dependencies and enables cycle detection
 * Uses adjacency list representation with in-degree tracking
 */
export declare class DependencyGraph {
    private dependents;
    private dependencies;
    private inDegree;
    private reverseDependencies;
    private taskCount;
    /**
     * Add a task to the graph
     */
    addTask(taskId: string): void;
    /**
     * Add a dependency: task A depends on task B
     */
    addDependency(taskId: string, dependencyId: string): void;
    /**
     * Remove a dependency
     */
    removeDependency(taskId: string, dependencyId: string): boolean;
    /**
     * Get all dependencies of a task
     */
    getDependencies(taskId: string): Set<string>;
    /**
     * Get all tasks that depend on this task
     */
    getDependents(taskId: string): Set<string>;
    /**
     * Get in-degree (number of unsatisfied dependencies) for a task
     */
    getInDegree(taskId: string): number;
    /**
     * Check if all dependencies are satisfied
     */
    isReady(taskId: string): boolean;
    /**
     * Decrease in-degree when a dependency is satisfied
     */
    decreaseInDegree(taskId: string): number;
    /**
     * Increase in-degree when a dependency is re-added
     */
    increaseInDegree(taskId: string): number;
    /**
     * Check if adding a dependency would create a cycle
     * Uses DFS to detect if there's already a path from dependencyId to taskId
     */
    wouldCreateCycle(taskId: string, dependencyId: string): boolean;
    /**
     * Check if there's a path from start to end using BFS
     * Follows the "depends on" direction
     */
    private hasPath;
    /**
     * Detect all cycles in the graph using Kahn's algorithm
     * Returns array of task IDs involved in cycles, or null if no cycles
     */
    detectCycles(): string[] | null;
    /**
     * Get all tasks involved in any cycle
     */
    getCycleTasks(): string[];
    /**
     * Check if the graph has any cycles
     */
    hasCycles(): boolean;
    /**
     * Get the number of tasks in the graph
     */
    getTaskCount(): number;
    /**
     * Get all task IDs
     */
    getAllTaskIds(): string[];
    /**
     * Clear the graph
     */
    clear(): void;
    /** Remove a task from the graph */
    removeTask(taskId: string): void;
    getReverseDependents(taskId: string): Set<string>;
    hasTask(taskId: string): boolean;
    /** Get all dependencies for all tasks (for stats) */
    getAllDependencies(): Map<string, Set<string>>;
    /** Get the total number of dependency edges */
    getTotalEdgeCount(): number;
    /**
     * Get statistics
     */
    getStats(): {
        taskCount: number;
        edgeCount: number;
        tasksWithDependencies: number;
    };
}
