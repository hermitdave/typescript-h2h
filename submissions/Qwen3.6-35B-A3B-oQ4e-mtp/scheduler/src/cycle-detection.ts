/**
 * Cycle detection for dependency graph.
 *
 * Uses DFS with three-color marking to detect cycles in O(V + E).
 * Called when adding/updating task dependencies to ensure the DAG property.
 */

import { TaskState } from './types';
import { Task } from './types';

export interface DependencyGraph {
  /** Forward edges: task -> its dependencies */
  dependencies: Map<string, Set<string>>;

  /** Reverse edges: dependency -> tasks that depend on it */
  dependents: Map<string, Set<string>>;
}

export function createDependencyGraph(): DependencyGraph {
  return {
    dependencies: new Map(),
    dependents: new Map(),
  };
}

/**
 * Check if adding edges from `newTaskId` to `newDependencies` would create a cycle.
 *
 * A cycle exists if any dependency in the new set transitively depends on `newTaskId`.
 * We DFS from each dependency through the dependencies map (forward edges) looking for newTaskId.
 *
 * @param graph The dependency graph
 * @param newTaskId The task being added/modified
 * @param newDependencies The dependencies it would have
 * @returns null if no cycle, or array of task IDs forming the cycle path
 */
export function hasCycle(
  graph: DependencyGraph,
  newTaskId: string,
  newDependencies: string[],
): string[] | null {
  for (const depId of newDependencies) {
    const path = dfsCycle(graph, newTaskId, depId, new Set());
    if (path !== null) {
      return path;
    }
  }
  return null;
}

/**
 * DFS from `current` through dependencies (forward edges), looking for `target`.
 * Returns cycle path if found, null otherwise.
 * Uses iterative approach to avoid stack overflow on deep chains.
 */
function dfsCycle(
  graph: DependencyGraph,
  target: string,
  current: string,
  visited: Set<string>,
): string[] | null {
  const stack: { node: string; path: string[] }[] = [{ node: current, path: [current] }];

  while (stack.length > 0) {
    const { node, path } = stack.pop()!;

    if (visited.has(node)) continue;
    visited.add(node);

    const deps = graph.dependencies.get(node);
    if (!deps) continue;

    for (const dep of deps) {
      if (dep === target) {
        return [...path, dep];
      }
      if (visited.has(dep)) continue;
      stack.push({ node: dep, path: [...path, dep] });
    }
  }
  return null;
}

/**
 * Add edges to the dependency graph.
 */
export function addEdges(
  graph: DependencyGraph,
  taskId: string,
  dependencies: string[],
): void {
  const deps = graph.dependencies.get(taskId);
  if (deps) {
    // Merge with existing dependencies
    for (const dep of dependencies) {
      deps.add(dep);
      if (!graph.dependents.has(dep)) {
        graph.dependents.set(dep, new Set());
      }
      graph.dependents.get(dep)!.add(taskId);
    }
  } else {
    const newDeps = new Set<string>(dependencies);
    graph.dependencies.set(taskId, newDeps);
    for (const dep of dependencies) {
      if (!graph.dependents.has(dep)) {
        graph.dependents.set(dep, new Set());
      }
      graph.dependents.get(dep)!.add(taskId);
    }
  }
}

/**
 * Remove edges for a task from the graph.
 */
export function removeEdges(
  graph: DependencyGraph,
  taskId: string,
): void {
  const deps = graph.dependencies.get(taskId);
  if (deps) {
    for (const depId of deps) {
      const childSet = graph.dependents.get(depId);
      if (childSet) {
        childSet.delete(taskId);
      }
    }
    graph.dependencies.delete(taskId);
  }
}

/**
 * Update edges: remove old, add new.
 */
export function updateEdges(
  graph: DependencyGraph,
  taskId: string,
  oldDeps: string[],
  newDeps: string[],
): void {
  // Remove old edges
  for (const depId of oldDeps) {
    const childSet = graph.dependents.get(depId);
    if (childSet) {
      childSet.delete(taskId);
    }
  }
  graph.dependencies.set(taskId, new Set(newDeps));

  // Add new edges
  for (const depId of newDeps) {
    if (!graph.dependents.has(depId)) {
      graph.dependents.set(depId, new Set());
    }
    graph.dependents.get(depId)!.add(taskId);
  }
}

/**
 * Get all dependencies for a task.
 */
export function getDependencies(graph: DependencyGraph, taskId: string): string[] {
  const deps = graph.dependencies.get(taskId);
  return deps ? [...deps] : [];
}

/**
 * Get all dependents for a task.
 */
export function getDependents(graph: DependencyGraph, taskId: string): string[] {
  const children = graph.dependents.get(taskId);
  return children ? [...children] : [];
}

/**
 * Check if all dependencies of a task are completed.
 */
export function areAllDependenciesMet<T extends { state: TaskState }>(
  graph: DependencyGraph,
  taskStates: Map<string, T>,
  taskId: string,
): boolean {
  const deps = graph.dependencies.get(taskId);
  if (!deps || deps.size === 0) return true;
  for (const depId of deps) {
    const depState = taskStates.get(depId);
    if (!depState || depState.state !== 'completed') {
      return false;
    }
  }
  return true;
}

/**
 * Total number of dependency edges in the graph.
 */
export function getTotalEdges(graph: DependencyGraph): number {
  let total = 0;
  for (const deps of graph.dependencies.values()) {
    total += deps.size;
  }
  return total;
}
