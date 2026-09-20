/**
 * A minimal, allocation-conscious binary min-heap ordered by a caller-supplied
 * comparator. This is intentionally dependency-free and generic so it can back
 * both the ready (priority-ordered) and future (time-ordered) queues.
 *
 * Why a hand-rolled heap and not a sorted array or a `Map`?
 *  - JS has no built-in order-preserving set/map, and balancing a BST adds
 *    constant-factor overhead we don't need here.
 *  - We need O(log n) insert and O(log n) extract-min, and O(1) peek.
 *  - Stale-entry pruning only needs to happen at the root, so we expose a
 *    `prune` that cheaply drops invalid entries from the top.
 */
export type Comparator<T> = (a: T, b: T) => number;

export class MinHeap<T> {
  private readonly data: T[] = [];

  constructor(private readonly cmp: Comparator<T>) {}

  get size(): number {
    return this.data.length;
  }

  get isEmpty(): boolean {
    return this.data.length === 0;
  }

  /** O(1) peek of the head element (no mutation). */
  peek(): T | undefined {
    return this.data[0];
  }

  /** O(log n) insert with sift-up. */
  push(item: T): void {
    this.data.push(item);
    let i = this.data.length - 1;
    const data = this.data;
    const cmp = this.cmp;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const ip = data[parent];
      if (ip === undefined) break; // safety; should never happen
      if (cmp(data[i]!, ip) >= 0) break;
      const tmp = data[i]!;
      data[i] = ip;
      data[parent] = tmp;
      i = parent;
    }
  }

  /** O(log n) extract-min. Returns the extracted head, or `undefined` if empty. */
  pop(): T | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (last === undefined) return top; // was the sole element
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown();
    }
    return top;
  }

  /**
   * Drop invalid entries that happen to sit at the root. Returns how many were
   * removed. Used for lazy deletion: the top of the heap is the only place we
   * bother to validate eagerly; everything deeper is cleaned lazily as it bubbles.
   */
  prune(pred: (item: T) => boolean): number {
    let removed = 0;
    const data = this.data;
    while (data.length > 0 && pred(data[0]!)) {
      this.pop();
      removed++;
    }
    return removed;
  }

  /** Drop all entries (clears the underlying array). O(n) to reclaim. */
  clear(): void {
    this.data.length = 0;
  }

  /** Internal sift-down used by pop(). */
  private sinkDown(): void {
    const data = this.data;
    const cmp = this.cmp;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      const li = data[l];
      const ri = data[r];
      if (li === undefined || ri === undefined) break;
      let smallest = i;
      if (cmp(li, data[smallest]!) < 0) smallest = l;
      if (cmp(ri, data[smallest]!) < 0) smallest = r;
      if (smallest === i) break;
      const tmp = data[i]!;
      data[i] = data[smallest]!;
      data[smallest] = tmp;
      i = smallest;
    }
  }
}
