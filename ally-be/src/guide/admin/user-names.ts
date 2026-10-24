import { DataSource } from 'typeorm';

/** Display names for user ids an admin screen shows (never emails). */
export async function userNames(
  dataSource: DataSource,
  ids: Array<number | null | undefined>,
): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id): id is number => !!id))];
  if (!unique.length) return new Map();
  const rows: Array<{ id: number; name: string | null }> =
    await dataSource.query(
      `SELECT "id", "name" FROM "users" WHERE "id" = ANY($1::int[])`,
      [unique],
    );
  return new Map(
    rows
      .filter((row) => row.name?.trim())
      .map((row) => [Number(row.id), row.name!.trim()] as const),
  );
}
