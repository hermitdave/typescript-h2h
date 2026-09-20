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
export declare class BinaryHeap<T> {
    private cmp;
    private data;
    constructor(cmp: Comparator<T>);
    push(item: T): void;
    pop(): T | null;
    peek(): T | null;
    get size(): number;
    clear(): void;
    toArray(): T[];
    private parent;
    private left;
    private right;
    private compare;
    private bubbleUp;
    private bubbleDown;
    private swap;
}
//# sourceMappingURL=heap.d.ts.map