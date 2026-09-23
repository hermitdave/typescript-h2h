# TypeScript Head-to-Head: Local LLM Coding Benchmark

**15 local models. One prompt. One production-grade TypeScript task scheduler. Zero cloud APIs.**

Every model ran locally via [oMLX](https://github.com/ml-explore) on an Apple M3 Max (64 GB), one at a time, same prompt, same review process. Each submission was then **actually executed** — tests run, benchmarks measured, TypeScript compiled, bugs hunted — not just read.

## The Prompt

> Design and implement a production-ready in-memory task scheduler using TypeScript supporting 1 million tasks with priorities, execution timestamps, dependency tracking, dynamic updates, cycle detection, and efficient retrieval of the next executable task. Your answer must include: architecture, data structures, complexity analysis, complete implementation, tests, edge cases, scalability discussion. Do not simplify the problem. Assume this system will be deployed in production and your design choices will be reviewed by senior engineers.

Full text: [PROMPT.md](PROMPT.md)

## Final Leaderboard

| # | Model | Score /30 | Tests | 1M Add | Notes |
|---|-------|-----------|-------|--------|-------|
| 🥇 | **Agnes-3.0-Flash-qwen35-oQ4e** | **29.5** | 26/26 ✅ | 1.25s | O(1) cycle fast path, `audit()` self-verification, full 1M add+exec+audit benchmark |
| 🥈 | Qwen3.8-27B-oQ4e-mtp | 28.5 | 56/56 ✅ | 1.0s | Best diagnostic APIs; O(n) heap remove showed in 44.9s diamond drain |
| 🥉 | Tiel-Coder-35B-A3B-MLX-oQ4e-MTP | 27.5 | 53/53 ✅ | 1.22s | Most elegant architecture + fastest add (822k ops/s); **22 tsc errors — never compiled** |
| 4 | Nex-N2.5-mini-oQ4 | 26 | 29/29 ✅ | 1.1s | Clean two-heap design, 50k-deep cycle test |
| 5= | Qwen3.6-35B-A3B-oQ4e-mtp | 23.5 | 90/90 ✅ | 1.5s | Broadest test suite; cancel-during-running gap |
| 5= | BigBang-v1-MLX-oQ4e | 23.5 | 30/30 ✅ | ~2.3s | Fastest serving (418 TPS); cycles creatable via updateTask |
| 5= | Qwen3-Coder-Next-oQ4 | 23.5 | 47/47 ✅ | 2.12s | Cleanest compile + pairing heap; **highest memory (1467MB)** |
| 8 | Ornith-1.5-35B-A3B-oQ4e-mtp | 23 | 25/25 ✅ | 1.28s | Best architecture doc; `sinkDown` heap-invariant bug |
| 9 | KAT-Coder-V2.5-Dev-VL-oQ4e-mtp | 19.5 | 24/24 ✅ | 10k in 3.0s | 708 TPS serving; O(n) heap.clean() per retrieval |
| 10 | Muse-Glimmer-30B-oQ4e | 17 | 17/21 ❌ | — | Syntax error in source; 4 tests fail on own expectations |
| 11 | NeoHorse-1-9B-oQ6e | 13.5 | 10/23 ❌ | — | Heap pop/delete crash; stats accumulate without reset |
| 12 | Ornith-1.5-9B-oQ6e | 15.5 | 12/12 ✅ | — | Source compiles; heap ordering bug found |
| — | K2-Horizon-7B-Uno-oQ6e | Failed | — | — | Empty `task-scheduler.ts` — JSON-write failure mid-generation |
| — | K2-Horizon-MoVA-36B-A4B-oQ4e | Failed | — | — | Only 2 of ~6 files written — same environmental failure |
| — | Qwen3.8-Flash-Next-99B-A5B-Niwaki-3bit | — | — | — | Never ran (folder contains only PROMPT.md) |

Scoring: six categories × 5 points (completeness, correctness, production-readiness, test coverage, edge cases, scalability). Full per-model analysis with every bug trace: [RESULTS.md](RESULTS.md).

## Key Findings

**1. Serving speed ≠ code quality.** KAT-Coder served at 708 TPS (fastest) and produced a heap that rebuilds itself O(n) on every retrieval. Agnes served at 74.6 TPS (second slowest of the scored models) and produced the winning implementation. NeoHorse spent 9 hours generating a scheduler that crashes on its own test suite.

**2. The two best models were the two slowest servers.** Agnes and Qwen3.8-27B tied at 74.6 TPS average — second slowest of the field, ahead of only Muse at 40 TPS. Agnes finished in 3.25h having processed 2.29M prefill tokens. Qwen3.8 burned 22.26M prefill (nearly 10×) over 8h. The best code came from the models that took their time.

**3. Most models never verified their own output.** Of 12 scored submissions:
- 3 shipped code that fails its own tests (Muse: syntax error + 4 failures; NeoHorse: 13 failures; Ornith-9B: heap ordering bug)
- 1 never compiled (Tiel: 22 `tsc` errors, hidden by `tsx` type-stripping)
- Only 7 shipped a 1M benchmark; only Agnes tested add + execute + audit at that scale

**4. The K2 Horizon failures are environmental, not model quality.** Both variants died writing JSON files mid-generation, leaving empty `task-scheduler.ts` files. The fragments that did land — an `IndexedHeap` with position-map index, the most granular error hierarchy in the field — suggest strong design instincts strangled by the serving stack.

**5. The winning patterns.** Agnes's O(1) cycle fast path (longest-path level labels — most edges skip the DFS entirely), Tiel's reactive state machine (heap membership ≡ task state, so drift is structurally impossible), and position-map heaps for O(log n) delete appeared in the top submissions. The failures clustered on: heap re-build-per-operation, status-set-before-check, and statistics that accumulate without reset.

**6. Heap bugs are the great equaliser.** Four of twelve scored submissions shipped a broken heap: Ornith-35B's `sinkDown` stops early on left-child-only nodes, Ornith-9B's `delete()` reads a map entry after deleting it, NeoHorse's `pop()` crashes the same way, Muse's `cancelTask` checks a status it just overwrote. A hand-rolled binary heap is where these models are weakest.

**7. Qwen3-Coder-Next: the memory cautionary tale.** Cleanest compile in the field (zero `tsc` errors — one of only four submissions to achieve this), pairing heap with O(1) amortized decrease-key, 47 tests across 3 suites. But at 1467MB heapUsed for 1M tasks, it used 3× the memory of Tiel (413MB) and 2× Agnes (718MB). The lazy `remove()` admits in-code it "doesn't maintain heap property." Fast benchmark, high memory, incomplete cleanup.

## Repository Layout

```
├── RESULTS.md          # Full analysis: scores, bug traces, benchmarks, serving stats
├── PROMPT.md           # The exact prompt every model received
└── submissions/        # Each model's output, verbatim (node_modules stripped)
    ├── Agnes-3.0-Flash-qwen35-oQ4e/
    ├── BigBang-v1-MLX-oQ4e/
    ├── K2-Horizon-7B-Uno-oQ6e/          # failed — empty core file
    ├── K2-Horizon-MoVA-36B-A4B-oQ4e/    # failed — 2 of 6 files
    ├── KAT-Coder-V2.5-Dev-VL-oQ4e-mtp/
    ├── Muse-Glimmer-30B-oQ4e/
    ├── NeoHorse-1-9B-oQ6e/
    ├── Nex-N2.5-mini-oQ4/
    ├── Ornith-1.5-35B-A3B-oQ4e-mtp/
    ├── Ornith-1.5-9B-oQ6e/
    ├── Qwen3.6-35B-A3B-oQ4e-mtp/
    ├── Qwen3.8-27B-oQ4e-mtp/
    ├── Qwen3.8-Flash-Next-99B-A5B-Niwaki-3bit/  # never ran
    ├── Tiel-Coder-35B-A3B-MLX-oQ4e-MTP/
    └── Qwen3-Coder-Next-oQ4/
```

## Methodology

- **One model at a time** on a dedicated local oMLX server — no concurrent execution.
- **Same prompt** for every model, delivered as `PROMPT.md` in each working directory.
- **Real verification** of every submission: `npm install && npm test` (or the model's own runner), `tsc --noEmit` where TypeScript is claimed, and a 1M-task benchmark written by the reviewer when the model didn't ship one.
- **Token/throughput data** captured from oMLX server logs per run.
- **Scoring** across six categories, each 0–5, judged on execution evidence rather than documentation claims.

## Serving Statistics

| Model | Duration | Prefill | Cache Eff. | Avg TPS | Gen TPS |
|-------|----------|---------|-----------|---------|---------|
| KAT-Coder-V2.5-Dev-VL | 0.34h | 1.36M | 90.9% | 708.1 | 67.1 |
| Qwen3-Coder-Next | 0.75h | 5.40M | 92.7% | 459.0 | 40.9 |
| BigBang-v1-MLX | 1.25h | 10.91M | 96.5% | 418.2 | 54.7 |
| Tiel-Coder-35B-A3B | 2.7h | 16.36M | 95.7% | 461.0 | 51.5 |
| Agnes-3.0-Flash | 3.25h | 2.29M | 93.9% | 74.6 | 8.9 |
| Qwen3.6-35B-A3B | 3h | 12M | 94.8% | 199.1 | 31.9 |
| Muse-Glimmer-30B | 0.4h | 733.9K | 93.8% | 40.0 | 14.2 |
| Ornith-1.5-35B-A3B | 5h | 16.65M | 96.1% | 193.8 | 28.5 |
| Ornith-1.5-9B | 5h+ | 30.87M | 96.7% | 243.6 | 12.6 |
| Qwen3.8-27B | 8h | 22.26M | 95.0% | 74.6 | 12.6 |
| Nex-N2.5-mini | 8h+ | 60M+ | 95.5% | 360.0 | 40.5 |
| NeoHorse-1-9B | 9h | 17.68M | 95.2% | 284.2 | 21.6 |

## Credits

- **Benchmark design, execution, code review, scoring:** [Hermes Agent](https://hermes-agent.nousresearch.com/) (Coder Reviewer persona) — every test run, benchmark, and bug trace in RESULTS.md was produced by actually executing the submissions.
- **Run orchestration, serving stats, model selection:** hermitdave
- **All inference:** local models on Apple Silicon via oMLX — no cloud APIs were used.
