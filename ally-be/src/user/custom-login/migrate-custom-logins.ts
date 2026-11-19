import { DataSource } from 'typeorm';

/** Keys an Assistant owner may hold. Anything else ticked means the login does more than assistants. */
export const ASSISTANT_OWNER_KEYS = ['whatsapp_bot'];

export interface CustomLoginMove {
  userId: number;
  email: string;
  enabled: string[];
}

export interface CustomLoginReport {
  moved: CustomLoginMove[];
  /** Custom logins with other Ally admin pages ticked: left as platform admins, for a person to decide. */
  kept: CustomLoginMove[];
}

/**
 * CR1 Part B: move A1's custom logins (platform admins with more toggles off than on, Chatbots on —
 * the rule of migration 1983900000100) onto the ASSISTANT_OWNER role, removing PLATFORM_ADMIN.
 * Only those whose ticked toggles are all assistants keys move; the rest are reported.
 * Their toggle rows stay as they are. Role caches expire within 30 minutes (or flush `user:*`).
 */
export async function migrateCustomLogins(
  dataSource: DataSource,
  { dryRun }: { dryRun: boolean },
): Promise<CustomLoginReport> {
  const rows: Array<{
    userId: number;
    email: string;
    enabled: string[] | null;
  }> = await dataSource.query(
    `SELECT u.id AS "userId", u.email,
              array_remove(array_agg(t."featureKey") FILTER (WHERE t.enabled), NULL) AS enabled
         FROM users u
         JOIN user_groups ug ON ug."userId" = u.id
         JOIN groups g ON g.id = ug."groupId" AND g.name = 'PLATFORM_ADMIN'
         JOIN admin_feature_toggles t ON t."userId" = u.id
        GROUP BY u.id, u.email
       HAVING count(*) FILTER (WHERE NOT t.enabled) > count(*) FILTER (WHERE t.enabled)
          AND bool_or(t."featureKey" = 'whatsapp_bot' AND t.enabled)
        ORDER BY u.id`,
  );
  const report: CustomLoginReport = { moved: [], kept: [] };
  for (const row of rows) {
    const entry = {
      userId: row.userId,
      email: row.email,
      enabled: row.enabled ?? [],
    };
    if (entry.enabled.every((key) => ASSISTANT_OWNER_KEYS.includes(key))) {
      report.moved.push(entry);
    } else {
      report.kept.push(entry);
    }
  }
  if (dryRun || !report.moved.length) return report;
  await dataSource.transaction(async (manager) => {
    for (const login of report.moved) {
      await manager.query(
        `INSERT INTO user_groups ("userId", "groupId")
         SELECT $1, g.id FROM groups g WHERE g.name = 'ASSISTANT_OWNER'
            AND NOT EXISTS (SELECT 1 FROM user_groups x WHERE x."userId" = $1 AND x."groupId" = g.id)`,
        [login.userId],
      );
      await manager.query(
        `DELETE FROM user_groups WHERE "userId" = $1
            AND "groupId" IN (SELECT id FROM groups WHERE name = 'PLATFORM_ADMIN')`,
        [login.userId],
      );
    }
  });
  return report;
}
