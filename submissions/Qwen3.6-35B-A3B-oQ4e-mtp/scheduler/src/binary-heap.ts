/**
 * Binary Min-Heap for efficient next-task retrieval.
 *
 * Ordering keys (in priority order):
 *  1. executeAt (ascending) — earliest first
 *  2. priority (ascending)   — highest priority first
 *  3. taskId (string)        — alphabetical, for determinism
 *
 * Supports lazy removal via stale entry tracking.
 */

export interface HeapEntry {
  taskId: string;
  executeAtEpoch: number | null;
  priority: number;
  version: number;
}

export class BinaryHeap {
  private heap: HeapEntry[];
  private staleIds: Set<string>;
  private capacity: number;

  constructor(initialCapacity: number = 256) {
    this.heap = new Array(initialCapacity);
    this.heap.length = 0;
    this.staleIds = new Set();
    this.capacity = initialCapacity;
  }

  get size(): number {
    return this.heap.length;
  }

  get empty(): boolean {
    return this.heap.length === 0;
  }

  get staleCount(): number {
    return this.staleIds.size;
  }

  /** Insert a heap entry. */
  insert(entry: HeapEntry): void {
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  /** Peek at the minimum entry without removing it. Returns undefined if empty. */
  peek(): HeapEntry | undefined {
    if (this.empty) return undefined;
    return this.heap[0];
  }

  /**
   * Extract the minimum entry, skipping stale entries lazily.
   * Returns undefined if no valid entries remain.
   */
  extractMin(): HeapEntry | undefined {
    if (this.empty) return undefined;

    const root = this.heap[0];

    // Skip stale entries
    while (this.heap.length > 0 && this.isStale(this.heap[0])) {
      this.removeRoot();
    }

    if (this.empty) return undefined;

    const min = this.heap[0];
    this.removeRoot();
    return min;
  }

  /** Remove a specific task by ID. O(log n). */
  remove(taskId: string): void {
    for (let i = 0; i < this.heap.length; i++) {
      if (this.heap[i].taskId === taskId) {
        this.heap[i] = this.heap[this.heap.length - 1];
        this.heap.pop();
        if (i < this.heap.length) {
          this.siftUp(i);
          this.siftDown(i);
        }
        break;
      }
    }
  }

  /** Mark a task as stale so it will be skipped on next extractMin. */
  markStale(taskId: string): void {
    this.staleIds.add(taskId);
  }

  /** Re-insert a task with updated properties (update priority/time).
   *  Removes the old entry first, then inserts the new one.
   */
  reinsert(entry: HeapEntry): void {
    this.remove(entry.taskId);
    entry.version += 1;
    this.insert(entry);
  }

  /** Eagerly clear all stale entries (for testing/benchmarking). */
  clearStale(): void {
    this.heap = this.heap.filter((e) => !this.isStale(e));
    this.staleIds.clear();
    this.heapify();
  }

  // ─── Internal Methods ────────────────────────────────────────────────────

  private isStale(entry: HeapEntry): boolean {
    return this.staleIds.has(entry.taskId);
  }

  /** Remove the root element and restructure the heap. */
  removeRoot(): void {
    const last = this.heap.pop();
    if (this.heap.length === 0) {
      if (last) this.staleIds.delete(last.taskId);
      return;
    }
    this.heap[0] = last!;
    this.siftDown(0);
  }

  private siftUp(idx: number): void {
    const heap = this.heap;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.compare(heap[parent], heap[idx]) > 0) {
        this.swap(heap, parent, idx);
        idx = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(idx: number): void {
    const heap = this.heap;
    const n = heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;

      if (left < n && this.compare(heap[smallest], heap[left]) > 0) {
        smallest = left;
      }
      if (right < n && this.compare(heap[smallest], heap[right]) > 0) {
        smallest = right;
      }

      if (smallest !== idx) {
        this.swap(heap, idx, smallest);
        idx = smallest;
      } else {
        break;
      }
    }
  }

  private compare(a: HeapEntry, b: HeapEntry): number {
    // 1. executeAt: ascending (null = immediately, treated as -Infinity)
    const aExec = a.executeAtEpoch ?? -Infinity;
    const bExec = b.executeAtEpoch ?? -Infinity;
    if (aExec !== bExec) return aExec - bExec;

    // 2. priority: ascending (lower = higher priority)
    if (a.priority !== b.priority) return a.priority - b.priority;

    // 3. taskId: alphabetical (for determinism)
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
  }

  private swap(arr: HeapEntry[], a: number, b: number): void {
    [arr[a], arr[b]] = [arr[b], arr[a]];
  }

  private heapify(): void {
    const n = this.heap.length;
    for (let i = (n >> 1) - 1; i >= 0; i--) {
      this.siftDown(i);
    }
  }
}
