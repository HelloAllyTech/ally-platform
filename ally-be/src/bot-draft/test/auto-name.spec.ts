import {
  AUTO_NAME_PATTERN,
  autoNameDay,
  autoNameStem,
  nextAutoName,
} from '../blank/auto-name';

describe('auto name', () => {
  const day = new Date('2025-11-25T09:00:00Z');

  it('writes the day as DDMMYY', () => {
    expect(autoNameDay(day)).toBe('251125');
    expect(autoNameDay(new Date('2026-01-03T00:00:00Z'))).toBe('030126');
    expect(autoNameStem(day)).toBe('Your new Ally Chatbot 251125');
  });

  it('starts at 1 and counts up through the day', () => {
    expect(nextAutoName(day, [])).toBe('Your new Ally Chatbot 2511251');
    expect(nextAutoName(day, ['Your new Ally Chatbot 2511251'])).toBe(
      'Your new Ally Chatbot 2511252',
    );
    expect(
      nextAutoName(day, [
        'Your new Ally Chatbot 2511251',
        'Your new Ally Chatbot 2511253',
      ]),
    ).toBe('Your new Ally Chatbot 2511254');
  });

  it('ignores other days, other words and real names', () => {
    expect(
      nextAutoName(day, [
        'Your new Ally Chatbot 2411259',
        'Your new Ally Chatbot 251125 for schools',
        'Saathi',
      ]),
    ).toBe('Your new Ally Chatbot 2511251');
  });

  it('matches every auto name, and only those', () => {
    expect(AUTO_NAME_PATTERN.test('Your new Ally Chatbot 2511251')).toBe(true);
    expect(AUTO_NAME_PATTERN.test('Your new Ally Chatbot 25112510')).toBe(true);
    expect(AUTO_NAME_PATTERN.test('Your new Ally Chatbot 251125')).toBe(false);
    expect(AUTO_NAME_PATTERN.test('Your new Ally Chatbot')).toBe(false);
  });
});
