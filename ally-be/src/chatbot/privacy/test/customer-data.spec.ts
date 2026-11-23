import { eraseConfirmStep, isEraseRequest } from '../erase-intent';
import { eraseResultMessage } from '../erase-copy';
import { consentAnswerOf, consentWording } from '../memory-consent-copy';
import { scanForPii } from '../../../knowledge-base/privacy/pii-scan';
import { heuristicConflict } from '../../knowledge/answer-conflict.service';
import { noAnswerReply } from '../../knowledge/no-answer-reply';
import {
  enabledLanguagesOf,
  replyLanguageFor,
} from '../../languages/reply-language-for';
import { curatedLanguageOf } from '../../languages/safety-translations.service';
import { SafetyTranslationsService } from '../../languages/safety-translations.service';
import { helplineNumbersWithExtras } from '../../quick-replies/quick-reply-copy.service';
import { enabledLanguagesPatch } from '../../../bot-draft/service/bot-draft-publish.service';
import {
  AssistantRetentionService,
  RETENTION_STORES,
} from '../assistant-retention.service';
import { MemoryService } from '../../memory/memory.service';

describe('Assistants stage 5 (pure parts)', () => {
  describe('erase in chat: intent and two-step confirm', () => {
    it.each([
      ['Please delete my data', 'en'],
      ['can you erase all my messages', 'en'],
      ['forget me', 'en'],
      ['mera data delete kar do', 'hi-latn'],
      ['mujhe bhool jao', 'hi-latn'],
      ['मेरा डेटा मिटा दो', 'hi'],
      ['कृपया मेरी बातचीत हटा दें', 'hi'],
    ])('recognises %p', (text, language) => {
      expect(isEraseRequest(text, language)).toBe(true);
    });

    it.each([
      'how do I delete a booking?',
      'what is your data policy',
      'I forgot my password',
      'remove the appointment for tomorrow',
    ])('does not mistake %p for an erase request', (text) => {
      expect(isEraseRequest(text, 'en')).toBe(false);
    });

    it('asks first, erases on yes within ten minutes, cancels on no, and ignores a stale yes', () => {
      const t0 = new Date('2026-11-23T10:00:00Z');
      const ask = eraseConfirmStep(null, 'delete my data', 'en', t0);
      expect(ask.action).toBe('ask_confirm');
      const pending = ask.pending!;
      expect(
        eraseConfirmStep(pending, 'YES', 'en', new Date(t0.getTime() + 60_000))
          .action,
      ).toBe('erase');
      expect(
        eraseConfirmStep(
          pending,
          'haan',
          'hi-latn',
          new Date(t0.getTime() + 60_000),
        ).action,
      ).toBe('erase');
      expect(
        eraseConfirmStep(pending, 'no', 'en', new Date(t0.getTime() + 60_000))
          .action,
      ).toBe('cancelled');
      expect(
        eraseConfirmStep(
          pending,
          'yes',
          'en',
          new Date(t0.getTime() + 11 * 60_000),
        ).action,
      ).toBe('none');
      expect(eraseConfirmStep(null, 'yes', 'en', t0).action).toBe('none');
    });

    it('tells the customer what was erased and what was kept, with why', () => {
      const text = eraseResultMessage('en', {
        erased: ['conversations', 'memory', 'contact_details'],
        kept: [{ what: 'flagged_conversations' }, { what: 'sign_in' }],
      });
      expect(text).toContain(
        'your conversations, what I remembered about you and your name and contact details',
      );
      expect(text).toContain('12 months');
      expect(text).toContain('still sign in');
      expect(
        eraseResultMessage('hi', { erased: ['conversations'], kept: [] }),
      ).toContain('आपकी बातचीत');
    });
  });

  describe('memory consent wording', () => {
    it('uses the young-people wording when the audience age is unknown or includes minors', () => {
      expect(consentWording('unstated', 'en').version).toBe(
        'memory-consent-young-v1',
      );
      expect(consentWording(undefined, 'hi').version).toBe(
        'memory-consent-young-v1',
      );
      expect(consentWording('includes_minors', 'en').version).toBe(
        'memory-consent-young-v1',
      );
      expect(consentWording('adults', 'hi-latn').version).toBe(
        'memory-consent-adults-v1',
      );
    });

    it('reads a yes or no, and nothing else', () => {
      expect(consentAnswerOf('Yes!')).toBe('granted');
      expect(consentAnswerOf('हाँ')).toBe('granted');
      expect(consentAnswerOf('nahin')).toBe('declined');
      expect(consentAnswerOf('what do you remember?')).toBeNull();
    });

    it('memory lines are refused without consent; the name still saves', async () => {
      const query = jest.fn(async (sql: string) =>
        sql.includes('FROM chatbot_messages m') ? [{ 1: 1 }] : [],
      );
      const dataSource = {
        query,
        transaction: jest.fn(async (fn: (m: unknown) => unknown) =>
          fn({
            query: jest.fn(async (sql: string) =>
              sql.includes('FOR UPDATE')
                ? [{ id: 'c1', display_name: null }]
                : [],
            ),
          }),
        ),
      };
      const consent = { isGranted: jest.fn().mockResolvedValue(false) };
      const service = new MemoryService(
        dataSource as never,
        {} as never,
        {} as never,
        undefined,
        consent as never,
      );
      const out = await service.apply(
        {
          id: 'b1',
          settings: { memory: { on: true } },
          safetyPack: null,
        } as never,
        {
          contactId: 'c1',
          conversationId: 'v1',
          sourceMessageId: 'm1',
          runId: 'r1',
          writes: [
            { op: 'add', section: 'context', text: 'Has two children' },
            { op: 'name', text: 'Asha' },
          ] as never,
          refs: {},
        },
      );
      expect(consent.isGranted).toHaveBeenCalledWith('b1', 'c1');
      expect(out.refused).toBe(1);
      expect(out.added).toBe(0);
    });
  });

  describe('knowledge', () => {
    it('finds phones, emails and Aadhaar-like numbers, masks them, and skips public contacts', () => {
      const text =
        'Call our desk on +91 22 4000 1234 or info@clinic.org. Patient Ravi: 98765 43210, ravi.k@gmail.com, Aadhaar 2345 6789 0123.';
      const result = scanForPii(text, ['+91 22 4000 1234', 'info@clinic.org']);
      const kinds = Object.fromEntries(result.findings.map((f) => [f.kind, f]));
      expect(kinds.phone.count).toBe(1);
      expect(kinds.email.count).toBe(1);
      expect(kinds.id_number.count).toBe(1);
      expect(JSON.stringify(result)).not.toContain('ravi.k@gmail.com');
      expect(JSON.stringify(result)).not.toContain('9876543210');
      expect(scanForPii('Open 9am to 5pm, Monday to Friday.').total).toBe(0);
    });

    it('flags two documents that give different phone numbers or fees, not the same document', () => {
      expect(
        heuristicConflict([
          { documentId: 'a', text: 'Call 9876543210 for bookings.' },
          { documentId: 'b', text: 'Bookings: 9123456780.' },
        ]),
      ).toMatchObject({ conflict: true, reason: 'phone' });
      expect(
        heuristicConflict([
          { documentId: 'a', text: 'The fee is ₹500.' },
          { documentId: 'b', text: 'Consultation costs Rs 700.' },
        ]),
      ).toMatchObject({ conflict: true, reason: 'amount' });
      expect(
        heuristicConflict([
          { documentId: 'a', text: 'Call 9876543210.' },
          { documentId: 'a', text: 'Or 9123456780.' },
        ]).conflict,
      ).toBe(false);
      expect(
        heuristicConflict([
          { documentId: 'a', text: 'Fee ₹500, call 9876543210.' },
          { documentId: 'b', text: 'Fees are ₹500. Phone 98765 43210.' },
        ]).conflict,
      ).toBe(false);
    });

    it('composes the no-answer reply by mode, always ending with the crisis link', () => {
      const both = noAnswerReply('say_unknown_offer_person', 'en');
      expect(both).toMatch(/^I don't know/);
      expect(both).toContain('a person from the team');
      expect(both).toContain('https://findahelpline.com');
      expect(noAnswerReply('say_unknown', 'en')).not.toContain('person');
      expect(
        noAnswerReply('offer_person', 'hi', { helplineNumbers: '14416' }),
      ).toContain('14416');
      expect(
        noAnswerReply('offer_person', 'en', { personAvailable: false }),
      ).toContain('contact the organisation');
    });
  });

  describe('languages', () => {
    const bot = (settings: Record<string, unknown>, persona = {}) => ({
      settings,
      persona,
    });

    it('replies only in an enabled language, choosing the closest', () => {
      const b = bot({ enabledLanguages: ['en', 'hi'] });
      expect(replyLanguageFor(b, 'hi')).toBe('hi');
      expect(replyLanguageFor(b, 'hi-Latn')).toBe('hi');
      expect(replyLanguageFor(b, 'ta')).toBe('en');
      expect(replyLanguageFor(b, null)).toBe('en');
      expect(enabledLanguagesOf(bot({}, { defaultLanguage: 'mr' }))).toEqual([
        'mr',
      ]);
    });

    it('persists the draft languages as enabledLanguages at publish', () => {
      expect(enabledLanguagesPatch(['en', 'hi', 'en', 'not a tag'])).toEqual({
        enabledLanguages: ['en', 'hi'],
      });
      expect(enabledLanguagesPatch([])).toEqual({});
    });

    it('uses curated crisis text for en/hi/hi-latn, a reviewed translation otherwise, never an unreviewed one', async () => {
      expect(curatedLanguageOf('hi-Latn')).toBe('hi-latn');
      expect(curatedLanguageOf('ta')).toBeNull();
      const query = jest.fn().mockResolvedValue([]);
      const service = new SafetyTranslationsService({ query } as never);
      const hi = await service.crisisHelpFor('b1', 'hi', '14416');
      expect(hi.text).toContain('14416');
      expect(query).not.toHaveBeenCalled();
      // No reviewed Tamil text: English, not the unreviewed one.
      const ta = await service.crisisHelpFor('b1', 'ta');
      expect(ta.language).toBe('en');
      expect(query.mock.calls[0][0]).toContain('reviewed = true');
      query.mockResolvedValueOnce([{ text: 'உதவிக்கு: {numbers} {link}' }]);
      const reviewed = await service.crisisHelpFor('b1', 'ta', '14416');
      expect(reviewed).toMatchObject({ language: 'ta' });
      expect(reviewed.text).toContain('https://findahelpline.com');
    });
  });

  describe('quick replies and retention plumbing', () => {
    it('puts the regional numbers after the chatbot numbers', () => {
      expect(helplineNumbersWithExtras('14416', ['+91 22 1234'])).toBe(
        '14416, +91 22 1234',
      );
      expect(helplineNumbersWithExtras('', [])).toBe('');
    });

    it('covers every store that holds message content', () => {
      const steps = new AssistantRetentionService({} as never).steps();
      expect(steps.map((s) => s.store)).toEqual([...RETENTION_STORES]);
      // Every step except the orphan-aware ones keeps flagged conversations.
      for (const step of steps) {
        if (step.store === 'wa_contacts') continue;
        expect(step.from).toMatch(/retain_until/);
      }
    });
  });
});
