export class Graph {
  private adjacencyList: Map<string, Set<string>>;
  private reverseAdjacencyList: Map<string, Set<string>>;

  constructor() {
    this.adjacencyList = new Map();
    this.reverseAdjacencyList = new Map();
  }

  addNode(nodeId: string): void {
    if (!this.adjacencyList.has(nodeId)) {
      this.adjacencyList.set(nodeId, new Set());
      this.reverseAdjacencyList.set(nodeId, new Set());
    }
  }

  addEdge(from: string, to: string): void {
    this.addNode(from);
    this.addNode(to);
    
    this.adjacencyList.get(from)!.add(to);
    this.reverseAdjacencyList.get(to)!.add(from);
  }

  removeEdge(from: string, to: string): void {
    this.adjacencyList.get(from)?.delete(to);
    this.reverseAdjacencyList.get(to)?.delete(from);
  }

  removeNode(nodeId: string): void {
    const neighbors = this.adjacencyList.get(nodeId);
    if (neighbors) {
      for (const neighbor of neighbors) {
        this.reverseAdjacencyList.get(neighbor)?.delete(nodeId);
      }
    }

    const predecessors = this.reverseAdjacencyList.get(nodeId);
    if (predecessors) {
      for (const predecessor of predecessors) {
        this.adjacencyList.get(predecessor)?.delete(nodeId);
      }
    }

    this.adjacencyList.delete(nodeId);
    this.reverseAdjacencyList.delete(nodeId);
  }

  getNeighbors(nodeId: string): Set<string> {
    return this.adjacencyList.get(nodeId) || new Set();
  }

  getPredecessors(nodeId: string): Set<string> {
    return this.reverseAdjacencyList.get(nodeId) || new Set();
  }

  hasNode(nodeId: string): boolean {
    return this.adjacencyList.has(nodeId);
  }

  hasEdge(from: string, to: string): boolean {
    return this.adjacencyList.get(from)?.has(to) || false;
  }

  detectCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const nodeId of this.adjacencyList.keys()) {
      if (!visited.has(nodeId)) {
        if (this.hasCycleDFS(nodeId, visited, recursionStack)) {
          return true;
        }
      }
    }
    return false;
  }

  private hasCycleDFS(nodeId: string, visited: Set<string>, recursionStack: Set<string>): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = this.adjacencyList.get(nodeId) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (this.hasCycleDFS(neighbor, visited, recursionStack)) {
          return true;
        }
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  findCycle(): string[] | null {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    for (const nodeId of this.adjacencyList.keys()) {
      if (!visited.has(nodeId)) {
        const cycle = this.findCycleDFS(nodeId, visited, recursionStack, path);
        if (cycle) return cycle;
      }
    }
    return null;
  }

  private findCycleDFS(
    nodeId: string,
    visited: Set<string>,
    recursionStack: Set<string>,
    path: string[]
  ): string[] | null {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const neighbors = this.adjacencyList.get(nodeId) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        const cycle = this.findCycleDFS(neighbor, visited, recursionStack, path);
        if (cycle) return cycle;
      } else if (recursionStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        return path.slice(cycleStart).concat([neighbor]);
      }
    }

    recursionStack.delete(nodeId);
    path.pop();
    return null;
  }

  topologicalSort(): string[] {
    const visited = new Set<string>();
    const stack: string[] = [];

    for (const nodeId of this.adjacencyList.keys()) {
      if (!visited.has(nodeId)) {
        this.topologicalSortDFS(nodeId, visited, stack);
      }
    }

    return stack.reverse();
  }

  private topologicalSortDFS(nodeId: string, visited: Set<string>, stack: string[]): void {
    visited.add(nodeId);
    const neighbors = this.adjacencyList.get(nodeId) || new Set();
    
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        this.topologicalSortDFS(neighbor, visited, stack);
      }
    }
    
    stack.push(nodeId);
  }

  getNodes(): string[] {
    return Array.from(this.adjacencyList.keys());
  }

  clear(): void {
    this.adjacencyList.clear();
    this.reverseAdjacencyList.clear();
  }
}
