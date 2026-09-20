/**
 * Dependency graph.
 *
 * A directed graph modelling "executes-before" edges between tasks. An edge
 * `dep -> task` means "dep must complete before task". We store it with two
 * reverse-linked maps, each O(1):
 *
 *   dependenciesByTask: task -> Set<dep>      (task's hard prerequisites)
 *   dependentsByTask:   dep -> Set<task>      (reverse fan-out)
 *   registeredTasks:    Set<task>
 *
 * Integrty: this module owns NOTHING about ordering or execution. It is purely
 * about structure and acyclicity, which makes it trivial to unit-test in
 * isolation (no timers, no async). The scheduler consults it for two things:
 *   1. Fast reverse fan-out when a dep reaches a terminal state.
 *   2. Cycle detection on every structural change, before accepting it.
 *
 * CYCLE DETECTION
 * ---------------
 * We use the well-understood Kahn topological-sort invariant: a directed graph
 * has a cycle iff not every node reaches in-degree 0 after repeatedly emitting
 * zero-in-degree nodes. Cost: O(V + E) over the whole graph.
 *
 * We additionally expose a TARGETED check — `wouldCreateCycle` — that answers a
 * single proposed edge in the same bound (and usually far better). On-demand
 * dependency updates use the targeted check so they don't pay the full-sort tax;
 * bulk registration validates once after inserting all edges.
 */
import { DependencyResolutionError, InvalidConfigurationError } from './errors';
export class DependencyGraph {
    constructor() {
        /** Reverse fan-out: dep -> tasks that depend on it (direct only). */
        this.dependentsByTask = new Map();
        /** Task -> its set of hard dependencies. */
        this.dependenciesByTask = new Map();
        /** Task ids currently registered. */
        this.registeredTasks = new Set();
    }
    /** Register `taskId` in the graph (no edges). Idempotent. */
    registerTask(taskId) {
        this.registeredTasks.add(taskId);
        this.dependenciesByTask.set(taskId, new Set());
        if (!this.dependentsByTask.has(taskId))
            this.dependentsByTask.set(taskId, new Set());
    }
    /** Deregister `taskId`, cleaning up reverse edges. */
    removeTask(taskId) {
        for (const dep of this.dependenciesByTask.get(taskId) ?? []) {
            this.unwire(taskId, dep);
        }
        this.dependenciesByTask.delete(taskId);
        this.registeredTasks.delete(taskId);
    }
    /**
     * Add edge `dep -> taskId` (taskId depends on dep).
     * @throws DependencyResolutionError if it introduces a cycle, references a
     *   self / unknown / unregistered task. No edges are added on failure.
     */
    addDependency(taskId, dep) {
        this.require(taskId, dep);
        if (taskId === dep) {
            throw new DependencyResolutionError(taskId, [taskId]);
        }
        const newEdges = !this.dependenciesByTask.get(taskId)?.has(dep);
        if (newEdges) {
            const cycle = this.wouldCreateCycle(taskId, dep);
            if (cycle)
                throw new DependencyResolutionError(taskId, cycle);
            this.wire(taskId, dep);
        }
    }
    /** Remove edge `dep -> taskId` if present. */
    removeDependency(taskId, dep) {
        if (this.dependenciesByTask.get(taskId)?.delete(dep))
            this.unwire(taskId, dep);
    }
    /**
     * Replace `taskId`'s full dependency set atomically (structurally). Performs
     * the targeted cycle check against the graph state *after* old edges are gone,
     * so only genuinely-new cycles are rejected.
     * @throws DependencyResolutionError if the resulting graph is cyclic.
     */
    replaceDependencies(taskId, deps) {
        this.requireExisting(taskId);
        for (const dep of this.dependenciesByTask.get(taskId) ?? [])
            this.unwire(taskId, dep);
        for (const dep of deps)
            this.addDependency(taskId, dep);
    }
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
    wouldCreateCycle(taskId, dep) {
        // Special case: taskId directly depends on dep already -> adding is a dup.
        if (this.dependenciesByTask.get(taskId)?.has(dep))
            return null;
        const path = [taskId];
        const visited = new Set([taskId]);
        const stack = [taskId];
        while (stack.length > 0) {
            const cur = stack.pop();
            if (cur === dep)
                return path; // path from taskId ... dep
            for (const next of this.dependentsByTask.get(cur) ?? []) {
                if (!visited.has(next)) {
                    visited.add(next);
                    path.push(next);
                    stack.push(next);
                }
            }
        }
        return null;
    }
    /**
     * Global acyclicity check via Kahn. Returns the set of task ids that remain
     * after emitting all zero-in-degree nodes (i.e. exactly the tasks stuck in
     * cycles). Empty iff acyclic.
     */
    findCyclicTasks() {
        const remaining = new Map();
        for (const task of this.registeredTasks) {
            remaining.set(task, this.dependenciesByTask.get(task)?.size ?? 0);
        }
        const queue = [];
        for (const [task, deg] of remaining)
            if (deg === 0)
                queue.push(task);
        while (queue.length > 0) {
            const task = queue.shift();
            remaining.delete(task);
            for (const dependent of this.dependentsByTask.get(task) ?? []) {
                const d = (remaining.get(dependent) ?? 0) - 1;
                remaining.set(dependent, d);
                if (d === 0)
                    queue.push(dependent);
            }
        }
        return [...remaining.keys()];
    }
    /** Tasks that (transitively) depend on `taskId`. Immutable snapshot. */
    dependentsOf(taskId) {
        return [...this.dependentsByTask.get(taskId) ?? []];
    }
    /** Direct hard dependencies of `taskId`. Immutable snapshot. */
    dependenciesOf(taskId) {
        return [...(this.dependenciesByTask.get(taskId) ?? [])];
    }
    /** Has `taskId` registered a dependency on `dep`? */
    hasDependency(taskId, dep) {
        return this.dependenciesByTask.get(taskId)?.has(dep) ?? false;
    }
    /** Remove every edge and task: reset the graph to empty. O(V + E). */
    clear() {
        this.dependenciesByTask.clear();
        this.dependentsByTask.clear();
        this.registeredTasks.clear();
    }
    // ----- internals -----
    require(taskId, dep) {
        if (!this.registeredTasks.has(taskId))
            throw new InvalidConfigurationError(`Unknown task in dependency graph: "${taskId}"`);
        if (!this.registeredTasks.has(dep))
            throw new InvalidConfigurationError(`Dependency on unknown/unregistered task: "${dep}"`);
    }
    requireExisting(taskId) {
        if (!this.registeredTasks.has(taskId))
            throw new InvalidConfigurationError(`Unknown task in dependency graph: "${taskId}"`);
    }
    /** `taskId` depends on `dep`: add both edges. */
    wire(taskId, dep) {
        const set = this.dependenciesByTask.get(taskId);
        set.add(dep);
        this.dependentsByTask.get(dep).add(taskId);
    }
    /** Detach `taskId` from `dep` in both directions. */
    unwire(taskId, dep) {
        this.dependenciesByTask.get(taskId).delete(dep);
        if (this.dependentsByTask.get(dep).delete(taskId) && this.dependentsByTask.get(dep).size === 0) {
            this.dependentsByTask.delete(dep);
        }
    }
}
