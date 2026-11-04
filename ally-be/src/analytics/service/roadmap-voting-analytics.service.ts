import { Injectable } from '@nestjs/common';
import { RoadmapVotingAnalyticsRepository } from '../repository/roadmap-voting-analytics.repository';
import {
  RoadmapVoterDto,
  RoadmapVotingMonthDto,
  RoadmapVotingResponseDto,
  RoadmapVotingUserMonthDto,
} from '../dto/roadmap-voting-analytics.dto';
import {
  addMonths,
  isoDate,
  startOfUtcMonth,
} from '../util/analytics-window.util';

/**
 * Roadmap voting participation for Analytics → Highlights → Priority: how many votes
 * each admin with roadmap access cast, month by month. The point is adoption — more of
 * the team shaping the roadmap — so the shape carries the people who did NOT vote as
 * well as the ones who did:
 *
 *  - **Non-voters are rows, not absences.** Every month lists every admin who could
 *    vote in it, with 0 where they didn't. Participation ("4 of 11 voted") needs that
 *    denominator, and a chart built only from the votes table cannot see who is missing.
 *  - **Access is read from history, not from today.** A month's eligible set is the
 *    admins issued a grant for that month (plus anyone who voted in it). Months before
 *    the grant ledger existed have `eligible: null` — who had access then was never
 *    recorded, and today's admin list would be a guess dressed up as a figure.
 *  - **The current month is kept and flagged**, like the roadmap-delivery chart beside
 *    it: "who has voted so far this month" is the reading that lets someone nudge the
 *    rest before the month closes.
 */
@Injectable()
export class RoadmapVotingAnalyticsService {
  constructor(private readonly repository: RoadmapVotingAnalyticsRepository) {}

  async getRoadmapVoting(now = new Date()): Promise<RoadmapVotingResponseDto> {
    const [cast, granted, eligibleNow] = await Promise.all([
      this.repository.getVotesCast(),
      this.repository.getVotesGranted(),
      this.repository.getEligibleUserIds(),
    ]);

    const currentMonth = isoDate(startOfUtcMonth(now));
    const votesBy = new Map<string, Map<number, number>>();
    for (const row of cast) {
      if (row.votes <= 0) continue;
      const month = periodToMonth(row.periodKey);
      const users = votesBy.get(month) ?? new Map<number, number>();
      users.set(row.userId, (users.get(row.userId) ?? 0) + row.votes);
      votesBy.set(month, users);
    }
    const grantedBy = new Map<string, Map<number, number>>();
    for (const row of granted) {
      const month = periodToMonth(row.periodKey);
      const users = grantedBy.get(month) ?? new Map<number, number>();
      users.set(row.userId, (users.get(row.userId) ?? 0) + row.granted);
      grantedBy.set(month, users);
    }

    const ledgerMonths = [...grantedBy.keys()].sort();
    const accessRecordedFrom = ledgerMonths[0] ?? null;
    const axis = monthAxis(
      [...votesBy.keys(), ...grantedBy.keys()],
      currentMonth,
    );
    const eligibleNowSet = new Set(eligibleNow);

    const months: RoadmapVotingMonthDto[] = axis.map((month) => {
      const votes = votesBy.get(month) ?? new Map<number, number>();
      const grants = grantedBy.get(month);
      const recorded =
        accessRecordedFrom !== null && month >= accessRecordedFrom;

      const userIds = new Set<number>(votes.keys());
      if (recorded) {
        for (const id of grants?.keys() ?? []) userIds.add(id);
        if (month === currentMonth) {
          for (const id of eligibleNowSet) userIds.add(id);
        }
      }

      const users: RoadmapVotingUserMonthDto[] = [...userIds]
        .sort((a, b) => a - b)
        .map((userId) => ({
          userId,
          votes: votes.get(userId) ?? 0,
          granted: recorded ? (grants?.get(userId) ?? 0) : null,
        }));

      return {
        month,
        partial: month === currentMonth,
        votes: sum(users.map((u) => u.votes)),
        voters: users.filter((u) => u.votes > 0).length,
        eligible: recorded ? users.length : null,
        granted: recorded ? sum(users.map((u) => u.granted ?? 0)) : null,
        users,
      };
    });

    const users = await this.buildUsers(months, eligibleNowSet);
    return {
      months,
      users,
      accessRecordedFrom,
      computedAt: now.toISOString(),
    };
  }

  private async buildUsers(
    months: RoadmapVotingMonthDto[],
    eligibleNow: Set<number>,
  ): Promise<RoadmapVoterDto[]> {
    const stats = new Map<
      number,
      { votes: number; monthsVoted: number; lastVotedMonth: string | null }
    >();
    for (const id of eligibleNow) {
      stats.set(id, { votes: 0, monthsVoted: 0, lastVotedMonth: null });
    }
    for (const month of months) {
      for (const u of month.users) {
        const s = stats.get(u.userId) ?? {
          votes: 0,
          monthsVoted: 0,
          lastVotedMonth: null,
        };
        if (u.votes > 0) {
          s.votes += u.votes;
          s.monthsVoted += 1;
          s.lastVotedMonth = month.month;
        }
        stats.set(u.userId, s);
      }
    }

    const names = new Map(
      (await this.repository.getUserNames([...stats.keys()])).map((r) => [
        r.userId,
        r.name,
      ]),
    );
    const nameCounts = new Map<string, number>();
    for (const id of stats.keys()) {
      const n = names.get(id);
      if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    }
    const displayName = (id: number): string => {
      const n = names.get(id);
      if (!n) return `Admin #${id}`;
      // Two accounts with one name would otherwise merge into one legend entry
      // and one colour while being two people.
      return (nameCounts.get(n) ?? 0) > 1 ? `${n} (#${id})` : n;
    };

    return [...stats.entries()]
      .map(([userId, s]) => ({
        userId,
        name: displayName(userId),
        votes: s.votes,
        monthsVoted: s.monthsVoted,
        lastVotedMonth: s.lastVotedMonth,
        hasAccessNow: eligibleNow.has(userId),
      }))
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  }
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** 'YYYY-MM' → 'YYYY-MM-01'. */
function periodToMonth(periodKey: string): string {
  return `${periodKey}-01`;
}

/**
 * Contiguous `yyyy-mm-01` keys from the earliest month seen through the later of the
 * current month and the latest month seen. Empty when nothing has happened at all, so
 * the client shows an empty state instead of a one-month axis of zeros.
 */
function monthAxis(seen: string[], currentMonth: string): string[] {
  if (seen.length === 0) return [];
  const sorted = [...seen].sort();
  const first = new Date(`${sorted[0]}T00:00:00.000Z`);
  const lastSeen = sorted[sorted.length - 1];
  const last = new Date(
    `${lastSeen > currentMonth ? lastSeen : currentMonth}T00:00:00.000Z`,
  );
  const months: string[] = [];
  for (let cur = first; cur <= last; cur = addMonths(cur, 1)) {
    months.push(isoDate(cur));
  }
  return months;
}
