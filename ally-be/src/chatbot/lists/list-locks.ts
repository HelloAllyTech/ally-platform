import type { EntityManager } from 'typeorm';

/**
 * One advisory lock a write needs. Every rule has a list-wide key (`rule:<id>`) and, per value it
 * guards, a value key (`rule:<id>:<value>`). An ordinary write takes the list-wide key shared and
 * the value key exclusive, so writes to different slots run side by side. An import takes the
 * list-wide key exclusive and no value keys: it excludes every other writer on that rule while it
 * runs, and holds a handful of locks instead of one per row.
 */
export interface ListLock {
  key: string;
  shared: boolean;
}

export const ruleLock = (ruleId: string): string => `lists:${ruleId}`;
export const valueLock = (ruleId: string, value: unknown): string =>
  `lists:${ruleId}:${JSON.stringify(value)}`;

/**
 * The order locks are taken in: list-wide keys before value keys, each sorted, one entry per key
 * (exclusive wins over shared). Every write takes its locks in this one order, so two writes can't
 * each hold a lock the other waits for.
 */
export function lockOrder(locks: ListLock[]): ListLock[] {
  const byKey = new Map<string, ListLock>();
  for (const lock of locks) {
    const seen = byKey.get(lock.key);
    byKey.set(lock.key, {
      key: lock.key,
      shared: seen ? seen.shared && lock.shared : lock.shared,
    });
  }
  const rank = (key: string) => (key.split(':').length > 2 ? 1 : 0);
  return [...byKey.values()].sort(
    (a, b) =>
      rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/** Takes the locks for the rest of the transaction (`pg_advisory_xact_lock`), in `lockOrder`. */
export async function takeLocks(
  manager: EntityManager,
  locks: ListLock[],
): Promise<void> {
  for (const lock of lockOrder(locks)) {
    await manager.query(
      lock.shared
        ? 'SELECT pg_advisory_xact_lock_shared(hashtext($1))'
        : 'SELECT pg_advisory_xact_lock(hashtext($1))',
      [lock.key],
    );
  }
}
