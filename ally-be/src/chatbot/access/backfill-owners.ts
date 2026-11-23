/**
 * A1: every assistant has an owner. Gives each bot with no owner its creator (`chatbots.created_by`)
 * as owner, and lists the bots that can't be fixed that way (no creator, or a creator who is no
 * longer an Ally user) for a person to assign.
 *
 * Safe to re-run: a bot that already has an owner is left alone, and the insert upserts the
 * creator's membership (an existing viewer or editor row becomes owner).
 */
export interface OwnerBackfillQuery {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

export interface UnownedBot {
  id: string;
  name: string;
  createdBy: number | null;
  archived: boolean;
}

export interface OwnerBackfillReport {
  dryRun: boolean;
  /** Bots that got (or, in a dry run, would get) their creator as owner. */
  assigned: (UnownedBot & { ownerUserId: number })[];
  /** Bots with no usable creator: Shehbaz assigns these by hand. */
  needsOwner: UnownedBot[];
}

interface Row {
  id: string;
  name: string;
  created_by: number | null;
  creator_exists: boolean;
  archived: boolean;
}

export async function backfillOwners(
  db: OwnerBackfillQuery,
  { dryRun }: { dryRun: boolean },
): Promise<OwnerBackfillReport> {
  const rows = await db.query<Row[]>(
    `SELECT b.id, b.name, b.created_by,
            (u.id IS NOT NULL) AS creator_exists,
            (b.archived_at IS NOT NULL) AS archived
       FROM chatbots b
       LEFT JOIN users u ON u.id = b.created_by
      WHERE NOT EXISTS (
              SELECT 1 FROM chatbot_members m
               WHERE m.chatbot_id = b.id AND 'owner' = ANY(m.roles))
      ORDER BY b."createdAt" ASC`,
  );
  const report: OwnerBackfillReport = { dryRun, assigned: [], needsOwner: [] };
  for (const row of rows) {
    const bot: UnownedBot = {
      id: row.id,
      name: row.name,
      createdBy: row.created_by,
      archived: row.archived,
    };
    if (!row.created_by || !row.creator_exists) {
      report.needsOwner.push(bot);
      continue;
    }
    if (!dryRun) {
      await db.query(
        // Dual write (Stage 1b): the old single role and the set; an existing member keeps the
        // roles they hold and gains owner.
        `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles, created_by)
         VALUES ($1, $2, 'owner', ARRAY['owner']::text[], NULL)
         ON CONFLICT (chatbot_id, user_id) DO UPDATE SET role = 'owner',
           roles = ARRAY(SELECT DISTINCT unnest(chatbot_members.roles || ARRAY['owner']::text[]))`,
        [row.id, row.created_by],
      );
    }
    report.assigned.push({ ...bot, ownerUserId: row.created_by });
  }
  return report;
}
