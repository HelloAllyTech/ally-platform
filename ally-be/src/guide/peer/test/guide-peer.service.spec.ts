import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { GUIDE_DEFAULT_PEER_POLICY } from '../../release/guide-release.bundle';
import {
  GuidePeerService,
  adviceProblem,
  peerPhrases,
} from '../guide-peer.service';

const policy = GUIDE_DEFAULT_PEER_POLICY;

describe('peerPhrases (plan §4.9, Appendix A "Peer")', () => {
  it('says nothing about a group under the minimum of 5', () => {
    expect(
      peerPhrases(
        {
          trackItemId: 'i',
          learners: 4,
          paused: 4,
          retried: 4,
          medianMinutes: 12,
        },
        policy.minGroupSize,
      ),
    ).toEqual([]);
  });

  it('turns a group of 5 or more into words, never counts', () => {
    const phrases = peerPhrases(
      {
        trackItemId: 'i',
        learners: 10,
        paused: 4,
        retried: 3,
        medianMinutes: 12.4,
      },
      policy.minGroupSize,
    );
    expect(phrases).toEqual([
      'Learners often pause around here and come back to it later.',
      'Many learners take more than one go at this.',
      'Learners usually spend about 10 minutes on this.',
    ]);
    expect(phrases.join(' ')).not.toMatch(/\b(10|4|3) (learners|of)\b/);
  });

  it('leaves out what is not common, and times that are not one sitting', () => {
    expect(
      peerPhrases(
        {
          trackItemId: 'i',
          learners: 10,
          paused: 1,
          retried: 0,
          medianMinutes: 900,
        },
        policy.minGroupSize,
      ),
    ).toEqual([]);
  });
});

describe('adviceProblem', () => {
  it('holds a line to 200 characters and keeps contact details out', () => {
    expect(adviceProblem('  ', 200)).toBe('empty');
    expect(adviceProblem('a'.repeat(201), 200)).toBe('too_long');
    expect(adviceProblem('a'.repeat(200), 200)).toBeNull();
    expect(adviceProblem('Mail me at x@y.org', 200)).toBe('contact_details');
    expect(adviceProblem('Call 98765 43210 anytime', 200)).toBe(
      'contact_details',
    );
    expect(adviceProblem('See https://example.org', 200)).toBe(
      'contact_details',
    );
    expect(adviceProblem('Breathe before you pick up.', 200)).toBeNull();
  });
});

describe('GuidePeerService', () => {
  function setup(opts: {
    finished?: boolean;
    finishers?: number;
    existing?: any;
  }) {
    const saved: any[] = [];
    const repo = {
      findOne: jest.fn(async () => opts.existing ?? null),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => {
        const out = {
          id: row.id ?? 'a1',
          createdAt: row.createdAt ?? new Date('2026-10-24T00:00:00Z'),
          ...row,
        };
        saved.push(out);
        return out;
      }),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        for (const m of ['select', 'where', 'andWhere', 'orderBy', 'limit']) {
          qb[m] = jest.fn(() => qb);
        }
        qb.getMany = jest.fn(async () => [{ text: 'Breathe first.' }]);
        return qb;
      }),
    };
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('COUNT(DISTINCT "userId")')) {
          return [{ n: opts.finishers ?? 0 }];
        }
        if (sql.includes('SELECT 1 FROM "track_enrollments"')) {
          return opts.finished ? [{}] : [];
        }
        return [];
      }),
    };
    const service = new GuidePeerService(repo as never, dataSource as never);
    return { service, repo, saved };
  }

  const submit = (service: GuidePeerService, text = 'Breathe first.') =>
    service.submit({
      userId: 3,
      tenantId: 'org',
      trackId: 'tr',
      text,
      policy,
    });

  it('takes advice only from a learner who finished the course', async () => {
    const t = setup({ finished: false });
    await expect(submit(t.service)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores a new line as pending, flagging risk words for the moderator', async () => {
    const t = setup({ finished: true });
    const view = await submit(
      t.service,
      'Some days I want to kill myself, and this helped.',
    );
    expect(view.status).toBe('pending');
    expect(t.saved[0].flags).toEqual(['risk_words']);
    const plain = setup({ finished: true });
    await submit(plain.service);
    expect(plain.saved[0].flags).toEqual([]);
  });

  it('allows one line per course: rewritable while pending, not after review', async () => {
    const pending = setup({
      finished: true,
      existing: {
        id: 'a1',
        status: 'pending',
        text: 'old',
        createdAt: new Date(),
      },
    });
    const view = await submit(pending.service, 'New words.');
    expect(view).toMatchObject({ id: 'a1', text: 'New words.' });
    expect(pending.repo.create).not.toHaveBeenCalled();

    const reviewed = setup({
      finished: true,
      existing: {
        id: 'a1',
        status: 'approved',
        text: 'old',
        createdAt: new Date(),
      },
    });
    await expect(submit(reviewed.service)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses contact details before anything is stored', async () => {
    const t = setup({ finished: true });
    await expect(
      submit(t.service, 'Write to me: a@b.co'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.repo.save).not.toHaveBeenCalled();
  });

  it('shows advice only once 10 have finished in the organisation', async () => {
    const few = setup({ finishers: 9 });
    expect(
      await few.service.visibleAdvice({
        trackId: 'tr',
        tenantId: 'org',
        policy,
      }),
    ).toEqual([]);
    expect(few.repo.createQueryBuilder).not.toHaveBeenCalled();

    const enough = setup({ finishers: 10 });
    expect(
      await enough.service.visibleAdvice({
        trackId: 'tr',
        tenantId: 'org',
        policy,
      }),
    ).toEqual(['Breathe first.']);
  });

  it('records who moderated, and why a line was rejected', async () => {
    const t = setup({
      existing: {
        id: 'a1',
        status: 'pending',
        text: 'x',
        createdAt: new Date(),
      },
    });
    const view = await t.service.moderate({
      id: 'a1',
      decision: 'reject',
      reason: 'Names a client',
      moderatorId: 9,
    });
    expect(view.status).toBe('rejected');
    expect(t.saved[0]).toMatchObject({
      moderatedBy: 9,
      rejectReason: 'Names a client',
    });
  });
});
