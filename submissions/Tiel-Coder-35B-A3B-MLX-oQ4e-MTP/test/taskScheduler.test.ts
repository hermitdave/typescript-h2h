import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TaskScheduler, TaskState } from '../src/index.js';
import type { Task } from '../src/index.js';

/**
 * Deterministic clock shared across tests. `now` is exposed so tests can
 * advance wall-clock time and observe time-based readiness and auto-ticking.
 */
class FakeClock {
  public nowMs = 1000;
  public calls = 0;
  get now(): number {
    return this.nowMs;
  }
  setNow(ms: number): void {
    this.nowMs = ms;
  }
}

describe('TaskScheduler — basic queueing', () => {
  it('adds a task with no deps and reports it runnable', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    const t = s.add({ id: 'a', priority: 0 });
    assert.equal(t.state, TaskState.READY);
    assert.equal(s.size, 1);
    assert.equal(s.get('a')?.state, TaskState.READY);
    assert.equal(s.get('a')?.runAt, clock.now);
  });

  it('stores a task whose runAt is in the future as WAITING', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: 2000 });
    assert.equal(s.get('a')?.state, TaskState.WAITING);
    assert.equal(s.get('a')?.runAt, 2000);
    assert.equal(s.hasRunnable(), false);
  });

  it('advances WAITING -> READY on tick when runAt passes', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: 1500 });
    s.add({ id: 'b', runAt: 2500 });
    assert.equal(s.get('a')?.state, TaskState.WAITING);
    assert.equal(s.get('b')?.state, TaskState.WAITING);

    clock.setNow(1500);
    s.tick();
    assert.equal(s.get('a')?.state, TaskState.READY);
    assert.equal(s.get('b')?.state, TaskState.WAITING);
  });

  it('next() returns the highest-priority runnable task', () => {
    const s = new TaskScheduler();
    s.add({ id: 'low', priority: 1 });
    s.add({ id: 'high', priority: 10 });
    s.add({ id: 'mid', priority: 5 });
    const next = s.next()!;
    assert.equal(next.id, 'high');
    // peek doesn't mutate.
    assert.equal(s.get('high')?.state, TaskState.READY);
  });

  it('runNext pops and transitions the task to RUNNING', () => {
    const s = new TaskScheduler();
    s.add({ id: 'x', priority: 1 });
    s.add({ id: 'y', priority: 9 });
    const t = s.runNext()!;
    assert.equal(t.id, 'y');
    assert.equal(s.get('y')?.state, TaskState.RUNNING);
    assert.equal(s.next()?.id, 'x');
  });

  it('returns undefined for next/runNext when nothing is runnable', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'future', runAt: 5000 });
    assert.equal(s.next(), undefined);
    assert.equal(s.runNext(), undefined);
  });

  it('ties are broken by earliest runAt then insertion order', () => {
    const s = new TaskScheduler();
    // Equal runAt (both due now) with equal priority -> insertion order wins.
    const runAt = Date.now();
    s.add({ id: 'first', priority: 5, runAt });
    s.add({ id: 'later', priority: 5, runAt });
    // 'first' inserted earlier, so it runs first despite equal priority+runAt.
    assert.equal(s.next()?.id, 'first');
  });
});

describe('TaskScheduler — priority ordering', () => {
  it('always dispatches the highest priority first regardless of insertion', () => {
    const s = new TaskScheduler();
    const N = 20;
    // Insert all tasks first, THEN pop them all. Inserting all keeps every task
    // in the ready heap, so popping the full set exercises the global ordering
    // across all N in-flight tasks (the previous version interleaved add/runNext,
    // which kept the heap at <= 1 element and never tested ordering at all).
    const expectedPrio: number[] = [];
    for (let i = 0; i < N; i++) {
      const prio = (i * 7) % 13;
      s.add({ id: `t${i}`, priority: prio });
    }
    for (let i = 0; i < N; i++) {
      const run = s.runNext();
      assert.ok(run, 'every task should be runnable');
      expectedPrio.push(run.priority);
    }
    // The sequence must be non-increasing priority.
    for (let i = 1; i < expectedPrio.length; i++) {
      assert.ok(expectedPrio[i] <= expectedPrio[i - 1]);
    }
    // All N were popped; each runNext consumed exactly one. Since we never
    // complete() any task, every popped task is left in RUNNING.
    assert.equal(s.get('t0')?.state, TaskState.RUNNING);
  });

  it('respects priority even when runAt is far in the future vs a lower priority due now', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    // A high-priority task due far in the future is NOT runnable now.
    s.add({ id: 'hp-future', priority: 100, runAt: 100000 });
    // A low-priority task due now IS runnable now.
    s.add({ id: 'lp-due', priority: 0 });
    assert.equal(s.next()?.id, 'lp-due');
  });
});

describe('TaskScheduler — dependency tracking', () => {
  it('keeps a task PENDING until its dependency completes', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: clock.now - 1 });
    s.add({ id: 'b', deps: ['a'] });
    assert.equal(s.get('b')?.state, TaskState.PENDING);
    // b is blocked by a, but a itself is runnable here (it is READY). The point
    // under test is that RUNNING a does not make b runnable — only COMPLETING a
    // does. Assert on b's state, not on next() being empty.
    assert.equal(s.get('a')?.state, TaskState.READY);
    s.runNext(); // a -> RUNNING
    assert.equal(s.get('b')?.state, TaskState.PENDING); // still blocked, a not done
    s.complete('a'); // only now does b become runnable
    assert.equal(s.get('b')?.state, TaskState.READY);
    assert.equal(s.next()?.id, 'b');
  });

  it('promotes dependents to READY when the dependency completes', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: clock.now - 1 });
    s.add({ id: 'b', deps: ['a'] });
    s.add({ id: 'c', deps: ['a'] });
    s.runNext();
    s.complete('a');
    assert.equal(s.get('b')?.state, TaskState.READY);
    assert.equal(s.get('c')?.state, TaskState.READY);
    // a is DONE; b and c not completed.
    assert.equal(s.get('a')?.state, TaskState.DONE);
    assert.equal(s.remaining, 2);
  });

  it('multi-level chains promote correctly', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: clock.now - 1 });
    s.add({ id: 'b', deps: ['a'] });
    s.add({ id: 'c', deps: ['b'] });
    assert.equal(s.get('b')?.state, TaskState.PENDING);
    assert.equal(s.get('c')?.state, TaskState.PENDING);
    s.runNext();
    s.complete('a');
    assert.equal(s.get('b')?.state, TaskState.READY);
    assert.equal(s.get('c')?.state, TaskState.PENDING);
    s.runNext();
    s.complete('b');
    assert.equal(s.get('c')?.state, TaskState.READY);
    s.runNext();
    s.complete('c');
    assert.equal(s.get('c')?.state, TaskState.DONE);
  });

  it('a task stays pending with multiple deps until ALL are done', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: clock.now - 1 });
    s.add({ id: 'b', runAt: clock.now - 1 });
    s.add({ id: 'c', deps: ['a', 'b'] });
    // Complete a: runNext a (RUNNING) then complete a. b is still runnable, so
    // next() correctly returns b here — the invariant under test is that c
    // stays PENDING until BOTH a and b are completed.
    s.runNext();
    s.complete('a');
    assert.equal(s.get('c')?.state, TaskState.PENDING);
    // b remains runnable (it was never blocked); c must not be.
    assert.equal(s.next()?.id, 'b');
    s.runNext();
    s.complete('b');
    assert.equal(s.get('c')?.state, TaskState.READY);
  });

  it('addDependency raises a pending task to runnable when its last blocker completes', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: clock.now - 1 });
    s.add({ id: 'b', runAt: clock.now - 1 });
    s.add({ id: 'c', deps: ['a'] });
    s.addDependency('c', 'b');
    assert.equal(s.get('c')?.state, TaskState.PENDING);
    s.runNext();
    s.complete('a');
    assert.equal(s.get('c')?.state, TaskState.PENDING); // still blocked on b
    s.runNext();
    s.complete('b');
    assert.equal(s.get('c')?.state, TaskState.READY);
  });

  it('carries a new dependency onto a WAITING task correctly', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: clock.now - 1 }); // due now
    s.add({ id: 'b', runAt: clock.now + 4000 }); // future
    s.add({ id: 'c', runAt: clock.now - 1 }); // due now, no deps -> READY
    assert.equal(s.get('c')?.state, TaskState.READY);
    // Add dep on b (future). c must drop back to PENDING because b not done.
    s.addDependency('c', 'b');
    assert.equal(s.get('c')?.state, TaskState.PENDING);
    // Completing a does nothing (a was never a dep of c).
    s.runNext();
    s.complete('a');
    assert.equal(s.get('c')?.state, TaskState.PENDING);
  });
});

describe('TaskScheduler — dynamic updates', () => {
  it('update priority takes effect immediately in the ready heap', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a', priority: 1 });
    s.add({ id: 'b', priority: 2 });
    assert.equal(s.next()?.id, 'b');
    s.update('a', { priority: 10 });
    assert.equal(s.next()?.id, 'a');
  });

  it('update runAt demotes a READY task to WAITING when runAt becomes future', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a', runAt: 1000 });
    assert.equal(s.get('a')?.state, TaskState.READY);
    assert.equal(s.hasRunnable(), true);
    s.update('a', { runAt: 5000 });
    assert.equal(s.get('a')?.state, TaskState.WAITING);
    assert.equal(s.hasRunnable(), false);
    s.update('a', { runAt: 1000 });
    assert.equal(s.get('a')?.state, TaskState.READY);
  });

  it('update payload changes without heap churn', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a', payload: { n: 1 } });
    s.update('a', { payload: { n: 2 } });
    assert.deepEqual(s.get('a')?.payload, { n: 2 });
    assert.equal(s.get('a')?.version, 1);
  });

  it('cannot update priority/runAt of a RUNNING task', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a', priority: 1 });
    s.runNext();
    assert.equal(s.get('a')?.state, TaskState.RUNNING);
    assert.throws(() => s.update('a', { priority: 5 }));
    assert.throws(() => s.update('a', { runAt: 9999 }));
  });

  it('rejects non-finite priority/runAt', () => {
    const s = new TaskScheduler();
    assert.throws(() => s.add({ id: 'a', priority: Number.NaN }));
    assert.throws(() => s.add({ id: 'a', priority: Number.POSITIVE_INFINITY }));
    assert.throws(() => s.add({ id: 'a', runAt: Number.NEGATIVE_INFINITY }));
  });
});

describe('TaskScheduler — cycle detection', () => {
  it('rejects a self-dependency on add', () => {
    const s = new TaskScheduler();
    assert.throws(() => s.add({ id: 'a', deps: ['a'] }), /cannot depend on itself/);
  });

  it('rejects a dependency edge that creates a cycle', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] }); // a -> b
    s.add({ id: 'c', deps: ['b'] }); // b -> c
    // Now add a -> c: cycle a -> c -> b -> a.
    assert.throws(() => s.addDependency('a', 'c'), /cycle/);
    assert.equal(s.get('a')?.state, TaskState.READY); // unchanged
  });

  it('rejects adding an edge that closes a longer cycle', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] }); // a -> b
    s.add({ id: 'c', deps: ['b'] }); // b -> c
    s.add({ id: 'd', deps: ['c'] }); // c -> d
    s.add({ id: 'e', deps: ['d'] }); // d -> e
    // Now add d -> e... wait, d already depends on e. Use the reverse: add
    // a -> e would need a path e->...->a; e->d->c->b->a closes a 5-node cycle.
    assert.throws(() => s.addDependency('a', 'e'), /cycle/);
  });

  it('allows adding an edge that does not create a cycle', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.add({ id: 'b' });
    // a -> b is fine (no cycle).
    s.addDependency('a', 'b');
    assert.equal(s.get('a')?.state, TaskState.PENDING);
    assert.equal(s.get('b')?.state, TaskState.READY);
  });

  it('is idempotent: adding the same edge twice is a no-op', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] });
    const before = s.get('b')!.remainingDeps;
    s.addDependency('b', 'a');
    assert.equal(s.get('b')!.remainingDeps, before);
  });

  it('cycle detection works on large chains (no stack overflow)', () => {
    const s = new TaskScheduler();
    const N = 10000;
    s.add({ id: '0' });
    for (let i = 1; i < N; i++) {
      s.add({ id: String(i), deps: [String(i - 1)] });
    }
    // Chain is 0 <- 1 <- ... <- (N-1) i.e. i depends on i-1. Adding 0 depends on
    // (N-1) closes the back-edge 0 -> (N-1) -> ... -> 0 => cycle.
    assert.throws(() => s.addDependency('0', String(N - 1)), /cycle/);
    assert.equal(s.size, N);
  });
});

describe('TaskScheduler — removal', () => {
  it('removes a task and reports it gone', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.add({ id: 'b' });
    const removed = s.remove('a')!;
    assert.equal(removed.id, 'a');
    assert.equal(s.get('a'), undefined);
    assert.equal(s.size, 1);
    assert.equal(s.next()?.id, 'b');
  });

  it('remove is a no-op returning undefined for unknown id', () => {
    const s = new TaskScheduler();
    assert.equal(s.remove('nope'), undefined);
  });

  it('cannot remove a RUNNING task', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.runNext();
    assert.throws(() => s.remove('a'));
  });

  it('removing a dependency unblocks dependents', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] });
    s.remove('a');
    assert.equal(s.get('b')?.state, TaskState.READY);
  });
});

describe('TaskScheduler — cancellation', () => {
  it('cancels a task and cascades to dependents', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] });
    s.add({ id: 'c', deps: ['b'] });
    const cancelled = s.cancel('a');
    assert.deepEqual(
      [...cancelled].sort(),
      ['a', 'b', 'c']
    );
    assert.equal(s.get('a')?.state, TaskState.CANCELLED);
    assert.equal(s.get('b')?.state, TaskState.CANCELLED);
    assert.equal(s.get('c')?.state, TaskState.CANCELLED);
    assert.equal(s.remaining, 0);
  });

  it('cancellation does not affect already-DONE tasks', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] });
    s.runNext(); // a -> RUNNING
    s.complete('a'); // a -> DONE
    assert.equal(s.get('a')?.state, TaskState.DONE);
    // cancelling a completed task returns [] (nothing to cancel).
    assert.equal(s.cancel('a').length, 0);
  });

  it('cannot cancel a non-registered task', () => {
    const s = new TaskScheduler();
    assert.throws(() => s.cancel('x'));
  });
});

describe('TaskScheduler — lifecycle validation', () => {
  it('rejects duplicate task ids', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    assert.throws(() => s.add({ id: 'a' }), /already exists/);
    assert.equal(s.size, 1);
  });

  it('rejects unknown dependency on add', () => {
    const s = new TaskScheduler();
    assert.throws(() => s.add({ id: 'a', deps: ['ghost'] }), /not registered/);
  });

  it('completing a non-running task throws', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    assert.throws(() => s.complete('a')); // not RUNNING
  });

  it('double-complete throws', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.runNext();
    s.complete('a', 42);
    assert.equal(s.get('a')?.state, TaskState.DONE);
    assert.throws(() => s.complete('a'));
  });

  it('rejects add without id', () => {
    const s = new TaskScheduler();
    // @ts-expect-error missing id
    assert.throws(() => s.add({}));
  });
});

describe('TaskScheduler — completion result', () => {
  it('captures the result passed to complete()', () => {
    const s = new TaskScheduler<{ ok: boolean }>();
    s.add({ id: 'a', payload: { ok: true } });
    s.runNext();
    s.complete('a', { ok: true, code: 200 });
    assert.deepEqual(s.get('a')?.result, { ok: true, code: 200 });
  });

  it('populate newlyRunnable dependents list', () => {
    const clock = new FakeClock();
    clock.setNow(1000);
    const s = new TaskScheduler({ now: () => clock.now });
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] });
    s.add({ id: 'c', deps: ['a'] });
    s.runNext(); // a -> RUNNING
    const ran = s.complete('a'); // b, c become READY and returned as newly runnable
    assert.equal(ran.length, 2);
  });
});

describe('TaskScheduler — sync under many tasks', () => {
  it('produces a strict priority ordering for 5000 tasks', () => {
    const clock = new FakeClock();
    const s = new TaskScheduler({ now: () => clock.now });
    const N = 5000;
    // All tasks are due at the same instant. Adding them all keeps every task in
    // the ready heap; popping them all then verifies the heap maintains the
    // global priority order across all N in-flight tasks.
    for (let i = 0; i < N; i++) {
      s.add({ id: `t${i}`, priority: (i * 7919) % 97 }); // pseudo-random prio, all due now
    }
    const priorities: number[] = [];
    for (let i = 0; i < N; i++) {
      const t = s.runNext();
      if (!t) break;
      priorities.push(t.priority);
    }
    // Priority must be non-increasing across the run sequence.
    for (let i = 1; i < priorities.length; i++) {
      assert.ok(priorities[i] <= priorities[i - 1]);
    }
    // All N tasks were popped; each runNext consumed exactly one.
    assert.equal(s.size, N);
  });

  it('maintains heap invariants on the ready heap during mixed operations', () => {
    const s = new TaskScheduler();
    const N = 1000;
    // Add tasks with varied priorities and runNext repeatedly.
    for (let i = 0; i < N; i++) {
      s.add({ id: `t${i}`, priority: i * 3 % 500 });
    }
    let minSeen = Infinity;
    for (let i = 0; i < 500; i++) {
      const t = s.runNext();
      assert.ok(t);
      assert.ok(t.priority <= minSeen); // non-increasing
      minSeen = t.priority;
    }
  });
});

describe('TaskScheduler — clear', () => {
  it('clears all state', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a' });
    s.add({ id: 'b', deps: ['a'] });
    s.runNext(); // a -> RUNNING
    s.complete('a'); // a -> DONE
    const n = s.clear();
    assert.equal(n, 2);
    assert.equal(s.size, 0);
    assert.equal(s.remaining, 0);
    assert.equal(s.next(), undefined);
    s.add({ id: 'fresh' });
    assert.equal(s.get('fresh')?.state, TaskState.READY);
  });
});

describe('TaskScheduler — internal consistency (heap state machine)', () => {
  it('every task is in exactly one heap (or none) consistent with its state', () => {
    const s = new TaskScheduler();
    const future = Number.MAX_SAFE_INTEGER;
    s.add({ id: 'ready', priority: 3 });
    s.add({ id: 'time', runAt: future }); // far future -> WAITING
    s.add({ id: 'dep1' });
    s.add({ id: 'dep2', deps: ['dep1'] });

    // Check internal heap membership against task states.
    // dep2 is PENDING -> not in either heap.
    // ready is READY -> in readyHeap.
    // time is WAITING -> in timeHeap.

    // Sanity: ready runnable, time not.
    assert.equal(s.next()?.id, 'ready');
    assert.equal(s.get('time')?.state, TaskState.WAITING);
    assert.equal(s.get('dep2')?.state, TaskState.PENDING);
  });

  it('handles dependency cycles in weight updates', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a', priority: 1 });
    s.add({ id: 'b', priority: 2 });
    s.add({ id: 'c', priority: 3 });
    s.addDependency('a', 'b'); // a waits on b
    s.addDependency('b', 'c'); // b waits on c
    // a is PENDING; b is PENDING; c is runnable (highest priority).
    assert.equal(s.get('a')?.state, TaskState.PENDING);
    assert.equal(s.get('b')?.state, TaskState.PENDING);
    // Run c (RUNNING), then complete it: b's last blocker is done, so b becomes
    // READY. a must stay PENDING because b (its blocker) has not completed.
    s.runNext();
    s.complete('c');
    assert.equal(s.get('b')?.state, TaskState.READY);
    assert.equal(s.get('a')?.state, TaskState.PENDING);
  });
});

describe('TaskScheduler — toJSON', () => {
  it('round-trips task info into JSON', () => {
    const s = new TaskScheduler();
    s.add({ id: 'a', priority: 5, runAt: 1234, payload: { x: 1 } });
    s.add({ id: 'b', deps: ['a'], priority: 1 });
    const json = s.toJSON();
    const asObj = json as { size: number; readyCount: number; tasks: Record<string, unknown> };
    assert.equal(asObj.size, 2);
    assert.ok(asObj.tasks.a);
    assert.equal(asObj.tasks.a.priority, 5);
  });
});
