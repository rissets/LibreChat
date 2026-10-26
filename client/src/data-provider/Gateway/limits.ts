import type { GatewayWindow } from 'librechat-data-provider';

/** Native available already subtracts used tokens and outstanding reservations. */
export function remainingPercentage(window: Pick<GatewayWindow, 'limit' | 'available'>): number {
  const limit = Number(window.limit);
  const available = Number(window.available);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(available)) return 0;
  return Math.max(0, Math.min(100, (available / limit) * 100));
}
