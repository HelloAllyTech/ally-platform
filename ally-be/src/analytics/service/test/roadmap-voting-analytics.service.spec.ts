import { Test } from '@nestjs/testing';
import { RoadmapVotingAnalyticsService } from '../roadmap-voting-analytics.service';
import {
  RoadmapVoterRow,
  RoadmapVotesCastRow,
  RoadmapVotesGrantedRow,
  RoadmapVotingAnalyticsRepository,
} from '../../repository/roadmap-voting-analytics.repository';

const NOW = new Date('2026-11-03T10:00:00.000Z');

const cast = (
  userId: number,
  periodKey: string,
  votes: number,
): RoadmapVotesCastRow => ({ userId, periodKey, votes });
const grant = (
  userId: number,
  periodKey: string,
  granted: number,
): RoadmapVotesGrantedRow => ({ userId, periodKey, granted });

describe('RoadmapVotingAnalyticsService', () => {
  const build = async (
    votes: RoadmapVotesCastRow[],
    grants: RoadmapVotesGrantedRow[] = [],
    eligibleNow: number[] = [],
    names: RoadmapVoterRow[] = [],
    ownVotes: RoadmapVotesCastRow[] = [],
  ) => {
    const module = await Test.createTestingModule({
      providers: [
        RoadmapVotingAnalyticsService,
        {
          provide: RoadmapVotingAnalyticsRepository,
          useValue: {
            getVotesCast: jest.fn().mockResolvedValue(votes),
            getOwnVotesCast: jest.fn().mockResolvedValue(ownVotes),
            getVotesGranted: jest.fn().mockResolvedValue(grants),
            getEligibleUserIds: jest.fn().mockResolvedValue(eligibleNow),
            getUserNames: jest
              .fn()
              .mockImplementation((ids: number[]) =>
                Promise.resolve(names.filter((n) => ids.includes(n.userId))),
              ),
          },
        },
      ],
    }).compile();
    return module.get(RoadmapVotingAnalyticsService).getRoadmapVoting(NOW);
  };

  it('returns an empty axis when nothing has happened', async () => {
    const result = await build([], [], [1, 2]);
    expect(result.months).toEqual([]);
    expect(result.accessRecordedFrom).toBeNull();
    // Current admins still listed, so the client can name who has not voted.
    expect(result.users.map((u) => u.userId).sort()).toEqual([1, 2]);
  });

  it('builds a gapless axis through the current month and flags it partial', async () => {
    const result = await build([cast(1, '2026-08', 5)]);
    expect(result.months.map((m) => m.month)).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ]);
    expect(result.months.map((m) => m.partial)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(result.months[1].votes).toBe(0);
  });

  it('counts non-voters who were issued votes as eligible', async () => {
    const result = await build(
      [cast(1, '2026-10', 7)],
      [grant(1, '2026-10', 200), grant(2, '2026-10', 200)],
    );
    const oct = result.months.find((m) => m.month === '2026-10-01')!;
    expect(oct.voters).toBe(1);
    expect(oct.eligible).toBe(2);
    expect(oct.granted).toBe(400);
    expect(oct.users).toEqual([
      { userId: 1, votes: 7, votesOnOthers: 7, granted: 200 },
      { userId: 2, votes: 0, votesOnOthers: 0, granted: 200 },
    ]);
  });

  it('leaves eligibility null before the grant ledger, never guessing from today', async () => {
    const result = await build(
      [cast(1, '2026-08', 3), cast(1, '2026-10', 4)],
      [grant(1, '2026-10', 50)],
      [1, 2, 3],
    );
    const aug = result.months[0];
    expect(aug.eligible).toBeNull();
    expect(aug.granted).toBeNull();
    expect(aug.users).toEqual([
      { userId: 1, votes: 3, votesOnOthers: 3, granted: null },
    ]);
    expect(result.accessRecordedFrom).toBe('2026-10-01');
  });

  it('adds current permission holders to the current month only', async () => {
    const result = await build(
      [cast(1, '2026-10', 4)],
      [grant(1, '2026-10', 50)],
      [1, 9],
    );
    const oct = result.months.find((m) => m.month === '2026-10-01')!;
    const nov = result.months.find((m) => m.month === '2026-11-01')!;
    expect(oct.users.map((u) => u.userId)).toEqual([1]);
    expect(nov.users.map((u) => u.userId)).toEqual([1, 9]);
    expect(nov.eligible).toBe(2);
    expect(nov.voters).toBe(0);
  });

  it('counts a voter as eligible even without a grant that month', async () => {
    const result = await build(
      [cast(5, '2026-10', 2)],
      [grant(1, '2026-10', 50)],
    );
    const oct = result.months.find((m) => m.month === '2026-10-01')!;
    expect(oct.eligible).toBe(2);
    expect(oct.voters).toBe(1);
  });

  it('ranks users by all-time votes and disambiguates shared or blank names', async () => {
    const result = await build(
      [cast(1, '2026-10', 2), cast(2, '2026-10', 9), cast(2, '2026-11', 1)],
      [],
      [1, 2, 3, 4],
      [
        { userId: 1, name: 'Asha' },
        { userId: 2, name: 'Asha' },
        { userId: 3, name: null },
        { userId: 4, name: 'Bea' },
      ],
    );
    expect(result.users).toEqual([
      {
        userId: 2,
        name: 'Asha (#2)',
        votes: 10,
        monthsVoted: 2,
        lastVotedMonth: '2026-11-01',
        hasAccessNow: true,
      },
      {
        userId: 1,
        name: 'Asha (#1)',
        votes: 2,
        monthsVoted: 1,
        lastVotedMonth: '2026-10-01',
        hasAccessNow: true,
      },
      {
        userId: 3,
        name: 'Admin #3',
        votes: 0,
        monthsVoted: 0,
        lastVotedMonth: null,
        hasAccessNow: true,
      },
      {
        userId: 4,
        name: 'Bea',
        votes: 0,
        monthsVoted: 0,
        lastVotedMonth: null,
        hasAccessNow: true,
      },
    ]);
  });

  it('keeps every month total equal to the sum of its users', async () => {
    const result = await build(
      [cast(1, '2026-09', 3), cast(2, '2026-09', 4), cast(1, '2026-11', 6)],
      [grant(1, '2026-09', 10), grant(2, '2026-09', 10)],
    );
    for (const m of result.months) {
      expect(m.votes).toBe(m.users.reduce((s, u) => s + u.votes, 0));
    }
    expect(result.users.reduce((s, u) => s + u.votes, 0)).toBe(13);
  });

  it("splits each voter's votes into those on colleagues' ideas", async () => {
    const result = await build(
      [cast(1, '2026-11', 10), cast(2, '2026-11', 4)],
      [],
      [],
      [],
      [cast(1, '2026-11', 3)],
    );
    const users = result.months[0].users;
    expect(users.find((u) => u.userId === 1)?.votesOnOthers).toBe(7);
    expect(users.find((u) => u.userId === 2)?.votesOnOthers).toBe(4);
  });
});
