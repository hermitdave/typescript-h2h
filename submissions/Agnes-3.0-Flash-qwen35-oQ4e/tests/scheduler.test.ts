import { describe, expect, test } from 'vitest';
import { CycleError, NotFoundError, TaskScheduler } from '../src/index';

const T = (id: string, priority: number, scheduledAt = 1_000, deps?: readonly string[]) => ({ id, priority, scheduledAt, deps });

describe('TaskScheduler correctness', () => {
  test('ordering: higher priority is claimed first', () => {
    const s = new TaskScheduler();
    s.addTask(T('low', 1));
    s.addTask(T('mid', 5));
    s.addTask(T('high', 9));
    expect(s.nextTask()!.id).toBe('high');
    expect(s.nextTask()!.id).toBe('mid');
    expect(s.nextTask()!.id).toBe('low');
    expect(s.nextTask()).toBeNull();
  });

  test('tie-break: equal priority orders by earlier execution timestamp', () => {
    const s = new TaskScheduler();
    s.addTask({ id: 'late', priority: 5, scheduledAt: 300 });
    s.addTask({ id: 'early', priority: 5, scheduledAt: 100 });
    s.addTask({ id: 'mid', priority: 5, scheduledAt: 200 });
    expect(s.nextTask()!.id).toBe('early');
    expect(s.nextTask()!.id).toBe('mid');
    expect(s.nextTask()!.id).toBe('late');
  });

  test('tie-break: equal priority and timestamp orders by id', () => {
    const s = new TaskScheduler();
    s.addTask({ id: 't2', priority: 5, scheduledAt: 100 });
    s.addTask({ id: 't10', priority: 5, scheduledAt: 100 });
    s.addTask({ id: 't1', priority: 5, scheduledAt: 100 });
    // lexicographic: 't1' < 't10' < 't2'
    expect(s.nextTask()!.id).toBe('t1');
    expect(s.nextTask()!.id).toBe('t10');
    expect(s.nextTask()!.id).toBe('t2');
  });

  test('dependency chain cascades readiness: A <- B <- C', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    s.addTask(T('C', 5, 1_200, ['B']));
    expect(s.nextTask()!.id).toBe('A');
    s.markComplete('A');
    expect(s.nextTask()!.id).toBe('B');
    s.markComplete('B');
    expect(s.nextTask()!.id).toBe('C');
    s.markComplete('C');
    expect(s.nextTask()).toBeNull();
  });

  test('diamond dependency: dependent unlocks only when ALL deps complete', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 9, 1_100, ['A']));
    s.addTask(T('C', 5, 1_100, ['A']));
    s.addTask(T('D', 5, 1_200, ['B', 'C']));
    expect(s.nextTask()!.id).toBe('A');
    s.markComplete('A');
    // B and C both become ready; B has higher priority
    expect(s.nextTask()!.id).toBe('B');
    s.markComplete('B');
    // D still blocked: C unmet
    expect(s.nextTask()!.id).toBe('C');
    s.markComplete('C');
    expect(s.nextTask()!.id).toBe('D');
    s.markComplete('D');
    expect(s.nextTask()).toBeNull();
  });

  test('cycle detection: edge that closes a loop is rejected, graph untouched', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5));
    s.addDependency('B', 'A'); // legal: B depends on A
    expect(() => s.addDependency('A', 'B')).toThrow(CycleError);
    // the second edge would close the loop A->B->A: rejected, graph untouched.
    // B waits on A (blocked); A stays independently ready -> only A is claimable
    const claimed = s.nextTask();
    expect(claimed!.id).toBe('A');
    expect(s.markComplete('A').state).toBe('COMPLETED');
    // A completed -> B unmet reaches 0, becomes ready (but still NOT on the loop:
    // its deps are {A}, which is satisfied)
    expect(s.nextTask()!.id).toBe('B');
    s.markComplete('B');
    expect(s.nextTask()).toBeNull();
    expect(s.audit().valid).toBe(true);
  });

  test('self-dependency is rejected', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    expect(() => s.addDependency('A', 'A')).toThrow(CycleError);
  });

  test('duplicate dependency is an idempotent no-op', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5));
    const first = s.addDependency('B', 'A');
    const second = s.addDependency('B', 'A');
    expect(first.status).toBe('added');
    expect(second.status).toBe('duplicate');
    const rec = s.debugRecords().find((r) => r.id === 'B')!;
    expect(rec.deps.size).toBe(1);
    expect(rec.unmet).toBe(1);
    expect(s.nextTask()!.id).toBe('A');
  });

  test('priority update reorders the ready heap (stale entries lazily dropped)', () => {
    const s = new TaskScheduler();
    s.addTask(T('G', 5));
    s.addTask(T('A', 1, 1_000, ['G']));
    s.nextTask()!.id; // G claimed
    s.markComplete('G'); // A enters the heap at priority 1
    s.addTask(T('B2', 5));
    s.updateTask('A', { priority: 9 });
    // A now outranks B2 despite the stale priority-1 entry still in the heap
    expect(s.nextTask()!.id).toBe('A');
  });

  test('failure blocks the entire downstream subgraph', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    s.addTask(T('C', 5, 1_200, ['B']));
    s.addTask(T('X', 9)); // independent
    s.nextTask(); // claims highest priority first -> X (priority 9)
    s.markComplete('X');
    s.nextTask()!.id; // A
    s.markFailed('A');
    const states = Object.fromEntries(s.debugRecords().map((r) => [r.id, r.state]));
    expect(states['B']).toBe('BLOCKED');
    expect(states['C']).toBe('BLOCKED'); // transitive cascade
    expect(s.nextTask()).toBeNull();
  });

  test('restart after failure unblocks dependents once the task completes', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    s.addTask(T('C', 5, 1_200, ['B']));
    s.nextTask()!.id; // A
    s.markFailed('A');
    expect(s.debugRecords().find((r) => r.id === 'B')!.state).toBe('BLOCKED');
    s.restartTask('A');
    s.nextTask()!.id; // A (retried)
    s.markComplete('A');
    expect(s.nextTask()!.id).toBe('B');
    s.markComplete('B');
    expect(s.nextTask()!.id).toBe('C');
    s.markComplete('C');
    expect(s.nextTask()).toBeNull();
  });

  test('removeTask unblocks dependents whose last dep vanished', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    s.addTask(T('X', 9));
    expect(s.nextTask()!.id).toBe('X'); // X outranks the rest
    s.markComplete('X');
    s.removeTask('A');
    expect(s.nextTask()!.id).toBe('B'); // unmet recomputed to 0
  });

  test('removing a satisfied dep keeps the dependent ready in the same slot', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 9, 1_100, ['A']));
    s.addTask(T('C', 1, 500, ['B']));
    s.nextTask()!.id; // A claimed (B still blocked on A)
    s.markComplete('A'); // B becomes ready
    expect(s.peekNext()!.id).toBe('B');
    s.removeDependency('C', 'B'); // B is COMPLETED — satisfied, never counted in unmet
    const res = s.addDependency('C', 'B');
    expect(res.status).toBe('added');
    // C stays ready with unchanged ordering keys; B still sorts first at priority 9
    expect(s.peekNext()!.id).toBe('B');
  });

  test('removing an unsatisfied dep makes the dependent ready', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 9, 1_100, ['A']));
    s.removeDependency('B', 'A');
    const rec = s.debugRecords().find((r) => r.id === 'B')!;
    expect(rec.unmet).toBe(0);
    expect(s.nextTask()!.id).toBe('B');
  });

  test('declaring a dependency on a failed task blocks the dependent', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 9));
    s.addTask(T('B', 5));
    s.nextTask()!.id; // A claimed (higher priority)
    s.markFailed('A');
    expect(s.debugRecords().find((r) => r.id === 'B')!.state).toBe('PENDING');
    s.addDependency('B', 'A'); // A is FAILED — unsatisfied dependency
    const b = s.debugRecords().find((r) => r.id === 'B')!;
    expect(b.state).toBe('BLOCKED');
    expect(b.unmet).toBe(1);
    expect(s.nextTask()).toBeNull();
  });

  test('compact() purges stale entries after version churn', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 1));
    s.updateTask('A', { priority: 6 });
    s.updateTask('A', { priority: 5 });
    s.updateTask('A', { priority: 6 });
    // three schedulability-affecting bumps: four entries for one live task
    expect(s.heapSize).toBe(4);
    const report = s.compact();
    expect(report.kept).toBe(1);
    expect(report.dropped).toBe(3);
    const claimed = s.nextTask()!;
    expect(claimed.id).toBe('A');
    expect(claimed.priority).toBe(6);
  });

  test('mutators throw NotFoundError for unknown ids', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    expect(() => s.addDependency('ghost', 'A')).toThrow(NotFoundError);
    expect(() => s.addDependency('A', 'ghost')).toThrow(NotFoundError);
    expect(() => s.removeDependency('A', 'ghost')).toThrow(NotFoundError);
    expect(() => s.updateTask('ghost', { priority: 1 })).toThrow(NotFoundError);
    expect(() => s.removeTask('ghost')).toThrow(NotFoundError);
    expect(() => s.markComplete('ghost')).toThrow(NotFoundError);
  });

  test('audit() detects unmet drift after manual corruption', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    expect(s.audit().valid).toBe(true);
    const b = s.debugRecords().find((r) => r.id === 'B')!;
    b.unmet += 1; // simulate bookkeeping drift
    const report = s.audit();
    expect(report.valid).toBe(false);
    expect(report.issues.join('\n')).toMatch(/unmet mismatch on B/);
  });

  test('levels: chain and diamond assign longest-path levels', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    s.addTask(T('C', 5, 200, ['B', 'A']));
    expect(s.levelOf('A')).toBe(0);
    expect(s.levelOf('B')).toBe(1);
    expect(s.levelOf('C')).toBe(2); // max(dep levels)+1
  });

  test('addDependency level fast path: safe edge needs no BFS, levels untouched', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5)); // level 0
    s.addTask(T('B', 5, 1_100, ['A'])); // level 1
    s.addTask(T('C', 5, 200, ['B'])); // level 2
    s.addDependency('C', 'A'); // dep.level+1 = 1 <= C.level = 2 -> O(1) safe
    expect(s.levelOf('C')).toBe(2);
    expect(s.audit().valid).toBe(true);
  });

  test('addDependency level raise cascades to all descendants', () => {
    const s = new TaskScheduler();
    s.addTask(T('X', 1, 500)); // level 0
    s.addTask(T('X1', 1, 600, ['X'])); // level 1
    s.addTask(T('X2', 1, 700, ['X1'])); // level 2
    s.addTask(T('X3', 1, 800, ['X2'])); // level 3
    s.addTask(T('X4', 1, 900, ['X3'])); // level 4
    s.addTask(T('A', 5)); // level 0
    s.addTask(T('B', 5, 1_100, ['A'])); // level 1
    s.addTask(T('C', 5, 200, ['B'])); // level 2
    s.addTask(T('D', 5, 300, ['C'])); // level 3
    s.addTask(T('E', 5, 400, ['D'])); // level 4
    // X4.level+1 = 5 > D.level = 3 -> ambiguous -> BFS from X4 finds no cycle -> raise + cascade
    s.addDependency('D', 'X4');
    expect(s.levelOf('D')).toBe(5);
    expect(s.levelOf('E')).toBe(6); // cascade propagated the raise one further hop
    expect(s.audit().valid).toBe(true);
  });

  test('removeDependency restores levels after the driving dep is removed', () => {
    const s = new TaskScheduler();
    s.addTask(T('X', 1, 500));
    s.addTask(T('X1', 1, 600, ['X']));
    s.addTask(T('X2', 1, 700, ['X1']));
    s.addTask(T('X3', 1, 800, ['X2']));
    s.addTask(T('X4', 1, 900, ['X3'])); // level 4
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A'])); // level 1
    s.addTask(T('C', 5, 200, ['B'])); // level 2
    s.addTask(T('D', 5, 300, ['C'])); // level 3
    s.addTask(T('E', 5, 400, ['D'])); // level 4
    s.addDependency('D', 'X4'); // D.level driven to 5 by X4, cascades to E (6)
    expect(s.levelOf('D')).toBe(5);
    s.removeDependency('D', 'X4');
    expect(s.levelOf('D')).toBe(3); // recompute from remaining dep C
    expect(s.levelOf('E')).toBe(4); // cascade propagated the level drop
    expect(s.audit().valid).toBe(true);
  });

  test('removeTask cascades level repair to all downstream dependents', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5)); // level 0
    s.addTask(T('B', 5, 1_100, ['A'])); // level 1
    s.addTask(T('C', 5, 200, ['B'])); // level 2
    s.addTask(T('D', 5, 300, ['C'])); // level 3
    s.removeTask('A');
    expect(s.levelOf('B')).toBe(0);
    expect(s.levelOf('C')).toBe(1);
    expect(s.levelOf('D')).toBe(2);
    expect(s.audit().valid).toBe(true);
  });

  test('peekNext inspects without mutating state', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    const peek = s.peekNext()!;
    expect(peek.id).toBe('A');
    expect(peek.state).toBe('PENDING');
    const rec = s.debugRecords().find((r) => r.id === 'A')!;
    expect(rec.state).toBe('PENDING'); // peek changed nothing
    const claimed = s.nextTask()!;
    expect(claimed.id).toBe('A');
  });

  test('cancel blocks dependents exactly like failure', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    s.addTask(T('C', 5, 200, ['B']));
    s.cancelTask('A');
    const states = Object.fromEntries(s.debugRecords().map((r) => [r.id, r.state]));
    expect(states['A']).toBe('CANCELLED');
    expect(states['B']).toBe('BLOCKED');
    expect(states['C']).toBe('BLOCKED');
    expect(s.nextTask()).toBeNull();
  });

  test('stats() reports state distribution and edge count', () => {
    const s = new TaskScheduler();
    s.addTask(T('A', 5));
    s.addTask(T('B', 5, 1_100, ['A']));
    s.addTask(T('X', 9));
    const st = s.stats();
    expect(st.total).toBe(3);
    expect(st.edges).toBe(1);
    expect(st.byState.PENDING).toBe(3);
    s.nextTask()!.id; // X
    s.markComplete('X');
    const st2 = s.stats();
    expect(st2.byState.COMPLETED).toBe(1);
    expect(st2.byState.PENDING).toBe(2);
  });
});
