/**
 * Pairing Heap - A robust priority queue implementation
 * Supports O(1) amortized insert, find-min, decrease-key
 * O(log n) amortized delete-min
 */
export declare class PairingHeap<T> {
    private root;
    private size_;
    private compare;
    constructor(compareFn: (a: T, b: T) => number);
    get size(): number;
    isEmpty(): boolean;
    /**
     * Insert a value into the heap
     * Time complexity: O(1) amortized
     */
    insert(value: T): PairingNode<T>;
    /**
     * Find and return the minimum value
     * Time complexity: O(1)
     */
    findMin(): T | undefined;
    /**
     * Remove and return the minimum value
     * Time complexity: O(log n) amortized
     */
    deleteMin(): T | undefined;
    /**
     * Decrease the key of a node
     * Time complexity: O(1) amortized
     */
    decreaseKey(node: PairingNode<T>, newValue: T): void;
    /**
     * Merge two heaps
     * Time complexity: O(1)
     */
    merge(other: PairingHeap<T>): void;
    private meld;
    private mergePairs;
}
declare class PairingNode<T> {
    value: T;
    children: PairingNode<T>[];
    parent: PairingNode<T> | null;
    constructor(value: T);
}
/**
 * Priority queue wrapper for Task scheduling
 * Key is based on (priority, timestamp) - lower is higher priority
 */
export declare class TaskPriorityQueue {
    private heap;
    private taskNodeMap;
    constructor();
    get size(): number;
    isEmpty(): boolean;
    /**
     * Insert a task into the priority queue
     */
    insert(taskId: string, priority: number, timestamp: number): PairingNode<TaskQueueEntry>;
    /**
     * Remove and return the highest priority task
     */
    extractMin(): TaskQueueEntry | undefined;
    /**
     * Update the priority of a task
     */
    decreaseKey(taskId: string, newPriority: number, newTimestamp: number): boolean;
    /**
     * Remove a specific task from the queue
     */
    remove(taskId: string): boolean;
    /**
     * Get all task IDs in the queue
     */
    getTaskIds(): string[];
}
export interface TaskQueueEntry {
    taskId: string;
    priority: number;
    timestamp: number;
}
export {};
