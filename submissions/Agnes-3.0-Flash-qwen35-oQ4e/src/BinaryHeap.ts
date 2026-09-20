/**
 * Array-backed binary min-heap with a pluggable comparator.
 *
 * Semantics: cmp(a, b) < 0  =>  a sorts BEFORE b (a closer to the root).
 * The scheduler's comparator encodes "more urgent" as "smaller":
 *   higher priority first, then earlier scheduledAt, then id ascending.
 *
 * Complexity: insert O(log n), pop O(log n), peek O(1), drain O(n).
 */
export class BinaryHeap<T> {
  private a: T[] = [];

  constructor(private readonly cmp: (a: T, b: T) => number) {}

  get size(): number {
    return this.a.length;
  }

  peek(): T | undefined {
    return this.a[0];
  }

  insert(x: T): void {
    this.a.push(x);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(this.a[i], this.a[p]) < 0) {
        [this.a[i], this.a[p]] = [this.a[p], this.a[i]];
        i = p;
      } else {
        return;
      }
    }
  }

  pop(): T | undefined {
    if (this.a.length === 0) return undefined;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length > 0) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < this.a.length && this.cmp(this.a[l], this.a[s]) < 0) s = l;
        if (r < this.a.length && this.cmp(this.a[r], this.a[s]) < 0) s = r;
        if (s === i) break;
        [this.a[i], this.a[s]] = [this.a[s], this.a[i]];
        i = s;
      }
    }
    return top;
  }

  /** Remove and return every entry, leaving the heap empty. O(n). */
  drain(): T[] {
    const out = this.a;
    this.a = [];
    return out;
  }
}
