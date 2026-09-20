"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinaryHeap = void 0;
class BinaryHeap {
    constructor(cmp) {
        this.cmp = cmp;
        this.data = [];
    }
    push(item) {
        this.data.push(item);
        this.bubbleUp(this.data.length - 1);
    }
    pop() {
        const n = this.data.length;
        if (n === 0)
            return null;
        const top = this.data[0];
        this.data[0] = this.data[n - 1];
        this.data.length = n - 1;
        this.bubbleDown(0);
        return top;
    }
    peek() {
        return this.data[0] ?? null;
    }
    get size() {
        return this.data.length;
    }
    clear() {
        this.data = [];
    }
    toArray() {
        return [...this.data];
    }
    // --- internals ---
    parent(i) {
        return (i - 1) >> 1;
    }
    left(i) {
        return (i << 1) + 1;
    }
    right(i) {
        return (i << 1) + 2;
    }
    compare(i, j) {
        return this.cmp(this.data[i], this.data[j]);
    }
    bubbleUp(i) {
        while (i > 0) {
            const p = this.parent(i);
            if (this.compare(p, i) < 0) { // parent below child -> swap
                this.swap(p, i);
                i = p;
            }
            else {
                break;
            }
        }
    }
    bubbleDown(i) {
        const n = this.data.length;
        while (true) {
            let best = i;
            const l = this.left(i), r = this.right(i);
            if (l < n && this.compare(l, best) > 0)
                best = l;
            if (r < n && this.compare(r, best) > 0)
                best = r;
            if (best === i)
                break;
            this.swap(i, best);
            i = best;
        }
    }
    swap(i, j) {
        const a = this.data[i];
        this.data[i] = this.data[j];
        this.data[j] = a;
    }
}
exports.BinaryHeap = BinaryHeap;
//# sourceMappingURL=heap.js.map