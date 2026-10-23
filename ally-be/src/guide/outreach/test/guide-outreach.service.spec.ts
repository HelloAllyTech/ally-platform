import {
  outreachPassesLint,
  outreachTemplate,
} from '../../prompts/outreach.prompt';
import { GuideOutreachService, localHour } from '../guide-outreach.service';

const facts = {
  kind: 'idle' as const,
  courseTitle: 'New Counselor Foundations',
  languageCode: 'en',
  completed: 3,
  total: 6,
  lastCompletedTitle: 'Session Reflection Journal',
  nextTitle: 'Case Walkthrough',
  nextMinutes: 25,
};

describe('outreach text', () => {
  it('passes plain, specific copy and fails loss, guilt, neediness and exclamation', () => {
    expect(
      outreachPassesLint({
        title: 'Case Walkthrough is next',
        body: 'You finished the reflection journal. The case walkthrough takes about 25 minutes when you are ready.',
      }),
    ).toBe(true);
    for (const body of [
      "Don't lose your progress.",
      'You missed your session.',
      'You are falling behind.',
      "We're waiting for you.",
      'Last chance to finish.',
      'Keep your streak going.',
      'Great work!',
      'Only 2 days left.',
    ]) {
      expect(outreachPassesLint({ title: 'Ally', body })).toBe(false);
    }
  });

  it('the fallback template names progress and one small next step, and passes its own lint', () => {
    const idle = outreachTemplate(facts);
    expect(idle.body).toContain("You've finished 3 of 6");
    expect(idle.body).toContain('Case Walkthrough · about 25 min');
    expect(outreachPassesLint(idle)).toBe(true);
    const appointment = outreachTemplate({ ...facts, kind: 'appointment' });
    expect(appointment.body).toContain('You picked now');
    expect(outreachPassesLint(appointment)).toBe(true);
  });

  it('reads the hour in the learner’s own timezone', () => {
    const at = new Date('2026-10-24T05:30:00Z');
    expect(localHour(at, 'Asia/Kolkata')).toBe(11);
    expect(localHour(at, 'Europe/London')).toBe(6);
    expect(localHour(at, 'Not/AZone')).toBe(11); // falls back to the default
  });
});

describe('GuideOutreachService.eligibility', () => {
  function setup(o: {
    mode?: string;
    lastCrisisDaysAgo?: number | null;
    care?: boolean;
    outreach?: 'off' | 'in_app' | 'in_app_email';
    org?: { outreachEnabled?: boolean; emailEnabled?: boolean };
    user?: { email: string | null; lastActiveAt: Date | null; status?: string };
    lastWeek?: number;
    thisCourse?: number;
    engagement?: number;
  }) {
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM "users"')) {
          return [
            {
              status: 'ACTIVE',
              ...(o.user ?? { email: 'a@b.c', lastActiveAt: new Date() }),
            },
          ];
        }
        if (sql.includes('"flags"')) return [{ hit: o.care ?? false }];
        if (sql.includes('FROM "guide_outreach"')) {
          return [
            {
              lastWeek: o.lastWeek ?? 0,
              thisCourse: o.thisCourse ?? 0,
              engagement: o.engagement ?? 0,
            },
          ];
        }
        return [];
      }),
    };
    const config = {
      jwt: { accessToken: { secret: 'secret' } },
      publicApiBaseUrl: 'https://api.example',
    };
    const service = new GuideOutreachService(
      {} as never,
      {} as never,
      {} as never,
      {
        findOne: jest.fn(async () =>
          o.outreach ? { prefs: { outreach: o.outreach } } : null,
        ),
        save: jest.fn(async (row: any) => row),
      } as never,
      {
        findOne: jest.fn(async () => (o.org ? { profile: o.org } : null)),
      } as never,
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {
        lastCrisisAt: jest.fn(async () =>
          o.lastCrisisDaysAgo == null
            ? null
            : new Date(Date.now() - o.lastCrisisDaysAgo * 86_400_000),
        ),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      config as never,
    );
    const thread: any = {
      id: 'th1',
      userId: 3,
      tenantId: 'org',
      trackId: 'tr1',
      status: 'active',
      mode: o.mode ?? 'NORMAL',
      completedAt: null,
    };
    return { service, thread };
  }

  it('sends in-app only by default, and email only when chosen, allowed and signed in with', async () => {
    const plain = setup({});
    expect(await plain.service.eligibility(plain.thread, 'idle')).toMatchObject(
      {
        ok: true,
        channels: { inApp: true, email: false },
      },
    );
    const email = setup({ outreach: 'in_app_email' });
    expect(await email.service.eligibility(email.thread, 'idle')).toMatchObject(
      {
        ok: true,
        email: 'a@b.c',
      },
    );
    const neverSignedIn = setup({
      outreach: 'in_app_email',
      user: { email: 'a@b.c', lastActiveAt: null },
    });
    expect(
      await neverSignedIn.service.eligibility(neverSignedIn.thread, 'idle'),
    ).toMatchObject({ ok: true, email: null });
    const orgNoEmail = setup({
      outreach: 'in_app_email',
      org: { emailEnabled: false },
    });
    expect(
      await orgNoEmail.service.eligibility(orgNoEmail.thread, 'idle'),
    ).toMatchObject({ ok: true, email: null });
  });

  it.each([
    [{ lastCrisisDaysAgo: 10 }, 'crisis_recent'],
    [{ mode: 'CRISIS_FOLLOWUP' }, 'crisis_recent'],
    [{ care: true }, 'care_recent'],
    [{ mode: 'CARE' }, 'care_recent'],
    [{ outreach: 'off' as const }, 'opted_out'],
    [{ org: { outreachEnabled: false } }, 'org_off'],
    [{ lastWeek: 1 }, 'weekly_limit'],
    [{ thisCourse: 3 }, 'course_limit'],
    [{ engagement: 1 }, 'engagement_reminder_recent'],
  ])('holds back when %o', async (options, reason) => {
    const t = setup(options);
    expect(await t.service.eligibility(t.thread, 'idle')).toEqual({
      ok: false,
      reason,
    });
  });

  it('an appointment ignores the idle frequency limits, not the safety ones', async () => {
    const limited = setup({ lastWeek: 1, thisCourse: 3 });
    expect(
      (await limited.service.eligibility(limited.thread, 'appointment')).ok,
    ).toBe(true);
    const crisis = setup({ lastCrisisDaysAgo: 2 });
    expect(
      (await crisis.service.eligibility(crisis.thread, 'appointment')).ok,
    ).toBe(false);
  });

  it('a finished course or a visitor never gets one', async () => {
    const done = setup({});
    expect(
      await done.service.eligibility(
        { ...done.thread, completedAt: new Date() },
        'appointment',
      ),
    ).toEqual({ ok: false, reason: 'course_finished' });
    expect(
      await done.service.eligibility(
        { ...done.thread, userId: null, tenantId: null },
        'idle',
      ),
    ).toEqual({ ok: false, reason: 'visitor' });
  });

  it('the unsubscribe link works once signed and never when tampered with', async () => {
    const t = setup({});
    const link = new URL(t.service.unsubscribeLink(3, 'org'));
    const u = link.searchParams.get('u')!;
    const s = link.searchParams.get('s')!;
    expect(await t.service.unsubscribe({ u, t: 'org', s })).toBe(true);
    expect(await t.service.unsubscribe({ u: '4', t: 'org', s })).toBe(false);
    expect(await t.service.unsubscribe({ u, t: 'other', s })).toBe(false);
  });
});
