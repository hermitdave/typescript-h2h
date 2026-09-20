/**
 * A binary min-heap over an array. The standard cache/branch-friendly
 * implementation for priority queues: push/pop are O(log n) with tiny
 * constants and no allocation beyond the entry itself.
 *
 * @typeParam T the heap entry type; ordering is defined by `compare`.
 */
export class MinHeap<T> {
  private data: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.data.length;
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  peek(): T | undefined {
    return this.data[0];
  }

  push(item: T): void {
    this.data.push(item);
    this.siftUp(this.data.length - 1);
  }

  pop(): T | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last !== undefined) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Snapshot of the internal array (heap order is not sorted order). For tests/debug only. */
  toArray(): T[] {
    return this.data.slice();
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.data;
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.data[i], this.data[parent]) < 0) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    const n = this.data.length;
    let i = index;
    for (;;) {
      let smallest = i;
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      if (left < n && this.compare(this.data[left], this.data[smallest]) < 0) {
        smallest = left;
      }
      if (right < n && this.compare(this.data[right], this.data[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }
}