/**
 * Indexed binary heap with O(log n) keyed removal/update by id.
 *
 * The executable-task queue is a min-heap over a total order:
 *
 *   (priority asc, dueTime asc, seq asc)
 *
 *   - lower numeric priority executes sooner
 *   - ties break on the earliest execution timestamp
 *   - remaining ties break FIFO on insertion order (seq)
 *
 * A binary heap is chosen over a d-ary heap because sift-up/sift-down are
 * exactly the two paths needed here; d-ary trades extra comparisons for
 * fewer cache misses, which is nice-to-have, not needed at 1M tasks
 * (log2(1M) = 20 levels).
 *
 * The index map guarantees remove(id)/update(id) are O(log n) instead of
 * O(n): a plain binary heap would have to sift down from an arbitrary slot.
 */

/**
 * A keyed heap whose items carry a stable `id` so updates can be located
 * without a scan.
 */
export class IndexedHeap<T> {
  constructor(
    private readonly compare: (a: T, b: T) => number,
  ) {
    this.entries = [];
    this.indexById = new Map<string, number>();
  }

  private entries: T[] = [];

  /** O(1). Returns the minimum item, or undefined when empty. */
  peek(): T | undefined {
    return this.entries[0];
  }

  /** O(1). */
  get size(): number {
    return this.entries.length;
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** O(log n). Removes and returns the minimum item. Throws on empty heap. */
  pop(): T {
    if (this.entries.length === 0) {
      throw new Error("IndexedHeap.pop() on an empty heap");
    }
    const top = this.entries[0];
    this.removeByIndex(0);
    return top;
  }

  /** O(log n). Throws if the item is not currently in the heap. */
  remove(item: T): void {
    const idx = this.indexById.get(item.id);
    if (idx === undefined) {
      throw new Error("IndexedHeap.remove: unknown item");
    }
    this.removeByIndex(idx);
    this.indexById.delete(item.id);
  }

  /**
   * O(log n). Removes by stored id. Throws if no live entry exists for the id
   * (e.g. item was popped or never pushed).
   */
  removeById(id: string): void {
    const idx = this.indexById.get(id);
    if (idx === undefined) {
      throw new Error(`IndexedHeap.removeById: no live entry for "${id}"`);
    }
    this.removeByIndex(idx);
    this.indexById.delete(id);
  }

  /**
   * O(log n). Overwrites an item's key and re-heapifies. Idempotent: a no-op
   * when the item is not in the heap (e.g. task currently blocked on deps).
   */
  update(item: T): void {
    const idx = this.indexById.get(item.id);
    if (idx === undefined) {
      return;
    }
    this.entries[idx] = item;
    this.siftDown(idx);
    this.siftUp(idx);
  }

  /** O(n). Returns items in arbitrary heap order (mainly for tests). */
  toArray(): T[] {
    return this.entries.slice();
  }

  private removeByIndex(idx: number): void {
    const lastIdx = this.entries.length - 1;
    const item = this.entries[idx];
    if (lastIdx === idx) {
      this.entries.pop();
      return;
    }
    const last = this.entries[lastIdx];
    this.entries[idx] = last;
    this.entries.pop();
    this.indexById.set(item.id, idx); // item removed from map by the caller after this
    this.siftDown(idx);
    this.siftUp(idx);
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      const a = this.entries[idx];
      const b = this.entries[parent];
      if (this.compare(b, a) <= 0) break;
      this.swap(idx, parent);
      idx = parent;
    }
  }

  private siftDown(idx: number): void {
    const len = this.entries.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < len && this.compare(this.entries[left], this.entries[smallest]) < 0) {
        smallest = left;
      }
      if (right < len && this.compare(this.entries[right], this.entries[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const a = this.entries[i];
    const b = this.entries[j];
    this.entries[i] = b;
    this.entries[j] = a;
    this.indexById.set(a.id, j);
    this.indexById.set(b.id, i);
  }
}

/**
 * Executable-task entries. The heap comparator reads these fields directly
 * off the task record (no copies), so priority/dueTime/seq mutations are
 * immediately visible to heap ordering.
 */
export interface HeapTask {
  id: string;
  priority: number;
  dueTime: number;
  seq: number;
}