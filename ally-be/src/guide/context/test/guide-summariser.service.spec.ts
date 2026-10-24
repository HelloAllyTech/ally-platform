import { GuideMessageKind, GuideMessageRole } from '../../enum/guide.enum';
import { renderSummary } from '../../prompts/summariser.prompt';
import { GUIDE_DEFAULT_BUNDLE } from '../../release/guide-release.bundle';
import {
  GuideSummariserService,
  LEFT_OUT_HARD_MOMENT,
  LEFT_OUT_REAL_CASE,
  summariserTranscript,
} from '../guide-summariser.service';

const row = (
  seq: number,
  role: GuideMessageRole,
  content: string,
  extra: Record<string, any> = {},
) => ({
  seq,
  role,
  kind: GuideMessageKind.CHAT,
  content,
  turnId: `turn-${Math.ceil(seq / 2)}`,
  flags: null,
  ...extra,
});

describe('summariserTranscript', () => {
  it('keeps what was said, in order, with platform notes as notes', () => {
    expect(
      summariserTranscript([
        row(2, GuideMessageRole.ALLY, 'Shall we start?'),
        row(1, GuideMessageRole.LEARNER, 'I want calmer openings'),
        row(
          3,
          GuideMessageRole.SYSTEM_NOTE,
          'The learner completed "Silence".',
          {
            turnId: 'turn-9',
          },
        ),
      ]),
    ).toEqual([
      { role: 'learner', text: 'I want calmer openings' },
      { role: 'ally', text: 'Shall we start?' },
      { role: 'note', text: 'The learner completed "Silence".' },
    ]);
  });

  it('replaces a real case whole, and drops Ally’s reply to it', () => {
    const lines = summariserTranscript([
      row(1, GuideMessageRole.LEARNER, 'My client Ravi from Pune…', {
        flags: { realCase: true },
      }),
      row(2, GuideMessageRole.ALLY, 'About Ravi: speak to your supervisor.'),
    ]);
    expect(lines).toEqual([{ role: 'learner', text: LEFT_OUT_REAL_CASE }]);
  });

  it('reduces a hard moment to a marker and leaves out the crisis copy', () => {
    const lines = summariserTranscript([
      row(1, GuideMessageRole.LEARNER, 'I feel hopeless', {
        flags: { crisis: true },
      }),
      row(2, GuideMessageRole.ALLY, 'Please reach out now', {
        kind: GuideMessageKind.CRISIS_FIXED,
      }),
    ]);
    expect(lines).toEqual([{ role: 'learner', text: LEFT_OUT_HARD_MOMENT }]);
  });

  it('drops the oldest lines first when the whole is too long', () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      row(i + 1, GuideMessageRole.LEARNER, `${i} ${'x'.repeat(700)}`),
    );
    const lines = summariserTranscript(rows);
    expect(lines.length).toBe(100);
    expect(lines[lines.length - 1].text.startsWith('119 ')).toBe(true);
  });
});

describe('renderSummary', () => {
  it('renders the four lists and leaves out empty ones', () => {
    expect(
      renderSummary({
        goals: ['Feel calmer on first calls'],
        where: ['Finished chapter 1', ' '],
        agreed: [],
        open: ['Ally offered to rehearse an opening line'],
      }),
    ).toBe(
      [
        'Their goals:',
        '- Feel calmer on first calls',
        'Where things stand:',
        '- Finished chapter 1',
        'Still open:',
        '- Ally offered to rehearse an opening line',
      ].join('\n'),
    );
    expect(renderSummary({ goals: [], where: [], agreed: [], open: [] })).toBe(
      null,
    );
  });
});

describe('GuideSummariserService', () => {
  const call = (outcome: 'ok' | 'throw' | 'max_tokens') => {
    const models = {
      complete: jest.fn(async () => {
        if (outcome === 'throw') throw new Error('timeout');
        return {
          result: {
            stopReason: outcome === 'ok' ? 'end_turn' : 'max_tokens',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  goals: ['Feel calmer'],
                  where: [],
                  agreed: [],
                  open: [],
                }),
              },
            ],
          },
        };
      }),
    };
    const service = new GuideSummariserService(models as never);
    return {
      models,
      run: () =>
        service.summarise({
          rows: [row(1, GuideMessageRole.LEARNER, 'I want to feel calmer')],
          previousSummary: 'Earlier: they work nights.',
          courseTitle: 'Foundations',
          bundle: GUIDE_DEFAULT_BUNDLE,
          attribution: { threadId: 'th1' },
        }),
    };
  };

  it('asks the summariser role, folding in the earlier summary', async () => {
    const t = call('ok');
    expect(await t.run()).toBe('Their goals:\n- Feel calmer');
    const request = (t.models.complete.mock.calls[0] as any[])[0];
    expect(request).toMatchObject({
      role: 'summariser',
      aiTaskId: 'guide-summariser',
      task: 'guide_summariser',
    });
    expect(request.request.messages[0].content).toContain(
      '<earlier_summary>\nEarlier: they work nights.\n</earlier_summary>',
    );
  });

  it.each(['throw', 'max_tokens'] as const)(
    'keeps the earlier summary when the call fails (%s)',
    async (outcome) => {
      expect(await call(outcome).run()).toBe('Earlier: they work nights.');
    },
  );
});
