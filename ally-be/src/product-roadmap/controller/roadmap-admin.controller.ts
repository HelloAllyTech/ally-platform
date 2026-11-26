import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  AiSummariseDto,
  CreateInterviewNoteDto,
  CreateTaxonomyItemDto,
  RenameTaxonomyItemDto,
  RoadmapListQueryDto,
  UpdateInterviewNoteDto,
} from '../dto/roadmap-content.dto';
import {
  AiTextResponseDto,
  PruneVectorsResponseDto,
  ReindexResponseDto,
} from '../dto/roadmap-response.dto';
import {
  BulkAssessResponseDto,
  CreateStrategyGoalDto,
  ProdDirectorResponseDto,
  RankWeightsResponseDto,
  SetProdDirectorDto,
  RenameStrategyGoalDto,
  RoadmapStrategyContextDto,
  StrategyGoalsResponseDto,
  UpdateRankWeightsDto,
  UpdateRoadmapStrategyContextDto,
} from '../dto/roadmap-strategy.dto';
import { RoadmapStrategyContextService } from '../service/roadmap-strategy-context.service';
import { RoadmapTaxonomyService } from '../service/roadmap-taxonomy.service';
import { RoadmapStrategyGoalService } from '../service/roadmap-strategy-goal.service';
import { RoadmapGoalImpactService } from '../service/roadmap-goal-impact.service';
import { RoadmapInterviewNoteService } from '../service/roadmap-content.service';
import { RoadmapAiService } from '../service/roadmap-ai.service';
import { RoadmapVectorService } from '../service/roadmap-vector.service';
import { RoadmapAccessService } from '../service/roadmap-access.service';

/**
 * The Roadmap's settings and research routes: product goals, the Vision & strategy page,
 * strategy goals and the composite rank, interview notes, the transcript summary, and the
 * vector-index repair tools.
 */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap', version: '1' })
export class RoadmapAdminController {
  constructor(
    private readonly taxonomyService: RoadmapTaxonomyService,
    private readonly interviewService: RoadmapInterviewNoteService,
    private readonly aiService: RoadmapAiService,
    private readonly vectorService: RoadmapVectorService,
    private readonly access: RoadmapAccessService,
    private readonly strategyGoalService: RoadmapStrategyGoalService,
    private readonly goalImpactService: RoadmapGoalImpactService,
    private readonly strategyContextService: RoadmapStrategyContextService,
  ) {}

  // ── taxonomy ──────────────────────────────────────────────────────────────
  // Mutations key on the uuid id rather than the name: goal names contain spaces and
  // ampersands ("Engagement & Usability"), which makes them fragile path parameters.

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('product-goals')
  @ApiOperation({ summary: 'Product goals, in display order' })
  listGoals() {
    return this.taxonomyService.listGoals();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Get('product-goals/usage')
  @ApiOperation({
    summary: 'Opportunity count per goal, so a delete shows its cost first',
  })
  goalUsage() {
    return this.taxonomyService.getGoalUsage();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('product-goals')
  createGoal(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateTaxonomyItemDto,
  ) {
    return this.taxonomyService.createGoal(user.id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Patch('product-goals/:id')
  @ApiOperation({
    summary: 'Rename a goal',
    description:
      'Cascades to every opportunity via ON UPDATE CASCADE, which also keeps the goal names ' +
      'stored inside saved-view state valid.',
  })
  renameGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTaxonomyItemDto,
  ) {
    return this.taxonomyService.renameGoal(user.id, id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Delete('product-goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a goal',
    description:
      'Answers 409 with the usage count while opportunities still reference it.',
  })
  deleteGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.taxonomyService.deleteGoal(user.id, id);
  }

  // ── Vision & strategy page ────────────────────────────────────────────────
  // The prose the opportunity copilot reads on every turn: vision, audience, bets, non-goals,
  // measures. Read on the VIEW tier like the strategy goals below — the copilot's pushback
  // cites it, and a filer told "this conflicts with a non-goal" must be able to read the
  // non-goal. Written on the same manage gate as every other strategy setting.

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('strategy-context')
  @ApiOperation({
    summary: 'The Vision & strategy page',
    description:
      'Every field is a string, empty when unwritten. `updatedAt` is null until first saved.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: RoadmapStrategyContextDto })
  getStrategyContext(): Promise<RoadmapStrategyContextDto> {
    return this.strategyContextService.get();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('strategy-context')
  @ApiOperation({
    summary: 'Update the Vision & strategy page',
    description:
      'A field left out keeps its current text. The opportunity copilot reads the saved page ' +
      'from its next turn on.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: RoadmapStrategyContextDto })
  updateStrategyContext(
    @CurrentUser() user: TokenUser,
    @Body() dto: UpdateRoadmapStrategyContextDto,
  ): Promise<RoadmapStrategyContextDto> {
    return this.strategyContextService.update(user.id, dto);
  }

  // ── product strategy goals & composite rank ───────────────────────────────
  // A DIFFERENT CONCEPT from the product goals above, and worth not conflating: those are
  // CATEGORIES (exactly one per opportunity, used to file and filter). These are OUTCOMES the
  // board is ranked against, and one opportunity may advance several or none. Same id-not-name
  // path-parameter rule, for the same reason.

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('strategy-goals')
  @ApiOperation({
    summary: 'Strategy goals, each with its unassessed count',
    description:
      'VIEW-gated rather than EDIT-gated because every card shows a coverage figure these ' +
      'goals define — a reader who cannot name them cannot read the rank.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: StrategyGoalsResponseDto })
  async listStrategyGoals(): Promise<StrategyGoalsResponseDto> {
    const [goals, unassessed, needingAssessment] = await Promise.all([
      this.strategyGoalService.listGoals(),
      this.strategyGoalService.getUnassessedCounts(),
      this.goalImpactService.countNeedingAssessment(),
    ]);
    return {
      goals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        position: g.position,
        unassessed: unassessed[g.name] ?? 0,
      })),
      needingAssessment,
    };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('strategy-goals')
  @ApiOperation({
    summary: 'Add a strategy goal',
    description:
      'Returns how many opportunities are now unassessed against it. Adding a goal grows the ' +
      'coverage denominator, so every score drops until a bulk assessment catches up — the ' +
      'count is returned so the UI can say so instead of letting the board look re-ranked.',
  })
  createStrategyGoal(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateStrategyGoalDto,
  ) {
    return this.strategyGoalService.createGoal(user.id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Patch('strategy-goals/:id')
  @ApiOperation({
    summary: 'Rename a strategy goal',
    description:
      'Free: ON UPDATE CASCADE carries every stored verdict across, so nothing needs ' +
      'reassessing. A rename that changes the goal MEANING does leave verdicts judged against ' +
      'the old intent — reassess explicitly if so.',
  })
  renameStrategyGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameStrategyGoalDto,
  ) {
    return this.strategyGoalService.renameGoal(user.id, id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Delete('strategy-goals/:id')
  @ApiOperation({
    summary: 'Delete a strategy goal',
    description:
      'Never blocks: the verdicts cascade away and coverage recomputes against the smaller ' +
      'denominator with no LLM calls. Returns how many assessments were discarded, because ' +
      'they cost money to produce and this is not reversible.',
  })
  deleteStrategyGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.strategyGoalService.deleteGoal(user.id, id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('rank-weights')
  @ApiOperation({ summary: 'The four composite-rank factor weights' })
  @ApiResponse({ status: HttpStatus.OK, type: RankWeightsResponseDto })
  getRankWeights() {
    return this.strategyGoalService.getWeights();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Get('prod-director')
  @ApiOperation({
    summary: 'The Prod Director pick and the platform admins to choose from',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ProdDirectorResponseDto })
  getProdDirector() {
    return this.strategyGoalService.getProdDirector();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('prod-director')
  @ApiOperation({
    summary: 'Pick the Prod Director (a platform admin), or clear with null',
    description:
      'One person at a time. Only they see the star icon and can flip it; existing stars persist.',
  })
  setProdDirector(
    @CurrentUser() user: TokenUser,
    @Body() dto: SetProdDirectorDto,
  ) {
    return this.strategyGoalService.setProdDirector(user.id, dto.userId);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Patch('rank-weights')
  @ApiOperation({
    summary: 'Retune the composite rank',
    description:
      'PATCH semantics on purpose — one slider at a time, so two admins tuning different ' +
      'factors do not overwrite each other. Costs nothing but a re-sort: weights apply in SQL ' +
      'over factors that already exist, so this never re-runs the model.',
  })
  updateRankWeights(
    @CurrentUser() user: TokenUser,
    @Body() dto: UpdateRankWeightsDto,
  ) {
    return this.strategyGoalService.updateWeights(user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('strategy-goals/assess-missing')
  @ApiOperation({
    summary: 'Assess opportunities missing a verdict for at least one goal',
    description:
      'BOUNDED, and reports what remains. Adding a goal makes the whole board stale at once, ' +
      'and one request that billed all of it would time out — so a big backlog is several ' +
      'clicks rather than one call that silently truncates.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: BulkAssessResponseDto })
  assessMissing() {
    return this.goalImpactService.assessMissing();
  }

  // ── interview notes ───────────────────────────────────────────────────────

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VIEW_PRODUCT_ROADMAP],
  })
  @Get('interview-notes')
  listInterviews(@Query() query: RoadmapListQueryDto) {
    return this.interviewService.list(query);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Post('interview-notes')
  createInterview(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateInterviewNoteDto,
  ) {
    return this.interviewService.create(user.id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Patch('interview-notes/:id')
  @ApiOperation({ summary: 'Edit a note (author or manager)' })
  async updateInterview(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterviewNoteDto,
  ) {
    return this.interviewService.update(
      user.id,
      id,
      dto,
      await this.access.canManage(user.id),
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Delete('interview-notes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeInterview(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.interviewService.remove(
      user.id,
      id,
      await this.access.canManage(user.id),
    );
  }

  // ── AI helpers ────────────────────────────────────────────────────────────

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP, {
    permissions: [PERMISSIONS.VOTE_PRODUCT_ROADMAP],
  })
  @Post('ai/summarise')
  @ApiOperation({ summary: 'Summarise an interview transcript' })
  @ApiResponse({ status: 201, type: AiTextResponseDto })
  async summarise(@Body() dto: AiSummariseDto): Promise<AiTextResponseDto> {
    return { text: await this.aiService.summariseTranscript(dto.transcript) };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('admin/reindex')
  @ApiOperation({
    summary: 'Re-index opportunities into Weaviate',
    description:
      'The repair tool for index drift, and the one-time backfill after the Supabase import ' +
      '(505 rows ≈ 8 batches). Reports per-item failures rather than claiming success.',
  })
  @ApiResponse({ status: 201, type: ReindexResponseDto })
  reindex(@Query('force') force?: string): Promise<ReindexResponseDto> {
    return this.vectorService.reindexAll(force === 'true');
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('admin/vectors/prune')
  @ApiOperation({
    summary: 'Delete vectors whose opportunity no longer exists',
    description:
      'The other half of repair: reindex only pushes Postgres into Weaviate, so it can never ' +
      'remove a vector left behind by a HARD-deleted row. Such an orphan is filtered out of ' +
      'results but still consumes one of the top-N similarity slots a real duplicate needed. ' +
      'Deletes on the basis of absence, so it refuses to act when the orphan ratio is high ' +
      'enough to suggest our own id set is incomplete — check `abortedReason` on the response.',
  })
  @ApiResponse({ status: 201, type: PruneVectorsResponseDto })
  pruneVectors(): Promise<PruneVectorsResponseDto> {
    return this.vectorService.pruneOrphanedVectors();
  }
}
