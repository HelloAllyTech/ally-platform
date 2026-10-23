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
