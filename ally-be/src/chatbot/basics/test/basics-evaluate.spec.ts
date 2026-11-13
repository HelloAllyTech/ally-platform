import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { PLATFORM_BASICS } from '../basics-cases';
import { failuresOf } from '../basics-evaluate';

const reply = (
  handledBy: WaHandledBy,
  body = 'Hello! How can I help?',
  extra: { turnType?: any; handover?: 'asked' } = {},
) => ({ handledBy, body, ...extra });

describe('conversation basics: failuresOf', () => {
  it('passes a reply that meets every expectation', () => {
    expect(
      failuresOf(
        reply(WaHandledBy.RAG, 'Hi there!', { turnType: 'smalltalk' }),
        {
          crisis: false,
          handover: false,
          turnType: ['smalltalk'],
        },
      ),
    ).toEqual([]);
  });

  it('fails a crisis reply where none is expected, and the reverse', () => {
    expect(failuresOf(reply(WaHandledBy.CRISIS), { crisis: false })).toEqual([
      'got the crisis reply',
    ]);
    expect(failuresOf(reply(WaHandledBy.RAG), { crisis: true })).toEqual([
      'expected the crisis reply',
    ]);
  });

  it('counts an automatic hand-over and an asked one as a hand-over', () => {
    expect(
      failuresOf(reply(WaHandledBy.HANDOVER), { handover: false }),
    ).toEqual(['handed over']);
    expect(
      failuresOf(reply(WaHandledBy.TEMPLATE, 'x', { handover: 'asked' }), {
        handover: true,
      }),
    ).toEqual([]);
  });

  it('skips the turn type when the agent gave none (v1)', () => {
    expect(
      failuresOf(reply(WaHandledBy.DECLINED), { turnType: ['smalltalk'] }),
    ).toEqual([]);
    expect(
      failuresOf(reply(WaHandledBy.DECLINED, 'x', { turnType: 'question' }), {
        turnType: ['smalltalk'],
      }),
    ).toEqual(['turn type question, expected smalltalk']);
  });

  it('never accepts talk about passages or unfilled placeholders', () => {
    expect(
      failuresOf(
        reply(WaHandledBy.DECLINED, "The provided passages don't say."),
      ),
    ).toEqual(['says /\\bpassages?\\b/']);
    expect(failuresOf(reply(WaHandledBy.DECLINED, 'Email {contact}.'))).toEqual(
      ['says /\\{[a-z_]+\\}/'],
    );
    expect(
      failuresOf(reply(WaHandledBy.DECLINED, 'Call [[ {helpline_numbers}]]')),
    ).toHaveLength(2);
  });

  it('checks must and mustNot patterns case-insensitively', () => {
    expect(
      failuresOf(reply(WaHandledBy.RAG, 'Book on our website.'), {
        must: ['book'],
        mustNot: ['supervisor'],
      }),
    ).toEqual([]);
    expect(
      failuresOf(reply(WaHandledBy.RAG, 'Ask your Supervisor.'), {
        mustNot: ['supervisor'],
      }),
    ).toEqual(['says /supervisor/']);
  });

  it('has unique case ids and a must-pass urgent case in each language', () => {
    const ids = PLATFORM_BASICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const urgent = PLATFORM_BASICS.filter((c) => c.kind === 'urgent');
    expect(urgent.every((c) => c.mustPass)).toBe(true);
    expect(urgent.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'urgent-english',
        'urgent-hindi',
        'urgent-hinglish',
      ]),
    );
  });
});
