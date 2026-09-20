# agnes-task-scheduler

Production-ready in-memory DAG task scheduler (TypeScript, zero runtime
dependencies) supporting 1M tasks with priorities, execution timestamps,
dependency tracking, dynamic updates, cycle detection, and O(log n) retrieval
of the next executable task.

## Layout

| Path | Contents |
|---|---|
| `PROMPT.md` | Original requirements |
| `src/` | Implementation: `TaskScheduler`, `BinaryHeap`, types, errors |
| `tests/scheduler.test.ts` | 26-test correctness suite |
| `tests/scale-1m.test.ts` | 1M-task scale benchmark |
| `DESIGN.md` | Architecture, data structures, complexity, edge cases, scalability |

## Commands

```bash
npm install            # dev dependencies (typescript, vitest, @types/node)
npm run typecheck      # strict tsc --noEmit
npm test               # correctness suite (vitest run tests/scheduler.test.ts)
npm run bench          # 1M benchmark (vitest run tests/scale-1m.test.ts)
```

The benchmark needs a larger heap:

```bash
node --max-old-space-size=16384 ./node_modules/vitest/vitest.mjs run tests/scale-1m.test.ts
```

## Quick start

```typescript
import { TaskScheduler } from './src/index';

const s = new TaskScheduler();
s.addTask({ id: 'build', priority: 5, scheduledAt: Date.now() });
s.addTask({ id: 'deploy', priority: 9, scheduledAt: Date.now(), deps: ['build'] });

const task = s.nextTask();            // atomic claim, PENDING -> RUNNING
s.markComplete(task.id);              // cascades readiness to dependents

s.stats();                            // observability
s.audit();                            // structural invariant verification
```
