import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  BuilderHistoryClient,
  BuilderHistoryEntry,
  BuilderHistoryEntryType,
  BuilderHistorySurface,
} from '../entity/builder-history.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderDecision,
  parseDecisionId,
} from '../type/builder-decision.type';

@Injectable()
export class BuilderHistoryRepository extends Repository<BuilderHistoryEntry> {
  constructor(dataSource: DataSource) {
    super(BuilderHistoryEntry, dataSource.createEntityManager());
  }
}

/** Who answered, and from where. Passed down from whichever surface took the answer. */
export interface BuilderHistoryContext {
  surface: BuilderHistorySurface;
  actorUserId: number | null;
  client?: BuilderHistoryClient | null;
  msToDecide?: number | null;
  ruleId?: string | null;
}

/** The answer as the feed received it. */
export interface BuilderHistoryAnswer {
  selectedOptionIds?: string[];
  customText?: string | null;
  none?: boolean;
}

export type NewBuilderHistoryEntry = Partial<BuilderHistoryEntry> &
  Pick<BuilderHistoryEntry, 'entryType' | 'prompt' | 'surface' | 'decidedAt'>;

/**
 * The history row for a decision answered, frozen from the card as it stood.
 *
 * Pure, and exported for the spec: everything the scoreboard will later read
 * from History is decided here, so this is where "did the person take the
 * recommendation" is defined — once.
 */
export const historyFieldsFromDecision = (
  decision: BuilderDecision,
  answer: BuilderHistoryAnswer,
  context: BuilderHistoryContext,
  now: Date = new Date(),
): NewBuilderHistoryEntry => {
  const picked = answer.selectedOptionIds ?? [];
  const chosen = decision.options.filter((option) =>
    picked.includes(option.id),
  );
  const recommended =
    decision.options.find((option) => option.recommended)?.id ?? null;
  const custom = String(answer.customText ?? '').trim() || null;
  const labels = chosen.map((option) => option.label);
  if (answer.none) labels.push('None of these');
  const raisedAt = decision.waitingSince
    ? new Date(decision.waitingSince)
    : null;
  const parsed = parseDecisionId(decision.id);
  const isPullRequest =
    decision.kind === 'pr_merge' || decision.kind === 'pr_needs_human';

  return {
    entryType: 'decision',
    decisionId: decision.id,
    kind: decision.kind,
    category: decision.category,
    questionType: decision.questionType,
    sessionId: decision.sessionId,
    sessionTitle: decision.sessionTitle?.slice(0, 200) ?? null,
    pullRequestId: isPullRequest ? (parsed?.ref ?? null) : null,
    prompt: decision.prompt,
    chosenOptionIds: picked.length ? picked : null,
    chosenLabel: labels.length ? labels.join(', ') : custom,
    customText: custom,
    recommendedOptionId: recommended,
    // Agreeing with the only option on the card is not agreement, and there
    // is nothing to agree with when nothing was recommended.
    matchedRecommendation:
      !recommended || decision.options.length <= 1
        ? null
        : picked.length === 1 && picked[0] === recommended && !custom,
    oneWay: chosen.some((option) => option.oneWay || option.confirm),
    ruleId: context.ruleId ?? null,
    surface: context.surface,
    client: context.client ?? null,
    actorUserId: context.actorUserId,
    raisedAt,
    decidedAt: now,
    waitSeconds:
      raisedAt && !Number.isNaN(raisedAt.getTime())
        ? Math.max(0, Math.round((now.getTime() - raisedAt.getTime()) / 1000))
        : null,
    msToDecide:
      context.msToDecide != null && context.msToDecide >= 0
        ? Math.round(context.msToDecide)
        : null,
  };
};

export interface BuilderHistoryQuery {
  q?: string;
  sessionId?: string;
  entryType?: BuilderHistoryEntryType;
  who?: 'you' | 'team' | 'rule';
  ruleId?: string;
  before?: string;
  limit?: number;
}

export interface BuilderHistoryItem {
  id: string;
  entryType: BuilderHistoryEntryType;
  decisionId: string | null;
  kind: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  prompt: string;
  chosenLabel: string | null;
  answerText: string | null;
  recommendedOptionId: string | null;
  matchedRecommendation: boolean | null;
  oneWay: boolean;
  ruleId: string | null;
  surface: BuilderHistorySurface;
  client: BuilderHistoryClient | null;
  actorUserId: number | null;
  actorName: string | null;
  decidedAt: string;
  waitSeconds: number | null;
  undoneAt: string | null;
  appliedAt: string | null;
  applyError: string | null;
  tellStatus: string | null;
}

const HISTORY_PAGE = 50;
const HISTORY_PAGE_MAX = 200;

/**
 * Writes and reads Builder's History.
 *
 * Writes are best-effort by design: History records what happened, and a
 * failed insert must never fail the merge, the build or the answer it was
 * recording. A warning in the log is the whole of the failure path.
 */
@Injectable()
export class BuilderHistoryService {
  private readonly logger = LoggerService.getInstance(
    BuilderHistoryService.name,
  );

  constructor(
    private readonly repository: BuilderHistoryRepository,
    private readonly sessionRepository: BuilderSessionRepository,
  ) {}

  async record(
    entry: NewBuilderHistoryEntry,
  ): Promise<BuilderHistoryEntry | null> {
    try {
      return await this.repository.save(this.repository.create(entry));
    } catch (error) {
      this.logger.warn(
        `Could not write Builder history (${entry.entryType} ${
          entry.decisionId ?? entry.sessionId ?? ''
        }): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** A decision answered, frozen from the card. */
  recordDecision(
    decision: BuilderDecision,
    answer: BuilderHistoryAnswer,
    context: BuilderHistoryContext,
  ): Promise<BuilderHistoryEntry | null> {
    return this.record(historyFieldsFromDecision(decision, answer, context));
  }

  async markUndone(id: string): Promise<void> {
    await this.patch(id, { undoneAt: new Date() });
  }

  async markApplied(id: string, error?: string | null): Promise<void> {
    await this.patch(
      id,
      error
        ? { applyError: error.slice(0, 2000) }
        : { appliedAt: new Date(), applyError: null },
    );
  }

  async patch(id: string, fields: Partial<BuilderHistoryEntry>): Promise<void> {
    try {
      await this.repository.update({ id }, fields);
    } catch (error) {
      this.logger.warn(
        `Could not update Builder history ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  findById(id: string): Promise<BuilderHistoryEntry | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * History, newest first, searched and filtered. `who` is relative to the
   * person asking: "you", "teammates" (anyone else), or "your rules".
   */
  async list(
    query: BuilderHistoryQuery,
    userId: number,
  ): Promise<{ entries: BuilderHistoryItem[]; nextBefore: string | null }> {
    const limit = Math.min(
      Math.max(Number(query.limit) || HISTORY_PAGE, 1),
      HISTORY_PAGE_MAX,
    );
    const builder = this.repository
      .createQueryBuilder('h')
      .orderBy('h.decidedAt', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .take(limit + 1);

    const q = String(query.q ?? '').trim();
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      builder.andWhere(
        new Brackets((where) => {
          for (const column of [
            'prompt',
            'chosenLabel',
            'customText',
            'answerText',
            'sessionTitle',
          ]) {
            where.orWhere(`h."${column}" ILIKE :like`, { like });
          }
        }),
      );
    }
    if (query.sessionId) {
      builder.andWhere('h.sessionId = :sessionId', {
        sessionId: query.sessionId,
      });
    }
    if (query.entryType) {
      builder.andWhere('h.entryType = :entryType', {
        entryType: query.entryType,
      });
    }
    if (query.ruleId) {
      builder.andWhere('h.ruleId = :ruleId', { ruleId: query.ruleId });
    }
    if (query.who === 'you') {
      builder.andWhere('h.actorUserId = :userId AND h.surface <> :rule', {
        userId,
        rule: 'rule',
      });
    } else if (query.who === 'team') {
      builder.andWhere(
        'h.actorUserId IS NOT NULL AND h.actorUserId <> :userId AND h.surface <> :rule',
        { userId, rule: 'rule' },
      );
    } else if (query.who === 'rule') {
      builder.andWhere('h.surface = :rule', { rule: 'rule' });
    }
    if (query.before) {
      const before = new Date(query.before);
      if (!Number.isNaN(before.getTime())) {
        builder.andWhere('h.decidedAt < :before', { before });
      }
    }

    const rows = await builder.getMany();
    const page = rows.slice(0, limit);
    const names = await this.sessionRepository.findCreatorNames(
      page
        .map((row) => row.actorUserId)
        .filter((id): id is number => id != null),
    );
    return {
      entries: page.map((row) => toItem(row, names)),
      nextBefore:
        rows.length > limit && page.length
          ? page[page.length - 1].decidedAt.toISOString()
          : null,
    };
  }
}

const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

const toItem = (
  row: BuilderHistoryEntry,
  names: Map<number, string | null>,
): BuilderHistoryItem => ({
  id: row.id,
  entryType: row.entryType,
  decisionId: row.decisionId ?? null,
  kind: row.kind ?? null,
  sessionId: row.sessionId ?? null,
  sessionTitle: row.sessionTitle ?? null,
  prompt: row.prompt,
  chosenLabel: row.chosenLabel ?? null,
  answerText: row.answerText ?? null,
  recommendedOptionId: row.recommendedOptionId ?? null,
  matchedRecommendation: row.matchedRecommendation ?? null,
  oneWay: row.oneWay,
  ruleId: row.ruleId ?? null,
  surface: row.surface,
  client: row.client ?? null,
  actorUserId: row.actorUserId ?? null,
  actorName:
    row.actorUserId != null ? (names.get(row.actorUserId) ?? null) : null,
  decidedAt: new Date(row.decidedAt).toISOString(),
  waitSeconds: row.waitSeconds ?? null,
  undoneAt: iso(row.undoneAt),
  appliedAt: iso(row.appliedAt),
  applyError: row.applyError ?? null,
  tellStatus: row.tellStatus ?? null,
});
