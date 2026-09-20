export declare class DependencyGraph {
    /** Reverse fan-out: dep -> tasks that depend on it (direct only). */
    private readonly dependentsByTask;
    /** Task -> its set of hard dependencies. */
    private readonly dependenciesByTask;
    /** Task ids currently registered. */
    private readonly registeredTasks;
    /** Register `taskId` in the graph (no edges). Idempotent. */
    registerTask(taskId: string): void;
    /** Deregister `taskId`, cleaning up reverse edges. */
    removeTask(taskId: string): void;
    /**
     * Add edge `dep -> taskId` (taskId depends on dep).
     * @throws DependencyResolutionError if it introduces a cycle, references a
     *   self / unknown / unregistered task. No edges are added on failure.
     */
    addDependency(taskId: string, dep: string): void;
    /** Remove edge `dep -> taskId` if present. */
    removeDependency(taskId: string, dep: string): void;
    /**
     * Replace `taskId`'s full dependency set atomically (structurally). Performs
     * the targeted cycle check against the graph state *after* old edges are gone,
     * so only genuinely-new cycles are rejected.
     * @throws DependencyResolutionError if the resulting graph is cyclic.
     */
    replaceDependencies(taskId: string, deps: readonly string[]): void;
    /**
     * Would adding `dep -> taskId` create a cycle?
     *
     * Adding `dep -> taskId` forms a cycle iff there already exists a path
     * `taskId -> ... -> dep` (taskId transitively depends on dep). We search the
     * dependents-subgraph from `taskId`; reaching `dep` means yes.
     *
     * @returns the chain `[taskId, ..., dep]`, or null. Worst-case O(V + E);
     *   usually O(1) since it bails the moment `dep` is found.
     */
    wouldCreateCycle(taskId: string, dep: string): string[] | null;
    /**
     * Global acyclicity check via Kahn. Returns the set of task ids that remain
     * after emitting all zero-in-degree nodes (i.e. exactly the tasks stuck in
     * cycles). Empty iff acyclic.
     */
    findCyclicTasks(): string[];
    /** Tasks that (transitively) depend on `taskId`. Immutable snapshot. */
    dependentsOf(taskId: string): string[];
    /** Direct hard dependencies of `taskId`. Immutable snapshot. */
    dependenciesOf(taskId: string): string[];
    /** Has `taskId` registered a dependency on `dep`? */
    hasDependency(taskId: string, dep: string): boolean;
    /** Remove every edge and task: reset the graph to empty. O(V + E). */
    clear(): void;
    private require;
    private requireExisting;
    /** `taskId` depends on `dep`: add both edges. */
    private wire;
    /** Detach `taskId` from `dep` in both directions. */
    private unwire;
}
