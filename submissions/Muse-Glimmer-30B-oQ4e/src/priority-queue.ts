export class PriorityQueue<T> {
  private heap: Array<{ priority: number; timestamp: number; item: T }>;
  private comparator: (a: number, b: number) => number;

  constructor(comparator?: (a: number, b: number) => number) {
    this.heap = [];
    this.comparator = comparator || ((a, b) => a - b);
  }

  size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  push(item: T, priority: number, timestamp: number = Date.now()): void {
    const element = { priority, timestamp, item };
    this.heap.push(element);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop()?.item;

    const top = this.heap[0].item;
    this.heap[0] = this.heap.pop()!;
    this.bubbleDown(0);
    return top;
  }

  remove(predicate: (item: T) => boolean): boolean {
    const index = this.heap.findIndex(node => predicate(node.item));
    if (index === -1) return false;

    const last = this.heap.pop();
    if (index < this.heap.length) {
      this.heap[index] = last!;
      this.bubbleDown(index);
      this.bubbleUp(index);
    }
    return true;
  }

  toArray(): T[] {
    return [...this.heap].sort((a, b) => {
      const cmp = this.comparator(a.priority, b.priority);
      if (cmp !== 0) return cmp;
      return a.timestamp - b.timestamp;
    }).map(node => node.item);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(index, parentIndex) >= 0) break;
      
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;

      if (left < length && this.compare(left, smallest) < 0) {
        smallest = left;
      }
      if (right < length && this.compare(right, smallest) < 0) {
        smallest = right;
      }
      if (smallest === index) break;

      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }

  private compare(indexA: number, indexB: number): number {
    const a = this.heap[indexA];
    const b = this.heap[indexB];
    
    const priorityCmp = this.comparator(a.priority, b.priority);
    if (priorityCmp !== 0) return priorityCmp;
    
    return a.timestamp - b.timestamp;
  }

  clear(): void {
    this.heap = [];
  }
}
