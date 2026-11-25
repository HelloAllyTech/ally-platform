import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
  Optional,
} from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { User } from 'src/user/entity/user.entity';
import { PLATFORM_TIER_ROLES } from 'src/common/constants/user.constants';
import { BugFindingSeverity } from 'src/bug-hunter/enum/bug-finding.enum';
import { BugHunterBoardService } from 'src/bug-hunter-approvals/service/bug-hunter-board.service';
import { RepoClassifierService } from 'src/bug-hunter-approvals/service/repo-classifier.service';

/** The longest bug report description kept (it was the old Bug Hunter's finding limit). */
const BUG_FINDING_DESCRIPTION_MAX_LENGTH = 5000;
import {
  composeBugReportDescription,
  repoForSurface,
  severityForImpact,
} from '../util/bug-report-brief.util';

import { S3Service } from 'src/aws/service/s3.service';
import { AppConfigService } from 'src/config/config.service';

import {
  RoadmapOpportunity,
  RoadmapReferenceImage,
} from '../entity/roadmap-opportunity.entity';
import {
  PM_AGENT_AUTHOR_NAME,
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import {
  RoadmapOpportunityRepository,
  RoadmapOpportunityRow,
} from '../repository/roadmap-opportunity.repository';
import { RoadmapAllocationRepository } from '../repository/roadmap-allocation.repository';
import {
  ROADMAP_LIMITS,
  BUG_REPORT_DEFAULT_PRODUCT_GOAL,
  ROADMAP_FILEABLE_EFFORTS,
  ROADMAP_QUALITY_PASS_SCORE,
  ROADMAP_SINGLE_IDEA_EFFORTS,
  ROADMAP_OWNER_EMAILS,
  ROADMAP_READINESS_REQUIRE_TOKEN,
  ROADMAP_REFERENCE_IMAGE_S3_PREFIX,
} from '../constants/product-roadmap.constants';
import {
  CreateBugReportDto,
  CreateOpportunityDto,
  ListOpportunitiesQueryDto,
  RoadmapReferenceImageDto,
  UpdateOpportunityDto,
} from '../dto/roadmap-opportunity.dto';
import {
  GetOpportunitiesResponseDto,
  OpportunityResponseDto,
  RoadmapEligibleOwnerDto,
  RoadmapFacetsDto,
  RoadmapUserRefDto,
  OpportunityBriefResponseDto,
  RoadmapVoterDto,
} from '../dto/roadmap-response.dto';
import { currentPeriodKey } from '../util/roadmap-period.util';
import { effectiveMonthOf, isMonthPinned } from '../util/roadmap-month.util';
import {
  normaliseFilingInterview,
  normaliseOpportunityBrief,
} from '../util/roadmap-brief.util';
import { RoadmapAiService } from './roadmap-ai.service';
import { joinDescription } from '../item/roadmap-item-query.util';
import { RoadmapGoalImpactService } from './roadmap-goal-impact.service';
import { RoadmapStrategyGoalService } from './roadmap-strategy-goal.service';
import { RoadmapVectorService } from './roadmap-vector.service';
import { RoadmapReadinessTokenService } from './roadmap-readiness-token.service';

/** Fields whose change requires re-embedding. `prd` and `owner` deliberately do not. */
const REINDEX_TRIGGERING_FIELDS: (keyof UpdateOpportunityDto)[] = [
  'description',
  'productGoal',
];

@Injectable()
export class RoadmapOpportunityService {
  private readonly logger = LoggerService.getInstance(
    RoadmapOpportunityService.name,
  );

  constructor(
    private readonly opportunityRepository: RoadmapOpportunityRepository,
    private readonly allocationRepository: RoadmapAllocationRepository,
    private readonly strategyGoalService: RoadmapStrategyGoalService,
    private readonly goalImpactService: RoadmapGoalImpactService,
    private readonly vectorService: RoadmapVectorService,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly s3Service: S3Service,
    private readonly config: AppConfigService,
    private readonly readinessToken: RoadmapReadinessTokenService,
    private readonly roadmapAi: RoadmapAiService,
    // Bug Hunter v2 (chunk 10): a filed bug also enters v2's queue. Optional and
    // last, so the tests that build this service by hand and any module without v2
    // work as before.
    @Optional() private readonly bugHunterV2?: BugHunterBoardService,
    @Optional() private readonly repoClassifier?: RepoClassifierService,
  ) {}

  /** `title`, a blank line, then the summary: how a titled idea is stored in `description`. */
  private async storedText(
    dto: Omit<CreateOpportunityDto, 'title'> & { title?: string },
  ): Promise<string> {
    const body = dto.description.trim();
    if (dto.type === RoadmapOpportunityType.BUG) return body;
    const title =
      (dto.title ?? '').replace(/\s+/g, ' ').trim() ||
      (await this.roadmapAi.suggestTitle(body));
    if (!title) throw new BadRequestException('An idea needs a title.');
    const text = joinDescription(title, body);
    if (text.length > ROADMAP_LIMITS.STORED_TEXT_MAX) {
      throw new BadRequestException(
        `The title and summary together can be at most ${ROADMAP_LIMITS.STORED_TEXT_MAX} characters.`,
      );
    }
    return text;
  }

  async list(
    userId: number,
    query: ListOpportunitiesQueryDto,
  ): Promise<GetOpportunitiesResponseDto> {
    const periodKey = currentPeriodKey();
    const result = await this.opportunityRepository.listOpportunities({
      ...query,
      userId,
      periodKey,
      // Read once for the whole page. The bases are board-wide maxima, so scoring rows in one
      // page against different bases would break the ordering the page depends on.
      rank: await this.strategyGoalService.getRankContext(),
    });
    return {
      items: await this.toResponseList(result.items, userId),
      count: result.count,
      maxScore: result.maxScore,
      // The client must never derive the period itself — see SetAllocationDto.
      periodKey,
    };
  }

  async findOne(userId: number, id: string): Promise<OpportunityResponseDto> {
    const row = await this.opportunityRepository.findOneWithScore(
      id,
      userId,
      currentPeriodKey(),
      await this.strategyGoalService.getRankContext(),
    );
    if (!row) throw new NotFoundException(`Opportunity ${id} not found`);
    return (await this.toResponseList([row], userId))[0];
  }

  /**
   * The copilot's brief for one opportunity, or null when it was filed without one.
   *
   * Its own read rather than a field on OpportunityResponseDto — see `hasBrief` there. Selects
   * the one column so a drawer open does not re-run the scored projection for it.
   */
  async getBrief(id: string): Promise<OpportunityBriefResponseDto> {
    const row = await this.opportunityRepository.findOne({
      where: { id },
      select: { id: true, brief: true },
    });
    if (!row) throw new NotFoundException(`Opportunity ${id} not found`);
    return {
      brief: (row.brief ?? null) as OpportunityBriefResponseDto['brief'],
    };
  }

  /**
   * Per-admin breakdown behind `priorityScore` — who cast the votes that sum to it, across
   * every period. Highest votes first. A separate call rather than a field on
   * OpportunityResponseDto: that DTO serves the list and board too, where fetching this per
   * row would be a query per card for a breakdown nobody asked to see yet.
   */
  async getVoters(opportunityId: string): Promise<RoadmapVoterDto[]> {
    const rows =
      await this.allocationRepository.votersForOpportunity(opportunityId);
    const users = await this.resolveUsers(rows.map((r) => r.userId));
    return rows.map((r) => {
      const user = users.get(r.userId) ?? this.unknownUser(r.userId);
      return {
        userId: r.userId,
        name: user.name,
        email: user.email,
        votes: r.votes,
        weightedVotes: r.weightedVotes,
      };
    });
  }

  /**
   * `extra` carries the fields the staff-facing CreateOpportunityDto has no reason to
   * expose — see createBugReport, its only other caller. Left undefined, every
   * field defaults exactly to what the pre-existing staff path always wrote (source
   * 'staff', tenantId/reporterContext null), so this is a no-op change for that caller.
   */
  async create(
    userId: number,
    // `title` is required over HTTP (CreateOpportunityDto) but optional here: a caller filing on
    // someone's behalf may leave it out and have one written — see storedText.
    dto: Omit<CreateOpportunityDto, 'title'> & { title?: string },
    extra?: {
      source?: RoadmapOpportunitySource;
      tenantId?: string | null;
      reporterContext?: Record<string, any> | null;
      /** The repo a staff reporter named; when set, Bug Hunter skips classification. */
      repo?: string | null;
      /** A reporter's impact rating, mapped to a severity; null leaves it to the finders. */
      severity?: BugFindingSeverity | null;
      /**
       * Whether the caller holds edit:admin:product-roadmap, resolved in the controller the same
       * way comment and saved-view deletion resolve it — see RoadmapAccessService for why a
       * row-level rule like this cannot be a decorator. Consulted by `ownerUserId` and by
       * nothing else, so every other caller can keep leaving it out.
       */
      canManage?: boolean;
      /**
       * Whether the readiness gate applies to this call at all.
       *
       * False for the internal `/bug-reports` path, which shares this method: a bug report is a
       * single guided prompt from a consumer who has never seen a checklist, and grading one
       * against "names the user group it affects" would refuse every real report. The gate is a
       * property of the IDEA-filing path, not of this table.
       */
      enforceReadiness?: boolean;
      /**
       * Roadmap v2's Submit only: the code its draft was given when New idea created it
       * (session-first, §4.2), so the idea keeps one code for life. Allocated from the same
       * sequence as the column default. Everyone else leaves it out and the default fires.
       */
      code?: string;
    },
  ): Promise<OpportunityResponseDto> {
    // Assigning at filing time is a MANAGE action on a route gated at the VOTE tier, so it is
    // checked here rather than left to the decorator: a filer who cannot manage the board must
    // not be able to point a new row at someone by posting a field the drawer never showed them.
    // 403 rather than dropping it — a silently ignored assignment is worse than a refusal.
    if (dto.ownerUserId !== undefined && dto.ownerUserId !== null) {
      if (!extra?.canManage) {
        throw new ForbiddenException(
          'Only a roadmap manager can assign an owner.',
        );
      }
      await this.assertEligibleOwner(dto.ownerUserId);
    }

    // A brief is the copilot's signed case for this draft, so it is only ever stored when the
    // readiness gate checked it against the token minted over it. Without that check it would
    // be an unsigned document labelled as the copilot's judgement.
    if (dto.brief != null && !(extra?.enforceReadiness && dto.readinessToken)) {
      throw new BadRequestException(
        "A copilot brief can only be filed together with the copilot's own draft.",
      );
    }

    if (extra?.enforceReadiness) this.assertReady(userId, dto);

    const referenceImages = this.normaliseReferenceImages(dto.referenceImages);
    // Normalised AFTER the hash check, never before: the token signs what the copilot emitted,
    // which was already normalised, so this is idempotent on an honest brief and only bounds
    // what a future write path might forget to.
    const brief = normaliseOpportunityBrief(dto.brief);
    // The conversation behind the draft, kept for the Builder session that picks it up. Same
    // door as the brief — only the copilot's own filing carries one — but ignored elsewhere
    // rather than refused: unlike the brief it claims nothing on anyone's behalf, and a filing
    // refused over its transcript would lose the conversation it was trying to keep.
    const interviewTranscript =
      extra?.enforceReadiness && dto.readinessToken
        ? normaliseFilingInterview(dto.interviewTranscript)
        : null;

    // Every new IDEA has a title. The form and the draft's Submit send one; a caller that files
    // on someone's behalf (the PM Agent) sends none, so one is written here rather than refused.
    // A bug keeps its text as one block, as before: a bug report is a guided prompt, not a
    // titled idea.
    const storedText = await this.storedText(dto);

    const saved = await this.opportunityRepository.save(
      this.opportunityRepository.create({
        description: storedText,
        type: dto.type,
        productGoal: dto.productGoal,
        // `?? null` so an omitted effort files as unsized rather than undefined — the column
        // is nullable and "not sized" is a real state, not a missing value.
        effort: dto.effort ?? null,
        // Only ever the id. The legacy free-text `owner` column stays untouched on a new row —
        // it is a text FK into roadmap_opportunity_owners(name) and writing both is what the
        // update path documents as the thing that 500s. See update().
        ownerUserId: dto.ownerUserId ?? null,
        // `?? []` rather than leaving it undefined: the column is NOT NULL with a '[]' default,
        // so both land the same row, but being explicit means the created entity in memory has
        // the same shape as one read back — which is what the response mapper reads.
        referenceImages,
        brief,
        interviewTranscript,
        ...(extra?.code ? { code: extra.code } : {}),
        createdBy: userId,
        updatedBy: userId,
        source: extra?.source ?? RoadmapOpportunitySource.STAFF,
        tenantId: extra?.tenantId ?? null,
        reporterContext: extra?.reporterContext ?? null,
      }),
    );

    // Best-effort and awaited: the row is already committed, so a vector failure cannot roll
    // it back, but awaiting means the very next duplicate check sees this opportunity.
    await this.vectorService.indexQuietly(saved.id);

    // Score the new row against the strategy before it is first read, so it enters the board
    // ranked rather than sitting at zero coverage until someone notices. Same best-effort
    // contract as the vector index above: a model outage must not fail a committed write.
    await this.goalImpactService.assessQuietly(saved.id);

    // A filed bug enters Bug Hunter's queue (bughunter.bugs); its mode decides whether and
    // when it is worked on. Best effort: a failure here never fails the roadmap write that
    // already committed. The app comes from the reporter, else from the repo classifier
    // (one cheap call that gives up rather than guess; null leaves it for an admin to pick).
    if (dto.type === RoadmapOpportunityType.BUG && this.bugHunterV2) {
      let repo: string | null = extra?.repo ?? null;
      if (!repo && this.repoClassifier) {
        repo = await this.repoClassifier
          .classifyRepo(saved.description)
          .then((r) => r.repo)
          .catch(() => null);
      }
      await this.bugHunterV2.enqueueReported({
        opportunityId: saved.id,
        description: saved.description,
        repo,
      });
    }

    return this.findOne(userId, saved.id);
  }

  /**
   * The readiness gate, applied to one filing. Returns nothing: a filing either passes or is
   * refused.
   *
   * ## The rule, in the order it is checked
   *
   * 1. NO TOKEN. Refused once ROADMAP_READINESS_REQUIRE_TOKEN is true; until then, warned about
   *    and allowed. This is the only leniency here and it is temporary — see the constant for
   *    the flip.
   * 2. A TOKEN THAT DOES NOT VERIFY. Always a 400, flag or no flag: tampered, expired, graded
   *    against different text, or issued against a criteria set that has since changed. The
   *    token service raises these with wording a filer can act on.
   * 3. THE VERDICT. Red criteria come from the token. The SIZE rule is applied to the effort
   *    being filed rather than the one in the token, so it is enforced whatever the client
   *    sends: filing an XL is refused even with a token minted for an S.
   *
   * There is NO override. It existed for the retired blank form, where a manager could file
   * against a verdict they judged wrong. The guided interview — now the only filing client —
   * mints a token only for a draft that met every criterion at a fileable size, so the escape
   * hatch had nothing left to open, and a gate with no client asking to bypass it should not
   * keep the bypass.
   */
  private assertReady(
    userId: number,
    dto: Omit<CreateOpportunityDto, 'title'> & { title?: string },
  ): void {
    if (!dto.readinessToken) {
      if (ROADMAP_READINESS_REQUIRE_TOKEN) {
        throw new BadRequestException(
          'Run the readiness check before filing this opportunity.',
        );
      }
      // The signal the rollout waits on: when this stops appearing in production, every client
      // in the wild sends a token and the flag above can be flipped.
      this.logger.warn(
        `[ROADMAP] Opportunity filed with no readiness token by user ${userId}. ` +
          `Readiness was NOT enforced for this filing.`,
      );
      return;
    }

    const verdict = this.readinessToken.verify(dto.readinessToken, {
      description: dto.description,
      productGoal: dto.productGoal,
      brief: dto.brief,
    });

    const failed = [...verdict.failedCriteria];
    // `size` rather than a criterion id: the size rule is derived from ROADMAP_FILEABLE_EFFORTS
    // and has no entry in ROADMAP_READINESS_CRITERIA. Kept in the same list so one message
    // answers "what was red?".
    const effortFileable =
      dto.effort != null &&
      (ROADMAP_FILEABLE_EFFORTS as readonly string[]).includes(dto.effort);
    if (!effortFileable) failed.push('size');

    // A token that carries a quality score came from the interview, which holds its ideas to
    // the quality bar: the score must reach the pass mark and the size must be one an idea can
    // be filed at on its own (XL and XXL are split first). Applied here, to the signed score and
    // the effort being filed, so it holds whatever a client sends. System filings (the PM Agent)
    // carry no score and keep the wider rule above.
    if (typeof verdict.qualityScore === 'number') {
      if (verdict.qualityScore < ROADMAP_QUALITY_PASS_SCORE) {
        failed.push('quality');
      }
      if (
        dto.effort != null &&
        !(ROADMAP_SINGLE_IDEA_EFFORTS as readonly string[]).includes(dto.effort)
      ) {
        failed.push('split_needed');
      }
    }

    if (failed.length > 0) {
      throw new BadRequestException(
        `This opportunity is not ready to file yet (${failed.join(', ')}). ` +
          `Keep the interview going until every item is met.`,
      );
    }
  }

  /**
   * POST /product-roadmap/bug-reports — ANY logged-in user filing a bug from a one-prompt
   * form, whether that is a consumer in web/mobile/helpline or a staff member using the
   * admin roadmap's "Report a bug" button. It runs the exact same create() pipeline a
   * staff-filed opportunity uses (vector indexing, the Bug Hunter inbox row), so a report
   * needs no bespoke follow-up work to appear wherever bugs already do.
   *
   * What differs from the staff /opportunities path: `type` is forced to BUG, `productGoal`
   * is fixed (see BUG_REPORT_DEFAULT_PRODUCT_GOAL — no form here has a goal picker), and
   * `source`/`tenantId`/`reporterContext` are stamped for triage. Returns the minimal
   * one-time confirmation, not the full opportunity — a reporter has no further use for
   * roadmap-internal fields like productGoal or boardPosition.
   */
  async createBugReport(
    userId: number,
    tenantId: string | null,
    dto: CreateBugReportDto,
  ): Promise<{ id: string; stage: RoadmapOpportunityStage }> {
    // The staff form's structured answers become one brief (what happened,
    // expected, steps, where, when, how often, impact, identifiers), the
    // surface picks the repo where the reporter did not, and the impact
    // rating becomes the severity — see bug-report-brief.util.ts.
    const created = await this.create(
      userId,
      {
        // The form caps the reporter's own words at ROADMAP_LIMITS.DESCRIPTION_MAX;
        // the brief adds the structured answers after them, so it is composed
        // into the finding's limit. Composing into the form's limit clipped a
        // long report to its first two hundred characters (2026-10-12), which
        // is the part every stage reads first.
        description: composeBugReportDescription(
          dto.description,
          dto.context ?? null,
          BUG_FINDING_DESCRIPTION_MAX_LENGTH,
        ),
        type: RoadmapOpportunityType.BUG,
        productGoal: BUG_REPORT_DEFAULT_PRODUCT_GOAL,
      },
      {
        source: (await this.isInternalReporter(userId))
          ? RoadmapOpportunitySource.STAFF
          : RoadmapOpportunitySource.CONSUMER,
        tenantId,
        reporterContext: dto.context ?? null,
        repo: dto.repo ?? repoForSurface(dto.context?.surface) ?? null,
        severity: severityForImpact(dto.context?.impact),
      },
    );
    return { id: created.id, stage: created.stage };
  }

  /**
   * Whether a reporter is one of us.
   *
   * `source` surfaces in Bug Hunter as a Staff/Consumer badge answering "who filed this?",
   * so it is derived from WHO the reporter is and not from which client they happened to
   * open. An admin filing from the roadmap board and an admin filing from the helpline app
   * are both internal reports; badging the second one "Consumer" would send a triager
   * hunting for an affected customer who does not exist.
   *
   * One extra query per report, on a route capped at BUG_REPORT_RATE_LIMIT per user.
   */
  private async isInternalReporter(userId: number): Promise<boolean> {
    const count = await this.userRepository
      .createQueryBuilder('user')
      .where('user.id = :userId', { userId })
      .andWhere(
        `EXISTS (
           SELECT 1 FROM user_groups ug
           INNER JOIN groups g ON g.id = ug."groupId"
           WHERE ug."userId" = "user"."id" AND g.name IN (:...roles)
         )`,
        { roles: PLATFORM_TIER_ROLES },
      )
      .getCount();
    return count > 0;
  }

  /**
   * Update. Gated on edit:admin:product-roadmap at the controller, which means the author
   * cannot edit their own opportunity unless they also hold edit: — a faithful port of the
   * source's RLS (UPDATE was admin-only). Flagged in the DTO docblock.
   */
  async update(
    userId: number,
    id: string,
    dto: UpdateOpportunityDto,
  ): Promise<OpportunityResponseDto> {
    const existing = await this.opportunityRepository.findOne({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Opportunity ${id} not found`);

    const patch: Partial<RoadmapOpportunity> = { updatedBy: userId };
    if (dto.description !== undefined)
      patch.description = dto.description.trim();
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.productGoal !== undefined) patch.productGoal = dto.productGoal;
    if (dto.ownerUserId !== undefined) {
      // ONE representation is written, never both. `owner` is a text FK into
      // roadmap_opportunity_owners(name), so copying the Ally user's name into it fails the
      // constraint unless that person also exists as a taxonomy row — and inventing taxonomy rows
      // to mirror user accounts is exactly the hand-maintained list this change removes.
      //
      // So: `ownerUserId` is the assignment and `owner` stays purely legacy — only ever set by the
      // Supabase migration. Reads COALESCE the two, and the owner-name filter matches either, so a
      // migrated saved view keeps working after its owner is linked to a real account.
      patch.ownerUserId = dto.ownerUserId ?? null;
      if (dto.ownerUserId !== null) {
        // Only a CHANGE of owner is validated. Now that the picker is the short
        // ROADMAP_OWNER_EMAILS list, rows owned by someone who predates it are normal — and the
        // drawer re-sends that unchanged id on every unrelated edit. Validating it again would
        // make those rows uneditable until somebody reassigned them, which is a worse outcome
        // than letting a grandfathered owner stand. Reassigning still has to land on the list.
        if (dto.ownerUserId !== existing.ownerUserId) {
          await this.assertEligibleOwner(dto.ownerUserId);
        }
      } else {
        // Un-assigning must also clear a legacy string, or the row would keep displaying a name
        // for an opportunity nobody owns.
        patch.owner = null;
      }
    }
    if (dto.prd !== undefined) patch.prd = dto.prd ?? null;
    // `?? null` rather than assigning dto.effort straight through: `null` is a real edit here
    // (un-sizing something that was sized), and the `!== undefined` guard is what separates that
    // from "the caller did not mention effort at all".
    if (dto.effort !== undefined) patch.effort = dto.effort ?? null;
    if (dto.claudePrompt !== undefined)
      patch.claudePrompt = dto.claudePrompt ?? null;
    // The full resulting list, never a delta — see the DTO. `[]` is a real edit (clear them all),
    // which is why this is guarded on `!== undefined` rather than on truthiness.
    if (dto.referenceImages !== undefined) {
      patch.referenceImages = this.normaliseReferenceImages(
        dto.referenceImages,
      );
    }

    if (dto.stage !== undefined) {
      // A retired stage value never reaches here: the DTO's @IsEnum rejects it with a 400.
      const nextStage = dto.stage;
      patch.stage = nextStage;
      patch.releasedAt = this.resolveReleasedAt(existing, nextStage);
    }

    if (
      dto.plannedMonth !== undefined &&
      dto.plannedMonth !== (existing.plannedMonth ?? null)
    ) {
      // A shipped card's lane is a fact, not a plan — the same rule the board enforces on drag,
      // checked here so the drawer cannot route around it. Evaluated against the stage the row
      // is ENDING UP in, so scheduling and releasing in one PATCH is judged on the outcome. Only
      // guards an actual change: the drawer always resends the existing plannedMonth alongside an
      // unrelated stage edit, and that carried-over value must not trip this check.
      const nextStage = patch.stage ?? existing.stage;
      const nextReleasedAt =
        patch.releasedAt !== undefined ? patch.releasedAt : existing.releasedAt;
      if (isMonthPinned(nextStage, nextReleasedAt)) {
        throw new UnprocessableEntityException(
          'A released opportunity sits in the month it shipped. Change its stage first to plan it into a different month.',
        );
      }
      patch.plannedMonth = dto.plannedMonth ?? null;
    }

    await this.opportunityRepository.update(id, patch);

    // Re-embed only when the embedded text or its scoping goal actually changed. A prd- or
    // owner-only edit must not spend an embedding call.
    const needsReindex = REINDEX_TRIGGERING_FIELDS.some(
      (field) => dto[field] !== undefined && dto[field] !== existing[field],
    );
    if (needsReindex) await this.vectorService.indexQuietly(id);

    // Re-assess only when the DESCRIPTION changed, and only when it really did — the drawer
    // resends the existing description alongside an unrelated edit, so an `!== undefined` check
    // alone would re-bill an assessment every time somebody set a planned month.
    //
    // Description is the ONLY trigger: it is the entire input the model judges. Effort, stage
    // and owner do not change whether the work advances a strategy goal, and re-running on them
    // would pay for an identical answer.
    const descriptionChanged =
      dto.description !== undefined &&
      dto.description.trim() !== existing.description;
    if (descriptionChanged) {
      await this.goalImpactService.assessQuietly(id);
    }

    return this.findOne(userId, id);
  }

  /**
   * `releasedAt` is stamped ONLY on the transition into RELEASED and never re-stamped.
   *
   * This lives in the service rather than a trigger for a concrete reason: split must COPY a
   * released parent's timestamp onto its new parts, not regenerate it, and a trigger would have
   * to be defeated to do that. Matches the source's `old.stage IS DISTINCT FROM 'released'`
   * condition, so released → prioritised → released does re-stamp.
   *
   * Note ~173 of 280 migrated released rows have a NULL releasedAt because the source trigger
   * also only fired on transition. Nothing here may backfill them.
   */
  private resolveReleasedAt(
    existing: RoadmapOpportunity,
    nextStage: RoadmapOpportunityStage,
  ): Date | null {
    const becomingReleased =
      nextStage === RoadmapOpportunityStage.RELEASED &&
      existing.stage !== RoadmapOpportunityStage.RELEASED;
    if (becomingReleased) return new Date();
    return existing.releasedAt ?? null;
  }

  async getFacets(): Promise<RoadmapFacetsDto> {
    const { createdBy, goals, owners } =
      await this.opportunityRepository.getFacets();
    const users = await this.resolveUsers(createdBy);
    return {
      creators: createdBy.map((id) => users.get(id) ?? this.unknownUser(id)),
      goals,
      owners,
    };
  }

  /**
   * Attach creator identity, resolving Ally users in ONE query rather than per row.
   *
   * Public because the month board maps the same rows into the same shape — one opportunity must
   * not serialise differently depending on which layout asked for it.
   */
  async toResponseList(
    rows: RoadmapOpportunityRow[],
    viewerId?: number,
  ): Promise<OpportunityResponseDto[]> {
    // Both resolved ONCE for the whole page, not per row: the goal count is the same for every
    // opportunity in a response, and fetching it per row would issue a query per card.
    const [users, goalsTotal, viewerIsDirector] = await Promise.all([
      this.resolveUsers(rows.map((r) => r.createdBy)),
      this.strategyGoalService.countGoals(),
      viewerId === undefined
        ? Promise.resolve(false)
        : this.strategyGoalService.isProdDirector(viewerId),
    ]);
    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      type: row.type,
      stage: row.stage,
      productGoal: row.productGoal,
      // The resolved display name, not the raw column — see RoadmapOpportunityRow.ownerDisplay.
      // `owner` stays the API's single owner field so no client has to know both representations.
      owner: row.ownerDisplay ?? row.owner ?? null,
      ownerUserId: row.ownerUserId ?? null,
      prd: row.prd ?? null,
      code: row.code,
      queueRank: row.queueRank ?? null,
      claudePrompt: row.claudePrompt ?? null,
      // `?? []` because the column is only NOT NULL from migration 1944400000000 onward and a
      // row read through a raw `opp.*` projection in a mid-deploy window can still arrive
      // without it. An absent array and an empty one mean the same thing to every client.
      referenceImages: row.referenceImages ?? [],
      hasBrief: row.brief != null,
      builderSessionId: row.builderSessionId ?? null,
      releasedAt: row.releasedAt ?? null,
      plannedMonth: row.plannedMonth ?? null,
      effort: row.effort ?? null,
      boardPosition: Number(row.boardPosition ?? 0),
      // Derived here rather than trusted from the row, so the single-opportunity read (which has
      // no lane context) reports the same month as the board.
      effectiveMonth: effectiveMonthOf(
        row.stage,
        row.releasedAt,
        row.plannedMonth,
      ),
      monthPinned: isMonthPinned(row.stage, row.releasedAt),
      priorityScore: Number(row.priorityScore ?? 0),
      // Rounded to one decimal at the edge, not in SQL: the ORDER BY runs on the full-precision
      // value, so rounding here cannot reorder anything — it only stops the card rendering
      // 63.33333333333333.
      compositeScore: Math.round(Number(row.compositeScore ?? 0) * 10) / 10,
      voterCount: Number(row.voterCount ?? 0),
      // Only the Prod Director ever sees the flag; null for everyone else (and for the broadcast).
      directorStarred: viewerIsDirector ? row.directorStarred === true : null,
      goalsHelped: Number(row.goalsHelped ?? 0),
      goalsAssessed: Number(row.goalsAssessed ?? 0),
      goalsTotal,
      breadthNew: row.breadthNew === true,
      myVotes: Number(row.myVotes ?? 0),
      commentCount: Number(row.commentCount ?? 0),
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // A PM Agent filing is authored by the agent; `createdBy` (the admin who accepted the
      // card) stays on the row for audit but is not who the board says posted it.
      creator:
        row.source === RoadmapOpportunitySource.PM_AGENT
          ? { id: row.createdBy, email: '', name: PM_AGENT_AUTHOR_NAME }
          : (users.get(row.createdBy) ?? this.unknownUser(row.createdBy)),
    }));
  }

  // ── reference images ────────────────────────────────────────────────────────

  /**
   * Trim captions, drop empty ones, and refuse any URL that is not one of our own uploads.
   *
   * THE GUARD IS THE POINT. `referenceImages` is rendered as `<img src>` in the admin dashboard
   * for every roadmap viewer, so without this the array is a way for one filer to point every
   * reader's browser at a host of their choosing — a beacon at best, and at worst a request
   * carrying whatever that host's cookies imply. The (since retired) presign endpoint was the
   * only way to get an object into the prefix, so requiring the URL to resolve to that bucket
   * AND that prefix means the only images that can be attached are ones this service handed out
   * an address for.
   *
   * It also scopes the check to THIS feature's prefix rather than to the bucket as a whole: the
   * assets bucket holds badges, blog headers and scenario covers too, and letting an opportunity
   * reach into those would make deleting one feature's object break another feature's row.
   *
   * 422, not 400: the payload is well-formed and the URL is a URL — it just names an object this
   * service did not issue, which is the same "well-formed but ineligible" shape as an owner who
   * is not on the roadmap owner list.
   *
   * Caption normalisation matters more than it looks: a caption of "   " renders as a blank line
   * under a thumbnail, and `undefined` vs `null` vs `''` in a jsonb array is three ways to store
   * the same absence. One representation — the key is absent — so two identical lists compare
   * equal, which is what the drawer's dirty check depends on.
   */
  private normaliseReferenceImages(
    images: RoadmapReferenceImageDto[] | undefined,
  ): RoadmapReferenceImage[] {
    if (!images?.length) return [];

    const bucket = this.assetsBucket();
    return images.map((image) => {
      const url = image.url.trim();
      const parsed = this.s3Service.parseS3Url(url);
      if (
        !parsed ||
        parsed.bucket !== bucket ||
        !parsed.key.startsWith(`${ROADMAP_REFERENCE_IMAGE_S3_PREFIX}/`)
      ) {
        throw new UnprocessableEntityException(
          'A reference image must be an image uploaded through this roadmap. Upload it again rather than pasting a link.',
        );
      }

      const caption = image.caption?.trim();
      return caption ? { url, caption } : { url };
    });
  }

  /**
   * The shared assets bucket, the same one blog headers and badge icons live in.
   *
   * Resolved per call rather than in the constructor: reading configuration at construction time
   * is module-load-time work, and this module is imported by other feature modules — a missing
   * env var would take down suites that never touch an image. Failing here fails only the
   * request that actually needed a bucket.
   */
  private assetsBucket(): string {
    const bucket = this.config.s3.assetsBucket;
    if (!bucket) {
      throw new InternalServerErrorException(
        'S3 bucket name for assetsBucket is not defined',
      );
    }
    return bucket;
  }

  /**
   * The users who may own an opportunity: the named accounts in ROADMAP_OWNER_EMAILS.
   *
   * Previously this was every PLATFORM_TIER_ROLES account, which turned the picker into a staff
   * directory — see the constant for why a short, explicit list replaced it. Matching is on
   * lowercased email so a `+admin` alias resolves to exactly that account and nothing else.
   *
   * A listed address with no Ally user simply contributes no option; the picker degrades to the
   * owners that do exist rather than failing. Existing assignments to someone no longer listed are
   * left alone — history should not silently rewrite itself — but cannot be re-made.
   */
  async listEligibleOwners(): Promise<RoadmapEligibleOwnerDto[]> {
    const rows = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.name', 'user.email'])
      .where('LOWER(user.email) IN (:...emails)', {
        emails: ROADMAP_OWNER_EMAILS,
      })
      .orderBy('user.name', 'ASC')
      .getMany();

    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email }));
  }

  /**
   * Reject an owner who is not on the roadmap owner list.
   *
   * 422 rather than 400: the id is well-formed, it just names someone ineligible — the same shape
   * the vote-cap breach uses, so the client can show the message rather than a generic failure.
   */
  private async assertEligibleOwner(userId: number): Promise<void> {
    const eligible = await this.listEligibleOwners();
    if (!eligible.some((u) => u.id === userId)) {
      throw new UnprocessableEntityException(
        'That user is not on the roadmap owner list.',
      );
    }
  }

  private async resolveUsers(
    ids: number[],
  ): Promise<Map<number, RoadmapUserRefDto>> {
    const unique = [
      ...new Set(ids.filter((id) => Number.isFinite(id) && id > 0)),
    ];
    if (unique.length === 0) return new Map();

    const users = await this.userRepository.find({
      where: { id: In(unique) },
      select: ['id', 'email', 'name'],
    });
    return new Map(
      users.map((u) => [u.id, { id: u.id, email: u.email, name: u.name }]),
    );
  }

  /**
   * createdBy has no FK to users, so a removed Ally user leaves an unresolvable id. Return a
   * placeholder rather than leaking a bare integer into the UI.
   */
  private unknownUser(id: number): RoadmapUserRefDto {
    return { id, email: '', name: 'Unknown user' };
  }
}
