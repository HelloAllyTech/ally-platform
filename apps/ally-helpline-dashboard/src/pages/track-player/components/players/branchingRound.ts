export type RoundWait = { unit: "hour" | "minute"; count: number };

const MINUTE_MS = 60_000;

/**
 * How long until the next round opens, rounded the way a person says it:
 * whole hours from an hour up (23h40m reads as 23 hours), else minutes, never
 * below one minute. Null once the time has passed.
 */
export const timeUntilRound = (nextRoundAt: string, now: number): RoundWait | null => {
  const target = new Date(nextRoundAt).getTime();
  if (Number.isNaN(target) || target <= now) return null;
  const minutes = Math.max(1, Math.ceil((target - now) / MINUTE_MS));
  if (minutes >= 60) return { unit: "hour", count: Math.floor(minutes / 60) };
  return { unit: "minute", count: minutes };
};
