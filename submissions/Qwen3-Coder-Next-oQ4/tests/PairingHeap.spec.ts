import { PairingHeap, TaskPriorityQueue } from '../src/PairingHeap';

describe('PairingHeap', () => {
    let heap: PairingHeap<number>;

    beforeEach(() => {
        heap = new PairingHeap<number>((a, b) => a - b);
    });

    test('should be empty when created', () => {
        expect(heap.isEmpty()).toBe(true);
        expect(heap.size).toBe(0);
    });

    test('should insert a single element', () => {
        heap.insert(5);
        expect(heap.size).toBe(1);
        expect(heap.findMin()).toBe(5);
    });

    test('should insert multiple elements and maintain min property', () => {
        heap.insert(5);
        heap.insert(3);
        heap.insert(7);
        heap.insert(1);
        heap.insert(9);

        expect(heap.size).toBe(5);
        expect(heap.findMin()).toBe(1);
    });

    test('should delete minimum correctly', () => {
        heap.insert(5);
        heap.insert(3);
        heap.insert(7);
        heap.insert(1);

        expect(heap.deleteMin()).toBe(1);
        expect(heap.deleteMin()).toBe(3);
        expect(heap.deleteMin()).toBe(5);
        expect(heap.deleteMin()).toBe(7);
        expect(heap.deleteMin()).toBeUndefined();
    });

    test('should handle duplicates', () => {
        heap.insert(5);
        heap.insert(5);
        heap.insert(5);

        expect(heap.deleteMin()).toBe(5);
        expect(heap.deleteMin()).toBe(5);
        expect(heap.deleteMin()).toBe(5);
    });

    test('should maintain order after multiple insertions and deletions', () => {
        for (let i = 10; i > 0; i--) {
            heap.insert(i);
        }

        for (let i = 1; i <= 10; i++) {
            expect(heap.deleteMin()).toBe(i);
        }
    });
});

describe('TaskPriorityQueue', () => {
    let queue: TaskPriorityQueue;

    beforeEach(() => {
        queue = new TaskPriorityQueue();
    });

    test('should insert tasks by priority and timestamp', () => {
        queue.insert('task-1', 50, Date.now() + 1000);
        queue.insert('task-2', 100, Date.now() + 500);
        queue.insert('task-3', 50, Date.now() + 500);

        const first = queue.extractMin();
        expect(first?.taskId).toBe('task-2');

        const second = queue.extractMin();
        expect(second?.taskId).toBe('task-3');

        const third = queue.extractMin();
        expect(third?.taskId).toBe('task-1');
    });

    test('should handle empty queue', () => {
        expect(queue.extractMin()).toBeUndefined();
    });
});
