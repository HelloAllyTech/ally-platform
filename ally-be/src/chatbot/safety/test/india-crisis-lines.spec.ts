import { emergencyReply } from '../../../bot-draft/safety-pack/safety-packs';
import { isIndiaAssistant } from '../../agent-tools/list-tools';
import {
  INDIA_CRISIS_LINES,
  blockedNotice,
  fixedCrisisInformation,
} from '../../engine/blocked-notice';
import { holdingMessage, noOneAvailableMessage } from '../crisis-copy';

const LINK = 'https://findahelpline.com';

describe('which assistants are in India', () => {
  it('goes by the time zone, and no zone set is India', () => {
    expect(isIndiaAssistant({ timeZone: 'Asia/Kolkata' })).toBe(true);
    expect(isIndiaAssistant({ timeZone: 'Asia/Calcutta' })).toBe(true);
    expect(isIndiaAssistant({})).toBe(true);
    expect(isIndiaAssistant(null)).toBe(true);
    expect(
      isIndiaAssistant({ handover: { hours: { timeZone: 'Asia/Kolkata' } } }),
    ).toBe(true);
    expect(isIndiaAssistant({ timeZone: 'Europe/London' })).toBe(false);
    expect(
      isIndiaAssistant({ handover: { hours: { timeZone: 'Asia/Dubai' } } }),
    ).toBe(false);
  });
});

describe('the crisis information in India', () => {
  it('is the national lines, then the builder’s numbers, then the link, in all three languages', () => {
    for (const language of ['en', 'hi', 'hi-latn'] as const) {
      const text = fixedCrisisInformation('9152987821', language, true);
      expect(text.startsWith(INDIA_CRISIS_LINES[language])).toBe(true);
      expect(text.indexOf('9152987821')).toBeGreaterThan(text.indexOf('14416'));
      expect(text.indexOf(LINK)).toBeGreaterThan(text.indexOf('9152987821'));
      expect(text).toMatch(/\b112\b/);
    }
  });

  it('drops a builder number that repeats 112 or 14416', () => {
    expect(fixedCrisisInformation('Tele-MANAS 14416', 'en', true)).toBe(
      `${INDIA_CRISIS_LINES.en} Or find a helpline near you at ${LINK}`,
    );
  });

  it('is unchanged outside India (R6)', () => {
    expect(fixedCrisisInformation(null, 'en')).toBe(
      `If you need support now, you can find a helpline near you at ${LINK}`,
    );
    expect(fixedCrisisInformation('9152987821', 'en', false)).toBe(
      `If you need support now, call 9152987821, or find a helpline near you at ${LINK}`,
    );
  });
});

describe('every fixed crisis surface in India carries 112 and 14416', () => {
  it('the emergency reply says call 112', () => {
    expect(emergencyReply({ language: 'en', india: true })).toBe(
      'This sounds like an emergency. Please go to the nearest emergency department now, or call 112.',
    );
    expect(emergencyReply({ language: 'hi', india: true })).toContain(
      '112 पर कॉल करें',
    );
    expect(emergencyReply({ language: 'hi-latn', india: true })).toContain(
      '112 par call karein',
    );
    expect(emergencyReply({ language: 'en' })).toContain(
      'call your local emergency number',
    );
    const selfHarm = emergencyReply({
      language: 'en',
      india: true,
      selfHarm: true,
    });
    expect(selfHarm).toContain('14416');
  });

  it('the blocked notices, holding message and no-one-available message', () => {
    for (const text of [
      blockedNotice('OUT_OF_CREDITS', { language: 'en', india: true }),
      blockedNotice('REMOVED_FROM_LIST', { language: 'hi', india: true }),
      holdingMessage('hi-latn', null, true),
      noOneAvailableMessage('en', '9152987821', true),
    ]) {
      expect(text).toMatch(/\b112\b/);
      expect(text).toContain('14416');
      expect(text).toContain(LINK);
    }
    expect(holdingMessage('en', null)).not.toMatch(/112|14416/);
  });
});
