export const DAILY_LIMIT = 3;
export const MONTHLY_LIMIT = 15;
export function isProEntitlement(expiresAt: string | null | undefined, now = Date.now()) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() > now);
}
export function belowFreeLimits(today: number, month: number) {
  return today < DAILY_LIMIT && month < MONTHLY_LIMIT;
}
export function usageBoundaries(now = new Date()) {
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())).toISOString(),
    month: new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString(),
  };
}
