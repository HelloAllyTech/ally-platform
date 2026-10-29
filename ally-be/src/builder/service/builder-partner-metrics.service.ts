import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan } from 'typeorm';
import { BuilderHistoryEntry } from '../entity/builder-history.entity';
import { BuilderRule } from '../entity/builder-rule.entity';
import { BuilderHistoryRepository } from './builder-history.service';
import { BuilderRuleRepository } from './builder-rule-context.service';

/** A one-way decision taken faster than this is worth a second look, not a target. */
const HASTY_ONE_WAY_MS = 3_000;
/** A gap longer than this between answers starts a new sitting. */
const SITTING_GAP_MS = 15 * 60 * 1000;

export interface BuilderAgreementRow {
  kind: string;
  questionType: string | null;
  agreed: number;
  total: number;
}

export interface BuilderPartnerScoreboard {
  windowDays: number;
  /** Human decisions counted (rule-decided and undone ones excluded). */
  decisions: number;
  waitingOnYou: {
    /** Total minutes Builder sat idle on a person across the window. */
    totalMinutes: number;
    medianMinutes: number | null;
    byKind: { kind: string; minutes: number; count: number }[];
    oneWayMinutes: number;
    reversibleMinutes: number;
  };
  /** Human answers a rule already covered when they were asked. Aim: zero. */
  askedTwice: { count: number; ofDecisions: number };
  agreement: BuilderAgreementRow[];
  caution: {
    /** One-way decisions taken in under 3 s, over all one-way decisions. */
    hastyOneWay: number;
    oneWay: number;
    undone: number;
    /** Undo rate over every human answer, undone ones included. */
    answered: number;
  };
  /** Private diagnostic: decisions per hour of sitting. Never on the Now page. */
  pace: { decisions: number; sittingMinutes: number; perHour: number | null };
  byClient: {
    client: string;
    decisions: number;
    undone: number;
  }[];
  decidedByRules: number;
  outcome: { started: number; released: number };
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The partner numbers, from History alone. Pure, so every definition the
 * scoreboard shows is pinned by its spec.
 *
 * - Undone answers count in nothing but the undo rate.
 * - Rule-decided answers count in nothing but `decidedByRules`.
 * - Agreement excludes one-option kinds (there is nothing to agree with).
 */
export const partnerScoreboard = (
  rows: BuilderHistoryEntry[],
  rules: Pick<BuilderRule, 'match' | 'createdAt'>[],
  windowDays: number,
  outcome: { started: number; released: number } = { started: 0, released: 0 },
): BuilderPartnerScoreboard => {
  const decisionRows = rows.filter((row) => row.entryType === 'decision');
  const answered = decisionRows.filter((row) => row.surface !== 'rule');
  const human = answered.filter((row) => !row.undoneAt);

  const waits = human
    .map((row) => row.waitSeconds)
    .filter((value): value is number => value != null);
  const byKind = new Map<string, { seconds: number; count: number }>();
  let oneWaySeconds = 0;
  let reversibleSeconds = 0;
  for (const row of human) {
    const seconds = row.waitSeconds ?? 0;
    const entry = byKind.get(row.kind ?? 'other') ?? { seconds: 0, count: 0 };
    entry.seconds += seconds;
    entry.count += 1;
    byKind.set(row.kind ?? 'other', entry);
    if (row.oneWay) oneWaySeconds += seconds;
    else reversibleSeconds += seconds;
  }

  const askedTwice = human.filter((row) =>
    rules.some(
      (rule) =>
        rule.match &&
        rule.match.kind === row.kind &&
        (!rule.match.questionType ||
          rule.match.questionType === row.questionType) &&
        new Date(rule.createdAt) < new Date(row.raisedAt ?? row.decidedAt),
    ),
  ).length;

  const agreementMap = new Map<string, BuilderAgreementRow>();
  for (const row of human) {
    if (row.matchedRecommendation == null) continue;
    const key = `${row.kind}|${row.questionType ?? ''}`;
    const entry = agreementMap.get(key) ?? {
      kind: row.kind ?? 'other',
      questionType: row.questionType ?? null,
      agreed: 0,
      total: 0,
    };
    entry.total += 1;
    if (row.matchedRecommendation) entry.agreed += 1;
    agreementMap.set(key, entry);
  }

  const oneWay = human.filter((row) => row.oneWay);
  const hasty = oneWay.filter(
    (row) => row.msToDecide != null && row.msToDecide < HASTY_ONE_WAY_MS,
  );

  // Sittings: answers closer than the gap are one sitting; each lasts from its
  // first answer to its last, with a minute's floor so a single answer counts.
  const times = human
    .map((row) => new Date(row.decidedAt).getTime())
    .sort((a, b) => a - b);
  let sittingMs = 0;
  let start = times[0];
  let last = times[0];
  for (const time of times.slice(1)) {
    if (time - last > SITTING_GAP_MS) {
      sittingMs += Math.max(60_000, last - start);
      start = time;
    }
    last = time;
  }
  if (times.length) sittingMs += Math.max(60_000, last - start);

  const clients = new Map<string, { decisions: number; undone: number }>();
  for (const row of answered) {
    const key = row.client ?? 'unknown';
    const entry = clients.get(key) ?? { decisions: 0, undone: 0 };
    entry.decisions += 1;
    if (row.undoneAt) entry.undone += 1;
    clients.set(key, entry);
  }

  return {
    windowDays,
    decisions: human.length,
    waitingOnYou: {
      totalMinutes: round1(waits.reduce((a, b) => a + b, 0) / 60),
      medianMinutes: waits.length ? round1((median(waits) ?? 0) / 60) : null,
      byKind: [...byKind.entries()]
        .map(([kind, value]) => ({
          kind,
          minutes: round1(value.seconds / 60),
          count: value.count,
        }))
        .sort((a, b) => b.minutes - a.minutes),
      oneWayMinutes: round1(oneWaySeconds / 60),
      reversibleMinutes: round1(reversibleSeconds / 60),
    },
    askedTwice: { count: askedTwice, ofDecisions: human.length },
    agreement: [...agreementMap.values()].sort((a, b) => b.total - a.total),
    caution: {
      hastyOneWay: hasty.length,
      oneWay: oneWay.length,
      undone: answered.length - human.length,
      answered: answered.length,
    },
    pace: {
      decisions: human.length,
      sittingMinutes: round1(sittingMs / 60_000),
      perHour: sittingMs
        ? round1(human.length / (sittingMs / 3_600_000))
        : null,
    },
    byClient: [...clients.entries()].map(([client, value]) => ({
      client,
      ...value,
    })),
    decidedByRules: decisionRows.filter(
      (row) => row.surface === 'rule' && !row.undoneAt,
    ).length,
    outcome,
  };
};

/** The Scoreboard's partner section: how well the person and Builder work together. */
@Injectable()
export class BuilderPartnerMetricsService {
  constructor(
    private readonly historyRepository: BuilderHistoryRepository,
    private readonly ruleRepository: BuilderRuleRepository,
    private readonly dataSource: DataSource,
  ) {}

  async scoreboard(windowDays = 30): Promise<BuilderPartnerScoreboard> {
    const days = Math.min(Math.max(Math.round(windowDays) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [rows, rules, outcome] = await Promise.all([
      this.historyRepository.find({
        where: { decidedAt: MoreThan(since) },
        order: { decidedAt: 'ASC' },
        take: 10_000,
      }),
      this.ruleRepository.find(),
      this.outcome(since),
    ]);
    return partnerScoreboard(rows, rules, days, outcome);
  }

  /** Opportunities started from Up next in the window, and how many are now released. */
  private async outcome(
    since: Date,
  ): Promise<{ started: number; released: number }> {
    try {
      const [row] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS started,
                COUNT(*) FILTER (WHERE o.stage = 'released')::int AS released
           FROM builder_history h
           LEFT JOIN roadmap_opportunities o ON o."builderSessionId" = h."sessionId"
          WHERE h."entryType" = 'start' AND h."decidedAt" > $1`,
        [since],
      );
      return {
        started: Number(row?.started ?? 0),
        released: Number(row?.released ?? 0),
      };
    } catch {
      return { started: 0, released: 0 };
    }
  }
}
