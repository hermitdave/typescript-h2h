/**
 * A tiny, allocation-friendly identity that maps a `TaskId` (string | number)
 * to a stable interned string used everywhere the heap stores ids. Keeping a
 * single String instance per id avoids repeated string coercions and keeps the
 * index-map lookups cheap under a million-task workload.
 */
const interned = new Map<string, string>();

export function intern(id: string | number): string {
  const s = typeof id === 'string' ? id : String(id);
  const existing = interned.get(s);
  if (existing) return existing;
  const fresh = s;
  interned.set(s, fresh);
  return fresh;
}

/** Resolve an opaque heap id back to the scheduler's public `TaskId`. */
export function unintern(id: string): string | number {
  return id;
}
