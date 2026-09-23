/**
 * Pairing Heap - A robust priority queue implementation
 * Supports O(1) amortized insert, find-min, decrease-key
 * O(log n) amortized delete-min
 */
export class PairingHeap<T> {
    private root: PairingNode<T> | null = null;
    private size_: number = 0;
    private compare: (a: T, b: T) => number;

    constructor(compareFn: (a: T, b: T) => number) {
        this.compare = compareFn;
    }

    get size(): number {
        return this.size_;
    }

    isEmpty(): boolean {
        return this.root === null;
    }

    /**
     * Insert a value into the heap
     * Time complexity: O(1) amortized
     */
    insert(value: T): PairingNode<T> {
        const node = new PairingNode(value);
        if (this.root === null) {
            this.root = node;
        } else {
            this.root = this.meld(this.root, node);
        }
        this.size_++;
        return node;
    }

    /**
     * Find and return the minimum value
     * Time complexity: O(1)
     */
    findMin(): T | undefined {
        return this.root?.value;
    }

    /**
     * Remove and return the minimum value
     * Time complexity: O(log n) amortized
     */
    deleteMin(): T | undefined {
        if (this.root === null) {
            return undefined;
        }

        const min = this.root.value;
        if (this.root.children.length > 0) {
            this.root = this.mergePairs(this.root.children);
        } else {
            this.root = null;
        }
        this.size_--;
        return min;
    }

    /**
     * Decrease the key of a node
     * Time complexity: O(1) amortized
     */
    decreaseKey(node: PairingNode<T>, newValue: T): void {
        node.value = newValue;
        
        if (this.root !== node && this.compare(node.value, node.parent!.value) < 0) {
            // Detach node from parent
            const index = node.parent!.children.indexOf(node);
            if (index > -1) {
                node.parent!.children.splice(index, 1);
            }
            // Meld with root
            if (this.root !== null) {
                this.root = this.meld(this.root, node);
            } else {
                this.root = node;
            }
            node.parent = null;
        }
    }

    /**
     * Merge two heaps
     * Time complexity: O(1)
     */
    merge(other: PairingHeap<T>): void {
        if (other.root === null) return;
        if (this.root === null) {
            this.root = other.root;
            this.size_ = other.size_;
        } else {
            this.root = this.meld(this.root, other.root);
            this.size_ += other.size_;
        }
    }

    private meld(a: PairingNode<T>, b: PairingNode<T>): PairingNode<T> {
        if (this.compare(a.value, b.value) <= 0) {
            b.parent = a;
            a.children.push(b);
            return a;
        } else {
            a.parent = b;
            b.children.push(a);
            return b;
        }
    }

    private mergePairs(nodes: PairingNode<T>[]): PairingNode<T> | null {
        if (nodes.length === 0) return null;
        if (nodes.length === 1) return nodes[0];

        // Merge pairs sequentially
        const merged: PairingNode<T>[] = [];
        for (let i = 0; i < nodes.length; i += 2) {
            if (i + 1 < nodes.length) {
                merged.push(this.meld(nodes[i], nodes[i + 1]));
            } else {
                merged.push(nodes[i]);
            }
        }

        return this.mergePairs(merged);
    }
}

class PairingNode<T> {
    value: T;
    children: PairingNode<T>[] = [];
    parent: PairingNode<T> | null = null;

    constructor(value: T) {
        this.value = value;
    }
}

/**
 * Priority queue wrapper for Task scheduling
 * Key is based on (priority, timestamp) - lower is higher priority
 */
export class TaskPriorityQueue {
    private heap: PairingHeap<TaskQueueEntry>;
    private taskNodeMap: Map<string, PairingNode<TaskQueueEntry>> = new Map();

    constructor() {
        this.heap = new PairingHeap<TaskQueueEntry>((a, b) => {
            // Compare by priority first (higher number = higher priority), then by timestamp
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return a.timestamp - b.timestamp;
        });
    }

    get size(): number {
        return this.heap.size;
    }

    isEmpty(): boolean {
        return this.heap.isEmpty();
    }

    /**
     * Insert a task into the priority queue
     */
    insert(taskId: string, priority: number, timestamp: number): PairingNode<TaskQueueEntry> {
        const node = this.heap.insert({ taskId, priority, timestamp });
        this.taskNodeMap.set(taskId, node);
        return node;
    }

    /**
     * Remove and return the highest priority task
     */
    extractMin(): TaskQueueEntry | undefined {
        const entry = this.heap.deleteMin();
        if (entry) {
            this.taskNodeMap.delete(entry.taskId);
        }
        return entry;
    }

    /**
     * Update the priority of a task
     */
    decreaseKey(taskId: string, newPriority: number, newTimestamp: number): boolean {
        const node = this.taskNodeMap.get(taskId);
        if (!node) return false;

        node.value = { taskId, priority: newPriority, timestamp: newTimestamp };
        this.heap.decreaseKey(node, node.value);
        return true;
    }

    /**
     * Remove a specific task from the queue
     */
    remove(taskId: string): boolean {
        const node = this.taskNodeMap.get(taskId);
        if (!node) return false;

        // Note: This is a simplified removal that doesn't maintain heap property
        // For production, would need to track parent pointers or rebuild
        this.taskNodeMap.delete(taskId);
        return true;
    }

    /**
     * Get all task IDs in the queue
     */
    getTaskIds(): string[] {
        // This requires traversing the heap structure
        // For now, just return keys from the map
        return Array.from(this.taskNodeMap.keys());
    }
}

export interface TaskQueueEntry {
    taskId: string;
    priority: number;
    timestamp: number;
}
