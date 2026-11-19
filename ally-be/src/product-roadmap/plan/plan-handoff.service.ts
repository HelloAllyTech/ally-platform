import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { RoadmapCommentService } from '../service/roadmap-comment.service';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapItemReadService } from '../item/roadmap-item-read.service';
import { RoadmapDraftService } from '../draft/roadmap-draft.service';
import {
  RoadmapFilingInterviewMessage,
  RoadmapOpportunityBrief,
} from '../type/roadmap-brief.type';
import { renderBuilderHandoff } from '../util/roadmap-builder-handoff.util';
import { normaliseOpportunityBrief } from '../util/roadmap-brief.util';

/** Text the dated block always contains: what makes writing it idempotent. */
export const START_PLANNING_MARKER =
  '## The idea as it stands at Start planning';
/** The most recent comments carried, and how much of each. */
export const HANDOFF_COMMENTS_MAX = 15;
export const HANDOFF_COMMENT_CHARS = 600;
/** Voters named; the rest are counted. */
export const HANDOFF_VOTERS_MAX = 25;

export interface StartPlanningFacts {
  /** YYYY-MM-DD, the day planning started. */
  date: string;
  code: string;
  /** The description exactly as stored now, Owner edits included. */
  description: string;
  title: string;
  goal: string | null;
  size: string | null;
  author: string | null;
  filedAt: string | null;
  votes: number;
  voters: { name: string; votes: number }[];
  comments: { author: string; at: string; body: string }[];
  similar: {
    code: string;
    title: string;
    stage: string;
    votes: number;
    reason: string;
  }[];
  /** False when no copilot brief and no filing interview exist (an idea from before the interview). */
  hasFilingRecord: boolean;
  /** The brief's "who" and "how we'd know", when there is one. */
  who?: string | null;
  outcome?: string | null;
}

const line = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The dated block the planning agent reads first (audit rec. 5): the idea as it stands when the
 * Owner presses Start planning, not as it was filed. Pure. Sections with nothing in them say so
 * in one line rather than vanishing, because "no comments" and "nobody looked" read differently
 * to an agent deciding what to ask.
 */
export function renderStartPlanningBlock(facts: StartPlanningFacts): string {
  const parts: string[] = [
    `${START_PLANNING_MARKER} (${facts.date})`,
    'Written by the server when an Owner started planning. It is newer than anything below it: ' +
      'where the two differ (an Owner may have edited the title or summary since filing), this wins.' +
      (facts.hasFilingRecord
        ? ''
        : ' This idea was filed before the idea interview existed, so there is no brief and no ' +
          'filing interview: the description below is everything its author wrote. Quote it in ' +
          'your situation brief, and ask about what it leaves open rather than assuming it.'),
    `**Code:** ${facts.code}`,
    `**Title:** ${line(facts.title)}`,
    `**Description, exactly as it reads now:**\n\n${facts.description.trim()}`,
    `**Goal:** ${facts.goal ?? 'none set'}`,
    `**Size:** ${facts.size ? facts.size.toUpperCase() : 'not sized'}`,
  ];
  if (facts.who)
    parts.push(`**Who it affects (from the brief):** ${line(facts.who)}`);
  if (facts.outcome)
    parts.push(`**How we'd know (from the brief):** ${line(facts.outcome)}`);
  if (facts.author || facts.filedAt) {
    parts.push(
      `**Filed:** ${[
        facts.author ? `by ${facts.author}` : null,
        facts.filedAt ? `on ${facts.filedAt}` : null,
      ]
        .filter(Boolean)
        .join(' ')}`,
    );
  }

  const named = facts.voters.slice(0, HANDOFF_VOTERS_MAX);
  const more = facts.voters.length - named.length;
  parts.push(
    facts.voters.length
      ? `**Votes:** ${facts.votes} from ${facts.voters.length} ${facts.voters.length === 1 ? 'person' : 'people'}: ` +
          named.map((v) => `${v.name} (${v.votes})`).join(', ') +
          (more > 0 ? `, and ${more} more` : '')
      : `**Votes:** ${facts.votes}, from nobody yet`,
  );

  parts.push(
    facts.comments.length
      ? `**Comments (${facts.comments.length}, most recent last):**\n${facts.comments
          .map(
            (c) =>
              `- ${c.author} (${c.at}): ${clip(line(c.body), HANDOFF_COMMENT_CHARS)}`,
          )
          .join('\n')}`
      : '**Comments:** none yet',
  );

  parts.push(
    facts.similar.length
      ? `**Similar ideas on the board** (read one with \`read_roadmap_idea\` before deciding it overlaps):\n${facts.similar
          .map(
            (s) =>
              `- ${s.code} (${s.stage}, ${s.votes} votes): ${line(s.title)}${s.reason ? ` — ${line(s.reason)}` : ''}`,
          )
          .join('\n')}`
      : '**Similar ideas on the board:** none found',
  );
  return parts.join('\n\n');
}

/**
 * Start planning's hand-off (audit rec. 5, seam: one call in RoadmapReviewService.startPlanning).
 *
 * The hand-off the planning agent reads used to be written once, at Submit, and frozen; an
 * older idea whose session is created at Start planning got none and the agent saw only the
 * first line of its description as the session title. This gives every plan session:
 *
 * 1. the filing record (description, brief, filing interview) when one exists and the session
 *    has no hand-off yet — the case of an idea whose session Start planning created;
 * 2. in front of it, a dated block of the idea as it stands now: title, description, goal,
 *    size, votes and voters, comments and similar ideas.
 *
 * Idempotent: the block carries START_PLANNING_MARKER and is written once. Every read is as
 * the Owner who pressed the button, through the same read model the idea page uses, so nothing
 * reaches the agent that they could not see — and never a decline reason, which only the
 * author may read and which the session's other readers would then see quoted.
 */
@Injectable()
export class PlanHandoffService {
  private readonly logger = LoggerService.getInstance(PlanHandoffService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly builderSessions: BuilderSessionService,
    private readonly reader: RoadmapItemReadService,
    private readonly drafts: RoadmapDraftService,
    private readonly opportunities: RoadmapOpportunityService,
    private readonly comments: RoadmapCommentService,
  ) {}

  async attachAtStart(
    userId: number,
    code: string,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const item = await this.reader.detail(userId, code);
    const [opp] = await this.dataSource.query(
      `SELECT id, code, description, prd, brief, "interviewTranscript", "createdAt"
         FROM "roadmap_opportunities" WHERE id = $1`,
      [item.id],
    );
    if (!opp) return false;

    const brief = normaliseOpportunityBrief(
      opp.brief,
    ) as RoadmapOpportunityBrief | null;
    const transcript = Array.isArray(opp.interviewTranscript)
      ? (opp.interviewTranscript as RoadmapFilingInterviewMessage[])
      : [];
    const hasFilingRecord = !!brief || transcript.length > 0;
    if (hasFilingRecord) {
      // Writes only where the session has none yet (born at Start planning, or filed before
      // Submit wrote one); a hand-off written at Submit stays as the filing record.
      await this.builderSessions.attachHandoffContext(
        sessionId,
        renderBuilderHandoff({
          code: opp.code,
          description: opp.description,
          prd: opp.prd ?? null,
          brief,
          interviewTranscript: transcript,
        }),
      );
    }

    const [voters, comments, similar] = await Promise.all([
      this.opportunities.getVoters(opp.id).catch(() => []),
      this.comments.list(opp.id).catch(() => []),
      this.drafts
        .similarTo(userId, opp.description, item.goal?.name, opp.id)
        .then((r) => r.matches)
        .catch((error) => {
          this.logger.warn(
            `[ROADMAP] Similar ideas unavailable for ${code}'s hand-off: ${(error as Error)?.message}`,
          );
          return [];
        }),
    ]);
    const recent = [...comments]
      .sort(
        (a, b) =>
          new Date(a.createdAt as unknown as string).getTime() -
          new Date(b.createdAt as unknown as string).getTime(),
      )
      .slice(-HANDOFF_COMMENTS_MAX);
    const names = await this.namesOf(recent.map((c) => c.createdBy));

    const block = renderStartPlanningBlock({
      date: now.toISOString().slice(0, 10),
      code: item.code,
      description: opp.description,
      title: item.title,
      goal: item.goal?.name ?? null,
      size: item.size ?? null,
      author: item.author?.name ?? null,
      filedAt: opp.createdAt
        ? new Date(opp.createdAt).toISOString().slice(0, 10)
        : null,
      votes: item.votes,
      voters: voters
        .filter((v) => v.votes > 0)
        .map((v) => ({ name: v.name, votes: v.votes })),
      comments: recent.map((c) => ({
        author: names.get(Number(c.createdBy)) ?? 'Someone',
        at: new Date(c.createdAt as unknown as string)
          .toISOString()
          .slice(0, 10),
        body: c.body,
      })),
      similar: similar.map((s) => ({
        code: s.code,
        title: s.title,
        stage: s.shownStage,
        votes: s.votes,
        reason: s.reason,
      })),
      hasFilingRecord,
      who: item.summary?.who ?? null,
      outcome: item.summary?.outcome ?? null,
    });
    return this.builderSessions.prependHandoffBlock(
      sessionId,
      block,
      START_PLANNING_MARKER,
    );
  }

  private async namesOf(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.map(Number).filter(Number.isFinite))];
    if (!unique.length) return new Map();
    const rows: { id: number; name: string | null }[] =
      await this.dataSource.query(
        `SELECT id, name FROM "users" WHERE id = ANY($1)`,
        [unique],
      );
    return new Map(
      rows.filter((r) => r.name).map((r) => [Number(r.id), r.name as string]),
    );
  }
}
