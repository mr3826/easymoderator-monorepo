export const USAGE_THRESHOLDS = [70, 90, 100] as const;
export type UsageThreshold = (typeof USAGE_THRESHOLDS)[number];

export function usagePercentage(used: number, limit: number): number {
  if (limit < 0 || limit === 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

/** Return thresholds reached since the previous reading and not yet notified. */
export function getCrossedUsageThresholds(
  previousPercentage: number,
  currentPercentage: number,
  notified: ReadonlySet<number> = new Set(),
): UsageThreshold[] {
  return USAGE_THRESHOLDS.filter(
    (threshold): threshold is UsageThreshold =>
      previousPercentage < threshold && currentPercentage >= threshold && !notified.has(threshold),
  );
}

export function usageThresholdSeverity(threshold: UsageThreshold): "info" | "warning" | "exhausted" {
  if (threshold === 100) return "exhausted";
  if (threshold === 90) return "warning";
  return "info";
}
