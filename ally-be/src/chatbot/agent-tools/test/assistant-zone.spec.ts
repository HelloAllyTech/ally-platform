import { HOME_FIELDS } from '../../../bot-draft/home/home-fields';
import { assistantZone, isTimeZone, todayFor } from '../list-tools';

/** Chunk 6b, item 9: a time zone per assistant. */
describe('the assistant time zone', () => {
  it('is its own setting, else the hand-over hours, else Asia/Kolkata', () => {
    expect(assistantZone(null)).toBe('Asia/Kolkata');
    expect(
      assistantZone({ handover: { hours: { timeZone: 'Europe/London' } } }),
    ).toBe('Europe/London');
    expect(
      assistantZone({
        timeZone: 'Asia/Dubai',
        handover: { hours: { timeZone: 'Europe/London' } },
      }),
    ).toBe('Asia/Dubai');
    // An unknown zone never sticks.
    expect(assistantZone({ timeZone: 'Mars/Olympus' })).toBe('Asia/Kolkata');
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('nowhere')).toBe(false);
  });

  it("drives the agent's today", () => {
    const at = new Date('2026-11-14T06:28:00Z');
    expect(todayFor(at, assistantZone({ timeZone: 'Asia/Dubai' }))).toBe(
      'Saturday 14 Nov 2026, 10:28 (Asia/Dubai, UTC+04:00)',
    );
  });

  it('is a home field an owner can set, refused when it is not a real zone', () => {
    const field = HOME_FIELDS.timeZone;
    const state = { chatbot: { settings: {} } } as never;
    expect(field.read(state)).toBe('Asia/Kolkata');
    expect(field.parse(' Asia/Dubai ')).toBe('Asia/Dubai');
    expect(() => field.parse('Mars/Olympus')).toThrow(
      'Choose a time zone from the list.',
    );
    const written = field.write('Asia/Dubai', state) as {
      chatbot: { settings: { timeZone: string } };
    };
    expect(written.chatbot.settings.timeZone).toBe('Asia/Dubai');
  });
});
