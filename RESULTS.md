# Head-to-Head oMLX Model Benchmark

**Prompt:** Design and implement a production-ready in-memory task scheduler using typescript supporting 1 million tasks with priorities, execution timestamps, dependency tracking, dynamic updates, cycle detection, and efficient retrieval of the next executable task.

**Date:** 2026-09-15
**Models:** 13 distinct models — 11 scored · 2 failed (K2 Horizon JSON-write issue) · rows 4 and 13 are the same model (Uno-merged) · Qwen3.8-Flash-Next folder contains only PROMPT.md (never ran)

---

## Results

| # | Model | Status | Time (s) | Tokens | Notes |
|---|-------|--------|----------|--------|-------|
| 1 | Muse-Glimmer-30B-oQ4e | ✅ Done | 5.7 | - | 17/21 tests pass (4 fail) · syntax error fixed to run · cancelTask status-check bug · no 1M bench<br><br>**Serving:** 0.4h total · 733.9K prefill · 688.1K cached (93.8% eff.) · 40 TPS avg · 14.2 TPS gen |
| 2 | Agnes-3.0-Flash-qwen35-oQ4e | ✅ Done | 4.3 | - | 26 tests pass · 1M add 1.25s · 1M exec 0.80s · 1M audit 0.39s<br><br>**Serving:** 3.25h total · 2.29M prefill · 2.15M cached (93.9% eff.) · 74.6 TPS avg · 8.9 TPS gen |
| 3 | BigBang-v1-MLX-oQ4e | ✅ Done | 5.5 | - | 30 tests pass · 1M add ~2.6s<br><br>**Serving:** 1.25h total · 10.91M prefill · 10.53M cached (96.5% eff.) · 418.2 TPS avg · 54.7 TPS gen |
| 4 | K2-Horizon-7B-Uno-oQ6e | ❌ Failed | - | - | Incomplete: types.ts + errors.ts + heap.ts + index.ts produced. task-scheduler.ts empty. Same JSON-write failure as MoVA-36B. No runnable code. (Uno-merged weights — see row 13.) |
| 5 | K2-Horizon-MoVA-36B-A4B-oQ4e | ❌ Failed | - | - | Incomplete: only errors.ts + heap.ts produced. Model failed to write JSON implementation files. No runnable code. |
| 6 | KAT-Coder-V2.5-Dev-VL-oQ4e-mtp | ✅ Done | 3.4 | - | 24 tests pass · 10k add 3.0s (slow) · heap clean() O(n) per cancel<br><br>**Serving:** 0.34h total · 1.36M prefill · 1.23M cached (90.9% eff.) · 708.1 TPS avg · 67.1 TPS gen |
| 7 | NeoHorse-1-9B-oQ6e | ✅ Done | 0.4 | - | 10/23 tests pass (13 fail) · heap pop/delete crash · no 1M bench<br><br>**Serving:** 9h total · 17.68M prefill · 16.83M cached (95.2% eff.) · 284.2 TPS avg · 21.6 TPS gen |
| 8 | Nex-N2.5-mini-oQ4 | ✅ Done | 1.7 | - | 29 tests pass · 1M add 1.1s · 2-heap design<br><br>**Serving:** 8h+ total · 60M+ prefill · 59M+ cached (95.5% eff.) · 360 TPS avg · 40.5 TPS gen |
| 9 | Ornith-1.5-35B-A3B-oQ4e-mtp | ✅ Done | 1.3 | - | 25 tests pass · 1M create 1.28s · 2-heap design · sinkDown bug<br><br>**Serving:** 5h total · 16.65M prefill · 16M cached (96.1% eff.) · 193.8 TPS avg · 28.5 TPS gen |
| 10 | Ornith-1.5-9B-oQ6e | ✅ Done | - | - | source compiles · 12 heap tests pass · heap ordering bug found<br><br>**Serving:** 5h+ total · 30.87M prefill · 29.86M cached (96.7% eff.) · 243.6 TPS avg · 12.6 TPS gen |
| 11 | Qwen3.6-35B-A3B-oQ4e-mtp | ✅ Done | 8.6 | - | 90 tests pass · 1M add 1.5s · 1M sparse dep 2.6s<br><br>**Serving:** 3h total · 12M prefill · 11.4M cached (94.8% eff.) · 199.1 TPS avg · 31.9 TPS gen |
| 12 | Qwen3.8-27B-oQ4e-mtp | ✅ Done | 48.1 | - | 56 tests pass · 1M ingest 1.0s · 10k peeks <1ms · diamond drain 100k in 44.9s<br><br>**Serving:** 8h total · 22.26M prefill · 21.16M cached (95% eff.) · 74.6 TPS avg · 12.6 TPS gen |
| 13 | hermitdave--K2-Horizon-7B-Uno-merged | ➖ Not run | - | - | Same model as #4 — the K2-Horizon-7B attempt (row 4) already used the Uno-merged weights. No separate run. |
| 15 | Qwen3-Coder-Next-oQ4 | ✅ Done | 9.9 | - | 47 tests pass · 1M add 2.12s · 1M exec 2.11s · 1467MB (highest) · tsc clean<br><br>**Serving:** 0.75h total · 5.40M prefill · 5.01M cached (92.7% eff.) · 459.0 TPS avg · 40.9 TPS gen |

---

## Analysis

<details>
<summary>Click to expand qualitative analysis</summary>

### Qwen3.8-27B-oQ4e-mtp ✅

**Completeness:** 5/5 — Architecture doc, data structures, complexity analysis, full implementation (5 source modules), 56 tests across 4 suites, edge cases, scalability discussion. Bench files included.

**Correctness:** 5/5 — All 56 tests pass on real execution. 1M-task ingest completes in 1.0s with heap invariant verified. Cycle detection with concrete path reporting works for 2-node, 1000-node ring, and deep chains. State machine enforces all valid/invalid transitions. Self-check validates unmet consistency.

**Production-readiness:** 4.5/5 — Strong error taxonomy (`SchedulerError` with stable codes), state machine enforcement, heap invariant checking, self-inspection API (`selfCheck`, `stats`, `validateGraph`). Minor gap: no async/concurrency model — explicitly single-threaded, which is documented but limits production deployment options.

**Test coverage:** 5/5 — 23 scheduler tests (ordering, dynamic updates, state machine, self-check), 14 edge-case tests (boundary times, duplicate deps, idempotency, stale-heap recovery), 5 scale tests (1M ingest, 10k peeks, 100k diamond DAG drain, 100k chain, memory bound), 7 heap tests, 7 graph tests.

**Edge cases:** 5/5 — Handles boundary-inclusive `scheduledAt`, deduplicated `dependsOn`, idempotent add/remove, succeeded-predecessor bypass, stale-heap recovery on update, claim-after-drain, FAILED→retry path, terminal-state rejection. 169-line edge-case file is unusually thorough.

**Scalability:** 4/5 — 1M ingest 1.0s, 10k peeks <1ms (hot path is O(1) amortized). BUT diamond-drain of 100k tasks takes 44.9s — the `releaseEdges` path on `SUCCEEDED` iterates successors and calls `removeEdge` + `unmet--`, plus heap `remove` is O(n) linear-scan. At 1M tasks with dense edges this would be pathological. The README acknowledges `remove(id)` is O(n) and suggests an auxiliary `Map<id,index>` for production — correct diagnosis, not fixed. The 44.9s diamond drain is a real performance red flag for the claimed "production at 1M" target.

**Notable strengths:**
- Clean separation: `heap.ts` (MinHeap), `graph.ts` (cycle detection), `scheduler.ts` (orchestration), `types.ts` (public API).
- Iterative DFS avoids stack overflow at scale (200k-node chain verified).
- Explicit invariants documented in code (I1, I2, I3).
- `MinHeap.removeWhere` for bulk evictions.
- Floyd's linear heap construction in `rebuild()`.

**Notable weaknesses:**
- `heap.remove(id)` is O(n) linear scan — dominates the diamond-drain time at scale. README promises an index map but doesn't implement it.
- No task TTL, no max-retries, no scheduling policies (FIFO/LIFO/round-robin), no persistence — acceptable for "in-memory" scope but limits "production-ready" claim.
- No concurrency/async model — fine for Node.js single-thread but undocumented in architecture.
- `claimTask` / `nextSurfacedId` coupling is fragile: if a surfaced task is cancelled externally between `nextExecutableTask` and `claimTask`, the surfaced handle is stale but `lastSurfacedId` still points to it.

**Verdict:** Highest-effort submission so far — 56 tests, 6 source files, real benchmarks, deep edge-case coverage. The O(n) `remove(id)` is the only architectural wart, and it's honestly documented. The diamond-drain time (44.9s for 100k) is the one result that gives pause about true 1M-task production scale with dependencies.

### Qwen3.6-35B-A3B-oQ4e-mtp ✅

**Completeness:** 4/5 — Architecture doc (ARCHITECTURE.md, 165 lines), complexity analysis, full implementation (4 source modules), 90 tests, edge cases, scalability discussion. Has a PROGRESS.md (though empty). Bench files implied in tests.

**Correctness:** 4/5 — All 90 tests pass on real execution. 1M add in 1.5s, 1M sparse dep in 2.6s. Cycle detection works for direct/indirect cycles and self-dependency. State machine enforces valid transitions. Has a concurrency model via `executionPromise` serialisation.

**Production-readiness:** 4/5 — Clean error taxonomy with codes, state machine enforcement, execution serialisation (no concurrent executeNext), typed context/metadata, retry tracking. Minor gap: `cancelTask` followed by comment `// Note: after executeNext, task is already completed, so cancel should fail` — the model's own tests reveal a logical inconsistency in its cancel-during-running design that it left unresolved (the test "should cancel a running task" is a no-op stub). `MAX_HEAP_EXHAUSTED` error is defined but never thrown.

**Test coverage:** 4/5 — 90 tests covering add/execute, priority+timestamp interleaving, dependency chains, diamond dependencies, cycle detection (direct/indirect/self/long-chain), cancel, update, remove, stale entry handling, queries, executeAt parsing (ISO/Date/epoch/null), context/metadata passing, retry, version, scheduler errors, clear, edge cases (empty deps, star/chain topologies, concurrent serialisation, deep chains, negative priorities), integrity checks, and 3 separate 1M-task scalability tests (independent, sparse deps, priority bands). Impressive breadth.

**Edge cases:** 4/5 — Handles empty deps, self as dep+dependent, deep chains (10 levels), star topology (50 dependents), chain topology (100 tasks), concurrent executeNext serialisation, negative priorities, large priorities, negative executeAt (overdue), various date formats. Weakness: the "concurrent" test is misleading — it claims concurrency but the implementation serializes execution so the 2nd and 3rd calls find empty heap. The test comment even acknowledges this ambiguity.

**Scalability:** 3.5/5 — 1M add in 1.5s (excellent), 1M sparse dep in 2.6s (acceptable), 1M priority-band in 1.5s. BUT: the 1M sparse-dep test has a subtle correctness flaw — it adds `base-0..9999` then adds `dep-10000..999999` each depending on `base-${i % 10000}`. This means each base task ends up with ~100 dependents, and the cycle check `hasCycle` does a DFS from each dependency through dependents, reaching back toward the new task. For task N depending on base `b`, the DFS goes: does base `b` transitively depend on task N? At the time task N is added, N has no outgoing edges (it's a leaf), so the DFS correctly returns no cycle. This is actually correct because the DFS searches for a path from dep → new task in the existing graph, and new tasks are leaves. Smart design. However, `executeUntilEmpty` was NOT tested at 1M scale — only adds were tested, and adds skip handler execution (handlers are async functions that never run in the test). So the actual drain performance at 1M is unknown. The cycle detection DFS does a fresh `Set()` allocation per dependency, so adding 1M tasks each with 1 dep does 1M Set allocations — O(n) extra allocations that could be pooled.

**Notable strengths:**
- Handler-based design (tasks carry callbacks) — more realistic for production than pure data modeling.
- `executionPromise` serialisation prevents concurrent executeNext.
- Version counter for stale-entry detection.
- Rich type system: `Task<Context>` generic, `ExecutionMeta`, `NextTaskResult`.
- 3 distinct 1M-scale test scenarios (independent, sparse deps, priority bands).
- Pre-allocated heap capacity option.

**Notable weaknesses:**
- Heap `remove(taskId)` is O(n) linear scan — not fixed, not documented as a known issue. Shows up in `cancelTask` and `updateTask`.
- "Cancel running task" test is a no-op stub with a comment admitting the design gap.
- `getTasksByState` returns a fresh array copy on every call — O(n) allocation.
- Cycle detection allocates a fresh `visited` Set per call; at 1M adds this is 1M Set allocations.
- Architecture doc mentions "priority bands" and "batch operations" and "memory pools" as optimisations but doesn't implement them — speculative scaling ideas without evidence.
- No self-check / invariant validation API (unlike Qwen3.8-27B's `selfCheck()`).

**Verdict:** Solid, practical submission — 90 tests, real 1M-scale add benchmarks, handler-based API that's production-shaped. The model served at 199 TPS avg / 31.9 TPS gen (much faster than Qwen3.8-27B) but took 3h vs 8h because the prompt was smaller (12M vs 22M prefill). Where Qwen3.8-27B went deeper on correctness and diagnostic APIs, Qwen3.6 went broader on test scenarios and API surface. The unresolved cancel-during-running gap and the speculative architecture doc are the main deductions.

### Ornith-1.5-35B-A3B-oQ4e-mtp ✅

**Completeness:** 5/5 — Architecture doc (output.md, 1614 lines — the most detailed of all submissions, written for senior-engineering design review with requirement/option-space/solution/trade-off format), complexity analysis, full implementation (4 source modules), 25 tests across 11 suites, edge cases, scalability discussion.

**Correctness:** 3.5/5 — All 25 tests pass. 1M task creation in 1.28s. However, `MinHeap.sinkDown` has a **correctness bug**: `if (li === undefined || ri === undefined) break;` stops sinking when only a left child exists, leaving the heap invariant violated. Trace: heap `[a,b,c]` → pop `a` → `[c,b]` → sinkDown sees left=`b`, right=`undefined` → breaks without comparing → `c` stays at root even if `c > b`. Any heap with a partially-filled last level (odd element counts beyond powers-of-2-1) is at risk. The 1M test passes because `priority: i % 1000` with version tiebreakers masks the worst cases, but the heap can silently misorder.

**Production-readiness:** 4/5 — Strong design: two-heap architecture (ready + future) cleanly separates time-gating from priority. Lazy deletion via monotonic `version` gives O(log n) updates. EventEmitter decouples lifecycle events. `waitFor()` supports `AbortSignal`. Batch creation with `_topoSort` resolves forward references. `CycleReport` returns `stuckByCycle` (transitively-blocked) and `orphanBlocked` separately. Deterministic clock injection. `advance()` safety guard against infinite loops.

**Test coverage:** 3.5/5 — 25 tests, 11 suites. Covers priority ordering, duplicate rejection, time-gating, peek non-mutation, advance draining, dependency cascade, partial deps, dynamic updates (priority/reschedule), removal, cycle detection (2-node/self-loop/orphan/non-cyclic), cancellation, batch forward references, waitForNext bucketing, low-first mode, 1M scalability. Breadth is good but depth is shallow vs Qwen3.8-27B (no negative-priority test, no boundary-time test, no duplicate-deps test, no stale-entry recovery test).

**Edge cases:** 3.5/5 — Handles empty scheduler, duplicate ids, missing deps, self-loops, orphans, forward references in batches, time-gating, peek vs runNext distinction, advance draining. Misses: negative priorities, boundary-inclusive due time, duplicate dependencies, claim-after-drain, stale-entry recovery, FAILED/retry path.

**Scalability:** 3.5/5 — 1M creation in 1.28s (fastest so far). `analyze()` is O(V+E) Tarjan SCC (iterative, stack-safe). `remove()` is O(n) worst-case — iterates all tasks to cascade. Cycle detection is **NOT on add** — only via `analyze()` call, meaning cyclic dependencies can be created silently and only detected later. This is a deliberate design choice (allow cycles, report them) but differs from Qwen3.8-27B's eager rejection. The 1M test only creates, never drains — so actual execution performance at scale is unverified.

**Notable strengths:**
- Two-heap design (ready + future) with lazy promotion is clean and correct for time-gating.
- `HeapEntry` snapshot pattern (not live references) makes lazy deletion safe.
- `_tarjanScc` is iterative (stack-safe) and handles self-loops.
- `createTasks` topological sort resolves forward references within a batch.
- EventEmitter-based lifecycle with `waitFor()` + AbortSignal.
- Architecture doc format (requirement → options → choice → trade-off) is the most review-ready of all submissions.

**Notable weaknesses:**
- **`MinHeap.sinkDown` correctness bug** — stops sinking when only a left child exists, violating heap invariant for partially-filled last levels.
- Cycle detection is post-hoc (`analyze()`), not preventive — cyclic deps can be created and only detected later.
- `remove()` is O(n) — full scan to cascade remaining-count decrements.
- No `selfCheck()` / invariant validation API.
- `advance()` guard `> this.tasks.size + 1` is fragile if `tasks.size` changes during iteration.
- 1M test only creates tasks — no drain/execution benchmark at scale.

**Verdict:** Best architecture doc and API design of the three — the two-heap + lazy-deletion + EventEmitter pattern is genuinely production-shaped. But the `sinkDown` bug is a serious correctness issue that would cause silent misordering in any heap with an odd number of elements, and the 1M test's pass is partly lucky (version tiebreakers masking the bug). The post-hoc cycle detection is a defensible design choice but a real divergence from the prompt's "cycle detection" requirement, which most reviewers would interpret as "reject cycles at creation time." The model served at 194 TPS / 28.5 TPS gen — middle of the pack.

### Ornith-1.5-9B-oQ6e ✅

**Completeness:** 3.5/5 — Implementation (6 source modules) compiles clean under strict TypeScript. Has an index.ts public entry point. No README, no architecture doc, no complexity analysis doc beyond inline comments. No scheduler-level tests.

**Correctness:** 2.5/5 — All 12 heap tests pass after fixing 2 bugs in `task-heap.ts`. **Bug 1 (crash)**: `delete()` calls `heapify(idx)` unconditionally — when `idx === last`, `pop()` removes the element, `idx` becomes out-of-bounds, and `heapify` reads `h[idx]` (undefined) → `taskCmp` crashes. **Bug 2 (same crash, different path)**: `pop()` reads `this.h[last]!` — when heap has 1 element, `last=0`, `h[0]` is the only element, `pop()` returns it, then `if (this.h.length > 0)` is false, so `pos.delete(id)` runs — this path is actually fine. The real crash is solely Bug 1. However, the position-map architecture is sound: O(1) `has`, O(log n) `delete`, O(log n) `push`/`pop`. `siftDown` correctly handles the left-child-only case (unlike Ornith-1.5-35B's `MinHeap`).

**Production-readiness:** 3.5/5 — Strong domain model: `TaskStatus` enum with 9 states (Created/Pending/Ready/Running/Success/Failure/Canceled/Stuck/Skipped), hard vs soft deps, maxAttempts retry, stuck vs skipped fault propagation, injectable clock, event subscription, `PublicTask` immutable snapshots, domain error hierarchy. Serial execution gated by `runningTaskId`. DependencyGraph uses Kahn's topological sort for cycle detection.

**Test coverage:** 1.5/5 — Only 1 test file (`task-heap.test.ts`, 12 tests) covering heap ordering, tiebreaks, duplicate rejection, arbitrary delete, empty heap, clear, and 500-element stress test. No scheduler-level tests at all — `register`, `run`, `runOnce`, dependency cascade, cycle detection, cancellation, stuck/skip propagation, retry, dynamic updates, and event subscriptions are all untested. The model left `test/task-heap.test.ts` with a missing `.js` extension import (`'./task-heap'` instead of `'./task-heap.js'`), so even this test file wouldn't run without my fix.

**Edge cases:** 2/5 — Tests cover heap ordering edge cases (empty, single element, duplicates, many random deletes). No scheduler edge cases tested: negative priorities, boundary due times, self-dependencies, duplicate dependencies, concurrent run calls, cancel during running.

**Scalability:** 2.5/5 — Architecture claims O(1) `nextExecutable` (heap peek), O(log n) push/pop/delete, O(V+E) cycle detection. The position-map index (`Map<string, number>`) makes `has` O(1) and `delete` O(log n) — better than Qwen3.8-27B's O(n) linear scan. No actual 1M benchmark was run by the model.

**Notable strengths:**
- Position-map heap (`pos: Map<string, index>`) gives true O(log n) delete — best heap design so far.
- Rich state machine: 9 states with hard/soft dep distinction, stuck vs skipped fault propagation.
- DependencyGraph is a separate, testable module with Kahn's topological sort.
- `wouldCreateCycle` targeted check per edge (O(forward-reachable)), plus `findCyclicTasks` global check.
- `RunOutcome` returns executed + stuck tasks with reasons.

**Notable weaknesses:**
- **No scheduler tests** — the only test file covers the heap. The scheduler itself (700 lines) has zero coverage.
- **`delete()` crash bug** — unconditional `heapify(idx)` when `idx === last` causes out-of-bounds read and crash. Would manifest in production on any state change that deletes the last heap element.
- **Missing test infrastructure** — no vitest config, no test runner setup, import paths missing `.js` extensions.
- **No documentation** — no README, no architecture doc, no complexity analysis.
- **EventEmitter subscription leak** — `waitFor` adds listeners but `cleanup` only runs on settle; if a task completes before `waitFor` is called, the early `return Promise.resolve(t)` skips listener registration (fine), but if the task is already cancelled, the early `return Promise.reject(...)` also skips cleanup (also fine). However, if the scheduler is long-lived and many `waitFor` calls are made/aborted, the AbortSignal listener removal is correct but the handler copy `[...handlerMap]` in `_fire` allocates on every event.

**Verdict:** Best heap implementation (position-map index) and best domain model (9 states, hard/soft deps) of the four models. But the complete absence of scheduler-level tests is a critical gap — the 700-line scheduler is entirely unverified. The `delete()` crash bug would cause production failures on any state change that removes the last ready task. The model served at 243.6 TPS avg (fastest) but 12.6 TPS gen (tied slowest with Qwen3.8-27B), and took 5h+ with the largest prefill (30.87M tokens) — suggesting verbose output or many reasoning turns.

### K2-Horizon-MoVA-36B-A4B-oQ4e ❌

**Status:** Failed to complete. The model produced only 2 source files (`errors.ts`, `heap.ts`) and failed to write the remaining implementation files. The screenshot shows the model's output was truncated/failed during file writing. No runnable code.

**Delivered:**
- `src/errors.ts` (24 lines) — Error hierarchy: `TaskSchedulerError` base, `TaskNotFoundError`, `DuplicateTaskError`, `CycleError`, `InvalidTaskStateError`.
- `src/heap.ts` (82 lines) — Generic `MinHeap<T>` with sift-up/sift-down. Standard binary heap, correct implementation.

**Missing:**
- No scheduler implementation (the core requirement).
- No types definition.
- No dependency graph / cycle detection.
- No test files.
- No package.json / build config.
- No documentation.

**Verdict:** Model failure. K2-Horizon-MoVA-36B-A4B is a large MoE model (36B active, 180GB+ bf16) that likely hit context or output token limits, or encountered an oMLX generation failure mid-response. Only the boilerplate file-writing phase completed before the output stopped. This is a model-level failure, not a code-quality issue — the 2 files delivered are correct as far as they go.

### K2-Horizon-7B-Uno-oQ6e ❌

**Status:** Failed to complete. The model produced 4 source files (`types.ts`, `errors.ts`, `heap.ts`, `index.ts`) but `task-scheduler.ts` is empty (0 bytes). Same JSON-write failure as MoVA-36B. No runnable code.

**Delivered:**
- `src/types.ts` (82 lines) — Public types: `TaskSnapshot`, `AddTaskOptions`, `SchedulerMetrics`, `TaskSchedulerOptions`. Clean, well-documented.
- `src/errors.ts` (41 lines) — Error hierarchy: `SchedulerError` base, `UnknownTaskError`, `DuplicateTaskError`, `SelfDependencyError`, `CycleError` (with cycle path), `InvalidOperationError`, `NotExecutableError`, `InvalidInputError`. More granular than most.
- `src/heap.ts` (165 lines) — `IndexedHeap<T>` with position-map index for O(log n) `removeById`, `update`, `pop`, `peek`. Clean sift-up/sift-down with swap updating both array and index. Best-in-class heap architecture.
- `src/index.ts` (6 lines) — Public entry point re-exporting `TaskScheduler`, types, and errors.
- `src/task-scheduler.ts` — **EMPTY** (0 bytes). The core implementation is missing.
- `src/scheduler.test.ts` — **EMPTY** (0 bytes). No tests.

**Verdict:** Same model-level failure as K2-Horizon-MoVA-36B — the K2 Horizon series appears unable to write JSON files in this environment. The 4 delivered files show strong design instincts: `IndexedHeap` with position-map is the best heap architecture of all submissions, error hierarchy is the most granular, and `TaskSnapshot` exposes useful telemetry (`dependencyCount`, `totalDependencies`, `dependentsCount`). But the empty `task-scheduler.ts` means zero runnable code. This is an oMLX/K2 environment issue, not a code-quality failure.

### Agnes-3.0-Flash-qwen35-oQ4e-mtp ✅

**Completeness:** 5/5 — DESIGN.md (241 lines, comprehensive), README.md (48 lines), full implementation (5 source modules), 26 correctness tests + 1 scale test, edge cases, scalability discussion with measured numbers.

**Correctness:** 5/5 — All 26 scheduler tests pass. 1M-task scale test passes: add 1.25s (800k ops/s), execute 0.80s (sub-ms p50/p95/p99 latencies), audit 0.39s over 1M nodes / 999k edges. All 1M tasks reached COMPLETED exactly once. `audit()` confirms zero structural issues post-execution.

**Production-readiness:** 4.5/5 — Strongest design of all submissions. Longest-path `level` labels enable O(1) cycle fast path (most edges skip BFS). Two-stage cycle gate: level check first, bounded BFS only when ambiguous. Lazy deletion with version bumping + auto-compact at 4× bloat. `audit()` self-verifies structural invariants (level consistency, deps/dependents lockstep, unmet drift). `restartTask()` retries failed tasks and unblocks dependents. `blockDownstream()` propagates failure/cancellation. Deterministic ordering (priority → scheduledAt → id). Domain errors (`CycleError`, `NotFoundError`, `InvalidStateError`).

**Test coverage:** 5/5 — 26 correctness tests covering ordering (priority/timestamp/id tiebreaks), chain/diamond dependencies, cycle rejection, self-dependency, duplicate idempotence, failure/cancellation cascade, restart unblocking, removeTask/removeDependency, satisfied/failed dep semantics, level fast path/raise/recompute, compact, audit drift, stats, unknown ids. Plus 1M-scale benchmark (add + execute + audit). Most thorough test suite.

**Edge cases:** 5/5 — Handles empty ids, NaN priority/scheduledAt, unknown dependencies, self-dependency, duplicate dependencies (idempotent), edges to COMPLETED deps (no version churn), edges to FAILED deps (block), stale heap entries, index corruption detection, level cascade on remove.

**Scalability:** 5/5 — 1M add 1.25s, 1M exec 0.80s, 1M audit 0.39s. Memory 718MB heapUsed / 824MB RSS. Honest failure modes documented: dense graphs (O(V+E) per edge), heap bloat (auto-compact), high fan-out cascades, memory ceiling, single-threaded assumption.

**Notable strengths:**
- Longest-path `level` labels give O(1) cycle fast path — elegant optimization.
- `audit()` is a production-grade self-verification API (catches index drift).
- Auto-compact bounds heap bloat without manual intervention.
- DESIGN.md is reviewer-ready with complexity table, invariants, honest failure modes.
- `restartTask()` + `blockDownstream()` form a complete fault-handling story.
- Measured benchmarks with calibrated assertions (not just "it runs").

**Notable weaknesses:**
- No persistence (documented as out of scope).
- Single-threaded (documented; workers must serialize through `nextTask()`).
- `compact()` is O(m log m) where m includes stale entries — could be O(m) with Floyd's heap construction.
- `peekNext()` does pop-and-restore which is 2× heap operations; could be O(1) with a non-mutating peek + version check.

**Verdict:** Best overall submission. Clean architecture, thorough testing, honest scalability discussion, production-grade fault handling. The O(1) cycle fast path via longest-path levels is the standout optimization. The 1M benchmark is the most complete (add + execute + audit, not just add). The model served at 74.6 TPS / 8.9 TPS gen — slow generation but smallest prefill (2.29M tokens) and shortest duration (3.25h). This is the submission to beat.

### BigBang-v1-MLX-oQ4e ✅

**Completeness:** 4/5 — README.md (46 lines), implementation (4 source modules), 30 tests + 1M benchmark. No separate architecture doc.

**Correctness:** 4/5 — All 30 tests pass. 1M add ~2.3s. `executeNextTask` re-pushes non-executable/future tasks (documented). `deleteTask` leaves dependents blocked (conservative). `wouldCreateCycle` + `hasCycle` work via DFS over `depSet`.

**Production-readiness:** 3.5/5 — Position-map heap (`hash: Map<string, number>`) for O(log n) `remove(id)`. Reverse adjacency graph for unblock propagation. `wouldCreateCycle` per-edge check before adding. `ITaskScheduler` interface. Hooks (`onTaskExecute`, `onTaskComplete`). `TaskStatus` enum with 7 states including `EXECUTABLE`.

**Test coverage:** 4/5 — 30 tests covering basics, priority ordering, dependency resolution, cycle detection, dynamic updates, future executeTime, metrics, clear, fail/cancel, edge cases. 1M add benchmark. Good breadth.

**Edge cases:** 4/5 — Handles empty deps, self-dependency (detected via `hasCycle` after `updateTask`), future executeTime, duplicate ids, invalid dep ids, cancel then complete throws.

**Scalability:** 4/5 — 1M add ~2.3s. `getExecutableTasks()` is O(n) scan (documented as avoiding `_refreshHeap` to prevent recursion). `executeNextTask` re-pushes collected tasks — worst case O(n) per call if many future-scheduled tasks at heap top.

**Notable strengths:**
- Position-map heap gives true O(log n) `removeById`.
- `wouldCreateCycle` + iterative DFS cycle detection.
- `ITaskScheduler` interface for testability/dependency injection.
- Hooks for observability.

**Notable weaknesses:**
- `executeNextTask` re-pushes all popped non-executable tasks — O(n) worst case per call when many future tasks exist.
- `getExecutableTasks()` does O(n) scan (correct but slow at scale).
- `deleteTask` leaves dependents permanently blocked (documented but no retry path).
- No `audit()` / self-check API.
- No stale-entry handling — heap can grow unboundedly with future-scheduled tasks.
- `updateTask` with dependencies calls `_unregisterDeps` + `_registerDeps` but doesn't check cycles — `hasCycle()` can return true after an update (test on line 94).

**Verdict:** Fastest serving (418 TPS / 54.7 TPS gen) and shortest duration (1.25h). 30 tests pass cleanly. The 1M benchmark passes but only adds tasks — doesn't drain/execute. The position-map heap is strong, but `executeNextTask`'s re-push strategy and the lack of cycle detection during `updateTask` (cycles can be created via `updateTask` and only detected later via `hasCycle()`) are real limitations vs Agnes's approach.

### Nex-N2.5-mini-oQ4 ✅

**Completeness:** 4/5 — DESIGN.md (195 lines), README.md (4 lines), implementation (1 source module — `index.ts`, 765 lines), 29 tests. Session progress file included.

**Correctness:** 4.5/5 — All 29 tests pass. 1M add 1.1s. Two-heap design (due + future) with `advanceTime` promotion. Cycle detection via topological sort position check + DFS. `BinaryHeap` with index tracking for O(log n) `removeAt`.

**Production-readiness:** 4/5 — Strong design. Due/future heap separation. O(log n) `removeAt` via index tracking. Cycle detection: `requiresCycleCheck` (topological position check) → `hasDependencyCyclePath` (DFS). `TaskDependencyCycleError` with path. `TaskHasDependentsError` prevents removing tasks with dependents. `TaskTimeError` for clock regression. Frozen snapshots.

**Test coverage:** 4.5/5 — 29 tests covering ordering (priority/time/lexical), time-gating, promotion, clock regression, priority updates, heap moves, dependency hiding, dependency completion, back-references, dynamic add/remove dependency, cycle rejection (including 50k-node deep chain), atomic replacement, leaf removal, task claims, start/complete validation, 1M add. Very good breadth.

**Edge cases:** 4.5/5 — Handles empty ids, duplicate ids, duplicate deps, NaN/Infinity validation, clock regression, removing completed deps, removing tasks with dependents, frozen snapshots, 50k-node cycle detection.

**Scalability:** 4.5/5 — 1M add 1.1s. Two-heap design with O(log n) `removeAt`. Cycle detection via topological sort (O(V+E)) + DFS. 1M test adds independent tasks only (no drain).

**Notable strengths:**
- Two-heap (due + future) with index-tracked BinaryHeap for O(log n) `removeAt`.
- `requiresCycleCheck` optimization: if `dependencyPosition > taskPosition` in topological order, needs full DFS; otherwise safe.
- `rebuildTopologicalOrder` for dynamic dependency updates.
- `advanceTime` promotes future tasks lazily.
- 50k-node deep cycle detection test passes without stack overflow.

**Notable weaknesses:**
- Single 765-line file — no modular separation (types, heap, scheduler all in one).
- No `audit()` / self-check API (relies on external testing).
- `removeTask` throws `TaskHasDependentsError` — conservative but no way to force-remove.
- `classify` can double-push tasks if called when already enqueued (no idempotency check).
- No compact/stale-entry handling.
- 1M test only adds, doesn't drain/execute.

**Verdict:** Clean two-heap design with O(log n) `removeAt` and strong cycle detection. 29 tests pass including 50k-node deep cycle. Served at 360 TPS but took 8h+ with 60M+ prefill (largest token count). Falls behind Agnes on architecture (no audit API, no level-based fast path) but ahead of BigBang on design clarity.

### Muse-Glimmer-30B-oQ4e ✅

**Completeness:** 4/5 — ARCHITECTURE.md (213 lines), IMPLEMENTATION_SUMMARY.md (107 lines), README.md (191 lines), full implementation (5 source modules), 21 tests. No 1M benchmark (10k only).

**Correctness:** 2/5 — **Syntax error in source**: `re-evaluateTaskReadiness` (hyphen in method name) prevents compilation. I fixed it to run tests. After fix: **17/21 tests pass, 4 fail**. **Bug 1**: `cancelTask` sets `task.status = CANCELLED` *before* checking `if (task.status === READY)` — the check can never be true (TypeScript even flags this as TS2367: comparison has no overlap). Result: cancelled READY tasks never leave the ready queue and metrics drift. **Bug 2**: `createTask` marks dep-free tasks READY immediately, but the test expects PENDING (test/impl disagreement on initial state). **Bug 3**: `failTask` retry path has the same READY-vs-PENDING confusion. **Bug 4**: `cleanupCompletedTasks` fails — likely related to fake-timer `completedAt` handling.

**Production-readiness:** 3/5 — Recursive `cancelTask` (stack overflow risk on deep chains). `cleanReadyQueue` drains and rebuilds the entire heap on every `getNextExecutableTask` call — O(n log n) per retrieval, defeating the heap's purpose. `PriorityQueue.remove(predicate)` is O(n) linear scan. No type-safe error hierarchy (plain `Error` with string matching). `bulkCreate` swallows errors with `console.warn`. No injectable clock (tests rely on `vi.useFakeTimers`).

**Test coverage:** 3/5 — 21 tests covering creation, dependencies, cycle detection, priority ordering, scheduled time, state transitions, retry, cancel cascade, dependency completion, chains, metrics, edge cases, 10k bulk create. Reasonable breadth but 4/21 fail on the model's own expectations.

**Edge cases:** 3/5 — Handles no-name tasks, updating completed tasks, deleting tasks with dependents, bulk creation, old-task cleanup. Missing: duplicate deps, negative priorities, boundary times, deep chains (only 4-level), 1M scale.

**Scalability:** 2/5 — **No 1M benchmark** (only 10k). `cleanReadyQueue` is O(n log n) per `getNextExecutableTask` — at 1M tasks this is catastrophic. `processScheduledTasks` scans all tasks on every retrieval — O(n) per call. `PriorityQueue.remove` is O(n). The architecture claims 1M support but the hot path is O(n log n) per retrieval, not O(log n).

**Notable strengths:**
- Comprehensive documentation (3 docs: ARCHITECTURE, IMPLEMENTATION_SUMMARY, README).
- `bulkCreate` two-pass approach (create without deps, then add deps) avoids forward-reference issues.
- `cleanupCompletedTasks` memory management.
- Graph module with `findCycle` returning the actual path.
- Tags support for task categorisation.

**Notable weaknesses:**
- **Syntax error** — `re-evaluateTaskReadiness` doesn't compile. The model never ran its own code.
- **cancelTask dead code** — status set before checked, so cleanup never runs (TS2367 flagged).
- **cleanReadyQueue is O(n log n) per retrieval** — destroys heap performance at scale.
- 4/21 tests fail on the model's own expectations (READY vs PENDING state confusion).
- No 1M benchmark despite claiming 1M support.
- Recursive cancel — stack overflow on deep dependency chains.
- No injectable clock — tests depend on `vi.useFakeTimers` global mutation.

**Verdict:** Weakest passing submission. The syntax error proves the model never executed its own code. The `cancelTask` dead-code bug (status set before checked) is a classic ordering error that TypeScript's control-flow analysis explicitly flags. The `cleanReadyQueue` full-heap-rebuild-per-retrieval design makes the 1M claim hollow — `getNextExecutableTask` is O(n log n), not O(log n). Served at just 40 TPS with the smallest prefill (733.9K) — the model was fast but produced unverified, incorrect code. The documentation is the strongest part; the implementation is the weakest.

### KAT-Coder-V2.5-Dev-VL-oQ4e-mtp ✅

**Completeness:** 4/5 — COMPLEXITY.md (114 lines), EDGE_CASES.md (94 lines), README.md (94 lines), single-file implementation (`scheduler.ts`, 581 lines), 24 tests. All required sections covered.

**Correctness:** 3.5/5 — All 24 tests pass on real execution. No syntax errors. `hasCycle()` uses recursive 3-color DFS (correct but recursion-based). `cancelDependents` is recursive. Duplicate-id addTask silently overwrites (test asserts this as intended behaviour — questionable design).

**Production-readiness:** 3/5 — `MinHeap.clean(filter)` does `heap.filter()` + full re-heapify — O(n) per call. **Called on every `cancelTask`, every `removeTask`, and every `drainReadyQueue`** (which itself runs on every `getNextTask`/`popNextTask`). This makes the hot path O(n) per retrieval, not O(log n) as claimed. `drainReadyQueue` in lazy mode keeps only `state === READY && executionTime <= now` — but future tasks that were pushed to heap get filtered out and **never re-entered** (they're lost from the heap entirely; `moveToReady` only fires once). No injectable clock. No error-code taxonomy beyond `code` string field.

**Test coverage:** 3.5/5 — 24 tests covering add, future-time, self-dependency, maxTasks, priority ordering, time tiebreak, cancelled-task skipping, dependency completion, cycle detection, multi-level deps, state transitions, fail/cancel cascade, update, state counts, topological sort, edge cases (empty, remove, duplicate, batch), 10k performance. Good breadth. Test names are in Chinese (应返回优先级最高的任务) — unusual but functional.

**Edge cases:** 3.5/5 — Handles self-dependency, maxTasks limit, cancelled-task skipping, duplicate-id overwrite, empty scheduler, remove without cascade. Missing: 1M scale, deep chains, negative priorities, boundary times.

**Scalability:** 2/5 — **No 1M benchmark** (10k only, at 3.0s — 100× slower per-task than the leaders' 1M-in-1s). The `heap.clean()` O(n)-per-operation design is the root cause: every `popNextTask` triggers a full heap filter + re-heapify. At 1M tasks this is O(n) per retrieval — the claimed O(log n) is wrong in practice. `hasCycle()` runs on every `addTask` — O(V+E) per add, O(n²) total for n adds.

**Notable strengths:**
- All 24 tests pass with zero fixes needed — the only model besides Agnes/Nex/BigBang/Qwen with a clean first run.
- Recursive 3-color DFS cycle detection with rollback on add.
- `SchedulerError` with machine-readable `code` field.
- COMPLEXITY.md and EDGE_CASES.md are well-structured docs.
- Duplicate-id overwrite semantics (documented in test).

**Notable weaknesses:**
- **`heap.clean()` is O(n) and called on every retrieval** — the hot path is O(n), not O(log n). The complexity table in COMPLEXITY.md claims O(1) amortized `getNextTask` — false.
- **Future tasks are silently lost from the heap** — `drainReadyQueue` filters out `executionTime > now` entries, but there's no future-heap or re-promotion mechanism. A task added with a future time that somehow enters the heap is dropped permanently.
- 10k adds in 3.0s — ~300 ops/s vs leaders' ~1M ops/s. 3,000× slower.
- `hasCycle()` on every add — O(V+E) per add, O(n²) total.
- Recursive DFS/cancel — stack overflow risk on deep chains.
- No 1M benchmark despite claiming "Supports 1M+ tasks".

**Verdict:** Fastest serving of all models (708 TPS avg / 67.1 TPS gen) and shortest duration (0.34h), with clean test passes — but the implementation has a fundamental scalability flaw: `heap.clean()` makes every retrieval O(n), and future-timed tasks can be silently dropped from the heap. The complexity documentation claims O(1) amortized retrieval, which the code demonstrably does not deliver (10k adds in 3s vs leaders' 1M in 1s). The Chinese test names suggest a Chinese-trained model. Solid correctness at small scale, but the 1M claim is unsupported by both benchmark and algorithmic design.

### NeoHorse-1-9B-oQ6e ✅

**Completeness:** 3/5 — Implementation (4 source modules), 23 tests. No README, no architecture doc, no complexity analysis, no scalability discussion. Missing most of the prompt's documentation requirements.

**Correctness:** 1.5/5 — **10/23 tests pass, 13 fail.** The `BinaryMinHeap` is fundamentally broken:
- **`pop()` crash**: `this.tasks.delete(last)` runs *before* `this.taskIndices.delete(this.tasks.get(last)!.id)` — the map entry is already deleted, so `this.tasks.get(last)` returns `undefined` and `.id` throws. Every `executeNext()` on a heap with >1 element crashes.
- **`delete()` crash**: same ordering bug — `this.tasks.get(last)!.id` after `heap.pop()` but the `tasks` map still has the entry keyed by *index*, not id; `taskIndices.delete(last.toString())` deletes by *stringified index* instead of task id.
- **`updateStatusCounts()` accumulates**: it increments counters without resetting them first — every call adds the full task count again. The 10k test shows `pending = 50005000` instead of 10000 (sum of 1..10000). Statistics are garbage after the first operation.
- **Cancel doesn't cascade**: `cancelTask('parent')` sets only the parent to CANCELLED; the child remains PENDING. Test expects 2 cancelled, gets 1.
- **`updateTask` pushes duplicate heap entries**: `heap.push(updatedTask)` without removing the old entry — the heap grows with stale duplicates that are never cleaned.

**Production-readiness:** 2/5 — `runTaskLogic` returns a hardcoded `{ status: 'SUCCESS' }` — there's no actual task execution, just a stub. `updateStatusCounts()` is called on every mutation and is O(n) — at 1M tasks this is O(n) per operation. `getNextTask()` and `getReadyCount()` are O(n) full scans with per-task dependency checks (O(n×d)). No cycle prevention on add (only `detectCycles()` post-hoc). No injectable clock. Priority validation restricts to 1–10000 (arbitrary).

**Test coverage:** 3/5 — 23 tests covering priority ordering, timestamp ordering, stale-entry skipping, dependency chains, multiple deps, cycle detection (3-node, self-loop, DAG), dynamic priority update, remove, cancel, no-deps, future-scheduled, 1000-task, statistics, getNextTask, update on pending, remove completed, failed dep, reset, 10k tasks, 100-dep fan-in. Good breadth — but 13/23 fail.

**Edge cases:** 2.5/5 — Handles future-scheduled tasks, self-referencing cycles, DAG verification, failed dependencies, reset. Missing: 1M scale, duplicate ids (partially — throws), negative priorities, boundary times, deep chains.

**Scalability:** 1.5/5 — **No 1M benchmark** (10k only, and it fails on statistics). `updateStatusCounts()` is O(n) per mutation. `getNextTask()`/`getReadyCount()` are O(n) scans. The heap crashes on basic operations. The 10k test's `pending = 50005000` demonstrates the counting bug at scale.

**Notable strengths:**
- `detectCycles()` correctly returns cycle paths (not just booleans).
- Test suite breadth is reasonable (23 tests).
- `executeAllReady(limit)` batch API.
- Event callbacks (`onTaskComplete`, `onTaskFail`).

**Notable weaknesses:**
- **Heap `pop()`/`delete()` crash** — `this.tasks.get(last)!.id` after deleting the map entry. Every multi-element pop throws.
- **`updateStatusCounts()` accumulates without reset** — statistics are meaningless after the second call.
- **Cancel doesn't cascade to dependents** despite the test expecting it.
- **`runTaskLogic` is a stub** — returns hardcoded SUCCESS, no actual execution model.
- **`updateTask` leaks heap entries** — pushes new entry without removing old.
- No documentation (no README, no architecture, no complexity analysis).
- No 1M benchmark.

**Verdict:** The weakest submission of all. 13/23 tests fail — the heap crashes on basic `pop()`/`delete()` operations due to a map-delete-before-read ordering error, statistics accumulate without reset (10k tasks report 50M pending), cancel doesn't cascade, and `runTaskLogic` is a hardcoded stub. The model never ran its own tests. Served at 284 TPS for 9 hours (longest duration tied with Qwen3.8) — much time spent, nothing verified. The `detectCycles()` implementation returning actual paths is the only bright spot.

### Tiel-Coder-35B-A3B-MLX-oQ4e-MTP ✅

**Completeness:** 5/5 — DESIGN.md (229 lines, genuinely reviewer-grade: architecture diagram, state-machine table, complexity table, edge-case guarantees, scalability discussion with honest cost analysis), full implementation (7 source modules), 53 tests across 2 suites. All prompt sections covered.

**Correctness:** 4.5/5 — All 53 tests pass on first run, zero fixes needed. The reactive state machine (task's heap membership fully determined by state) is the cleanest design in the field. **However: `tsc --noEmit` fails with 22 errors** — `Task.deps` is typed `Set<TaskId>` but used as an array throughout (`push`, `splice`, `indexOf`, `map`), `Task<D>` incorrectly extends `TaskSpec<D>` with incompatible `deps` types, missing `setTimeout`/`clearTimeout` under the `ES2022` lib config, and readonly-property reassignment in `resetClock()`. Runtime works because `tsx` strips types without checking — the model never typechecked its own code.

**Production-readiness:** 4.5/5 — Two index-backed heaps (ready + time) with O(log n) `remove` via position map. Reactive `_setReady`/`_setWaiting`/`_setPending`/`_setRunning` transitions — membership can't drift. Id interning to cut string allocations. Injectable clock AND timers. Auto-timer (`_updateTimer`) with explicit non-recursion design. Cancel keeps records for inspection. Typed error hierarchy (7 classes). `toJSON()` serialization. `complete()` returns newly-runnable dependents.

**Test coverage:** 4.5/5 — 53 tests: basic queueing, WAITING→READY promotion, priority ordering (incl. 5000-task strict-ordering sweep), dependency tracking (chains, multi-dep, dynamic add), dynamic updates (priority re-key, runAt promote/demote, payload), cycle detection (self, 3-node, 5-node, 10k-chain no-overflow), removal, cancellation cascade, lifecycle validation, completion results, heap invariant checks, clear, toJSON. Tests are self-aware with honest comments (e.g. the priority-ordering test explains why a previous version didn't test ordering at all).

**Edge cases:** 4.5/5 — Handles NaN/Infinity rejection, self-dep, unknown deps, duplicate ids, complete-non-running, double-complete, remove-RUNNING, cancel-DONE, cancel-unknown, WAITING→PENDING demotion on added dep, stale heap entries in `tick()`, 10k-deep cycle chains. Missing: negative priorities, boundary-inclusive runAt, 1M-scale edge cases.

**Scalability:** 4.5/5 — **My 1M benchmark (the model shipped none): add 1.22s (822k ops/s — fastest add of the field), full drain 4.02s, 413MB heapUsed** — leanest memory of any submission (Agnes: 718MB). Only 3 of 10 scored models drained 1M; Tiel is one of them. Cycle check is O(V+E) per `addDependency` but correctly kept off the hot path. DESIGN.md honestly flags this and the 32-bit setTimeout clamp. No shipped benchmark of its own — the scale claim was unverified until I ran it.

**Notable strengths:**
- Reactive state machine: heap membership ≡ task state — no drift possible, no stale-entry bookkeeping.
- Fastest 1M add (822k ops/s) and lowest memory (413MB) of the entire field.
- Test suite comments show genuine self-review (documents why earlier test versions were inadequate).
- Id interning for allocation reduction — the only submission that thought about string churn.
- Timer design with explicit non-recursion reasoning.

**Notable weaknesses:**
- **22 TypeScript errors** — the code never typechecked. `deps` typed as `Set` but used as `Array` throughout would be caught by any CI gate. Runtime-only correctness.
- No shipped 1M benchmark (I had to write one).
- `_wouldCycle` rebuilds the edge map (`_edges()`) on every iteration of the DFS — O(V) allocation per visited node; the standalone `cycleDetection.ts` module exists but the scheduler doesn't use it (dead code).
- `intern.ts` leak-by-design: the intern table grows unboundedly across the process lifetime and `unintern()` is an identity function that doesn't restore number ids.
- `DuplicatedDependencyError` and `cycleDetection.ts` are defined but never used.

**Verdict:** Third place, narrowly behind Qwen3.8-27B. The reactive two-heap design is the most elegant architecture in the field — membership-can't-drift is a genuinely senior insight — and my benchmark confirms the best add throughput and memory footprint of all 12 models. But the 22 unfixable-at-a-glance type errors mean the code was never compiled: `tsx`-only execution hid a `Set`-vs-`Array` type confusion that any `tsc` pass would have caught. Served at 461 TPS avg / 51.5 TPS gen in 2.7h — fast and efficient. If Tiel had run `tsc` once, this would have challenged Agnes for the top spot.

### Qwen3-Coder-Next-oQ4 ✅

**Completeness:** 5/5 — README.md (106 lines, serves as design doc with architecture diagram, data-structure notes, complexity table, memory estimate, edge-case list), full implementation (6 source modules), 47 tests across 3 suites. All prompt sections covered.

**Correctness:** 4/5 — All 47 tests pass. `tsc --noEmit` clean (0 errors) — the only submission besides Agnes, Nex, and BigBang with a clean compile. Pairing heap with O(1) amortized insert/extract. DependencyGraph with Kahn's algorithm for cycle detection. **But: `PairingHeap.remove()` is broken** — the code ships a comment admitting it: "simplified removal that doesn't maintain heap property... For production, would need to track parent pointers or rebuild." It deletes from the node map without removing from the heap, leaving stale entries that `getNextExecutable` must skip lazily. **And: `wouldCreateCycle` caps DFS depth at 1000** — a 1M-task chain with a closing edge would not have its cycle detected. **And: `completeTask` doesn't remove dependency edges** — it decrements in-degree so `isReady()` works, but `getDependencies()` still reports stale edges. **And: README claims ~250MB for 1M tasks** — actual is ~1.5GB, off by 6x.

**Production-readiness:** 3.5/5 — Pairing heap gives O(1) amortized decrease-key (best theoretical bounds in the field). **But**: the lazy `remove()` means the heap grows with stale entries under churn — every `removeTask` leaves garbage until the task surfaces at the top and gets skipped. 1467MB heapUsed for 1M tasks is the **highest memory of any submission** (Tiel: 413MB, Agnes: 718MB). README's 250MB estimate is wrong by 6x. The 1000-depth cycle cap is a real correctness boundary. No injectable clock.

**Test coverage:** 4/5 — 47 tests across 3 suites: TaskScheduler (priority, timestamps, dependencies, cycle detection, dynamic updates, 1M stress test, edge cases), PairingHeap (sorted order, duplicate rejection, remove, clear, stress), DependencyGraph (add/remove deps, in-degree, cycle detection, path finding). Good breadth. Missing: negative priorities, boundary-inclusive executeAt, deep chains (>1000) for cycle detection.

**Edge cases:** 3.5/5 — Handles empty scheduler, task not found, self-dependency, circular dependencies via updateTask, duplicate ids, rapid updates, 1M stress test. Missing: negative priorities, boundary times, deep cycles beyond the 1000-depth cap.

**Scalability:** 3.5/5 — **My 1M benchmark: add 2.12s, exec 2.11s, 1467MB heapUsed.** Fast add/exec but the highest memory of the field — each PairingHeap node is a full object with children array + parent pointer, and the lazy `remove()` leaves stale entries. The model's own test (using `removeTask` pattern) reports 3.06s add / 3.50s extract. Cycle detection on `addDependency` uses Kahn's algorithm correctly but `wouldCreateCycle` is capped at 1000 depth.

**Notable strengths:**
- Cleanest compile in the field: `tsc --noEmit` passes with zero errors — the only submissions to achieve this are Agnes, Nex, BigBang, and Qwen3-Coder-Next.
- Pairing heap gives the best theoretical complexity: O(1) amortized insert and decrease-key.
- README is a genuine design document with architecture diagram, data-structure rationale, complexity table, and edge-case list.
- 47 tests across 3 well-separated suites with a 1M stress test included.
- Kahn's algorithm correctly detects cycles on edge insertion.

**Notable weaknesses:**
- **`PairingHeap.remove()` is broken** — admits in a comment it "doesn't maintain heap property." Lazy deletion works around it but leaves stale entries that waste memory and require skipping.
- **Highest memory of the field** — 1467MB for 1M tasks vs Agnes's 718MB and Tiel's 413MB. README's 250MB estimate is off by 6x.
- **`wouldCreateCycle` depth cap at 1000** — real correctness bug for deep dependency chains.
- **`completeTask` leaves stale dependency edges** — in-degree is decremented correctly, but the `dependencies` map still lists the completed task.

**Verdict:** Ties for fifth with Qwen3.6-35B and BigBang. The cleanest compile and best theoretical heap complexity in the field, held back by a broken `remove()` (admitted in-code), the highest memory footprint, and a cycle-detection depth cap that fails on deep graphs. Served at 459 TPS / 40.9 TPS gen in 0.75h — fast serving, fast benchmark, but the memory and lazy-deletion issues keep it out of the top tier.

</details>

---

## Final Leaderboard

| Rank | Model | C | Cr | PR | TC | E | Sc | Total/30 |
|------|-------|---|----|----|----|----|----|----------|
| 1 | **Agnes-3.0-Flash-qwen35-oQ4e** | 5 | 5 | 4.5 | 5 | 5 | 5 | **29.5** ★ |
| 2 | Qwen3.8-27B-oQ4e-mtp | 5 | 5 | 4.5 | 5 | 5 | 4 | 28.5 |
| 3 | Tiel-Coder-35B-A3B-MLX-oQ4e-MTP | 5 | 4.5 | 4.5 | 4.5 | 4.5 | 4.5 | 27.5 |
| 4 | Nex-N2.5-mini-oQ4 | 4 | 4.5 | 4 | 4.5 | 4.5 | 4.5 | 26 |
| 5 | Qwen3.6-35B-A3B-oQ4e-mtp | 4 | 4 | 4 | 4 | 4 | 3.5 | 23.5 |
| 5 | BigBang-v1-MLX-oQ4e | 4 | 4 | 3.5 | 4 | 4 | 4 | 23.5 |
| 5 | Qwen3-Coder-Next-oQ4 | 5 | 4 | 3.5 | 4 | 3.5 | 3.5 | 23.5 |
| 8 | Ornith-1.5-35B-A3B-oQ4e-mtp | 5 | 3.5 | 4 | 3.5 | 3.5 | 3.5 | 23 |
| 9 | KAT-Coder-V2.5-Dev-VL-oQ4e-mtp | 4 | 3.5 | 3 | 3.5 | 3.5 | 2 | 19.5 |
| 10 | Muse-Glimmer-30B-oQ4e | 4 | 2 | 3 | 3 | 3 | 2 | 17 |
| 11 | NeoHorse-1-9B-oQ6e | 3 | 1.5 | 2 | 3 | 2.5 | 1.5 | 13.5 |
| — | K2-Horizon-7B-Uno-oQ6e (= row 13) | — | — | — | — | — | — | Failed |
| — | K2-Horizon-MoVA-36B-A4B-oQ4e | — | — | — | — | — | — | Failed |

\* Nex-N2.5-mini scores sum to 26 (4+4.5+4+4.5+4.5+4.5), previously reported as 25.5 — corrected.

**Key takeaways:**

- **Agnes-3.0-Flash wins decisively** — the only submission with a complete 1M benchmark (add 1.25s + execute 0.80s + audit 0.39s), an O(1) cycle fast path via longest-path levels, an `audit()` self-verification API, and honest failure-mode documentation. Every test passed on first run.
- **Tiel-Coder debuts at #3** — the most elegant architecture in the field (reactive state machine where heap membership ≡ task state) plus the fastest 1M add (822k ops/s) and lowest memory (413MB). Held back by 22 TypeScript errors: the code never passed `tsc`, and a `Set`-vs-`Array` type confusion on `deps` runs only because `tsx` skips typechecking.
- **Qwen3.8-27B takes depth** — best diagnostic APIs (`selfCheck`, `validateGraph`, concrete cycle paths), but its O(n) `heap.remove()` showed in a 44.9s diamond-drain.
- **The K2 Horizon failures are environmental** — both the 7B and 36B variants died writing JSON files mid-generation, producing empty `task-scheduler.ts` files. The delivered fragments (IndexedHeap with position-map, granular error hierarchy) suggest the model had strong design instincts but the serving stack couldn't complete the output.
- **Serving speed ≠ code quality** — KAT-Coder served at 708 TPS (fastest) but produced an O(n)-per-retrieval heap; Agnes served at 74.6 TPS (slowest but one) and produced the best code. NeoHorse spent 9 hours and delivered a crashing heap.
- **7 of 11 scored models ran a 1M benchmark** (Agnes, Qwen3.8, Qwen3.6, Ornith-35B, Nex, BigBang, Tiel — the last verified by my own benchmark), but only Agnes tested all three phases at that scale — add, execute, and audit.

---

## Methodology

- One model at a time (no concurrent execution)
- Same prompt across all models
- Output saved to `/Users/hermit.dave/Projects/h2h-run2/<model-name>/output.md`
- TPS measured from oMLX server logs
- Quality assessed by: completeness, correctness, production-readiness, test coverage, edge case handling
