import { DependencyGraph } from '../src/DependencyGraph';

describe('DependencyGraph', () => {
    let graph: DependencyGraph;

    beforeEach(() => {
        graph = new DependencyGraph();
    });

    describe('addTask', () => {
        test('should add a task', () => {
            graph.addTask('task-1');
            expect(graph.getTaskCount()).toBe(1);
            expect(graph.getInDegree('task-1')).toBe(0);
        });

        test('should be idempotent', () => {
            graph.addTask('task-1');
            graph.addTask('task-1');
            expect(graph.getTaskCount()).toBe(1);
        });
    });

    describe('addDependency', () => {
        test('should add a dependency', () => {
            graph.addTask('task-1');
            graph.addTask('task-2');
            graph.addDependency('task-1', 'task-2');

            expect(graph.getDependencies('task-1')).toEqual(new Set(['task-2']));
            expect(graph.getInDegree('task-1')).toBe(1);
        });

        test('should throw on self-dependency', () => {
            expect(() => {
                graph.addDependency('task-1', 'task-1');
            }).toThrow('Self-dependency is not allowed');
        });

        test('should be transitive', () => {
            graph.addDependency('task-1', 'task-2');
            graph.addDependency('task-2', 'task-3');

            expect(graph.getDependencies('task-1')).toEqual(new Set(['task-2']));
            expect(graph.getDependencies('task-2')).toEqual(new Set(['task-3']));
        });
    });

    describe('removeDependency', () => {
        test('should remove a dependency', () => {
            graph.addDependency('task-1', 'task-2');
            graph.removeDependency('task-1', 'task-2');

            expect(graph.getDependencies('task-1')).toEqual(new Set());
            expect(graph.getInDegree('task-1')).toBe(0);
        });
    });

    describe('isReady', () => {
        test('should return true for tasks with no dependencies', () => {
            graph.addTask('task-1');
            expect(graph.isReady('task-1')).toBe(true);
        });

        test('should return false for tasks with unsatisfied dependencies', () => {
            graph.addDependency('task-1', 'task-2');
            expect(graph.isReady('task-1')).toBe(false);
        });
    });

    describe('cycle detection', () => {
        test('should not detect cycle for linear dependency', () => {
            graph.addDependency('task-1', 'task-2');
            graph.addDependency('task-2', 'task-3');

            expect(graph.hasCycles()).toBe(false);
            expect(graph.detectCycles()).toBeNull();
        });

        test('should detect self-dependency cycle', () => {
            expect(() => {
                graph.addDependency('task-1', 'task-1');
            }).toThrow('Self-dependency is not allowed');
        });

        test('should detect A->B->A cycle', () => {
            graph.addDependency('task-1', 'task-2');

            // Try to add reverse dependency
            expect(graph.wouldCreateCycle('task-2', 'task-1')).toBe(true);

            // Actually adding it should throw
            expect(() => {
                graph.addDependency('task-2', 'task-1');
            }).toThrow();
        });

        test('should detect longer cycle A->B->C->A', () => {
            graph.addDependency('task-1', 'task-2');
            graph.addDependency('task-2', 'task-3');

            expect(graph.wouldCreateCycle('task-3', 'task-1')).toBe(true);
        });
    });

    describe('getStats', () => {
        test('should return correct stats', () => {
            graph.addDependency('task-1', 'task-2');
            graph.addDependency('task-2', 'task-3');

            const stats = graph.getStats();
            expect(stats.taskCount).toBe(3);
            expect(stats.edgeCount).toBe(2);
            expect(stats.tasksWithDependencies).toBe(2);
        });
    });
});
