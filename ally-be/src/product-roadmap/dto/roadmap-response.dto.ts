import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RoadmapOpportunityEffort,
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';
import { RoadmapReferenceImageDto } from './roadmap-opportunity.dto';
import {
  RoadmapBriefEvidenceSource,
  RoadmapBriefRating,
} from '../type/roadmap-brief.type';

export class RoadmapBriefStrategicFitDto {
  @ApiProperty({
    description:
      'A strategy goal name, or a bet from the Vision & strategy page',
  })
  goal!: string;
  @ApiProperty() why!: string;
}

export class RoadmapBriefReachDto {
  @ApiProperty({ nullable: true }) howMany!: string | null;
  @ApiProperty({ nullable: true }) howOften!: string | null;
}

export class RoadmapBriefEvidenceDto {
  @ApiProperty({ enum: RoadmapBriefEvidenceSource })
  source!: RoadmapBriefEvidenceSource;
  @ApiProperty() claim!: string;
  @ApiProperty({
    nullable: true,
    description: 'Where to check it — an opportunity code, a path, a query',
  })
  ref!: string | null;
}

export class RoadmapBriefAssessmentDto {
  @ApiProperty({ enum: RoadmapBriefRating }) rating!: RoadmapBriefRating;
  @ApiProperty() summary!: string;
  @ApiProperty({
    type: [String],
    description: 'What would move it up a rating; empty once rated strong',
  })
  openRecommendations!: string[];
}

/** The opportunity copilot's brief — see RoadmapOpportunityBrief. */
export class RoadmapOpportunityBriefDto {
  @ApiProperty({ type: [RoadmapBriefStrategicFitDto] })
  strategicFit!: RoadmapBriefStrategicFitDto[];
  @ApiProperty({ type: RoadmapBriefReachDto }) reach!: RoadmapBriefReachDto;
  @ApiProperty({ type: [RoadmapBriefEvidenceDto] })
  evidence!: RoadmapBriefEvidenceDto[];
  @ApiProperty({ nullable: true }) successMetric!: string | null;
  @ApiProperty({ type: [String] }) assumptions!: string[];
  @ApiProperty({ type: [String] }) alternativesDropped!: string[];
  @ApiProperty({ type: RoadmapBriefAssessmentDto })
  assessment!: RoadmapBriefAssessmentDto;
}

export class OpportunityBriefResponseDto {
  @ApiPropertyOptional({ type: RoadmapOpportunityBriefDto, nullable: true })
  brief!: RoadmapOpportunityBriefDto | null;
}

export class RoadmapUserRefDto {
  @ApiProperty() id!: number;
  /** Falls back to a placeholder when the Ally user no longer exists — createdBy has no FK. */
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
}

export class OpportunityResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: RoadmapOpportunityType }) type!: RoadmapOpportunityType;
  @ApiProperty({ enum: RoadmapOpportunityStage })
  stage!: RoadmapOpportunityStage;
  @ApiProperty() productGoal!: string;
  /** Display name: the linked super-admin's current name, or a legacy migrated string. */
  @ApiPropertyOptional({ nullable: true }) owner?: string | null;

  /** Null for legacy migrated rows whose owner was never linked to an Ally account. */
  @ApiPropertyOptional({ nullable: true }) ownerUserId?: number | null;
  @ApiPropertyOptional({ nullable: true }) prd?: string | null;
  @ApiProperty({
    description:
      "Short human-quotable id, e.g. 'OPP-0042'. Unique, never reused.",
  })
  code!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Position in the queue (New / Prioritised / In development) by total votes — 1-based, ' +
      'unique, and null outside those stages. Computed per read, so it always reflects the ' +
      'current stages and vote totals.',
  })
  queueRank!: number | null;
  @ApiPropertyOptional({ nullable: true }) claudePrompt?: string | null;

  /**
   * Reference images in the order they were arranged. Always an array — empty, never null, so no
   * client has to handle both shapes.
   */
  @ApiProperty({ type: [RoadmapReferenceImageDto] })
  referenceImages!: RoadmapReferenceImageDto[];

  /**
   * Whether the copilot filed a brief with this opportunity. A flag rather than the brief:
   * this DTO serves every board row, and a brief can run to ~12 KB — fetch it from
   * `GET opportunities/:id/brief` when the drawer actually shows it.
   */
  @ApiProperty() hasBrief!: boolean;
  /** The Builder session started from this opportunity, or null. Drives the drawer's
   *  button between "Open in Builder Agent" and "Resume in Builder Agent". */
  @ApiPropertyOptional({ nullable: true }) builderSessionId?: string | null;
  @ApiPropertyOptional({ nullable: true }) releasedAt?: Date | null;

  /** The month somebody planned this into, 'YYYY-MM'. Null means Unscheduled. */
  @ApiPropertyOptional({ nullable: true }) plannedMonth?: string | null;

  /** Rough size — S/M/L/XL/XXL. Null means nobody has sized it. */
  @ApiPropertyOptional({ nullable: true, enum: RoadmapOpportunityEffort })
  effort?: RoadmapOpportunityEffort | null;

  /**
   * The weighted four-factor rank, 0-100. The board's DEFAULT ordering.
   *
   * Always accompanied by the four factors that produced it (below) — a composite you cannot
   * check against its own inputs is a number nobody can argue with, and the whole point of
   * ranking on four lenses rather than one is that the lenses stay visible.
   */
  @ApiProperty({
    description:
      'Weighted composite of votes, distinct backers, effort and strategy-goal coverage, ' +
      '0-100. Recomputed per read from live weights — never stored.',
  })
  compositeScore!: number;

  /**
   * Distinct admins backing this, across all periods. Breadth, where priorityScore is
   * intensity: one admin spending 40 votes and forty spending one each are the same total.
   */
  @ApiProperty() voterCount!: number;

  /** Strategy goals this was judged to positively move. */
  /**
   * The Prod Director's star. NON-NULL ONLY FOR THE DIRECTOR: every other viewer gets null, so
   * the icon is invisible to them. The star still moves their rank — only the flag is hidden.
   */
  @ApiProperty({ nullable: true })
  directorStarred!: boolean | null;

  @ApiProperty() goalsHelped!: number;

  /**
   * Strategy goals this has any verdict for. Below `goalsTotal` means the assessment predates
   * a goal being added — coverage divides by the live total either way, so such a row reads as
   * lower-impact than it may actually be. Surfaced rather than hidden.
   */
  @ApiProperty() goalsAssessed!: number;

  /** Live strategy-goal count — the coverage denominator. Zero means no strategy is defined. */
  @ApiProperty() goalsTotal!: number;

  /** Manual rank within its lane, ascending. Only meaningful against its own lane. */
  @ApiProperty() boardPosition!: number;

  /**
   * The lane the card actually appears in — its release month once shipped, else plannedMonth.
   * Derived, never stored; sent so the client never has to re-implement the rule.
   */
  @ApiPropertyOptional({ nullable: true }) effectiveMonth?: string | null;

  /**
   * True when the lane is a fact rather than a plan, so the card must not be dragged. The client
   * uses this to make the card undraggable instead of letting a drop fail with a 422.
   */
  @ApiProperty() monthPinned!: boolean;

  /**
   * SUM(weightedVotes) over ALL users and ALL periods — votes weighted by each voter's breadth
   * multiplier when they voted. One decimal at most. Computed in SQL, never stored.
   */
  @ApiProperty() priorityScore!: number;
  /**
   * True when voting here would back a colleague the caller has not backed inside the breadth
   * window: votable, not the caller's own, and no standing recent vote on that author. Drives
   * the "New colleague" marker and the "New to you" filter.
   */
  @ApiProperty() breadthNew!: boolean;
  /** The CALLER's votes on this opportunity in the CURRENT period only. */
  @ApiProperty() myVotes!: number;
  @ApiProperty() commentCount!: number;

  /** Who filed it — 'staff' (admin /opportunities) or 'consumer' (/bug-reports). Admin display only. */
  @ApiProperty({ enum: RoadmapOpportunitySource })
  source!: RoadmapOpportunitySource;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiPropertyOptional({ type: RoadmapUserRefDto, nullable: true })
  creator?: RoadmapUserRefDto | null;
}

/**
 * The confirmation returned to whoever filed a bug report — one-time only, by design (see
 * CreateBugReportDto's docblock): no "my reports" listing, no full OpportunityResponseDto,
 * since a reporter has no further use for the roadmap fields. Staff track their report in
 * Bug Hunter's findings table, where it lands, rather than back on this form.
 */
export class BugReportResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: RoadmapOpportunityStage })
  stage!: RoadmapOpportunityStage;
}

export class GetOpportunitiesResponseDto {
  @ApiProperty({ type: [OpportunityResponseDto] })
  items!: OpportunityResponseDto[];
  @ApiProperty() count!: number;

  /**
   * MAX priority score across ALL non-deleted opportunities — deliberately unfiltered, so the
   * priority bars keep a stable scale when the user applies a filter.
   */
  @ApiProperty() maxScore!: number;

  /** Server-computed 'YYYY-MM'. The client must never derive this itself. */
  @ApiProperty() periodKey!: string;
}

/**
 * The caller's live, spendable vote balance — every unexpired grant (50/month + 5/day, each
 * good for 30 days) minus what's already been drawn from it. Not scoped to a calendar month:
 * there's no fixed monthly total to compare against anymore, so there is deliberately no
 * "of N" figure alongside it. See RoadmapVoteGrant's docblock for the full ledger shape.
 */
export class VoteBudgetDto {
  @ApiProperty() available!: number;
}

/**
 * Returned by PUT /allocations. Carries BOTH the updated opportunity aggregate and the
 * caller's budget, so the frontend can reconcile its optimistic patch in one round-trip
 * instead of refetching the list (which would stomp an in-flight vote).
 */
export class SetAllocationResponseDto {
  @ApiProperty() opportunityId!: string;
  @ApiProperty() periodKey!: string;
  @ApiProperty() votes!: number;
  @ApiProperty() priorityScore!: number;
  @ApiProperty({ type: VoteBudgetDto }) budget!: VoteBudgetDto;
  /** The breadth multiplier this vote was weighted with (1 when the feature is off). */
  @ApiProperty() multiplier!: number;
  /** Distinct colleagues now counted toward the caller's breadth. */
  @ApiProperty() qualifying!: number;
}

/** One admin's vote total on one opportunity, across every period. */
export class RoadmapVoterDto {
  @ApiProperty() userId!: number;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  /** Votes spent. */
  @ApiProperty() votes!: number;
  /** What those votes are worth to the score; equals `votes` when no breadth bonus applied. */
  @ApiProperty() weightedVotes!: number;
}

/** The caller's breadth multiplier and what's behind it. */
export class BreadthDto {
  /** False when the feature flag is off — the UI renders none of the breadth surface. */
  @ApiProperty() enabled!: boolean;
  @ApiProperty() multiplier!: number;
  /** Distinct colleagues backed inside the window. */
  @ApiProperty() qualifying!: number;
  /** Colleagues needed for the full bonus right now (capped, and never more than exist). */
  @ApiProperty() target!: number;
  @ApiProperty() windowDays!: number;
  /** The multiplier at full breadth, i.e. the ceiling for this caller today. */
  @ApiProperty() maxMultiplier!: number;
  /** When the multiplier will next fall from votes ageing out; null if nothing is due. */
  @ApiPropertyOptional({ nullable: true }) nextDropAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) nextDropMultiplier!: number | null;
  /** The colleague whose vote is ageing out, for the "why" line. */
  @ApiPropertyOptional({ nullable: true }) nextDropAuthorName!: string | null;
}

export class RoadmapFacetsDto {
  @ApiProperty({ type: [RoadmapUserRefDto] }) creators!: RoadmapUserRefDto[];
  @ApiProperty({ type: [String] }) goals!: string[];
  @ApiProperty({ type: [String] }) owners!: string[];
}

export class DuplicateMatchDto {
  @ApiProperty() id!: string;
  @ApiProperty() description!: string;
  @ApiProperty() productGoal!: string;
  @ApiProperty({ enum: RoadmapOpportunityStage })
  stage!: RoadmapOpportunityStage;
  @ApiProperty({ description: 'Why the model judged this a duplicate' })
  reason!: string;
  @ApiProperty() similarity!: number;
}

export class DuplicatesResponseDto {
  @ApiProperty({ type: [DuplicateMatchDto] }) matches!: DuplicateMatchDto[];
}

/** One criterion's live verdict, as the interview's checklist renders it. */
export class OpportunityInterviewGateDto {
  @ApiProperty({ description: 'A ROADMAP_READINESS_CRITERIA id' })
  id!: string;

  @ApiProperty({
    description:
      'True only when the conversation so far actually establishes it',
  })
  met!: boolean;

  @ApiProperty({ description: 'What satisfied it, or what is still missing' })
  note!: string;
}

/** The draft an interview hands over once every gate is met. */
export class OpportunityInterviewDraftDto {
  @ApiProperty() description!: string;

  @ApiPropertyOptional({
    description:
      "A short title the copilot suggests for the idea; the Roadmap v2 draft page offers it beside the author's words",
  })
  title?: string;

  @ApiProperty({
    nullable: true,
    description: 'One of the live product goal names, or null when none fit',
  })
  productGoal!: string | null;

  @ApiProperty({ enum: RoadmapOpportunityEffort, nullable: true })
  effort!: RoadmapOpportunityEffort | null;
}

/** One graded quality dimension. */
export class OpportunityQualityDimensionDto {
  @ApiProperty({ description: 'A ROADMAP_QUALITY_DIMENSIONS id' }) id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({
    description:
      '0 absent · 1 vague · 2 adequate · 3 specific · 4 specific and evidenced',
  })
  score!: number;
  @ApiProperty({ description: 'Share of the 100-point score' }) weight!: number;
  @ApiProperty({
    description:
      'Score this dimension must reach for the idea to pass, whatever the total',
  })
  floor!: number;
  @ApiProperty({
    description: 'What earned the grade, or the one thing that would raise it',
  })
  note!: string;
}

/** The quality verdict. Computed server-side from the model's per-dimension grades. */
export class OpportunityQualityDto {
  @ApiProperty({ description: '0-100' }) score!: number;
  @ApiProperty() passScore!: number;
  @ApiProperty() scaleMax!: number;
  @ApiProperty({
    description:
      'Score at the pass mark and no floored dimension below its floor',
  })
  passed!: boolean;
  @ApiProperty({ type: [OpportunityQualityDimensionDto] })
  dimensions!: OpportunityQualityDimensionDto[];
  @ApiProperty({
    nullable: true,
    description: 'The dimension to strengthen next',
  })
  weakest!: string | null;
}

/** One independently fileable slice of a too-big idea, with its own signed token. */
export class OpportunityInterviewSliceDto {
  @ApiPropertyOptional({ nullable: true }) title!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true }) productGoal!: string | null;
  @ApiProperty({ enum: RoadmapOpportunityEffort })
  effort!: RoadmapOpportunityEffort;
  @ApiProperty({
    nullable: true,
    description: 'Signed readiness verdict for exactly this slice',
  })
  readinessToken!: string | null;
}

export class OpportunityInterviewTurnResponseDto {
  @ApiProperty({
    description: "The agent's next question, or its hand-over line",
  })
  reply!: string;

  @ApiProperty({
    type: [OpportunityInterviewGateDto],
    description:
      'One entry per readiness criterion, in the criteria order — the same ones the filing ' +
      'gate grades, so a completed interview cannot produce a draft that gate would reject.',
  })
  gates!: OpportunityInterviewGateDto[];

  @ApiPropertyOptional({
    type: OpportunityInterviewDraftDto,
    nullable: true,
    description: 'Null until every gate is met.',
  })
  draft!: OpportunityInterviewDraftDto | null;

  /**
   * The signed readiness verdict for `draft.description`, to be handed back on
   * `POST /opportunities` as `readinessToken` — exactly as the "Check readiness" button's token
   * is. Issued only alongside a draft, and only because the interview grades the SAME criteria:
   * a token minted from a private rubric would be a signature over a check nobody ran.
   */
  @ApiPropertyOptional({ nullable: true })
  readinessToken!: string | null;

  /** The 0-100 quality grade after this turn, with each dimension. Always present. */
  @ApiProperty({ type: OpportunityQualityDto })
  quality!: OpportunityQualityDto;

  /**
   * Set instead of `draft` when the idea is too big for one filing (XL/XXL) or is really several
   * independent ideas: two to five slices, each fileable on its own. Empty otherwise.
   */
  @ApiProperty({ type: [OpportunityInterviewSliceDto] })
  slices!: OpportunityInterviewSliceDto[];

  /**
   * The copilot's working brief after this turn: strategic fit, reach, evidence it found,
   * success metric, assumptions, what was dropped, and its assessment. Send it back unchanged
   * as `brief` on the next turn, and on `POST /opportunities` alongside `readinessToken` —
   * the token is minted over it. Null until the copilot has anything to put in it.
   */
  @ApiPropertyOptional({ type: RoadmapOpportunityBriefDto, nullable: true })
  brief!: RoadmapOpportunityBriefDto | null;
}

export class AiTextResponseDto {
  @ApiProperty() text!: string;
}

export class ReindexResponseDto {
  @ApiProperty() queued!: number;
  @ApiProperty() succeeded!: number;
  @ApiProperty() failed!: number;
}

export class PruneVectorsResponseDto {
  @ApiProperty({ description: 'Ids enumerated in the vector index' })
  scanned!: number;

  @ApiProperty({
    description: 'Vectors with no Postgres row at all, deleted by this run',
  })
  orphansDeleted!: number;

  @ApiProperty({
    description: 'Orphans found but whose delete call failed; retry the sweep',
  })
  failed!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Set when the sweep REFUSED to delete anything. A high orphan ratio means the id set we ' +
      'diffed against was probably incomplete, and deleting on that basis would destroy good ' +
      'vectors. Nothing was deleted; investigate and re-run.',
  })
  abortedReason!: string | null;
}

export class RoadmapEligibleOwnerDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
}

/**
 * The result of pressing "Open in Builder Agent".
 *
 * `created` is the whole contract for whether the client seeds the interview: on a resume the
 * transcript already has the brief in it, and sending it again would open the session with the
 * same paragraph twice and the agent responding to the repeat. `seedMessage` is null in that case
 * for the same reason — there is nothing to send.
 */
export class OpenBuilderSessionResponseDto {
  @ApiProperty() sessionId!: string;
  @ApiProperty({
    description:
      'True only when this call created the session, so the client must seed it',
  })
  created!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: 'The opening brief to send, when created',
  })
  seedMessage!: string | null;
}
