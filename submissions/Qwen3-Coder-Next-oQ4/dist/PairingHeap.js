"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskPriorityQueue = exports.PairingHeap = void 0;
/**
 * Pairing Heap - A robust priority queue implementation
 * Supports O(1) amortized insert, find-min, decrease-key
 * O(log n) amortized delete-min
 */
class PairingHeap {
    constructor(compareFn) {
        this.root = null;
        this.size_ = 0;
        this.compare = compareFn;
    }
    get size() {
        return this.size_;
    }
    isEmpty() {
        return this.root === null;
    }
    /**
     * Insert a value into the heap
     * Time complexity: O(1) amortized
     */
    insert(value) {
        const node = new PairingNode(value);
        if (this.root === null) {
            this.root = node;
        }
        else {
            this.root = this.meld(this.root, node);
        }
        this.size_++;
        return node;
    }
    /**
     * Find and return the minimum value
     * Time complexity: O(1)
     */
    findMin() {
        return this.root?.value;
    }
    /**
     * Remove and return the minimum value
     * Time complexity: O(log n) amortized
     */
    deleteMin() {
        if (this.root === null) {
            return undefined;
        }
        const min = this.root.value;
        if (this.root.children.length > 0) {
            this.root = this.mergePairs(this.root.children);
        }
        else {
            this.root = null;
        }
        this.size_--;
        return min;
    }
    /**
     * Decrease the key of a node
     * Time complexity: O(1) amortized
     */
    decreaseKey(node, newValue) {
        node.value = newValue;
        if (this.root !== node && this.compare(node.value, node.parent.value) < 0) {
            // Detach node from parent
            const index = node.parent.children.indexOf(node);
            if (index > -1) {
                node.parent.children.splice(index, 1);
            }
            // Meld with root
            if (this.root !== null) {
                this.root = this.meld(this.root, node);
            }
            else {
                this.root = node;
            }
            node.parent = null;
        }
    }
    /**
     * Merge two heaps
     * Time complexity: O(1)
     */
    merge(other) {
        if (other.root === null)
            return;
        if (this.root === null) {
            this.root = other.root;
            this.size_ = other.size_;
        }
        else {
            this.root = this.meld(this.root, other.root);
            this.size_ += other.size_;
        }
    }
    meld(a, b) {
        if (this.compare(a.value, b.value) <= 0) {
            b.parent = a;
            a.children.push(b);
            return a;
        }
        else {
            a.parent = b;
            b.children.push(a);
            return b;
        }
    }
    mergePairs(nodes) {
        if (nodes.length === 0)
            return null;
        if (nodes.length === 1)
            return nodes[0];
        // Merge pairs sequentially
        const merged = [];
        for (let i = 0; i < nodes.length; i += 2) {
            if (i + 1 < nodes.length) {
                merged.push(this.meld(nodes[i], nodes[i + 1]));
            }
            else {
                merged.push(nodes[i]);
            }
        }
        return this.mergePairs(merged);
    }
}
exports.PairingHeap = PairingHeap;
class PairingNode {
    constructor(value) {
        this.children = [];
        this.parent = null;
        this.value = value;
    }
}
/**
 * Priority queue wrapper for Task scheduling
 * Key is based on (priority, timestamp) - lower is higher priority
 */
class TaskPriorityQueue {
    constructor() {
        this.taskNodeMap = new Map();
        this.heap = new PairingHeap((a, b) => {
            // Compare by priority first (higher number = higher priority), then by timestamp
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return a.timestamp - b.timestamp;
        });
    }
    get size() {
        return this.heap.size;
    }
    isEmpty() {
        return this.heap.isEmpty();
    }
    /**
     * Insert a task into the priority queue
     */
    insert(taskId, priority, timestamp) {
        const node = this.heap.insert({ taskId, priority, timestamp });
        this.taskNodeMap.set(taskId, node);
        return node;
    }
    /**
     * Remove and return the highest priority task
     */
    extractMin() {
        const entry = this.heap.deleteMin();
        if (entry) {
            this.taskNodeMap.delete(entry.taskId);
        }
        return entry;
    }
    /**
     * Update the priority of a task
     */
    decreaseKey(taskId, newPriority, newTimestamp) {
        const node = this.taskNodeMap.get(taskId);
        if (!node)
            return false;
        node.value = { taskId, priority: newPriority, timestamp: newTimestamp };
        this.heap.decreaseKey(node, node.value);
        return true;
    }
    /**
     * Remove a specific task from the queue
     */
    remove(taskId) {
        const node = this.taskNodeMap.get(taskId);
        if (!node)
            return false;
        // Note: This is a simplified removal that doesn't maintain heap property
        // For production, would need to track parent pointers or rebuild
        this.taskNodeMap.delete(taskId);
        return true;
    }
    /**
     * Get all task IDs in the queue
     */
    getTaskIds() {
        // This requires traversing the heap structure
        // For now, just return keys from the map
        return Array.from(this.taskNodeMap.keys());
    }
}
exports.TaskPriorityQueue = TaskPriorityQueue;
