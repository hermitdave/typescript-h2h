/**
 * TaskScheduler — production-grade in-memory DAG task scheduler.
 *
 * Design summary (full rationale in DESIGN.md):
 *
 *  Data structures
 *   1. tasks:        Map<id, TaskRecord>          — O(1) record lookup
 *   2. dependents:   Map<id, Set<dependent ids>>  — forward-edge index
 *   3. heap:         BinaryHeap<HeapEntry>       — ready queue, (priority, timestamp, id) order
 *   4. levels:       TaskRecord.level            — longest-path labels; O(1) cycle fast path
 *
 *  Invariants maintained by every mutator
 *   I1 tasks contains exactly the live (non-removed) records
 *   I2 record.deps and dependents indices stay in lockstep
 *   I3 record.unmet === |{d in deps : dep state !== COMPLETED}|
 *   I4 heap holds exactly one entry per PENDING task with unmet === 0,
 *      and entry.version === record.version (lazy deletion for the rest)
 *   I5 the forward-edge graph is acyclic
 *   I6 BLOCKED = task with >= 1 FAILED/CANCELLED dependency
 *
 *  Ordering semantics
 *   higher priority first; within equal priority, earlier scheduledAt
 *   first; final tie-break is id ascending (deterministic).
 *
 *  Stale-entry strategy
 *   Every schedulability-affecting mutation bumps record.version, which
 *   invalidates that record's heap entries; nextTask()/peekNext() discard
 *   stale entries lazily as they surface. When bloat exceeds
 *   compactFactor × live task count, compact() rebuilds the heap in O(m log m).
 */
import { BinaryHeap } from './BinaryHeap';
import { CycleError, InvalidStateError, NotFoundError } from './errors';
import type { HeapEntry, TaskRecord, TaskStateValue, TaskSpec } from './types';

const heapComparator = (a: HeapEntry, b: HeapEntry): number => {
  const dp = b.priority - a.priority;
  if (dp !== 0) return dp;
  const ds = a.scheduledAt - b.scheduledAt;
  if (ds !== 0) return ds;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

export type MutateStatus = 'added' | 'updated' | 'duplicate' | 'removed';

export interface MutateResult {
  status: MutateStatus;
  detail?: string;
}

export interface SchedulerStats {
  total: number;
  byState: Record<string, number>;
  heapSize: number;
  edges: number;
}

export interface AuditReport {
  valid: boolean;
  issues: string[];
}

export class TaskScheduler {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly dependents = new Map<string, Set<string>>();
  private readonly heap = new BinaryHeap<HeapEntry>(heapComparator);
  private edgeCount = 0;
  /** compact() fires when heap size exceeds this multiple of live task count. */
  private readonly compactFactor = 4;

  get taskCount(): number {
    return this.tasks.size;
  }

  get heapSize(): number {
    return this.heap.size;
  }

  // ───────────────────────────── structure mutation ─────────────────────────────

  /** Create a task. Deps must already exist. A brand-new node cannot be part of a
   *  cycle (it has no outgoing edges yet), so no reachability check is needed;
   *  its level is max(dep levels)+1, or 0 for sources. */
  addTask(spec: TaskSpec): TaskRecord {
    if (spec.id === '') throw new InvalidStateError('task id must be non-empty');
    if (this.tasks.has(spec.id)) throw new InvalidStateError(`task id already exists: ${spec.id}`);
    if (!Number.isFinite(spec.priority)) throw new InvalidStateError(`task ${spec.id}: priority must be finite`);
    if (!Number.isFinite(spec.scheduledAt)) throw new InvalidStateError(`task ${spec.id}: scheduledAt must be finite`);
    const deps = spec.deps ?? [];
    for (const d of deps) {
      if (!this.tasks.has(d)) throw new NotFoundError(`unknown dependency: ${d}`);
    }
    let maxDepLevel = 0;
    let unmet = 0;
    for (const d of deps) {
      const dep = this.tasks.get(d)!;
      maxDepLevel = Math.max(maxDepLevel, dep.level);
      if (dep.state !== 'COMPLETED') unmet++;
    }
    const level = deps.length === 0 ? 0 : maxDepLevel + 1;
    const rec: TaskRecord = {
      id: spec.id,
      priority: spec.priority,
      scheduledAt: spec.scheduledAt,
      state: 'PENDING',
      unmet,
      deps: new Set(deps),
      level,
      version: 1,
    };
    if (spec.payload !== undefined) rec.payload = spec.payload;
    this.tasks.set(spec.id, rec);
    for (const d of deps) {
      this.linkForward(d, spec.id);
      rec.deps.add(d);
    }
    if (rec.unmet === 0) this.pushReady(rec);
    this.maybeCompact();
    return rec;
  }

  /** Update ordering-relevant fields of an existing task. The old heap entry is
   *  invalidated by the version bump; a fresh entry is pushed if the task is
   *  currently ready. Stale entries are discarded lazily. */
  updateTask(id: string, patch: { priority?: number; scheduledAt?: number; payload?: unknown }): TaskRecord {
    const rec = this.requireTask(id);
    if (patch.priority !== undefined) {
      if (!Number.isFinite(patch.priority)) throw new InvalidStateError(`priority must be finite`);
      rec.priority = patch.priority;
    }
    if (patch.scheduledAt !== undefined) {
      if (!Number.isFinite(patch.scheduledAt)) throw new InvalidStateError(`scheduledAt must be finite`);
      rec.scheduledAt = patch.scheduledAt;
    }
    if (patch.payload !== undefined) rec.payload = patch.payload;
    if (patch.priority === undefined && patch.scheduledAt === undefined && patch.payload === undefined) {
      return rec; // nothing to change — no version churn
    }
    rec.version++;
    if (rec.state === 'PENDING' && rec.unmet === 0) this.pushReady(rec);
    this.maybeCompact();
    return rec;
  }

  /** Declare: dependentId depends on dependencyId.
   *  Cycle gate: if level[dep]+1 <= level[dependent] the edge is provably safe in
   *  O(1) (level invariant). Otherwise a bounded reachability BFS from dep decides
   *  between "legitimate level raise" and "cycle"; cycles throw CycleError and
   *  mutate nothing. Legitimate raises cascade the new level to descendants. */
  addDependency(dependentId: string, dependencyId: string): MutateResult {
    if (dependentId === dependencyId) throw new CycleError(`task ${dependentId} cannot depend on itself`);
    const dependent = this.requireTask(dependentId);
    const dep = this.requireTask(dependencyId);
    if (dependent.deps.has(dependencyId)) return { status: 'duplicate', detail: dependencyId };

    if (dep.level + 1 > dependent.level) {
      // A cycle forms iff the dependent can already reach the dependency via
      // existing forward edges (the new edge dep->dependent would close the
      // loop). So the walk starts at the DEPENDENT and looks for the DEPENDENCY.
      if (this.reaches(dependentId, dependencyId)) {
        throw new CycleError(`adding ${dependencyId} -> ${dependentId} would create a dependency cycle`);
      }
      dependent.level = dep.level + 1;
      this.cascadeLevels(dependentId, dependent.level);
    }

    this.linkForward(dependencyId, dependentId);
    dependent.deps.add(dependencyId);
    switch (dep.state) {
      case 'COMPLETED': {
        // satisfied dependency: unmet unchanged; re-push if dependent was ready
        if (dependent.state === 'PENDING' && dependent.unmet === 0) {
          dependent.version++;
          this.pushReady(dependent);
        }
        break;
      }
      case 'FAILED':
      case 'CANCELLED': {
        dependent.unmet++;
        if (dependent.state === 'PENDING') dependent.state = 'BLOCKED';
        dependent.version++;
        break;
      }
      default: {
        dependent.unmet++;
        dependent.version++;
        break;
      }
    }
    this.maybeCompact();
    return { status: 'added' };
  }

  /** Remove a declared dependency. unmet is recomputed from the current dep states
   *  (O(degree)); if the dependent becomes fully satisfied it (re)enters the ready
   *  heap, including the BLOCKED -> PENDING transition. If the removed dep had been
   *  driving the dependent's level, descendant levels are recomputed. */
  removeDependency(dependentId: string, dependencyId: string): MutateResult {
    const dependent = this.requireTask(dependentId);
    const dep = this.requireTask(dependencyId);
    if (!dependent.deps.has(dependencyId)) {
      throw new NotFoundError(`task ${dependentId} does not depend on ${dependencyId}`);
    }
    const levelDriven = dependent.level === dep.level + 1;
    dependent.deps.delete(dependencyId);
    this.dependents.get(dependencyId)?.delete(dependentId);
    this.edgeCount--;
    if (dep.state === 'COMPLETED') {
      // dep was satisfied, so it was never counted in unmet — no unmet change
      if (dependent.state === 'PENDING' && dependent.unmet === 0) {
        dependent.version++;
        this.pushReady(dependent);
      }
    } else {
      dependent.unmet = this.recomputeUnmet(dependent);
      dependent.version++;
      if (dependent.unmet === 0) {
        if (dependent.state !== 'PENDING') dependent.state = 'PENDING';
        this.pushReady(dependent);
      }
    }
    if (levelDriven) {
      dependent.level = this.recomputeLevel(dependent);
      this.recomputeCascade([dependentId]);
    }
    this.maybeCompact();
    return { status: 'removed' };
  }

  /** Delete a task wholesale. All of its dependents lose the edge (deps + unmet
   *  recomputed; ready ones re-enter the heap), all of its deps lose the reverse
   *  index entry, and level cascades repair any levels that were derived from it. */
  removeTask(id: string): void {
    const rec = this.requireTask(id);
    const fwd = this.dependents.get(id) ?? new Set<string>();
    const sources: string[] = [];
    for (const dId of fwd) {
      const d = this.tasks.get(dId);
      if (!d) continue;
      const levelDriven = d.level === rec.level + 1;
      d.deps.delete(id);
      d.unmet = this.recomputeUnmet(d);
      d.version++;
      if (d.unmet === 0) {
        if (d.state !== 'PENDING') d.state = 'PENDING';
        this.pushReady(d);
      }
      if (levelDriven) sources.push(dId);
    }
    for (const dep of rec.deps) this.dependents.get(dep)?.delete(id);
    this.edgeCount -= rec.deps.size + fwd.size;
    if (sources.length > 0) this.recomputeCascade(sources);
    this.tasks.delete(id);
    this.dependents.delete(id);
    this.maybeCompact();
  }

  // ───────────────────────────── execution ─────────────────────────────

  /** Claim the next executable task atomically: lazily discards stale heap entries
   *  until a valid top surfaces, pops it, and transitions PENDING -> RUNNING.
   *  Returns null when nothing is executable. */
  nextTask(): TaskRecord | null {
    const e = this.popValid();
    if (!e) return null;
    this.heap.pop();
    const rec = this.tasks.get(e.id)!;
    rec.state = 'RUNNING';
    rec.version++;
    this.maybeCompact();
    return rec;
  }

  /** Non-mutating peek at the next executable task (pop-and-restore). */
  peekNext(): { id: string; priority: number; scheduledAt: number; state: TaskStateValue } | null {
    const e = this.popValid();
    if (!e) return null;
    this.heap.pop();
    this.heap.insert(e);
    const rec = this.tasks.get(e.id)!;
    return { id: rec.id, priority: rec.priority, scheduledAt: rec.scheduledAt, state: rec.state };
  }

  /** Transition a RUNNING task to COMPLETED. Every dependent loses one unmet dep;
   *  any dependent whose unmet count reaches 0 flips to PENDING (from BLOCKED if
   *  needed) and enters the ready heap. */
  markComplete(id: string): TaskRecord {
    const rec = this.requireTask(id);
    if (rec.state !== 'RUNNING') {
      throw new InvalidStateError(`cannot complete task ${id} in state ${rec.state}`);
    }
    rec.state = 'COMPLETED';
    rec.version++;
    for (const dId of this.dependents.get(id) ?? []) {
      const d = this.tasks.get(dId);
      if (!d || d.state === 'COMPLETED' || d.state === 'CANCELLED') continue;
      d.unmet--;
      if (d.unmet === 0) {
        if (d.state !== 'PENDING') d.state = 'PENDING';
        this.pushReady(d);
      }
    }
    this.maybeCompact();
    return rec;
  }

  /** Transition a RUNNING task to FAILED, then propagate BLOCKED downstream:
   *  every reachable dependent that is PENDING is marked BLOCKED (its failed dep
   *  can never satisfy it), and the block cascades through the subgraph. */
  markFailed(id: string): TaskRecord {
    const rec = this.requireTask(id);
    if (rec.state !== 'RUNNING') {
      throw new InvalidStateError(`cannot fail task ${id} in state ${rec.state}`);
    }
    rec.state = 'FAILED';
    rec.version++;
    this.blockDownstream(id);
    this.maybeCompact();
    return rec;
  }

  /** Cancel a PENDING or RUNNING task; downstream dependents are blocked exactly
   *  as for markFailed (a cancelled dep can never satisfy its dependents). */
  cancelTask(id: string): TaskRecord {
    const rec = this.requireTask(id);
    if (rec.state !== 'PENDING' && rec.state !== 'RUNNING') {
      throw new InvalidStateError(`cannot cancel task ${id} in state ${rec.state}`);
    }
    rec.state = 'CANCELLED';
    rec.version++;
    this.blockDownstream(id);
    this.maybeCompact();
    return rec;
  }

  /** Retry a FAILED or CANCELLED task: it returns to PENDING and both its own unmet
   *  count and those of its dependents are recomputed from current dep states
   *  (states may have changed while it was dead). Dependents whose unmet reaches 0
   *  flip BLOCKED -> PENDING and re-enter the ready heap. */
  restartTask(id: string): TaskRecord {
    const rec = this.requireTask(id);
    if (rec.state !== 'FAILED' && rec.state !== 'CANCELLED') {
      throw new InvalidStateError(`cannot restart task ${id} in state ${rec.state}`);
    }
    rec.state = 'PENDING';
    rec.unmet = this.recomputeUnmet(rec);
    rec.version++;
    if (rec.unmet === 0) this.pushReady(rec);
    for (const dId of this.dependents.get(id) ?? []) {
      const d = this.tasks.get(dId);
      if (!d) continue;
      d.unmet = this.recomputeUnmet(d);
      d.version++;
      if (d.unmet === 0) {
        if (d.state !== 'PENDING') d.state = 'PENDING';
        this.pushReady(d);
      }
    }
    this.maybeCompact();
    return rec;
  }

  // ───────────────────────────── observability ─────────────────────────────

  stats(): SchedulerStats {
    const byState: Record<string, number> = {};
    for (const rec of this.tasks.values()) byState[rec.state] = (byState[rec.state] ?? 0) + 1;
    return { total: this.tasks.size, byState, heapSize: this.heap.size, edges: this.edgeCount };
  }

  /** Structural audit: level consistency over every forward edge (O(E)), source
   *  level check, deps/dependents lockstep, and unmet consistency (O(V + degree)).
   *  Cheaper than a full Kahn pass at 1M scale, and catches index drift that
   *  would otherwise corrupt scheduling. */
  audit(): AuditReport {
    const issues: string[] = [];
    for (const [u, set] of this.dependents) {
      const uRec = this.tasks.get(u);
      if (!uRec) {
        issues.push(`forward edges from removed task ${u}`);
        continue;
      }
      for (const v of set) {
        const vRec = this.tasks.get(v);
        if (!vRec) {
          issues.push(`forward edge ${u}->${v} targets a removed task`);
          continue;
        }
        if (vRec.level < uRec.level + 1) {
          issues.push(`level violation on edge ${u}->${v}: level[${v}]=${vRec.level} < level[${u}]+1=${uRec.level + 1}`);
        }
      }
    }
    for (const rec of this.tasks.values()) {
      for (const d of rec.deps) {
        if (!this.tasks.has(d)) {
          issues.push(`task ${rec.id} depends on removed task ${d}`);
          continue;
        }
        const fset = this.dependents.get(d);
        if (!fset || !fset.has(rec.id)) {
          issues.push(`lockstep broken: ${rec.id} declares dep ${d} but the forward index disagrees`);
        }
      }
      if (rec.state !== 'COMPLETED' && rec.state !== 'CANCELLED') {
        const expected = this.recomputeUnmet(rec);
        if (expected !== rec.unmet) {
          issues.push(`unmet mismatch on ${rec.id}: stored=${rec.unmet} expected=${expected}`);
        }
      }
      if (rec.deps.size === 0 && rec.level !== 0) {
        issues.push(`source task ${rec.id} has level ${rec.level}, expected 0`);
      }
    }
    return { valid: issues.length === 0, issues };
  }

  /** Exposes records for diagnostics/tests. Read-only: mutating returned records
   *  directly is how you test the audit() drift detector. */
  debugRecords(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  levelOf(id: string): number {
    return this.requireTask(id).level;
  }

  /** Rebuild the ready heap keeping only valid entries. O(m log m) in heap size m. */
  compact(): { scanned: number; kept: number; dropped: number } {
    const all = this.heap.drain();
    let kept = 0;
    for (const e of all) {
      const rec = this.tasks.get(e.id);
      if (rec && rec.state === 'PENDING' && rec.unmet === 0 && rec.version === e.version) {
        this.heap.insert(e);
        kept++;
      }
    }
    return { scanned: all.length, kept, dropped: all.length - kept };
  }

  // ───────────────────────────── internals ─────────────────────────────

  private requireTask(id: string): TaskRecord {
    const rec = this.tasks.get(id);
    if (!rec) throw new NotFoundError(`unknown task: ${id}`);
    return rec;
  }

  private adjacent(u: string): Set<string> {
    let s = this.dependents.get(u);
    if (!s) {
      s = new Set();
      this.dependents.set(u, s);
    }
    return s;
  }

  /** Register forward edge u -> v (u is a dependency of v). */
  private linkForward(u: string, v: string): void {
    this.adjacent(u).add(v);
    this.edgeCount++;
  }

  private pushReady(rec: TaskRecord): void {
    this.heap.insert({
      id: rec.id,
      version: rec.version,
      priority: rec.priority,
      scheduledAt: rec.scheduledAt,
    });
  }

  private maybeCompact(): void {
    if (this.tasks.size > 0 && this.heap.size > this.tasks.size * this.compactFactor) {
      this.compact();
    }
  }

  /** Discard stale heap entries until a valid top surfaces, or the heap empties.
   *  Valid = record exists, is PENDING, unmet === 0, and versions match. */
  private popValid(): HeapEntry | null {
    for (;;) {
      const e = this.heap.peek();
      if (!e) return null;
      const rec = this.tasks.get(e.id);
      if (rec && rec.state === 'PENDING' && rec.unmet === 0 && rec.version === e.version) return e;
      this.heap.pop();
    }
  }

  /** Count of a record's declared deps that are not yet satisfied.
   *  A missing dep record is counted as unsatisfied (defensive). */
  private recomputeUnmet(rec: TaskRecord): number {
    let n = 0;
    for (const d of rec.deps) {
      const dep = this.tasks.get(d);
      if (!dep || dep.state !== 'COMPLETED') n++;
    }
    return n;
  }

  /** Longest-path level of a record given its current deps: 0 if dep-free,
   *  else max(level[dep]+1). */
  private recomputeLevel(rec: TaskRecord): number {
    if (rec.deps.size === 0) return 0;
    let m = 0;
    for (const d of rec.deps) {
      const dep = this.tasks.get(d);
      if (!dep) continue;
      m = Math.max(m, dep.level + 1);
    }
    return m;
  }

  /** Bounded reachability check: can `toId` be reached from `fromId` via existing
   *  forward edges? Cost O(reachable subgraph); worst case O(V + E). Used by the
   *  cycle gate with fromId = dependent, toId = dependency. */
  private reaches(fromId: string, toId: string): boolean {
    if (fromId === toId) return true;
    const seen = new Set<string>([fromId]);
    const queue: string[] = [fromId];
    while (queue.length > 0) {
      const u = queue.shift()!;
      if (u === toId) return true;
      for (const v of this.dependents.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
    return false;
  }

  /** Propagate a level RAISE forward: every visited node's level is lifted to at
   *  least parent level + 1 when that exceeds its current level. Versions are
   *  deliberately untouched — levels do not affect schedulability, and bumping
   *  would invalidate heap entries that remain valid. */
  private cascadeLevels(startId: string, startLevel: number): void {
    const queue: Array<[string, number]> = [[startId, startLevel]];
    const seen = new Set<string>([startId]);
    while (queue.length > 0) {
      const [u, lv] = queue.shift()!;
      const uRec = this.tasks.get(u);
      if (!uRec) continue;
      for (const v of this.dependents.get(u) ?? []) {
        const vRec = this.tasks.get(v);
        if (!vRec) continue;
        if (!seen.has(v)) {
          seen.add(v);
          const nl = lv + 1;
          if (nl > vRec.level) vRec.level = nl;
          queue.push([v, vRec.level]);
        }
      }
    }
  }

  /** Propagate level RECOMPUTATION forward after edge removals: every reached
   *  descendant's level is recomputed from its current deps (levels may go DOWN,
   *  so no node can be pruned). BFS order guarantees each node's deps inside the
   *  reached subgraph are recomputed before the node itself. */
  private recomputeCascade(sources: string[]): void {
    if (sources.length === 0) return;
    const queue: string[] = [...sources];
    const seen = new Set<string>(sources);
    while (queue.length > 0) {
      const u = queue.shift()!;
      const uRec = this.tasks.get(u);
      if (!uRec) continue;
      uRec.level = this.recomputeLevel(uRec);
      for (const v of this.dependents.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
  }

  /** BFS downstream from a failed/cancelled task; every reachable PENDING
   *  dependent is marked BLOCKED (version bump drops its heap entries).
   *  Already-BLOCKED nodes are skipped for state changes but the walk continues
   *  through them, so the block reaches the whole downstream subgraph. */
  private blockDownstream(id: string): void {
    const queue: string[] = [...(this.dependents.get(id) ?? [])];
    const seen = new Set<string>([id]);
    while (queue.length > 0) {
      const dId = queue.shift()!;
      if (seen.has(dId)) continue;
      seen.add(dId);
      const d = this.tasks.get(dId);
      if (!d) continue;
      if (d.state === 'PENDING') {
        d.state = 'BLOCKED';
        d.version++;
      }
      for (const x of this.dependents.get(dId) ?? []) {
        if (!seen.has(x)) queue.push(x);
      }
    }
  }
}
