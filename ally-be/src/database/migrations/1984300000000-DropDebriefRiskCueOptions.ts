import { MigrationInterface, QueryRunner } from 'typeorm';
import { CreateDebriefRiskCueOptions1983600000000 } from './1983600000000-CreateDebriefRiskCueOptions';

/**
 * Risk-cue options are gone (2026-11-18): a roleplay's choice is one yes/no saved on the roleplay
 * (`scenarios.metadata.debriefRiskCueOption`), and the definition of a risk cue is the one pinned
 * prompt. Nothing reads or writes this table (be-v1.221.0 onwards), and it only ever held the two
 * seeded rows, so it is dropped. `down` rebuilds it with its two seeds, as it was.
 */
export class DropDebriefRiskCueOptions1984300000000 implements MigrationInterface {
  name = 'DropDebriefRiskCueOptions1984300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_risk_cue_options"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await new CreateDebriefRiskCueOptions1983600000000().up(queryRunner);
  }
}
