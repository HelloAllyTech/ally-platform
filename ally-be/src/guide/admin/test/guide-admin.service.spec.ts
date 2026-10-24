import { BadRequestException } from '@nestjs/common';
import {
  HIDDEN_FOR_PRIVACY,
  redactText,
  reviewableText,
} from '../../safety/redaction';
import { GuideAdminService, normaliseOrgProfile } from '../guide-admin.service';

describe('redaction', () => {
  it('masks contact details and long numbers', () => {
    expect(
      redactText(
        'Call her on +91 98450 12345 or mail priya@example.org, see https://x.io/a?b=1',
      ),
    ).toBe('Call her on [number] or mail [email], see [link]');
  });

  it('keeps short numbers that are not contact details', () => {
    expect(redactText('Question 3 had 4 options')).toBe(
      'Question 3 had 4 options',
    );
  });

  it('hides a message flagged as identifying a real person', () => {
    expect(
      reviewableText({
        content: 'My client Priya Sharma…',
        flags: { pii: true },
      }),
    ).toBe(HIDDEN_FOR_PRIVACY);
    expect(
      reviewableText({ content: 'raw', redactedContent: 'model-redacted' }),
    ).toBe('model-redacted');
  });
});

describe('normaliseOrgProfile', () => {
  it('keeps known fields, trimmed and bounded', () => {
    expect(
      normaliseOrgProfile({
        supportLines: {
          hi: [
            {
              name: ' Tele-MANAS ',
              phone: '14416',
              isCrisis: true,
              extra: 'x',
            },
          ],
        },
        supervisorWording: '  your shift lead ',
        avoidTopics: ['  ', 'politics'],
        unknown: 'dropped',
      }),
    ).toEqual({
      supportLines: {
        hi: [
          {
            name: 'Tele-MANAS',
            phone: '14416',
            hours: null,
            url: null,
            isCrisis: true,
          },
        ],
      },
      supervisorContact: null,
      supervisorWording: 'your shift lead',
      protocols: null,
      toneNotes: null,
      avoidTopics: ['politics'],
      outreachEnabled: true,
      emailEnabled: true,
    });
  });

  it.each([
    [{ supportLines: { fr: [] } }, /language/],
    [{ supportLines: { en: [{ name: 'X' }] } }, /name and a phone/],
    [
      { supportLines: { en: [{ name: 'X', phone: 'call us' }] } },
      /not a phone/,
    ],
  ])('refuses %o', (input, message) => {
    expect(() => normaliseOrgProfile(input)).toThrow(message);
  });
});

describe('GuideAdminService.saveCrisisResponse', () => {
  const service = new GuideAdminService(
    { transaction: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('refuses an unknown language or copy that is too short', async () => {
    await expect(
      service.saveCrisisResponse({
        tenantId: null,
        languageCode: 'fr',
        body: 'x'.repeat(50),
        userId: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveCrisisResponse({
        tenantId: null,
        languageCode: 'en',
        body: 'Call us.',
        userId: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GuideAdminService crisis copy scope', () => {
  function service(rows: any[]) {
    const crisisResponses = {
      findOne: jest.fn(
        async ({ where }: any) =>
          rows.find(
            (row) =>
              row.id === where.id &&
              row.scope === where.scope &&
              (where.scope === 'platform'
                ? row.tenantId === null
                : row.tenantId === where.tenantId),
          ) ?? null,
      ),
      update: jest.fn(async () => undefined),
    };
    return {
      crisisResponses,
      service: new GuideAdminService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        crisisResponses as never,
      ),
    };
  }
  const rows = [
    { id: 'p1', scope: 'platform', tenantId: null },
    { id: 'o1', scope: 'tenant', tenantId: 'org-a' },
  ];

  it('the platform route never withdraws an organisation’s copy', async () => {
    const t = service(rows);
    await expect(t.service.removeCrisisResponse('o1', null)).rejects.toThrow(
      'not found',
    );
    await t.service.removeCrisisResponse('p1', null);
    expect(t.crisisResponses.update).toHaveBeenCalledWith('p1', {
      active: false,
    });
  });

  it('an organisation withdraws only its own copy', async () => {
    const t = service(rows);
    await expect(t.service.removeCrisisResponse('o1', 'org-b')).rejects.toThrow(
      'not found',
    );
    await expect(t.service.removeCrisisResponse('p1', 'org-a')).rejects.toThrow(
      'not found',
    );
    await t.service.removeCrisisResponse('o1', 'org-a');
    expect(t.crisisResponses.update).toHaveBeenCalledWith('o1', {
      active: false,
    });
  });
});

describe('GuideAdminService.listThreads', () => {
  it('pages by (updatedAt, id) so rows sharing a timestamp are never skipped', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return [];
      }),
    };
    const service = new GuideAdminService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.listThreads({
      before: '2026-10-23T10:00:00.000000|3f2c1e4a-0000-4000-8000-000000000000',
      status: 'active',
    });
    expect(calls[0].sql).toContain('(th."updatedAt", th."id") <');
    expect(calls[0].sql).toContain(
      'ORDER BY th."updatedAt" DESC, th."id" DESC',
    );
    expect(calls[0].params).toEqual([
      25,
      '2026-10-23T10:00:00.000000',
      '3f2c1e4a-0000-4000-8000-000000000000',
      'active',
    ]);
  });
});
