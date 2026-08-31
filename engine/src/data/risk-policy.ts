/**
 * Shared, deliberately small risk policy.
 *
 * Every surface reads these limits rather than independently deciding what
 * "concentrated" or "stale" means. The values are defaults, not a claim that
 * they fit every investor; changing them is a product-policy change.
 */
export const RISK_POLICY = {
  concentration: {
    singlePositionPct: 25,
    topThreePct: 60,
  },
  maxPositionRiskPct: 5,
  circuitBreakerPct: 15,
  /** A dated mark older than this cannot silently authorize a new trade. */
  markFreshnessDays: 1,
} as const;

export function markAgeDays(markedAt: string | null, now = Date.now()): number | null {
  if (!markedAt) return null;
  const timestamp = Date.parse(markedAt);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
}

export function oldestMarkAgeDays(
  marks: Array<string | null | undefined>,
  now = Date.now(),
): number | null {
  const ages = marks
    .map(mark => markAgeDays(mark ?? null, now))
    .filter((age): age is number => age !== null);
  return ages.length ? Math.max(...ages) : null;
}
