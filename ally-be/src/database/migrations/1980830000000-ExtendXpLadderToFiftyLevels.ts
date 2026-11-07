import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the XP ladder from ten levels starting at 1 to fifty starting at 0.
 *
 * Every account now begins at level 0 and reaches level 1 at 100 XP. The old level N
 * becomes level N-1 (the old level 2, 100 XP, is the new level 1), and the ladder
 * continues past the old top to level 50. See `LEVEL_THRESHOLDS` in
 * `src/progress/progress.constants.ts`; the arrays below are copies of it as of this
 * migration, kept inline so a later change to the curve cannot rewrite what this ran.
 *
 * Three things have to move together:
 *  - `user_progress.level` is a stored copy of the level resolved from `totalXp`. The
 *    read path recomputes it, but the next award compares against the stored value to
 *    decide whether to announce a level-up, so a stale column would fire a spurious
 *    celebration (or skip a real one) for everyone.
 *  - The column default becomes 0 to match the new starting level.
 *  - The four XP_LEVEL badges carry a level number in `achievementParams.count`. They
 *    are re-pointed so each still needs the same XP as before (old 2, 5, 8 -> new 1, 4,
 *    7), and "Top of the Ladder" now marks level 50. Badges already awarded are left
 *    alone: nobody loses one. Cached translated descriptions are dropped so they are
 *    regenerated from the new English text rather than still saying the old level.
 *
 * Hand-written SQL, never `migration:generate`.
 */
const NEW_THRESHOLDS = [
  0, 100, 260, 516, 926, 1581, 2630, 4308, 6992, 11287, 16012, 21209, 26926,
  33214, 40131, 47740, 56110, 65317, 75444, 86584, 98838, 112318, 127146,
  143456, 161397, 181132, 202841, 226721, 252989, 281884, 313668, 348630,
  387089, 429394, 475929, 527118, 583425, 645363, 713495, 788440, 870880,
  961564, 1061316, 1171043, 1291743, 1424513, 1570560, 1731212, 1907929,
  2102318, 2316145,
];
const OLD_THRESHOLDS = [0, 100, 260, 516, 926, 1581, 2630, 4308, 6992, 11287];

const BADGES: {
  name: string;
  oldCount: number;
  oldDescription: string;
  newCount: number;
  newDescription: string;
}[] = [
  {
    name: 'Getting Going',
    oldCount: 2,
    oldDescription: 'Reach level 2 on your progress ladder.',
    newCount: 1,
    newDescription: 'Reach level 1 on your progress ladder.',
  },
  {
    name: 'Halfway Up',
    oldCount: 5,
    oldDescription: 'Reach level 5 on your progress ladder.',
    newCount: 4,
    newDescription: 'Reach level 4 on your progress ladder.',
  },
  {
    name: 'Seasoned',
    oldCount: 8,
    oldDescription: 'Reach level 8 on your progress ladder.',
    newCount: 7,
    newDescription: 'Reach level 7 on your progress ladder.',
  },
  {
    name: 'Top of the Ladder',
    oldCount: 10,
    oldDescription: 'Reach level 10, the highest level.',
    newCount: 50,
    newDescription: 'Reach level 50, the highest level.',
  },
];

export class ExtendXpLadderToFiftyLevels1980830000000 implements MigrationInterface {
  name = 'ExtendXpLadderToFiftyLevels1980830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_progress" ALTER COLUMN "level" SET DEFAULT 0`,
    );
    await this.recomputeLevels(queryRunner, NEW_THRESHOLDS, 0);
    for (const badge of BADGES) {
      await this.repointBadge(
        queryRunner,
        badge.name,
        badge.newCount,
        badge.newDescription,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_progress" ALTER COLUMN "level" SET DEFAULT 1`,
    );
    // Learners past the old top (16,012 XP and up) clamp to the old maximum of 10.
    await this.recomputeLevels(queryRunner, OLD_THRESHOLDS, 1);
    for (const badge of BADGES) {
      await this.repointBadge(
        queryRunner,
        badge.name,
        badge.oldCount,
        badge.oldDescription,
      );
    }
  }

  /**
   * Level = how many rungs the learner has cleared, counting from `firstLevel`. Every
   * ladder starts at 0 XP, so the count is always at least one.
   */
  private async recomputeLevels(
    queryRunner: QueryRunner,
    thresholds: number[],
    firstLevel: number,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE "user_progress" SET "level" = (
         SELECT COUNT(*)::int - 1 + $2::int
         FROM unnest($1::int[]) AS t(xp)
         WHERE "user_progress"."totalXp" >= t.xp
       ), "updatedAt" = now()`,
      [thresholds, firstLevel],
    );
  }

  private async repointBadge(
    queryRunner: QueryRunner,
    name: string,
    count: number,
    description: string,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE "badges" SET
         "achievementParams" = jsonb_set(
           COALESCE("achievementParams", '{}'::jsonb), '{count}', to_jsonb($2::int)
         ),
         "description" = $3::text,
         "translations" = CASE
           WHEN jsonb_typeof("translations") = 'object' THEN (
             SELECT COALESCE(
               jsonb_object_agg(
                 e.key,
                 CASE WHEN jsonb_typeof(e.value) = 'object'
                      THEN e.value - 'description' ELSE e.value END
               ),
               '{}'::jsonb
             )
             FROM jsonb_each("translations") AS e
           )
           ELSE "translations"
         END,
         "updatedAt" = now()
       WHERE "name" = $1::varchar AND "category" = 'XP_LEVEL'`,
      [name, count, description],
    );
  }
}
