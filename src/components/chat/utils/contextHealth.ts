export type ContextLevel = 'ok' | 'warn' | 'critical';

const WARN_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 90;

export function computeContextHealth(
  used: number,
  total: number,
): { percent: number; level: ContextLevel } | null {
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  const rawPercent = (used / total) * 100;
  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));
  const clampedRaw = Math.max(0, Math.min(100, rawPercent));
  const level: ContextLevel =
    clampedRaw < WARN_THRESHOLD ? 'ok' : clampedRaw < CRITICAL_THRESHOLD ? 'warn' : 'critical';

  return { percent, level };
}
