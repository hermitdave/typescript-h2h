import { TaskScheduler } from '../src/scheduler';

describe('TaskScheduler: 1M scalability', () => {
  test('1M tasks: add then drain completes within time budget', () => {
    const s = new TaskScheduler(0);
    const N = 1_000_000;
    const start = Date.now();
    for (let i = 0; i < N; i++) {
      s.addTask({ id: `t${i}`, priority: i % 100, scheduledAt: 0 });
    }
    const addMs = Date.now() - start;

    let dequeued = 0;
    let task: ReturnType<typeof s.dequeueNextExecutable>;
    const drainStart = Date.now();
    while ((task = s.dequeueNextExecutable()) !== null) {
      s.completeTask(task.id);
      dequeued++;
    }
    const drainMs = Date.now() - drainStart;

    expect(dequeued).toBe(N);
    expect(addMs).toBeLessThan(120_000);
    expect(drainMs).toBeLessThan(120_000);
  }, 180_000); // 3-minute timeout for the 1M loop
});