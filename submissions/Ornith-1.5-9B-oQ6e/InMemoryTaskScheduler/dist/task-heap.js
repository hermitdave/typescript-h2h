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
/** Total order over heap entries: (dueTime, priority, seq). */
export function taskCmp(a, b) {
    if (a.due !== b.due)
        return a.due - b.due;
    if (a.prio !== b.prio)
        return a.prio - b.prio;
    return a.seq - b.seq;
}
/**
 * Binary min-heap keyed by the comparison above. Provides O(log n) insert /\
 * pop-min and O(log n) arbitrary delete — the shape the scheduler needs.
 */
export class TaskHeap {
    constructor() {
        this.h = [];
        this.pos = new Map();
    }
    /** Insert `id`. Throws on duplicate. O(log n). */
    push(id, due, prio, seq) {
        if (this.pos.has(id))
            throw new Error(`TaskHeap.push: duplicate id ${id}`);
        this.h.push({ due, prio, seq, id });
        const i = this.h.length - 1;
        this.pos.set(id, i);
        this.siftUp(i);
    }
    /**
     * Remove `id`. O(log n): swap the target with the tail (single assignment),
     * then heapify to fix the moved-up and/or moved-down region.
     * Returns whether the id was present.
     */
    delete(id) {
        const idx = this.pos.get(id);
        if (idx === undefined)
            return false;
        const last = this.h.length - 1;
        const tail = this.h[last];
        if (idx !== last) {
            this.h[idx] = tail;
            this.pos.set(tail.id, idx);
        }
        this.h.pop();
        this.pos.delete(id);
        // `idx` may now violate both the up and down invariants: try both, in a
        // single downward pass that also sifts up when it belongs higher.
        this.heapify(idx);
        return true;
    }
    /** O(1): min id, or undefined if empty. */
    peek() {
        return this.h[0]?.id;
    }
    /** O(log n): remove and return the min id. */
    pop() {
        if (this.h.length === 0)
            return undefined;
        const id = this.h[0].id;
        const last = this.h.pop();
        if (this.h.length > 0) {
            this.h[0] = last;
            this.pos.set(last.id, 0);
            this.siftDown(0);
        }
        else {
            this.pos.delete(id);
        }
        return id;
    }
    /** O(1) membership. */
    has(id) {
        return this.pos.has(id);
    }
    /** Immutable snapshot of held ids (for diagnostics/stats). */
    keys() {
        return [...this.pos.keys()];
    }
    /** Current number of entries. */
    get size() {
        return this.h.length;
    }
    /** Remove all entries and the position index. O(n). */
    clear() {
        this.h.length = 0;
        this.pos.clear();
    }
    /** O(1) read of a task's live ordering key. */
    key(id) {
        const p = this.pos.get(id);
        if (p === undefined)
            return undefined;
        const e = this.h[p];
        return { due: e.due, prio: e.prio };
    }
    /** @internal expose comparator for tests / diagnostics. */
    getComparator() {
        return taskCmp;
    }
    // ----- heap internals (all with explicit narrowing) -----
    siftUp(start) {
        const h = this.h;
        const v = h[start];
        let i = start;
        while (true) {
            const parent = (i - 1) >> 1;
            if (parent < 0)
                break;
            const hp = h[parent];
            if (taskCmp(v, hp) >= 0)
                break;
            h[i] = hp;
            this.pos.set(h[i].id, i);
            i = parent;
        }
        h[i] = v;
        this.pos.set(v.id, i);
    }
    siftDown(start) {
        const h = this.h;
        const v = h[start];
        let i = start;
        const length = h.length;
        while (true) {
            const l = (i << 1) + 1;
            if (l >= length)
                break;
            let j = l;
            const r = l + 1;
            if (r < length) {
                const hr = h[r];
                const hj = h[j];
                if (taskCmp(hr, hj) < 0)
                    j = r;
            }
            const hj2 = h[j];
            if (taskCmp(v, hj2) < 0) {
                h[i] = hj2;
                this.pos.set(h[i].id, i);
                i = j;
            }
            else {
                break;
            }
        }
        h[i] = v;
        this.pos.set(v.id, i);
    }
    /** Restore heap property at `idx` after an arbitrary swap (e.g. delete). */
    heapify(idx) {
        const h = this.h;
        const length = h.length;
        // The element moved into `idx` may violate BOTH the up and down invariants.
        // Decide by comparing it against its parent and its smallest child in a
        // single downward pass: prefer sifting up when it is smaller than its
        // parent, otherwise sift down.
        while (idx > 0) {
            const parent = (idx - 1) >> 1;
            const hp = h[parent];
            const v = h[idx];
            if (taskCmp(v, hp) < 0) {
                h[idx] = hp;
                this.pos.set(hp.id, parent);
                this.pos.set(h[idx].id, idx);
                idx = parent;
            }
            else {
                break;
            }
        }
        // Now sift down from the settled position.
        const v = h[idx];
        let i = idx;
        while (true) {
            const l = (i << 1) + 1;
            if (l >= length)
                break;
            const r = l + 1;
            let j = l;
            if (r < length) {
                const hr = h[r];
                const hj = h[j];
                if (taskCmp(hr, hj) < 0)
                    j = r;
            }
            const hj2 = h[j];
            if (taskCmp(v, hj2) < 0) {
                h[i] = hj2;
                this.pos.set(h[i].id, i);
                i = j;
            }
            else {
                break;
            }
        }
        h[i] = v;
        this.pos.set(v.id, i);
    }
}
