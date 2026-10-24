import { Injectable } from '@nestjs/common';
import { LEARNING_GUARD } from 'src/guide-learning/evals/gate';
import {
  AllyCourseCostDto,
  AllyGuideAnalyticsQueryDto,
  AllyGuideCoursesDto,
  AllyGuideEngagementLearningDto,
  AllyGuideSummaryDto,
  AllyGuideWeeklyDto,
  AllyPairedWeekDto,
  AllyRateDto,
  AllyWeekDto,
} from '../dto/ally-guide-analytics.dto';
import {
  AllyGuideAnalyticsRepository,
  CourseCostRow,
  WeeklyLearningRow,
} from '../repository/ally-guide-analytics.repository';
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  AnalyticsWindow,
  describeWindow,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/** One minimum-group-size rule for the whole analytics surface. */
export const ALLY_MIN_GROUP_SIZE = MIN_COHORT_SIZE;

const PROVENANCE =
  "Signed-in learners' Ally conversations (guide_threads with a user; merged " +
  'visitor threads count once), their messages, turns and traces, ratings ' +
  '(guide_turn_feedback), appointments, crisis signals, and their course ' +
  'progress and quiz attempts on the course of the conversation. Weeks are ' +
  'ISO weeks in UTC. Test organisations are excluded. A rate over fewer than ' +
  `${ALLY_MIN_GROUP_SIZE} learners is withheld; its counts are kept.`;

/** A rate with its counts, withheld under the minimum group size. */
export function rateOf(
  count: number,
  of: number,
  learners: number,
): AllyRateDto {
  const suppressed = learners < ALLY_MIN_GROUP_SIZE;
  return {
    rate: suppressed || !of ? null : Number((count / of).toFixed(4)),
    count,
    of,
    learners,
    suppressed,
  };
}

const per100 = (count: number, learners: number) =>
  learners < ALLY_MIN_GROUP_SIZE || !learners
    ? null
    : Number(((count / learners) * 100).toFixed(2));

/**
 * The guard on one week against the one before (plan §4.13: "if engagement
 * rises while learning is flat or falling, the change is reverted"), with the
 * thresholds the canary's guard uses.
 */
export function weekGuard(
  previous: AllyPairedWeekDto | null,
  current: Omit<AllyPairedWeekDto, 'guard'>,
): AllyPairedWeekDto['guard'] {
  if (
    !previous ||
    previous.quizFirstAttemptPass === null ||
    current.quizFirstAttemptPass === null
  ) {
    return 'too_few';
  }
  const rose = (c: number | null, p: number | null) =>
    c !== null &&
    p !== null &&
    p > 0 &&
    c >= p * (1 + LEARNING_GUARD.engagementLift);
  const engagementUp =
    rose(current.itemsPerLearningDay, previous.itemsPerLearningDay) ||
    rose(current.thumbsUpShare, previous.thumbsUpShare);
  if (
    current.quizFirstAttemptPass <
    previous.quizFirstAttemptPass - LEARNING_GUARD.learningMargin
  ) {
    return 'learning_fell';
  }
  if (
    engagementUp &&
    current.quizFirstAttemptPass <
      previous.quizFirstAttemptPass + LEARNING_GUARD.learningMargin
  ) {
    return 'engagement_up_learning_flat';
  }
  return 'ok';
}

/** Courses under the minimum group fold into one unnamed row. */
export function foldCourses(rows: CourseCostRow[]): AllyCourseCostDto[] {
  const shown: AllyCourseCostDto[] = [];
  const other = { learners: 0, turns: 0, costUsd: 0, folded: 0 };
  for (const row of rows) {
    if (row.learners < ALLY_MIN_GROUP_SIZE) {
      other.learners += row.learners;
      other.turns += row.turns;
      other.costUsd += row.costUsd;
      other.folded++;
      continue;
    }
    shown.push({
      trackId: row.trackId,
      title: row.title,
      learners: row.learners,
      turns: row.turns,
      costUsd: Number(row.costUsd.toFixed(4)),
      costPerLearnerUsd: Number((row.costUsd / row.learners).toFixed(4)),
      folded: 0,
    });
  }
  if (other.folded) {
    shown.push({
      trackId: null,
      title: 'Other courses',
      learners: other.learners,
      turns: other.turns,
      costUsd: Number(other.costUsd.toFixed(4)),
      costPerLearnerUsd:
        other.learners >= ALLY_MIN_GROUP_SIZE
          ? Number((other.costUsd / other.learners).toFixed(4))
          : null,
      folded: other.folded,
    });
  }
  return shown;
}

/** All weeks of the window, oldest first (Mondays, UTC). */
export function weeksOf(start: Date, endExclusive: Date): string[] {
  const monday = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const out: string[] = [];
  for (
    let d = monday;
    d < endExclusive;
    d = new Date(d.getTime() + 7 * 86_400_000)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The Ally guide's analytics (AAQ-240..251; plans/ally-guide/plan.md §4.13,
 * §10.5): engagement, learning and health, measured as a game and as
 * learning side by side so neither is read alone (Goodhart).
 */
@Injectable()
export class AllyGuideAnalyticsService {
  constructor(private readonly repository: AllyGuideAnalyticsRepository) {}

  /** Every range is read by ISO week: the charts are weekly series. */
  private static bucket(): AnalyticsBucket {
    return 'week';
  }

  private async window(
    query: AllyGuideAnalyticsQueryDto,
  ): Promise<AnalyticsWindow> {
    const needsFloor =
      (query.range ?? '90d') === 'all' && !query.from && !query.to;
    return resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor: AllyGuideAnalyticsService.bucket,
      allTimeStart: needsFloor
        ? ((await this.repository.dataFloor()) ?? new Date())
        : undefined,
    });
  }

  private base(window: AnalyticsWindow, tenantId: string | undefined) {
    return {
      window: describeWindow(window),
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      minGroupSize: ALLY_MIN_GROUP_SIZE,
      provenance: PROVENANCE,
    };
  }

  /** AAQ-240. */
  async summary(
    query: AllyGuideAnalyticsQueryDto,
  ): Promise<AllyGuideSummaryDto> {
    const window = await this.window(query);
    const tenantId = query.tenantId?.trim() || undefined;
    const t = await this.repository.totals(
      window.start,
      window.endExclusive,
      tenantId,
    );
    return {
      ...this.base(window, tenantId),
      learners: t.learners,
      conversations: t.conversations,
      learnerMessages: t.learnerMessages,
      thumbsUp: rateOf(t.thumbsUp, t.thumbsUp + t.thumbsDown, t.ratingLearners),
      costUsd: Number(t.costUsd.toFixed(4)),
      costPerLearnerUsd:
        t.learners >= ALLY_MIN_GROUP_SIZE
          ? Number((t.costUsd / t.learners).toFixed(4))
          : null,
    };
  }

  /** AAQ-241..247, 249, 250. */
  async weekly(query: AllyGuideAnalyticsQueryDto): Promise<AllyGuideWeeklyDto> {
    const window = await this.window(query);
    const tenantId = query.tenantId?.trim() || undefined;
    const args = [window.start, window.endExclusive, tenantId] as const;
    const [
      activity,
      wins,
      items,
      returns,
      appointments,
      quiz,
      roleplay,
      health,
      crises,
    ] = await Promise.all([
      this.repository.activity(...args),
      this.repository.firstWins(...args),
      this.repository.items(...args),
      this.repository.returns(...args),
      this.repository.appointments(...args),
      this.repository.quizFirstAttempts(...args),
      this.repository.roleplayScores(...args),
      this.repository.health(...args),
      this.repository.crises(...args),
    ]);
    const by = <T extends { week: string }>(rows: T[]) =>
      new Map(rows.map((row) => [row.week, row]));
    const split = (rows: WeeklyLearningRow[], ally: boolean) =>
      by(rows.filter((row) => row.ally === ally));
    const [A, W, I, R, P, H, C] = [
      by(activity),
      by(wins),
      by(items),
      by(returns),
      by(appointments),
      by(health),
      by(crises),
    ];
    const [Q, Qc, S, Sc] = [
      split(quiz, true),
      split(quiz, false),
      split(roleplay, true),
      split(roleplay, false),
    ];
    const learningRate = (row: WeeklyLearningRow | undefined) =>
      rateOf(
        row ? Math.round((row.rate ?? 0) * row.attempts) : 0,
        row?.attempts ?? 0,
        row?.learners ?? 0,
      );
    const score = (row: WeeklyLearningRow | undefined) =>
      row && row.learners >= ALLY_MIN_GROUP_SIZE ? row.rate : null;
    const weeks: AllyWeekDto[] = weeksOf(window.start, window.endExclusive).map(
      (week) => {
        const a = A.get(week);
        const w = W.get(week);
        const h = H.get(week);
        const learners = a?.learners ?? 0;
        const days = a?.learnerDays ?? 0;
        return {
          week,
          activeLearners: learners,
          firstSessionWin: rateOf(
            w?.winsInSession ?? 0,
            w?.newThreads ?? 0,
            w?.learners ?? 0,
          ),
          firstWinWithin5Min: rateOf(
            w?.winsWithin5Min ?? 0,
            w?.newThreads ?? 0,
            w?.learners ?? 0,
          ),
          itemsPerLearningDay:
            learners >= ALLY_MIN_GROUP_SIZE && days
              ? Number(((I.get(week)?.items ?? 0) / days).toFixed(2))
              : null,
          sevenDayReturn: rateOf(
            R.get(week)?.returned ?? 0,
            R.get(week)?.cohort ?? 0,
            R.get(week)?.cohort ?? 0,
          ),
          appointmentsSet: P.get(week)?.set ?? 0,
          appointmentsKept: rateOf(
            P.get(week)?.kept ?? 0,
            P.get(week)?.due ?? 0,
            P.get(week)?.learners ?? 0,
          ),
          voiceAdoption: rateOf(a?.voiceLearners ?? 0, learners, learners),
          quizFirstAttemptPass: learningRate(Q.get(week)),
          quizFirstAttemptPassClassic: learningRate(Qc.get(week)),
          roleplayScore: score(S.get(week)),
          roleplayScoreClassic: score(Sc.get(week)),
          careEntriesPer100: per100(h?.careEntries ?? 0, h?.learners ?? 0),
          crisisEntriesPer100: per100(
            C.get(week)?.crisisEntries ?? 0,
            h?.learners ?? 0,
          ),
          offCourse: rateOf(
            h?.offCourse ?? 0,
            h?.learnerTurns ?? 0,
            h?.learners ?? 0,
          ),
          refusals: rateOf(
            h?.refusals ?? 0,
            h?.learnerTurns ?? 0,
            h?.learners ?? 0,
          ),
        };
      },
    );
    return { ...this.base(window, tenantId), weeks };
  }

  /** AAQ-248: engagement and learning on one timeline, with the guard per week. */
  async engagementVsLearning(
    query: AllyGuideAnalyticsQueryDto,
  ): Promise<AllyGuideEngagementLearningDto> {
    const window = await this.window(query);
    const tenantId = query.tenantId?.trim() || undefined;
    const args = [window.start, window.endExclusive, tenantId] as const;
    const [activity, items, thumbs, quiz] = await Promise.all([
      this.repository.activity(...args),
      this.repository.items(...args),
      this.repository.thumbs(...args),
      this.repository.quizFirstAttempts(...args),
    ]);
    const A = new Map(activity.map((r) => [r.week, r]));
    const I = new Map(items.map((r) => [r.week, r]));
    const T = new Map(thumbs.map((r) => [r.week, r]));
    const Q = new Map(quiz.filter((r) => r.ally).map((r) => [r.week, r]));
    const weeks: AllyPairedWeekDto[] = [];
    let previous: AllyPairedWeekDto | null = null;
    for (const week of weeksOf(window.start, window.endExclusive)) {
      const a = A.get(week);
      const t = T.get(week);
      const q = Q.get(week);
      const learners = a?.learners ?? 0;
      const enough = learners >= ALLY_MIN_GROUP_SIZE;
      const row: Omit<AllyPairedWeekDto, 'guard'> = {
        week,
        activeLearners: learners,
        itemsPerLearningDay:
          enough && a?.learnerDays
            ? Number(((I.get(week)?.items ?? 0) / a.learnerDays).toFixed(2))
            : null,
        thumbsUpShare:
          t && t.learners >= ALLY_MIN_GROUP_SIZE && t.up + t.down
            ? Number((t.up / (t.up + t.down)).toFixed(4))
            : null,
        quizFirstAttemptPass:
          q && q.learners >= ALLY_MIN_GROUP_SIZE ? q.rate : null,
      };
      const paired: AllyPairedWeekDto = {
        ...row,
        guard: weekGuard(previous, row),
      };
      weeks.push(paired);
      previous = paired;
    }
    return { ...this.base(window, tenantId), weeks };
  }

  /** AAQ-251. */
  async courses(
    query: AllyGuideAnalyticsQueryDto,
  ): Promise<AllyGuideCoursesDto> {
    const window = await this.window(query);
    const tenantId = query.tenantId?.trim() || undefined;
    const rows = await this.repository.courses(
      window.start,
      window.endExclusive,
      tenantId,
    );
    return { ...this.base(window, tenantId), courses: foldCourses(rows) };
  }
}
