/**
 * Binary min-heap of task ids, ordered by (dueTime, priority, seq).
 *
 * A production scheduler's hottest primitive is "next executable task": this
 * must be O(log n) worst case, and arbitrary removal (re-queueing after a state
 * change) must also be O(log n) with NO stale entries. A binary min-heap gives
 * exactly that.
 *
 * INVARIANT: every live task has exactly ONE entry carrying its CURRENT
 * (dueTime, priority). The scheduler maintains this strictly: every state
 * change deletes the task then (re-)inserts it. Because ids are unique, the
 * `pos` map is a perfect O(1) index and the heap array is dense — so heap
 * operations are O(log n) and there are never dangling entries. A popped id is
 * always a live task, so the executor can trust it.
 *
 * Alternatives considered:
 *   - Bucket / windowed hash tables (due-slot grouping) — O(1) pop from the
 *     current due-window, good when due-times cluster, but O(N) bursts when a
 *     window refills; more complex. Not used here.
 *   - Sorted linked list by due-time — O(log n) insert, but O(n) scan on re-
 *     ordering and no cheap "priority reorder". Worse fit.
 *
 * Written to satisfy `strict` + `noUncheckedIndexedAccess`: every array read is
 * captured into a `const` reference and every read-pull uses a `!` (the read
 * index is < length, so the element provably exists). The moved node is owned
 * by a local, never deleted or reassigned, so its identity and non-nullness are
 * preserved throughout the sifting pass.
 */
interface TaskHeapEntry {
    /** Primary key: epoch-ms at which the task becomes due. */
    due: number;
    /** Secondary key: lower `priority` number wins (higher precedence). */
    prio: number;
    /** Tertiary key: global monotonic insert counter (insertion order tiebreak). */
    seq: number;
    /** The task id this entry represents. */
    id: string;
}
type Cmp = (a: TaskHeapEntry, b: TaskHeapEntry) => number;
/** Total order over heap entries: (dueTime, priority, seq). */
export declare function taskCmp(a: TaskHeapEntry, b: TaskHeapEntry): number;
/**
 * Binary min-heap keyed by the comparison above. Provides O(log n) insert /\
 * pop-min and O(log n) arbitrary delete — the shape the scheduler needs.
 */
export declare class TaskHeap {
    private readonly h;
    private readonly pos;
    /** Insert `id`. Throws on duplicate. O(log n). */
    push(id: string, due: number, prio: number, seq: number): void;
    /**
     * Remove `id`. O(log n): swap the target with the tail (single assignment),
     * then heapify to fix the moved-up and/or moved-down region.
     * Returns whether the id was present.
     */
    delete(id: string): boolean;
    /** O(1): min id, or undefined if empty. */
    peek(): string | undefined;
    /** O(log n): remove and return the min id. */
    pop(): string | undefined;
    /** O(1) membership. */
    has(id: string): boolean;
    /** Immutable snapshot of held ids (for diagnostics/stats). */
    keys(): string[];
    /** Current number of entries. */
    get size(): number;
    /** Remove all entries and the position index. O(n). */
    clear(): void;
    /** O(1) read of a task's live ordering key. */
    key(id: string): {
        due: number;
        prio: number;
    } | undefined;
    /** @internal expose comparator for tests / diagnostics. */
    getComparator(): Cmp;
    private siftUp;
    private siftDown;
    /** Restore heap property at `idx` after an arbitrary swap (e.g. delete). */
    private heapify;
}
export {};
