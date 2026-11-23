import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product planning P7 (plans/roadmap-owns-planning rev 5.2): Builder's own "new session" door
 * becomes a switch. On by default, so nothing changes until it is turned off at launch, when
 * new work starts as an idea on the roadmap and Builder builds plans.
 */
export class AddBuilderDirectInterviewSwitch1981900400000 implements MigrationInterface {
  name = 'AddBuilderDirectInterviewSwitch1981900400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "builderDirectInterviewEnabled" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "builderDirectInterviewEnabled"`,
    );
  }
}
