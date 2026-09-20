/**
 * Cycle detection over the dependency graph.
 *
 * The scheduler stores dependency edges as `id -> Set<depId>`. When we add a
 * task that depends on `dep` (an edge `task -> dep`), a cycle is introduced
 * precisely when `dep` can already reach `task` by following dependency edges.
 * So the test reduces to a reachability query: **can `dep` reach `task`?**
 *
 * We answer it with an iterative DFS (white/grey colouring) that works on graphs
 * far too deep for a recursive walk (e.g. a 1,000,000-deep chain) without
 * overflowing the call stack.
 */

/**
 * Does `from` reach `to` by following dependency edges?
 *
 * @param from   node to start the DFS from (exclusive — we don't re-add `to`
 *               below since it is where we're looking)
 * @param to     target node
 * @param edges  id -> array of dependency ids (outgoing edges)
 * @param edgeId the offending edge's source id, for a precise error message
 * @returns the `to` node id if reachable (cycle), else `null`
 */
export function detectCycle(
  from: string,
  to: string,
  edges: Map<string, Set<string>>,
  edgeId: string
): string | null {
  if (from === to) return from;

  const seen = new Set<string>();
  const stack = [from];
  seen.add(from);

  while (stack.length > 0) {
    const node = stack.pop()!;
    const deps = edges.get(node);
    if (!deps) continue;
    for (const dep of deps) {
      if (dep === to) return to;
      if (!seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }

  return null;
}
