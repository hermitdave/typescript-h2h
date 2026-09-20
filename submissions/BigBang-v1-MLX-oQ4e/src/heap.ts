/**
 * Generic binary heap (max-heap by `cmp`).
 *
 * Convention: `cmp(a, b) > 0` means `a` should sit *above* `b` in the heap
 * (i.e. `a` has higher priority / is "greater"). The top of the heap is the
 * element for which no other element is "greater".
 *
 * Thread/safety: this is a plain in-memory heap; the scheduler layer uses
 * lazy-deletion (sequence-number validation) to handle dynamic priority /
 * scheduled-time updates without O(n) removals.
 */
export type Comparator<T> = (a: T, b: T) => number;

export class BinaryHeap<T> {
  private data: T[] = [];

  constructor(private cmp: Comparator<T>) {}

  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | null {
    const n = this.data.length;
    if (n === 0) return null;
    const top = this.data[0];
    this.data[0] = this.data[n - 1];
    this.data.length = n - 1;
    this.bubbleDown(0);
    return top;
  }

  peek(): T | null {
    return this.data[0] ?? null;
  }

  get size(): number {
    return this.data.length;
  }

  clear(): void {
    this.data = [];
  }

  toArray(): T[] {
    return [...this.data];
  }

  // --- internals ---
  private parent(i: number): number {
    return (i - 1) >> 1;
  }
  private left(i: number): number {
    return (i << 1) + 1;
  }
  private right(i: number): number {
    return (i << 1) + 2;
  }

  private compare(i: number, j: number): number {
    return this.cmp(this.data[i], this.data[j]);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = this.parent(i);
      if (this.compare(p, i) < 0) { // parent below child -> swap
        this.swap(p, i);
        i = p;
      } else {
        break;
      }
    }
  }

  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let best = i;
      const l = this.left(i), r = this.right(i);
      if (l < n && this.compare(l, best) > 0) best = l;
      if (r < n && this.compare(r, best) > 0) best = r;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }

  private swap(i: number, j: number): void {
    const a = this.data[i];
    this.data[i] = this.data[j];
    this.data[j] = a;
  }
}