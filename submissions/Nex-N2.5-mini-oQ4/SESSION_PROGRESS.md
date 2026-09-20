# Scheduler project progress

## Contract

- Build a production-ready TypeScript in-memory task scheduler in this directory only.
- Support priorities, execution timestamps, dependencies, dynamic updates, cycle detection, and deterministic next-task retrieval.
- Retain the lifecycle values `PENDING`, `RUNNING`, and `COMPLETED`.
- Do not inspect or use sibling directories.

## Architecture finalised

- One `Map` stores task records by ID.
- Two binary heaps store due and future tasks.
- A blocked set stores due tasks waiting on active dependencies.
- Bidirectional dependency sets and active-edge bookkeeping keep dependency metadata exact.
- A maintained topological order and position index avoid repeated graph scans for normal edge insertion.
- Backward edges use iterative cycle reachability and perform one bounded topological rebuild only when needed.
- Public snapshots and dependency arrays are defensive frozen copies.

## Verification

- Runtime: Node `v22.23.1`, npm `10.9.8`, macOS Darwin ARM64.
- Strict TypeScript build: passed.
- Vitest suite: 29/29 tests passed.
- Full test duration: 1.453 s; total Vitest process duration: 2.18 s.
- Million-task insertion: 967.109 ms for 1,000,000 independent tasks.
- First root lookup after insertion: approximately 0.11 ms; returned `task-0`.
- 50,000-node chain and closing-cycle probe: rejection passed in approximately 9.834 ms, with the graph unchanged.
- Public API spelling corrected and verified: snapshots expose `dependentCount`.

## Final files

- `src/index.ts` — complete scheduler implementation and public types/errors.
- `tests/scheduler.test.ts` — 29 deterministic behavioral, graph, lifecycle, error, deep-cycle, snapshot, and scale tests.
- `DESIGN.md` — architecture, data structures, complexity, edge cases, scalability evidence, and verification.
- `dist/index.js` and `dist/index.d.ts` — generated JavaScript and declaration artifacts.
- `package.json` and `package-lock.json` — package metadata and dependencies.
- `tsconfig.json` — strict TypeScript build settings.

## Timing record

The first retained execution timestamp during this work was
`2026-09-18T08:07:33.604374000+01:00`. The final benchmark was captured at
approximately `2026-09-18T14:16:40.119157000+01:00`. That is approximately
**6 hours 9 minutes** from the first retained checkpoint; the earlier portion
of the interrupted session had no retained authoritative start timestamp.

## Not retained

- This directory is not a Git repository, so no Git diff/status was available.
- Delegated implementation review was blocked by the oMLX prefill memory guard.
