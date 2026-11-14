import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan §8.8: a release names exactly which Skills Store versions it uses, and
 * rolling back restores all of them together. Debrief releases left prompts
 * unpinned (`null` = "the store's current"), so this records, for every
 * existing debrief release, the exact version of each unpinned prompt in
 * `agent_releases."changeSet".pinnedPrompts` — beside the bundle, so the
 * bundle and its content hash never change. New releases record theirs when
 * they are created (DebriefRunnerService.pinPrompts).
 *
 * For each prompt: the version most recently published at or before the
 * release went live (its `promotedAt`, else its `createdAt`), from
 * `prompts_versions."publishedAt"`. Where that cannot be determined (no
 * version published by then), the version current now, and the release is
 * marked `pinSource: 'migration'` with `pinFallbacks` listing those prompts;
 * its release notes say so. A Skills Store roll back that re-served an older
 * version leaves no timestamp, so the history read is the best available.
 */
const AGENT_KEY = 'debrief';

export class PinDebriefReleasePrompts1981900750000 implements MigrationInterface {
  name = 'PinDebriefReleasePrompts1981900750000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const releases: Array<{
      id: string;
      bundle: { prompts?: Record<string, number | null> } | null;
      at: Date;
    }> = await queryRunner.query(
      `SELECT id, bundle, COALESCE("promotedAt", "createdAt") AS at
         FROM agent_releases
        WHERE "agentKey" = $1
          AND NOT (coalesce("changeSet", '{}'::jsonb) ? 'pinnedPrompts')`,
      [AGENT_KEY],
    );
    for (const r of releases) {
      const pins: Record<string, number> = {};
      const fallbacks: string[] = [];
      for (const [code, v] of Object.entries(r.bundle?.prompts ?? {})) {
        if (v != null) continue;
        const [then] = await queryRunner.query(
          `SELECT pv.version FROM prompts p
             JOIN prompts_versions pv ON pv."promptId" = p.id
            WHERE p."promptCode" = $1 AND pv."publishedAt" IS NOT NULL
              AND pv."publishedAt" <= $2
            ORDER BY pv."publishedAt" DESC LIMIT 1`,
          [code, r.at],
        );
        if (then?.version != null) {
          pins[code] = Number(then.version);
          continue;
        }
        const [now] = await queryRunner.query(
          `SELECT "currentVersion" AS version FROM prompts WHERE "promptCode" = $1`,
          [code],
        );
        if (now?.version != null) {
          pins[code] = Number(now.version);
          fallbacks.push(code);
        }
      }
      await queryRunner.query(
        `UPDATE agent_releases
            SET "changeSet" = coalesce("changeSet", '{}'::jsonb)
                  || jsonb_build_object('pinnedPrompts', $2::jsonb, 'pinSource', $3::text,
                                        'pinFallbacks', $4::jsonb, 'pinnedAt', now()::text)
          WHERE id = $1`,
        [
          r.id,
          JSON.stringify(pins),
          fallbacks.length ? 'migration' : 'go_live',
          JSON.stringify(fallbacks),
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE agent_releases
          SET "changeSet" = "changeSet" - 'pinnedPrompts' - 'pinSource' - 'pinFallbacks' - 'pinnedAt'
        WHERE "agentKey" = $1 AND "changeSet" IS NOT NULL`,
      [AGENT_KEY],
    );
  }
}
