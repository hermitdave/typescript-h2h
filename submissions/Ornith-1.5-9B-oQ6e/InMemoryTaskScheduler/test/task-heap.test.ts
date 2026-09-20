import { describe, it, expect, beforeEach } from 'vitest';
import { TaskHeap, taskCmp } from './task-heap';

describe('TaskHeap ordering', () => {
  it('pops the smallest entry by (due, priority, seq)', () => {
    const heap = new TaskHeap();
    // Insert out of order; expected pop order is min-first.
    heap.push('late', 300, 0, 3);
    heap.push('early', 100, 0, 1);
    heap.push('mid', 200, 0, 2);
    expect(heap.peek()).toBe('early');
    expect(heap.pop()).toBe('early');
    expect(heap.peek()).toBe('mid');
    expect(heap.pop()).toBe('mid');
    expect(heap.peek()).toBe('late');
    expect(heap.pop()).toBe('late');
    expect(heap.pop()).toBeUndefined();
  });

  it('breaks due-time ties by lower priority number first', () => {
    const heap = new TaskHeap();
    heap.push('low-priority', 200, 5, 1);
    heap.push('high-priority', 200, 1, 2);
    heap.push('neutral', 200, 0, 3);
    expect(heap.pop()).toBe('neutral');
    expect(heap.pop()).toBe('high-priority');
    expect(heap.pop()).toBe('low-priority');
  });

  it('breaks due+priority ties by seq (insertion order)', () => {
    const heap = new TaskHeap();
    heap.push('first', 100, 0, 1);
    heap.push('second', 100, 0, 2);
    heap.push('third', 100, 0, 3);
    expect(heap.keys().sort()).toEqual(['first', 'second', 'third']);
    expect(heap.pop()).toBe('first');
    expect(heap.pop()).toBe('second');
    expect(heap.pop()).toBe('third');
  });

  it('throws on duplicate push', () => {
    const heap = new TaskHeap();
    heap.push('a', 1, 0, 1);
    expect(() => heap.push('a', 2, 0, 2)).toThrow(/duplicate/);
  });

  it('supports arbitrary delete then reorder via heapify', () => {
    const heap = new TaskHeap();
    for (let i = 0; i < 20; i++) heap.push(`t${i}`, 100 + i, i % 2, i);
    heap.delete('t19'); // remove the max, then siftUp the tail element
    expect(heap.pop()).toBe('t18');
    expect(heap.size).toBe(19);
    expect([...heap.keys()].length).toBe(19);
  });

  it('delete of a non-present id returns false and leaves heap intact', () => {
    const heap = new TaskHeap();
    heap.push('a', 1, 0, 1);
    heap.push('b', 1, 0, 2);
    expect(heap.delete('missing')).toBe(false);
    expect(heap.keys().sort()).toEqual(['a', 'b']);
  });

  it('handles empty heap gracefully', () => {
    const heap = new TaskHeap();
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
    expect(heap.delete('x')).toBe(false);
    expect(heap.has('x')).toBe(false);
    expect(heap.size).toBe(0);
    expect(heap.keys()).toEqual([]);
  });

  it('clear() empties the heap and position index', () => {
    const heap = new TaskHeap();
    heap.push('a', 1, 0, 1);
    heap.push('b', 2, 0, 2);
    heap.clear();
    expect(heap.size).toBe(0);
    expect(heap.has('a')).toBe(false);
    expect(heap.peek()).toBeUndefined();
  });

  it('stays a valid heap after many random deletions', () => {
    // Stress the arbitrary-delete + heapify path with shuffled removals.
    const heap = new TaskHeap();
    const ids = Array.from({ length: 500 }, (_, i) => `n${i}`);
    for (const id of ids) {
      const due = Number(Math.random() * 1000);
      const prio = Math.floor(Math.random() * 1000);
      const seq = ids.indexOf(id);
      heap.push(id, due, prio, seq);
    }
    // Collect into a shuffled order.
    const order = ids.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const id of order) {
      expect(heap.delete(id)).toBe(true);
    }
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
  });
});

describe('taskCmp', () => {
  it('orders by dueTime first', () => {
    expect(taskCmp({ due: 1, prio: 0, seq: 0, id: 'a' }, { due: 2, prio: 0, seq: 0, id: 'b' })).toBeLessThan(0);
    expect(taskCmp({ due: 2, prio: 0, seq: 0, id: 'b' }, { due: 1, prio: 0, seq: 0, id: 'a' })).toBeGreaterThan(0);
  });

  it('orders by priority when dueTime is equal', () => {
    const a: any = { due: 5, prio: 9, seq: 0, id: 'a' };
    const b: any = { due: 5, prio: 2, seq: 0, id: 'b' };
    expect(taskCmp(a, b)).toBeGreaterThan(0);
  });

  it('orders by seq when due and priority are equal', () => {
    const a: any = { due: 5, prio: 2, seq: 3, id: 'a' };
    const b: any = { due: 5, prio: 2, seq: 1, id: 'b' };
    expect(taskCmp(a, b)).toBeGreaterThan(0);
    expect(taskCmp(b, a)).toBeLessThan(0);
  });
});
