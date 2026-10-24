import { LoggerService } from 'src/logger/logger.service';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  AgentEvalCaseSource,
  AgentEvalCaseStatus,
  AgentEvalRunKind,
} from 'src/llm-agent/harness/enum/eval.enum';
import {
  CreateEvalCaseDto,
  DismissReviewDto,
  GenerateRedTeamDto,
  LessonDecisionDto,
  ListLessonsQueryDto,
  RunEvaluatorDto,
  SetDelegationStageDto,
  SaveEvalCaseDto,
  StartEvalRunDto,
  SubmitReviewDto,
  UpdateEvalCaseDto,
} from '../dto/guide-learning.dto';
import { userNames } from 'src/guide/admin/user-names';
import { RED_TEAM_CATEGORIES } from '../evals/categories';
import { GuideEvalCaseService } from '../evals/guide-eval-case.service';
import { GuideEvalRunService } from '../evals/guide-eval-run.service';
import { GuideRedTeamService } from '../evals/guide-red-team.service';
import { GuideEvaluatorService } from '../evaluator/guide-evaluator.service';
import { RUBRIC_CRITERIA } from '../evaluator/rubric';
import { GuideReviewService } from '../review/guide-review.service';
import { GuideCuratorService } from '../curator/guide-curator.service';
import { GuideLearningAuditService } from '../curator/guide-learning-audit.service';
import { GuideDelegationService } from '../pipeline/guide-delegation.service';
import { GuidePipelineService } from '../pipeline/guide-pipeline.service';
import { GuideShadowService } from '../shadow/guide-shadow.service';
import { GuideSyntheticService } from '../synthetic/guide-synthetic.service';
import { DelegationStatus } from '../pipeline/guide-delegation.service';

const VIEW = { permissions: [PERMISSIONS.VIEW_ALLY_GUIDE] };
const EDIT = { permissions: [PERMISSIONS.EDIT_ALLY_GUIDE] };
const REVIEW = { permissions: [PERMISSIONS.REVIEW_ALLY_GUIDE_TRANSCRIPTS] };

/**
 * The learning loop's Console API (plans/ally-guide/plan.md §7.13, §10.5
 * "Evals"): the nightly evaluator, the review queue and κ, eval cases and
 * suites, the red team, and eval runs.
 *
 * Gating follows the transcript routes: anything that returns or stores a
 * learner's words — a review's window, a case's input, a replayed reply,
 * saving a turn as a case — needs the per-person `ally_guide_transcripts`
 * toggle and the review permission. Counts, verdicts and ids need only the
 * `ally_guide` toggle.
 */
@ApiTags('Ally guide — learning loop')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/guide/admin')
export class GuideLearningAdminController {
  private readonly logger = LoggerService.getInstance(
    'GuideLearningAdminController',
  );

  constructor(
    private readonly evaluator: GuideEvaluatorService,
    private readonly reviews: GuideReviewService,
    private readonly cases: GuideEvalCaseService,
    private readonly runs: GuideEvalRunService,
    private readonly redTeam: GuideRedTeamService,
    private readonly curator: GuideCuratorService,
    private readonly learningAudit: GuideLearningAuditService,
    private readonly delegation: GuideDelegationService,
    private readonly pipeline: GuidePipelineService,
    private readonly shadows: GuideShadowService,
    private readonly synthetic: GuideSyntheticService,
    private readonly dataSource: DataSource,
  ) {}

  /** Each row with its person's display name beside the id (null for the system or a nameless user). */
  private async withNames<T, K extends string>(
    rows: T[],
    idOf: (row: T) => number | null | undefined,
    nameKey: K,
  ): Promise<Array<T & Record<K, string | null>>> {
    const names = await userNames(this.dataSource, rows.map(idOf));
    return rows.map((row) => {
      const id = idOf(row);
      const name = id ? (names.get(id) ?? null) : null;
      return { ...row, [nameKey]: name } as T & Record<K, string | null>;
    });
  }

  private async delegationView(status: DelegationStatus) {
    const [named] = await this.withNames(
      [status],
      (row) => row.changedBy,
      'changedByName',
    );
    return named;
  }

  // ─── Evaluator ────────────────────────────────────────────────────────────

  @Get('evaluator/rubric')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'The rubric the critic, the verifier and reviewers grade',
  })
  rubric() {
    return {
      criteria: RUBRIC_CRITERIA,
      redTeamCategories: RED_TEAM_CATEGORIES.map(({ id, safety, brief }) => ({
        id,
        safety,
        brief,
      })),
    };
  }

  @Get('evaluator/summary')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "The nightly evaluator by night: windows judged, safety flags, disagreements, failures per check and criterion, today's spend (no text)",
  })
  evaluatorSummary(@Query('days') days?: string) {
    return this.evaluator.summary(Math.min(Number(days) || 14, 90));
  }

  @Post('evaluator/run')
  @HttpCode(202)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Run the nightly evaluator now for one UTC day (default yesterday). Turns already judged are skipped',
  })
  runEvaluator(@Body() dto: RunEvaluatorDto) {
    // A night can take many minutes: run it after replying; the summary and
    // the review queue show the result (as eval runs do).
    const night = dto.night;
    setImmediate(() => {
      this.evaluator
        .runNight(night)
        .catch((error) =>
          this.logger.error('Evaluator run failed', error as Error),
        );
    });
    return { started: true, night: night ?? null };
  }

  @Get('evaluator/kappa')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'κ per criterion, critic and verifier against people; criteria below 0.6 or without enough labels are excluded from automated decisions',
  })
  kappa() {
    return this.reviews.agreement();
  }

  // ─── Review queue ─────────────────────────────────────────────────────────

  @Get('reviews')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'The review queue, highest priority first (ids, reasons and check ids only)',
  })
  listReviews(
    @Query('status') status?: string,
    @Query('reason') reason?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviews.list({ status, reason, limit: Number(limit) || 50 });
  }

  @Get('reviews/:reviewId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary:
      "One review: the redacted window and the rubric. The judges' verdicts stay hidden until it is labelled",
  })
  getReview(@Param('reviewId', ParseUUIDPipe) reviewId: string) {
    return this.reviews.get(reviewId);
  }

  @Post('reviews/:reviewId/claim')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({ summary: 'Take a review so no one else labels it' })
  claimReview(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.reviews.claim(reviewId, user.id);
  }

  @Post('reviews/:reviewId/submit')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary:
      'Label every criterion pass / fail / na and give an overall call; optionally save the window as a regression case',
  })
  async submitReview(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: SubmitReviewDto,
    @CurrentUser() user: TokenUser,
  ) {
    const result = await this.reviews.submit(reviewId, user.id, dto);
    const savedCase = dto.saveAsCase
      ? await this.cases.saveFromTurn(result.review.turnId, user.id, {
          kind: dto.verdict === 'problem' ? 'regression' : 'golden',
          source: AgentEvalCaseSource.REVIEW,
          notes: `From review ${reviewId}`,
        })
      : null;
    return { ...result, savedCase };
  }

  @Post('reviews/:reviewId/dismiss')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary: 'Close a review without labels (it then never counts toward κ)',
  })
  dismissReview(
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: DismissReviewDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.reviews.dismiss(reviewId, user.id, dto.notes);
  }

  // ─── Eval cases and suites ────────────────────────────────────────────────

  @Post('turns/:turnId/eval-case')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary:
      "Save as eval case: the turn's learner message (redacted), its conditions and its expectations become a replayable regression case",
  })
  saveTurnAsCase(
    @Param('turnId', ParseUUIDPipe) turnId: string,
    @Body() dto: SaveEvalCaseDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.cases.saveFromTurn(turnId, user.id, dto);
  }

  @Get('eval-suites')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'Suites with their active, proposed and safety counts',
  })
  listSuites() {
    return this.cases.listSuites();
  }

  @Get('eval-cases')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'Eval cases (titles and categories; no inputs)',
  })
  listCases(
    @Query('suite') suite?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    return this.cases.list({
      suiteKey: suite,
      status,
      category,
      limit: Number(limit) || undefined,
    });
  }

  @Post('eval-cases')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({ summary: 'Write a case by hand' })
  createCase(@Body() dto: CreateEvalCaseDto, @CurrentUser() user: TokenUser) {
    return this.cases.createManual(user.id, dto);
  }

  @Get('eval-cases/:caseId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary:
      "One case with its input, which may hold a learner's redacted words",
  })
  getCase(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.cases.get(caseId);
  }

  @Patch('eval-cases/:caseId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary: "Edit a case's title, category, safety flag or expectations",
  })
  async updateCase(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: UpdateEvalCaseDto,
  ) {
    return this.cases.summary(await this.cases.update(caseId, dto));
  }

  @Post('eval-cases/:caseId/accept')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({ summary: 'Accept a proposed case: it runs in the next gate' })
  acceptCase(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.cases.setStatus(caseId, AgentEvalCaseStatus.ACTIVE);
  }

  @Post('eval-cases/:caseId/retire')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({ summary: 'Retire a case: it no longer runs' })
  retireCase(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.cases.setStatus(caseId, AgentEvalCaseStatus.RETIRED);
  }

  @Post('eval-cases/:caseId/variants')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Counterfactual variants: the same case misspelt, terse, with a preamble, on the other channel, without its history',
  })
  variants(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.cases.createVariants(caseId, user.id);
  }

  @Post('red-team/generate')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Write a fresh red-team set now (it also runs weekly). Every case lands proposed',
  })
  generateRedTeam(@Body() dto: GenerateRedTeamDto) {
    return this.redTeam.generate(dto);
  }

  // ─── Eval runs ────────────────────────────────────────────────────────────

  @Post('releases/:releaseId/eval-runs')
  @HttpCode(202)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Replay a release against the cases in dry run: smoke (the smoke suite, once) or gate (every active case, 3 repetitions, against GA)',
  })
  startRun(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @Body() dto: StartEvalRunDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.runs.start(
      releaseId,
      {
        kind:
          dto.kind === 'gate' ? AgentEvalRunKind.GATE : AgentEvalRunKind.SMOKE,
        repetitions: dto.repetitions,
        targetCaseIds: dto.targetCaseIds,
      },
      user.id,
    );
  }

  @Get('eval-runs')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'Eval runs, newest first, with their gate decisions',
  })
  listRuns(@Query('releaseId') releaseId?: string) {
    return this.runs.list(releaseId);
  }

  @Get('eval-runs/:runId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary: 'One run, its decision and the per-case verdicts (no text)',
  })
  async getRun(@Param('runId', ParseUUIDPipe) runId: string) {
    return {
      run: await this.runs.get(runId),
      results: await this.runs.listResults(runId, false),
    };
  }

  @Get('eval-runs/:runId/outputs')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS, REVIEW)
  @ApiOperation({
    summary:
      "The run's results with each replayed reply (a mined case may echo a learner's redacted words)",
  })
  runOutputs(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.runs.listResults(runId, true);
  }

  // ─── Curator and playbook (plan §7.13 loop 2) ─────────────────────────────

  @Post('curator/run')
  @HttpCode(202)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Run the curator now (it also runs daily): trusted evidence → at most 5 lessons or tweaks → guardrails → a curator draft release. Skipped while a curator release is still in the pipeline',
  })
  runCurator(@CurrentUser() user: TokenUser) {
    setImmediate(() => {
      this.curator
        .run({ userId: user.id })
        .catch((error) =>
          this.logger.error('Curator run failed', error as Error),
        );
    });
    return { started: true };
  }

  @Get('playbook')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "The GA release's playbook: every lesson by scope with its id, and each scope's cap",
  })
  playbook() {
    return this.curator.playbook();
  }

  @Get('lessons')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "Every change the curator proposed — blocked and quarantined ones with the reason. Curator-written text and counts only; never a learner's words",
  })
  async listLessons(@Query() query: ListLessonsQueryDto) {
    return this.withNames(
      await this.curator.list(query),
      (lesson) => lesson.decidedBy,
      'decidedByName',
    );
  }

  @Post('lessons/:lessonId/approve')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Clear a quarantined change: the next curator run carries it, through every other guardrail again',
  })
  approveLesson(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: LessonDecisionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.curator.decide(lessonId, 'approve', user.id, dto.notes);
  }

  @Post('lessons/:lessonId/reject')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary: 'Reject a quarantined, approved or proposed change',
  })
  rejectLesson(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: LessonDecisionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.curator.decide(lessonId, 'reject', user.id, dto.notes);
  }

  @Post('lessons/:lessonId/retire')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Take an active lesson out of the playbook; the next curator release drops it',
  })
  retireLesson(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: LessonDecisionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.curator.retire(lessonId, user.id, dto.notes);
  }

  @Get('learning/audit')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "The learning loop's audit: curator runs, lesson decisions, stage changes and the pipeline's own steps, newest first",
  })
  async learningAuditList(
    @Query('releaseId') releaseId?: string,
    @Query('lessonId') lessonId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.withNames(
      await this.learningAudit.list({
        releaseId,
        lessonId,
        limit: Number(limit) || 100,
      }),
      (row) => row.actorUserId,
      'actorName',
    );
  }

  @Get('releases/:releaseId/trail')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "A release's complete trail, oldest first: created → gate → shadow → canary → decision → GA or revert, with the curator's change set",
  })
  async trail(@Param('releaseId', ParseUUIDPipe) releaseId: string) {
    const { release, trail } = await this.pipeline.trail(releaseId);
    return {
      release,
      trail: await this.withNames(trail, (row) => row.actorUserId, 'actorName'),
    };
  }

  // ─── Shadow ───────────────────────────────────────────────────────────────

  @Post('releases/:releaseId/shadow')
  @HttpCode(202)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Shadow a release: replay recent real GA turns on it in dry run and compare with what GA said (check ids and counts only)',
  })
  startShadow(
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.shadows.start(releaseId, user.id);
  }

  @Get('shadow-reports')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'Shadow reports, newest first' })
  listShadows(@Query('releaseId') releaseId?: string) {
    return this.shadows.list(releaseId);
  }

  @Get('shadow-reports/:reportId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'One shadow report and its per-turn verdicts' })
  getShadow(@Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.shadows.get(reportId);
  }

  // ─── Canary decision, pipeline, delegation ───────────────────────────────

  @Get('canary/decision')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      "The running canary's automatic decision (wait, promote or revert) with its thresholds, κ-trusted criteria per arm and the learning guard",
  })
  canaryDecision() {
    return this.pipeline.canaryStatus();
  }

  @Post('learning/pipeline/advance')
  @HttpCode(200)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Run one pass of the pipeline now (it also runs hourly): decide the canary, and at stage 2+ move the curator release on',
  })
  advance() {
    return this.pipeline.advance();
  }

  @Get('delegation')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'The progressive-delegation stage, which stages are unlocked, and every precondition counted (auto-revert is always on)',
  })
  async getDelegation() {
    return this.delegationView(await this.delegation.effectiveStage());
  }

  @Put('delegation')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary:
      'Set the stage: lower it any time; raise it one step, only when that stage is unlocked',
  })
  async setDelegation(
    @Body() dto: SetDelegationStageDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.delegationView(
      await this.delegation.setStage(dto.stage, user.id, dto.reason),
    );
  }

  // ─── Synthetic monitoring ─────────────────────────────────────────────────

  @Get('synthetic-runs')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({
    summary:
      'Nightly synthetic journeys on GA: pass rate, safety failures and drift per night',
  })
  listSynthetic(@Query('limit') limit?: string) {
    return this.synthetic.list(Number(limit) || 30);
  }

  @Get('synthetic-runs/:runId')
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, VIEW)
  @ApiOperation({ summary: 'One synthetic night, per journey and step' })
  getSynthetic(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.synthetic.get(runId);
  }

  @Post('synthetic-runs')
  @HttpCode(202)
  @RequireFeatureToggle(FeatureToggleKey.ALLY_GUIDE, EDIT)
  @ApiOperation({
    summary: 'Run the synthetic journeys on GA now (they also run nightly)',
  })
  runSynthetic() {
    setImmediate(() => {
      this.synthetic
        .runNight()
        .catch((error) =>
          this.logger.error('Synthetic run failed', error as Error),
        );
    });
    return { started: true };
  }
}
