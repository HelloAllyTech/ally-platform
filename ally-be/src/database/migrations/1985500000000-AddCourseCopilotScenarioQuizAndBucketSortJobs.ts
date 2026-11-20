import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Course Copilot can now write the two Studio components it could not:
 * scenario quizzes (BRANCHING_SCENARIO) and bucket sorts (BUCKET_SORT). Each
 * is built by its own job kind, so the jobs' kind CHECK gains both values.
 */
export class AddCourseCopilotScenarioQuizAndBucketSortJobs1985500000000 implements MigrationInterface {
  name = 'AddCourseCopilotScenarioQuizAndBucketSortJobs1985500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "course_copilot_jobs" DROP CONSTRAINT IF EXISTS "CHK_course_copilot_jobs_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_copilot_jobs" ADD CONSTRAINT "CHK_course_copilot_jobs_kind" CHECK ("kind" IN (
        'course_meta', 'article', 'quiz', 'journal', 'annotated_artifact',
        'branching_scenario', 'bucket_sort',
        'game', 'video', 'roleplay_new', 'roleplay_ref', 'case_new',
        'case_ref', 'cover_image', 'article_image', 'course_review'
      ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows of the new kinds would violate the old CHECK; drop them first.
    await queryRunner.query(
      `DELETE FROM "course_copilot_jobs" WHERE "kind" IN ('branching_scenario', 'bucket_sort')`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_copilot_jobs" DROP CONSTRAINT IF EXISTS "CHK_course_copilot_jobs_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "course_copilot_jobs" ADD CONSTRAINT "CHK_course_copilot_jobs_kind" CHECK ("kind" IN (
        'course_meta', 'article', 'quiz', 'journal', 'annotated_artifact',
        'game', 'video', 'roleplay_new', 'roleplay_ref', 'case_new',
        'case_ref', 'cover_image', 'article_image', 'course_review'
      ))`,
    );
  }
}
