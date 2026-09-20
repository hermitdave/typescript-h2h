"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const scheduler_1 = require("../src/scheduler");
describe('TaskScheduler: 1M scalability', () => {
    test('1M tasks: add then drain completes within time budget', () => {
        const s = new scheduler_1.TaskScheduler(0);
        const N = 1000000;
        const start = Date.now();
        for (let i = 0; i < N; i++) {
            s.addTask({ id: `t${i}`, priority: i % 100, scheduledAt: 0 });
        }
        const addMs = Date.now() - start;
        let dequeued = 0;
        let task;
        const drainStart = Date.now();
        while ((task = s.dequeueNextExecutable()) !== null) {
            s.completeTask(task.id);
            dequeued++;
        }
        const drainMs = Date.now() - drainStart;
        expect(dequeued).toBe(N);
        expect(addMs).toBeLessThan(120000);
        expect(drainMs).toBeLessThan(120000);
    }, 180000); // 3-minute timeout for the 1M loop
});
//# sourceMappingURL=stress.test.js.map