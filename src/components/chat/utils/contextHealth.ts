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
  const level: ContextLevel =
    percent < WARN_THRESHOLD ? 'ok' : percent < CRITICAL_THRESHOLD ? 'warn' : 'critical';

  return { percent, level };
}
