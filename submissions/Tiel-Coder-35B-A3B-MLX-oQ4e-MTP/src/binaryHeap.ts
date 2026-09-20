/**
 * A min binary heap keyed by an arbitrary comparable payload, backed by an
 * id-to-position index map so that `remove` and key updates run in O(log n).
 *
 * The heap stores `payload` values and tracks each by an opaque `id` string.
 * `cmp(a, b) < 0` means `a` is "smaller" and sits higher in the heap (this is a
 * min-heap over the comparator). A single primitive is reused by the scheduler
 * for both the time heap (ordered by `runAt`) and the ready heap (ordered by
 * priority), so callers must write a comparator that matches their intent.
 *
 * Why an index map rather than decrease-key-by-value: the scheduler mutates task
 * priority/runAt and removes tasks by identity. An index map makes all of those
 * O(log n) and avoids the O(n) linear search a value-based heap would require.
 */
export type Compare<P> = (a: P, b: P) => number;

interface Node<P> {
  id: string;
  payload: P;
}

export class BinaryHeap<P> {
  private nodes: Node<P>[] = [];
  private index = new Map<string, number>();

  constructor(private cmp: Compare<P>) {}

  /** Number of elements in the heap. */
  get size(): number {
    return this.nodes.length;
  }

  /** True if `id` is currently in the heap. */
  has(id: string): boolean {
    return this.index.has(id);
  }

  private parent(i: number): number {
    return (i - 1) >> 1;
  }

  private left(i: number): number {
    return (i << 1) + 1;
  }

  private right(i: number): number {
    return (i << 1) + 2;
  }

  private swap(a: number, b: number): void {
    if (a === b) return;
    const na = this.nodes[a];
    const nb = this.nodes[b];
    this.nodes[a] = nb;
    this.nodes[b] = na;
    this.index.set(nb.id, a);
    this.index.set(na.id, b);
  }

  /** Bubble `i` up while it is smaller than its parent. */
  private swim(i: number): void {
    while (i > 0) {
      const p = this.parent(i);
      if (this.cmp(this.nodes[i].payload, this.nodes[p].payload) < 0) {
        this.swap(i, p);
        i = p;
      } else {
        break;
      }
    }
  }

  /** Sink `i` down while it is larger than its smaller child. */
  private sink(i: number): void {
    const n = this.nodes.length;
    while (true) {
      const l = this.left(i);
      const r = this.right(i);
      let s = i;
      if (l < n && this.cmp(this.nodes[l].payload, this.nodes[s].payload) < 0) {
        s = l;
      }
      if (r < n && this.cmp(this.nodes[r].payload, this.nodes[s].payload) < 0) {
        s = r;
      }
      if (s === i) break;
      this.swap(i, s);
      i = s;
    }
  }

  /** The minimum payload without removing it (undefined when empty). */
  peek(): P | undefined {
    return this.nodes[0]?.payload;
  }

  /** The id of the current minimum without removing it (undefined when empty). */
  peekId(): string | undefined {
    return this.nodes[0]?.id;
  }

  /** Insert a payload under `id`. Throws if the id is already present. */
  push(id: string, payload: P): void {
    if (this.index.has(id)) {
      throw new Error(`duplicate id "${id}" in heap`);
    }
    this.nodes.push({ id, payload });
    this.index.set(id, this.nodes.length - 1);
    this.swim(this.nodes.length - 1);
  }

  /** Remove and return the minimum payload (undefined when empty). */
  pop(): P | undefined {
    const top = this.nodes[0];
    if (!top) return undefined;
    const last = this.nodes.pop()!;
    this.index.delete(top.id);
    if (this.nodes.length > 0) {
      this.index.set(last.id, 0);
      this.nodes[0] = last;
      this.sink(0);
    }
    return top.payload;
  }

  /**
   * Remove the element with the given id (no-op if absent). O(log n): swap the
   * target with the last element, pop it, then sift the displaced element back
   * into place. The displaced element may need to move either direction, so
   * sink then swim covers both cases.
   */
  remove(id: string): void {
    const pos = this.index.get(id);
    if (pos === undefined) return;
    const lastIndex = this.nodes.length - 1;
    const removed = this.nodes[pos];
    if (pos === lastIndex) {
      this.nodes.pop();
      this.index.delete(id);
      return;
    }
    const last = this.nodes[lastIndex];
    this.nodes[pos] = last;
    this.index.set(last.id, pos);
    this.nodes.pop();
    this.index.delete(removed.id);
    this.sink(pos);
    this.swim(pos);
  }

  /** Empty the heap. */
  clear(): void {
    this.nodes = [];
    this.index.clear();
  }
}
