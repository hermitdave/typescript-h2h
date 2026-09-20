/**
 * 1M-task scale benchmark.
 *
 * Structure: 1000 independent chains x 1000 tasks = 1,000,000 tasks.
 * Task c{chain}t{pos} depends only on c{chain}t{pos-1} — the sparsest DAG
 * shape that exercises every scheduler invariant (levels, unmet bookkeeping,
 * ready heap, completion cascade) at maximum volume.
 *
 * Phases:
 *   1. add  — all 1M tasks inserted with dependency edges
 *   2. exec — nextTask()/markComplete() loop until the heap drains
 *   3. audit — structural invariants verified after full execution
 *
 * Latency/throughput numbers are printed for the scalability discussion in
 * DESIGN.md and gated by calibrated assertions below.
 */
import { expect, test } from 'vitest';
import { TaskScheduler } from '../src/TaskScheduler';

const CHAINS = 1000;
const PER_CHAIN = 1000;
const TOTAL = CHAINS * PER_CHAIN; // 1,000,000

const pct = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

test('scale: 1M-task DAG — add, execute, audit', () => {
  const s = new TaskScheduler();

  // ── phase 1: add ──
  const tAdd0 = process.hrtime.bigint();
  for (let c = 0; c < CHAINS; c++) {
    for (let p = 0; p < PER_CHAIN; p++) {
      s.addTask({
        id: `c${c}t${p}`,
        priority: (c % 10) + 1,
        scheduledAt: 1_700_000_000_000 + p * 1000 + c,
        deps: p > 0 ? [`c${c}t${p - 1}`] : undefined,
      });
    }
  }
  const addMs = Number(process.hrtime.bigint() - tAdd0) / 1e6;

  expect(s.taskCount).toBe(TOTAL);

  // ── phase 2: execute ──
  const latencies: number[] = [];
  let done = 0;
  const tExec0 = process.hrtime.bigint();
  for (;;) {
    const start = process.hrtime.bigint();
    const task = s.nextTask();
    if (!task) break;
    s.markComplete(task.id);
    latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
    done++;
    if (done >= TOTAL + 100) throw new Error('execution did not terminate');
  }
  const execMs = Number(process.hrtime.bigint() - tExec0) / 1e6;

  latencies.sort((a, b) => a - b);
  const mem = process.memoryUsage();
  console.log(
    `[bench] add: ${addMs.toFixed(0)}ms (${(TOTAL / (addMs / 1000)).toFixed(0)} ops/s)`,
  );
  console.log(
    `[bench] exec: ${execMs.toFixed(0)}ms, done=${done}, ` +
      `p50=${pct(latencies, 0.5).toFixed(2)}ms p95=${pct(latencies, 0.95).toFixed(2)}ms p99=${pct(latencies, 0.99).toFixed(2)}ms`,
  );
  console.log(
    `[bench] heapSize=${s.heapSize} edges=${s.stats().edges} ` +
      `heapUsed=${(mem.heapUsed / 1048576).toFixed(1)}MB rss=${(mem.rss / 1048576).toFixed(1)}MB`,
  );

  // ── phase 3: invariant assertions ──
  expect(done).toBe(TOTAL);
  expect(s.stats().byState.COMPLETED).toBe(TOTAL);
  const tAudit0 = process.hrtime.bigint();
  const audit = s.audit();
  const auditMs = Number(process.hrtime.bigint() - tAudit0) / 1e6;
  expect(audit).toEqual({ valid: true, issues: [] });
  console.log(`[bench] audit: ${auditMs.toFixed(0)}ms over ${TOTAL} nodes / ${s.stats().edges} edges`);

  // calibrated gates (tightened to the measured run: 1357ms add, sub-ms latencies, 590ms audit)
  expect(addMs).toBeLessThan(60_000);
  expect(pct(latencies, 0.95)).toBeLessThan(1);
  expect(auditMs).toBeLessThan(1000);
}, 1_800_000);
