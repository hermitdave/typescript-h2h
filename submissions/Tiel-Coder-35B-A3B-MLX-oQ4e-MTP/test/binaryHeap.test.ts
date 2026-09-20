import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BinaryHeap } from '../src/binaryHeap.js';

describe('BinaryHeap', () => {
  it('supports push, pop, peek in sorted order', () => {
    const h = new BinaryHeap<number>((a, b) => a - b);
    assert.equal(h.size, 0);
    assert.equal(h.peek(), undefined);
    assert.equal(h.pop(), undefined);

    for (const n of [5, 3, 8, 1, 9, 2, 7]) h.push(String(n), n);
    assert.equal(h.size, 7);

    const out: number[] = [];
    while (h.size > 0) out.push(h.pop()!);
    assert.deepEqual(out, [1, 2, 3, 5, 7, 8, 9]);
  });

  it('pushing a duplicate id throws', () => {
    const h = new BinaryHeap<number>((a, b) => a - b);
    h.push('a', 1);
    assert.throws(() => h.push('a', 2));
  });

  it('remove is O(log n) and keeps the heap consistent', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const h = new BinaryHeap<number>((a, b) => a - b);
    for (const v of items) h.push(String(v), v);
    const expected = [...items].sort((a, b) => a - b);

    // Remove the middle half out of order.
    const toRemove = ['20', '50', '70', '10', '90'];
    for (const id of toRemove) h.remove(id);

    const out: number[] = [];
    while (h.size > 0) out.push(h.pop()!);
    const remaining = items.filter((v) => !toRemove.includes(String(v))).sort((a, b) => a - b);
    assert.deepEqual(out, remaining);
  });

  it('remove of an absent id is a no-op', () => {
    const h = new BinaryHeap<number>((a, b) => a - b);
    h.push('a', 1);
    h.remove('does-not-exist');
    assert.equal(h.size, 1);
    assert.equal(h.pop(), 1);
  });

  it('remove of the root rebalances correctly', () => {
    const h = new BinaryHeap<number>((a, b) => a - b);
    for (const v of [3, 1, 2, 5, 4]) h.push(String(v), v);
    h.remove('1'); // root
    assert.equal(h.peek(), 2);
    assert.equal(h.size, 4);
    const out: number[] = [];
    while (h.size > 0) out.push(h.pop()!);
    assert.deepEqual(out, [2, 3, 4, 5]);
  });

  it('clear empties the heap', () => {
    const h = new BinaryHeap<number>((a, b) => a - b);
    h.push('a', 1);
    h.clear();
    assert.equal(h.size, 0);
    assert.equal(h.has('a'), false);
  });

  it('handles interleaved push/pop/remove stress', () => {
    const h = new BinaryHeap<number>((a, b) => a - b);
    let seq = 0;
    const known = new Set<string>();
    // Track the value currently sitting under each id so removals can be
    // excluded from the expected output (the previous version only tracked
    // pushed values and never dropped removed ones).
    const valuesById = new Map<string, number>();
    for (let i = 0; i < 500; i++) {
      const v = Math.floor(Math.random() * 1000);
      if (known.size > 0 && Math.random() < 0.3) {
        // remove a random element
        const keys = [...known];
        const picked = keys[Math.floor(Math.random() * keys.length)];
        h.remove(picked);
        known.delete(picked);
        valuesById.delete(picked);
      } else {
        const id = String(seq++);
        h.push(id, v);
        known.add(id);
        valuesById.set(id, v);
      }
    }
    const out: number[] = [];
    while (h.size > 0) out.push(h.pop()!);
    assert.deepEqual(out, [...valuesById.values()].sort((a, b) => a - b));
  });
});
