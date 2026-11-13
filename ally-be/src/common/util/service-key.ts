import { createHash, timingSafeEqual } from 'crypto';

/**
 * The platform's service-to-service key, as `ApiAuthGuard` checks it, but compared in constant
 * time (both sides hashed first, so their lengths never differ). False when no key is configured.
 */
export function isServiceKey(
  presented: string | string[] | undefined,
  configured: string | undefined,
): boolean {
  if (typeof presented !== 'string' || !presented || !configured) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(presented), digest(configured));
}
