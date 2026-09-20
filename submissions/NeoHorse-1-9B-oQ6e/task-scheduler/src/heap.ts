/**
 * Binary Min-Heap for TaskScheduler.
 * Stores tasks keyed by (scheduledTime, -priority).
 * O(log N) push, pop, delete, peek.
 */

import { Task } from './types';

export class BinaryMinHeap {
  private heap: number[] = [];  // stores indices into tasks map
  private tasks: Map<number, Task> = new Map();  // index -> task
  private taskIndices: Map<string, number> = new Map();  // taskId -> heap index

  push(task: Task): void {
    const idx = this.tasks.size;
    this.tasks.set(idx, task);
    this.taskIndices.set(task.id, idx);
    this.heap.push(idx);
    this.bubbleUp(idx);
  }

  pop(): Task | undefined {
    if (this.heap.length === 0) return undefined;
    const result = this.tasks.get(this.heap[0]);
    const lastIdx = this.heap.length - 1;
    if (lastIdx === 0) {
      this.heap.pop();
      return result;
    }
    const last = this.heap[lastIdx];
    this.heap[0] = last;
    this.taskIndices.set(this.tasks.get(last)!.id, 0);
    this.bubbleDown(0);
    this.heap.pop();
    this.tasks.delete(last);
    this.taskIndices.delete(this.tasks.get(last)!.id);
    return result;
  }

  peek(): Task | undefined {
    if (this.heap.length === 0) return undefined;
    return this.tasks.get(this.heap[0]);
  }

  delete(taskId: string): void {
    const idx = this.taskIndices.get(taskId);
    if (idx === undefined) return;
    const lastIdx = this.heap.length - 1;
    if (lastIdx === 0) {
      this.heap.pop();
      this.tasks.delete(taskId);
      return;
    }
    const last = this.heap[lastIdx];
    this.heap[idx] = last;
    this.taskIndices.set(this.tasks.get(last)!.id, idx);
    this.bubbleDown(idx);
    this.heap.pop();
    this.tasks.delete(taskId);
    this.taskIndices.delete(last.toString());
  }

  size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = ((idx - 1) >> 1) | 0;
      const taskA = this.tasks.get(this.heap[idx])!;
      const taskB = this.tasks.get(this.heap[parent])!;
      if (this.compare(taskA, taskB) <= 0) break;
      const temp = this.heap[parent];
      this.heap[parent] = this.heap[idx];
      this.heap[idx] = temp;
      this.taskIndices.set(taskA.id, parent);
      this.taskIndices.set(taskB.id, idx);
      idx = parent;
    }
  }

  private bubbleDown(idx: number): void {
    const len = this.heap.length;
    while (true) {
      const left = (idx << 1) + 1;
      const right = left + 1;
      let smallest = idx;
      const taskA = this.tasks.get(this.heap[smallest]);
      const taskLeft = left < len ? this.tasks.get(this.heap[left]) : null;
      const taskRight = right < len ? this.tasks.get(this.heap[right]) : null;

      if (taskLeft && this.compare(taskLeft!, taskA!) < 0) {
        smallest = left;
      }
      if (taskRight && this.compare(taskRight!, this.tasks.get(this.heap[smallest])!) < 0) {
        smallest = right;
      }

      if (smallest === idx) break;

      const temp = this.heap[idx];
      this.heap[idx] = this.heap[smallest];
      this.heap[smallest] = temp;
      this.taskIndices.set(this.tasks.get(this.heap[idx])!.id, idx);
      this.taskIndices.set(this.tasks.get(this.heap[smallest])!.id, smallest);
      idx = smallest;
    }
  }

  private compare(a: Task, b: Task): number {
    if (a.scheduledTime !== b.scheduledTime) {
      return a.scheduledTime < b.scheduledTime ? -1 : 1;
    }
    return a.priority > b.priority ? -1 : a.priority < b.priority ? 1 : 0;
  }
}