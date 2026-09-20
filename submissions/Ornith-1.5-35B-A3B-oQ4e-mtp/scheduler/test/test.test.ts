import { describe, it, test, assert } from 'node:test';
import assertNode from 'node:assert/strict';

import { TaskScheduler } from '../src/index.js';
import type { NewTask } from '../src/index.js';

// A deterministic clock so tests don't depend on wall time.
function makeClock(start = 0) {
  let t = start;
  return {
    clock: () => t,
    advance(ms: number) { t += ms; },
    set(ms: number) { t = ms; },
  };
}

describe('createTask and runNext ordering', () => {
  test('prioritises higher priority first (high-first default)', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'low', priority: 1 });
    s.createTask({ id: 'high', priority: 10 });
    s.createTask({ id: 'mid', priority: 5 });
    assertNode.equal(s.runNext(c.clock())?.id, 'high');
    assertNode.equal(s.runNext(c.clock())?.id, 'mid');
    assertNode.equal(s.runNext(c.clock())?.id, 'low');
    assertNode.equal(s.runNext(c.clock()), null);
  });

  test('empty scheduler returns null from runNext', () => {
    const s = new TaskScheduler();
    assertNode.equal(s.runNext(), null);
  });

  test('denies duplicate ids with SchedulerError', () => {
    const s = new TaskScheduler();
    s.createTask({ id: 'a' });
    assertNode.throws(() => s.createTask({ id: 'a' }));
  });
});

describe('time-gating and future promotion', () => {
  test('does not run a task before its due time', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'future', dueAt: 100 });
    assertNode.equal(s.runNext(c.clock()), null);
    c.advance(100);
    const t = s.runNext(c.clock());
    assertNode.equal(t?.id, 'future');
  });

  test('peek does not mutate state', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'x', priority: 5 });
    assertNode.equal(s.peek(c.clock())?.id, 'x');
    // still pending after peek
    s.createTask({ id: 'y', priority: 3 });
    assertNode.equal(s.peek(c.clock())?.id, 'x');
    assertNode.equal(s.status('x'), 'pending');
  });

  test('advance drains all runnable tasks and honours time gates', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    // At t=0 all three are runnable; a single advance runs them in priority
    // order (3, 2, 1), completing each so dependents cascade.
    s.createTask({ id: 't1', priority: 1 });
    s.createTask({ id: 't2', priority: 2 });
    s.createTask({ id: 't3', priority: 3 });
    const first = s.advance(c.clock());
    assertNode.deepEqual(first.executed.map(t => t.id), ['t3', 't2', 't1']);
    assertNode.equal(first.pending, 0);
    // Nothing left to run: advance returns an empty batch.
    assertNode.equal(s.advance(c.clock()).executed.length, 0);

    // A second scheduler exercises time-gating across advance calls: only the
    // due task runs in each batch; future-gated ones stay parked.
    const s2 = new TaskScheduler({ clock: c.clock });
    s2.createTask({ id: 'a' });
    s2.createTask({ id: 'b', dueAt: 50 });
    s2.createTask({ id: 'c', dueAt: 100 });
    assertNode.deepEqual(s2.advance(0).executed.map(t => t.id), ['a']);
    c.advance(50);
    assertNode.deepEqual(s2.advance(50).executed.map(t => t.id), ['b']);
    c.set(200);
    assertNode.deepEqual(s2.advance(200).executed.map(t => t.id), ['c']);
    assertNode.equal(s2.advance(200).executed.length, 0);
  });
});

describe('dependency cascade', () => {
  test('dependent runs only after its dependency completes', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'dep' });
    s.createTask({ id: 'child', dependencies: ['dep'] });

    // child is blocked by dep
    assertNode.equal(s.remainingDeps('child'), 1);
    assertNode.equal(s.runNext(c.clock())?.id, 'dep');
    // after running dep it's not yet completed; child still blocked
    assertNode.equal(s.remainingDeps('child'), 1);

    s.completeTask('dep', c.clock());
    assertNode.equal(s.remainingDeps('child'), 0);
    assertNode.equal(s.runNext(c.clock())?.id, 'child');
  });

  test('chain of three resolves in order', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'a' });
    s.createTask({ id: 'b', dependencies: ['a'] });
    s.createTask({ id: 'c', dependencies: ['b'] });
    // Fine-grained stepping: advance() would run the whole chain in one batch,
    // so we use runNext + completeTask to drive one task at a time.
    assertNode.equal(s.runNext(c.clock())?.id, 'a');
    s.completeTask('a', c.clock());
    assertNode.equal(s.runNext(c.clock())?.id, 'b');
    s.completeTask('b', c.clock());
    assertNode.equal(s.runNext(c.clock())?.id, 'c');
  });

  test('partial deps release only after all satisfied', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'p' });
    s.createTask({ id: 'q' });
    s.createTask({ id: 'both', dependencies: ['p', 'q'] });
    assertNode.equal(s.remainingDeps('both'), 2);
    // Step one dependency at a time with runNext + completeTask.
    s.runNext(c.clock());                 // runs p
    s.completeTask('p', c.clock());
    assertNode.equal(s.remainingDeps('both'), 1);
    assertNode.equal(s.runNext(c.clock())?.id, 'q'); // q runnable
    s.completeTask('q', c.clock());
    assertNode.equal(s.remainingDeps('both'), 0);
    assertNode.equal(s.runNext(c.clock())?.id, 'both');
  });
});

describe('dynamic updates', () => {
  test('update changes priority ordering', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'first', priority: 10 });
    s.createTask({ id: 'second', priority: 5 });
    assertNode.equal(s.runNext(c.clock())?.id, 'first');
    // re-add and bump second after first consumed
    s.createTask({ id: 'first2', priority: 1 });
    assertNode.equal(s.runNext(c.clock())?.id, 'first2');
    s.createTask({ id: 'third', priority: 3 });
    const updated = s.update('third', { priority: 100 }, c.clock());
    assertNode.equal(updated.priority, 100);
    assertNode.equal(s.runNext(c.clock())?.id, 'third');
  });

  test('reschedule moves task back to future queue', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'x', dueAt: 0 });
    s.createTask({ id: 'y' });
    s.runNext(c.clock()); // consume x
    assertNode.equal(s.reschedule('x', 500, c.clock()).dueAt, 500);
    // x is pending again but not due; y should run first
    assertNode.equal(s.runNext(c.clock())?.id, 'y');
    c.set(500);
    assertNode.equal(s.runNext(c.clock())?.id, 'x');
  });

  test('update throws on unknown id', () => {
    const s = new TaskScheduler();
    assertNode.throws(() => s.update('nope', { priority: 1 }), /does not exist/);
  });
});

describe('removal', () => {
  test('remove cleans up a task and its edges', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'a' });
    s.createTask({ id: 'b', dependencies: ['a'] });
    assertNode.equal(s.remove('a')?.id, 'a');
    assertNode.equal(s.status('a'), undefined);
    assertNode.equal(s.has('a'), false);
    // b now has no remaining dep; a's edge was removed
    assertNode.equal(s.remainingDeps('b'), 0);
    assertNode.equal(s.runNext(c.clock())?.id, 'b');
  });

  test('remove returns null for unknown id', () => {
    const s = new TaskScheduler();
    assertNode.equal(s.remove('missing'), null);
  });
});

describe('cycle detection', () => {
  test('detects a 2-node cycle', () => {
    const s = new TaskScheduler();
    s.createTask({ id: 'a', dependencies: ['b'] });
    s.createTask({ id: 'b', dependencies: ['a'] });
    const r = s.analyze();
    assertNode.equal(r.hasCycle, true);
    const together = [...r.stuckByCycle].sort();
    assertNode.deepEqual(together, ['a', 'b']);
  });

  test('reports orphans (missing dependency)', () => {
    const s = new TaskScheduler();
    s.createTask({ id: 'orphan', dependencies: ['nonexistent'] });
    const r = s.analyze();
    assertNode.deepEqual(r.orphanBlocked, ['orphan']);
  });

  test('reports self-loop as cycle', () => {
    const s = new TaskScheduler();
    s.createTask({ id: 'loop', dependencies: ['loop'] });
    const r = s.analyze();
    assertNode.equal(r.hasCycle, true);
    assertNode.equal(r.stuckByCycle.includes('loop'), true);
  });

  test('non-cyclic deps report no cycle', () => {
    const s = new TaskScheduler();
    s.createTask({ id: 'a' });
    s.createTask({ id: 'b', dependencies: ['a'] });
    const r = s.analyze();
    assertNode.equal(r.hasCycle, false);
    assertNode.deepEqual(r.stuckByCycle, []);
    assertNode.deepEqual(r.orphanBlocked, []);
  });
});

describe('cancellation', () => {
  test('cancel leaves dependents blocked and orphaned', () => {
    const s = new TaskScheduler();
    s.createTask({ id: 'a' });
    s.createTask({ id: 'b', dependencies: ['a'] });
    assertNode.equal(s.cancelTask('a')?.id, 'a');
    assertNode.equal(s.status('a'), 'cancelled');
    assertNode.equal(s.remainingDeps('b'), 1);
    // b is orphaned
    const r = s.analyze();
    assertNode.deepEqual(r.orphanBlocked, ['b']);
  });

  test('completed task cannot be completed twice', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'a' });
    assertNode.equal(s.completeTask('a', c.clock())?.id, 'a');
    assertNode.equal(s.completeTask('a', c.clock()), null);
  });
});

describe('batch creation and forward references', () => {
  test('createTasks resolves forward references and preserves order', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    const created = s.createTasks([
      { id: 'c', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] },
      { id: 'a' },
    ], c.clock());
    assertNode.equal(created.length, 3);
    assertNode.equal(created[0].id, 'c'); // order preserved
    assertNode.equal(created[2].id, 'a');
    // running resolves chain
    s.advance(c.clock()); // a
    s.advance(c.clock()); // b
    s.advance(c.clock()); // c
    assertNode.equal(s.runNext(c.clock()), null);
    assertNode.equal(s.status('c'), 'completed');
  });

  test('createTasks rejects duplicates', () => {
    const s = new TaskScheduler();
    assertNode.throws(() => s.createTasks([
      { id: 'a' }, { id: 'a' },
    ]));
  });
});

describe('waitForNext report', () => {
  test('buckets tasks by blocking reason', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    s.createTask({ id: 'runnable' });
    s.createTask({ id: 'blocked', dependencies: ['runnable'] });
    const info = s.waitForNext(c.clock());
    assertNode.equal(info.runnable, 1);
    assertNode.equal(info.tasks.runnable.length, 1);
    assertNode.equal(info.tasks.blockedByDeps.length, 1);
    assertNode.equal(info.tasks.blockedByDeps[0].id, 'blocked');
  });
});

describe('low-first priority order', () => {
  test('runs lowest priority first when configured', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock, priorityOrder: 'low-first' });
    s.createTask({ id: 'low', priority: 1 });
    s.createTask({ id: 'high', priority: 100 });
    assertNode.equal(s.runNext(c.clock())?.id, 'low');
    assertNode.equal(s.runNext(c.clock())?.id, 'high');
  });
});

describe('scalability (1M tasks)', () => {
  test('creates and prioritises 1,000,000 tasks', () => {
    const c = makeClock(0);
    const s = new TaskScheduler({ clock: c.clock });
    const n = 1_000_000;
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      s.createTask({ id: `t${i}`, priority: i % 1000 });
    }
    const createMs = Date.now() - t0;
    assertNode.equal(s.count, n);
    const t1 = Date.now();
    // run the top few
    let first: string | null = null;
    let guard = 0;
    while (guard < 3) {
      const x = s.runNext(c.clock());
      if (!x) break;
      s.completeTask(x.id, c.clock());
      first ??= x.id;
      guard++;
    }
    const runMs = Date.now() - t1;
    assertNode.ok(createMs < 5000, `creation took ${createMs}ms (should be < 5s)`);
    assertNode.ok(runMs < 5000, `top-k run took ${runMs}ms (should be < 5s)`);
    assertNode.ok(first != null);
  });
});
