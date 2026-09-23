/**
 * Dependency Graph - Tracks task dependencies and enables cycle detection
 * Uses adjacency list representation with in-degree tracking
 */
export class DependencyGraph {
    // dependents[taskId] = set of tasks that depend on this task
    private dependents: Map<string, Set<string>> = new Map();
    
    // dependencies[taskId] = set of tasks this task depends on
    private dependencies: Map<string, Set<string>> = new Map();
    
    // inDegree[taskId] = number of unsatisfied dependencies
    private inDegree: Map<string, number> = new Map();
    
    // Reverse lookup: task -> tasks that depend on it
    private reverseDependencies: Map<string, Set<string>> = new Map();
    
    private taskCount: number = 0;

    /**
     * Add a task to the graph
     */
    addTask(taskId: string): void {
        if (!this.dependents.has(taskId)) {
            this.dependents.set(taskId, new Set());
            this.dependencies.set(taskId, new Set());
            this.inDegree.set(taskId, 0);
            this.reverseDependencies.set(taskId, new Set());
            this.taskCount++;
        }
    }

    /**
     * Add a dependency: task A depends on task B
     */
    addDependency(taskId: string, dependencyId: string): void {
        // Self-dependency is not allowed
        if (taskId === dependencyId) {
            throw new Error('Self-dependency is not allowed');
        }

        // Check if adding this dependency would create a cycle
        if (this.wouldCreateCycle(taskId, dependencyId)) {
            throw new Error('Cycle detected');
        }

        // Add task if not exists
        this.addTask(taskId);
        this.addTask(dependencyId);

        // Check if dependency already exists
        if (this.dependencies.get(taskId)?.has(dependencyId)) {
            return;
        }

        // Add the dependency
        this.dependencies.get(taskId)?.add(dependencyId);
        this.dependents.get(dependencyId)?.add(taskId);
        this.reverseDependencies.get(dependencyId)?.add(taskId);
        
        // Update in-degree
        this.inDegree.set(taskId, (this.inDegree.get(taskId) || 0) + 1);
    }

    /**
     * Remove a dependency
     */
    removeDependency(taskId: string, dependencyId: string): boolean {
        const deps = this.dependencies.get(taskId);
        const dependents = this.dependents.get(dependencyId);
        
        if (!deps || !dependents) return false;
        if (!deps.has(dependencyId) || !dependents.has(taskId)) return false;

        deps.delete(dependencyId);
        dependents.delete(taskId);
        this.reverseDependencies.get(dependencyId)?.delete(taskId);
        
        // Update in-degree
        const newDegree = Math.max(0, (this.inDegree.get(taskId) || 1) - 1);
        this.inDegree.set(taskId, newDegree);
        
        return true;
    }

    /**
     * Get all dependencies of a task
     */
    getDependencies(taskId: string): Set<string> {
        return this.dependencies.get(taskId) || new Set();
    }

    /**
     * Get all tasks that depend on this task
     */
    getDependents(taskId: string): Set<string> {
        return this.dependents.get(taskId) || new Set();
    }

    /**
     * Get in-degree (number of unsatisfied dependencies) for a task
     */
    getInDegree(taskId: string): number {
        return this.inDegree.get(taskId) || 0;
    }

    /**
     * Check if all dependencies are satisfied
     */
    isReady(taskId: string): boolean {
        return this.inDegree.get(taskId) === 0;
    }

    /**
     * Decrease in-degree when a dependency is satisfied
     */
    decreaseInDegree(taskId: string): number {
        const degree = this.inDegree.get(taskId) || 0;
        const newDegree = Math.max(0, degree - 1);
        this.inDegree.set(taskId, newDegree);
        return newDegree;
    }

    /**
     * Increase in-degree when a dependency is re-added
     */
    increaseInDegree(taskId: string): number {
        const degree = this.inDegree.get(taskId) || 0;
        const newDegree = degree + 1;
        this.inDegree.set(taskId, newDegree);
        return newDegree;
    }

    /**
     * Check if adding a dependency would create a cycle
     * Uses DFS to detect if there's already a path from dependencyId to taskId
     */
    wouldCreateCycle(taskId: string, dependencyId: string): boolean {
        // Can't add self-dependency
        if (taskId === dependencyId) {
            return true;
        }

        // Use BFS/DFS to check if there's already a path from dependencyId to taskId
        // If so, adding dependencyId -> taskId would create a cycle
        return this.hasPath(dependencyId, taskId);
    }

    /**
     * Check if there's a path from start to end using BFS
     * Follows the "depends on" direction
     */
    private hasPath(start: string, end: string, maxDepth: number = 1000): boolean {
        const visited = new Set<string>();
        const queue: string[] = [start];
        let depth = 0;

        while (queue.length > 0 && depth < maxDepth) {
            const current = queue.shift()!;
            
            if (current === end) {
                return true;
            }

            if (visited.has(current)) {
                continue;
            }

            visited.add(current);
            
            // Get tasks that current depends on
            const dependencies = this.dependencies.get(current);
            if (dependencies) {
                queue.push(...dependencies);
            }
            
            depth++;
        }

        return false;
    }

    /**
     * Detect all cycles in the graph using Kahn's algorithm
     * Returns array of task IDs involved in cycles, or null if no cycles
     */
    detectCycles(): string[] | null {
        // Create a copy of in-degrees
        const inDegree = new Map(this.inDegree);
        
        // Queue for tasks with in-degree 0
        const queue: string[] = [];
        for (const [taskId, degree] of inDegree) {
            if (degree === 0) {
                queue.push(taskId);
            }
        }

        const processed: string[] = [];
        
        while (queue.length > 0) {
            const current = queue.shift()!;
            processed.push(current);

            // For each task that depends on current
            const dependents = this.dependents.get(current);
            if (dependents) {
                for (const dependentId of dependents) {
                    const newDegree = (inDegree.get(dependentId) || 1) - 1;
                    inDegree.set(dependentId, newDegree);
                    
                    if (newDegree === 0) {
                        queue.push(dependentId);
                    }
                }
            }
        }

        // If we processed all tasks, no cycle exists
        if (processed.length === this.taskCount) {
            return null;
        }

        // Return tasks that weren't processed (part of cycles)
        const cycleTasks: string[] = [];
        for (const [taskId] of this.inDegree) {
            if (!processed.includes(taskId)) {
                cycleTasks.push(taskId);
            }
        }

        return cycleTasks;
    }

    /**
     * Get all tasks involved in any cycle
     */
    getCycleTasks(): string[] {
        return this.detectCycles() || [];
    }

    /**
     * Check if the graph has any cycles
     */
    hasCycles(): boolean {
        return this.detectCycles() !== null;
    }

    /**
     * Get the number of tasks in the graph
     */
    getTaskCount(): number {
        return this.taskCount;
    }

    /**
     * Get all task IDs
     */
    getAllTaskIds(): string[] {
        return Array.from(this.dependents.keys());
    }

    /**
     * Clear the graph
     */
    clear(): void {
        this.dependents.clear();
        this.dependencies.clear();
        this.inDegree.clear();
        this.reverseDependencies.clear();
        this.taskCount = 0;
    }

    /** Remove a task from the graph */
    removeTask(taskId: string): void {
        const dependents = this.dependents.get(taskId);
        if (dependents) {
            for (const depId of dependents) {
                this.removeDependency(depId, taskId);
            }
        }
        const dependencies = this.dependencies.get(taskId);
        if (dependencies) {
            for (const depId of dependencies) {
                this.dependents.get(depId)?.delete(taskId);
                this.reverseDependencies.get(depId)?.delete(taskId);
            }
        }
        const reverseDeps = this.reverseDependencies.get(taskId);
        if (reverseDeps) {
            for (const depId of reverseDeps) {
                this.dependencies.get(depId)?.delete(taskId);
                this.inDegree.delete(depId);
            }
        }
        this.dependents.delete(taskId);
        this.dependencies.delete(taskId);
        this.inDegree.delete(taskId);
        this.reverseDependencies.delete(taskId);
        this.taskCount--;
    }

    getReverseDependents(taskId: string): Set<string> {
        return this.reverseDependencies.get(taskId) || new Set();
    }

    hasTask(taskId: string): boolean {
        return this.dependents.has(taskId);
    }

    /** Get all dependencies for all tasks (for stats) */
    getAllDependencies(): Map<string, Set<string>> {
        return new Map(this.dependencies);
    }

    /** Get the total number of dependency edges */
    getTotalEdgeCount(): number {
        let count = 0;
        for (const deps of this.dependencies.values()) {
            count += deps.size;
        }
        return count;
    }

    /**
     * Get statistics
     */
    getStats(): {
        taskCount: number;
        edgeCount: number;
        tasksWithDependencies: number;
    } {
        let edgeCount = 0;
        let tasksWithDeps = 0;
        
        for (const [taskId, deps] of this.dependencies) {
            const count = deps.size;
            edgeCount += count;
            if (count > 0) {
                tasksWithDeps++;
            }
        }

        return {
            taskCount: this.taskCount,
            edgeCount,
            tasksWithDependencies: tasksWithDeps
        };
    }
}
