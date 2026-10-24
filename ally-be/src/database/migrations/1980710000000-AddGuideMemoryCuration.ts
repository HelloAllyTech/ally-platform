import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Memory Curator (plans/ally-guide/plan.md §7.7, §8.1):
 *
 *  - `guide_learner_memories.sourceMessageIds` — the learner messages a note
 *    was drawn from, so the learner can see why Ally remembers it
 *    (memory provenance). Older notes have none.
 *  - `guide_learner_memories.status` gains `retired`: a note the curator
 *    retired as out of date. Unlike `deleted` (the learner's forget, a
 *    tombstone that may never come back) a retired note can be written
 *    again if it becomes true again. Its text is dropped either way.
 *  - `guide_threads.memoryCuratedSeq` — the curator's watermark: messages at
 *    or below it have been read. Claimed with a conditional update, so two
 *    runs never read the same window.
 *
 * All additive; existing rows read as "nothing curated yet".
 */
export class AddGuideMemoryCuration1980710000000 implements MigrationInterface {
  name = 'AddGuideMemoryCuration1980710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guide_learner_memories" ADD COLUMN IF NOT EXISTS "sourceMessageIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_learner_memories" DROP CONSTRAINT IF EXISTS "CHK_guide_learner_memories_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_learner_memories" ADD CONSTRAINT "CHK_guide_learner_memories_status" CHECK ("status" IN ('active', 'deleted', 'retired'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_threads" ADD COLUMN IF NOT EXISTS "memoryCuratedSeq" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guide_threads" DROP COLUMN IF EXISTS "memoryCuratedSeq"`,
    );
    await queryRunner.query(
      `UPDATE "guide_learner_memories" SET "status" = 'deleted' WHERE "status" = 'retired'`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_learner_memories" DROP CONSTRAINT IF EXISTS "CHK_guide_learner_memories_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_learner_memories" ADD CONSTRAINT "CHK_guide_learner_memories_status" CHECK ("status" IN ('active', 'deleted'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "guide_learner_memories" DROP COLUMN IF EXISTS "sourceMessageIds"`,
    );
  }
}
