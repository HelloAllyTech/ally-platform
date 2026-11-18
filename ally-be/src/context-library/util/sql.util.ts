/**
 * Rows from `dataSource.query` for an UPDATE … RETURNING. TypeORM's postgres driver returns
 * `[rows, affectedCount]` for UPDATE and DELETE but plain rows for INSERT and SELECT, so a
 * caller that reads `.length` on the raw result is reading the wrong thing.
 */
export function returningRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0]))
    return result[0] as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}
