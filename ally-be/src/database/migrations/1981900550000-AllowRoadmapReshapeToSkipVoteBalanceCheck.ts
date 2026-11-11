import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets split and merge re-insert allocation rows without tripping the vote-grant balance trigger.
 *
 * THE BUG. roadmap_enforce_vote_grant_balance() (1962100000000) treats every INSERT as new
 * spend: delta = NEW.votes, compared with the user's unspent grants. Split and merge don't spend
 * anything — they delete a user's rows and re-insert the SAME votes elsewhere (merge: summed onto
 * the survivor). A voter who had spent most of their balance has `available` near 0, so the
 * re-insert looks like an overdraft, the trigger raises ROADMAP_VOTE_BALANCE_EXCEEDED, nothing
 * catches it, and the admin sees a bare 500 ("Something went wrong on our side").
 *
 * THE FIX. The function returns early when the transaction-local setting
 * `app.roadmap_reshape` is 'on'. Only RoadmapSplitMergeService sets it (set_config(..., true)
 * is scoped to its transaction), and that service asserts vote conservation itself, so the
 * backstop stays in force for every other writer. Same shape as the old
 * app.bypass_stage_check GUC, but opt-in per transaction and checked in one place.
 */
export class AllowRoadmapReshapeToSkipVoteBalanceCheck1981900550000 implements MigrationInterface {
  name = 'AllowRoadmapReshapeToSkipVoteBalanceCheck1981900550000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION roadmap_enforce_vote_grant_balance() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        delta     int;
        available int;
      BEGIN
        -- Split/merge move existing votes around; they never create any. See migration docblock.
        IF current_setting('app.roadmap_reshape', true) = 'on' THEN
          RETURN NEW;
        END IF;

        IF TG_OP = 'INSERT' THEN
          delta := NEW.votes;
        ELSE
          delta := NEW.votes - OLD.votes;
        END IF;

        IF delta <= 0 THEN
          RETURN NEW;
        END IF;

        SELECT COALESCE(SUM("amount" - "consumed"), 0) INTO available
        FROM roadmap_vote_grants
        WHERE "userId" = NEW."userId" AND "expiresAt" > now();

        IF delta > available THEN
          RAISE EXCEPTION
            'ROADMAP_VOTE_BALANCE_EXCEEDED: user % wants % more votes but only % are available',
            NEW."userId", delta, available
            USING ERRCODE = 'P0001';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION roadmap_enforce_vote_grant_balance() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        delta     int;
        available int;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          delta := NEW.votes;
        ELSE
          delta := NEW.votes - OLD.votes;
        END IF;

        IF delta <= 0 THEN
          RETURN NEW;
        END IF;

        SELECT COALESCE(SUM("amount" - "consumed"), 0) INTO available
        FROM roadmap_vote_grants
        WHERE "userId" = NEW."userId" AND "expiresAt" > now();

        IF delta > available THEN
          RAISE EXCEPTION
            'ROADMAP_VOTE_BALANCE_EXCEEDED: user % wants % more votes but only % are available',
            NEW."userId", delta, available
            USING ERRCODE = 'P0001';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
  }
}
