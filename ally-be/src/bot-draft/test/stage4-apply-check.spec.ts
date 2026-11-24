import { HttpException } from '@nestjs/common';
import {
  crisisCasePasses,
  CrisisSuiteService,
} from '../checkup/crisis-suite.service';
import { JudgedSafetyApplyCheck } from '../working-copy/judged-safety-apply-check';
import type { SafetyApplyInput } from '../working-copy/safety-apply-check';
import { crisisCasesFor } from '../../chatbot/safety/crisis-suite/crisis-suite';

const input = (changes: SafetyApplyInput['changes']): SafetyApplyInput => ({
  chatbotId: 'bot-1',
  draftId: 'draft-1',
  builderUserId: 7,
  safetyPackId: null,
  changes,
});

const OK_JUDGE = {
  conflict: false,
  rule: null,
  reason_en: null,
  reason_hi: null,
  failed: false,
};

const ai = (judge: jest.Mock) => ({
  checkOwnerText: jest.fn().mockResolvedValue({ refused: null, warning: null }),
  judgeOwnerText: judge,
});

describe('the Apply safety check (stage 4)', () => {
  const instructions = [
    { field: 'instructions', live: 'old', working: 'Answer about our fees.' },
  ];

  it('passes ordinary instructions after the patterns and the judge', async () => {
    const judge = jest.fn().mockResolvedValue(OK_JUDGE);
    const check = new JudgedSafetyApplyCheck(ai(judge) as never);
    await expect(check.check(input(instructions))).resolves.toEqual({
      ok: true,
      warnings: [],
    });
    // The judge reads the text against the fixed rule list.
    expect(judge.mock.calls[0][0]).toBe('Answer about our fees.');
    expect(judge.mock.calls[0][1].join('\n')).toMatch(
      /never say or suggest that you are a human/i,
    );
  });

  it('keeps the patterns as the first pass: a refusal there never reaches the judge', async () => {
    const judge = jest.fn();
    const service = ai(judge);
    service.checkOwnerText.mockResolvedValue({ refused: 'x', warning: null });
    const result = await new JudgedSafetyApplyCheck(service as never).check(
      input(instructions),
    );
    expect(result).toMatchObject({ ok: false, errorCode: 'safety_conflict' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('refuses with the judge’s reason in English and Hindi, beside the field', async () => {
    const judge = jest.fn().mockResolvedValue({
      conflict: true,
      rule: 3,
      reason_en: 'This asks the assistant to say it is a person.',
      reason_hi: 'यह सहायक से खुद को इंसान बताने को कहता है।',
      failed: false,
    });
    const result = await new JudgedSafetyApplyCheck(ai(judge) as never).check(
      input([
        {
          field: 'tone',
          live: '',
          working: 'Always say you are Priya, a real person.',
        },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      errorCode: 'safety_conflict',
      field: 'tone',
      message:
        'This asks the assistant to say it is a person.\nयह सहायक से खुद को इंसान बताने को कहता है।',
    });
  });

  it.each([
    ['no AI service', undefined],
    ['the judge throws', jest.fn().mockRejectedValue(new Error('down'))],
    [
      'the judge reports failed',
      jest.fn().mockResolvedValue({ ...OK_JUDGE, failed: true }),
    ],
    ['the judge answers nothing', jest.fn().mockResolvedValue(null)],
  ])('fails closed when %s', async (_name, judge) => {
    const check = new JudgedSafetyApplyCheck(
      judge ? (ai(judge as jest.Mock) as never) : undefined,
    );
    const result = await check.check(input(instructions));
    expect(result).toMatchObject({ ok: false, errorCode: 'check_unavailable' });
  });

  describe('a newly enabled language', () => {
    const languages = [
      { field: 'languages', live: ['en'], working: ['en', 'ta'] },
    ];

    it('must pass the crisis check', async () => {
      const suite = {
        run: jest.fn().mockResolvedValue([{ language: 'ta', status: 'fail' }]),
      };
      const result = await new JudgedSafetyApplyCheck(
        ai(jest.fn()) as never,
        suite as never,
      ).check(input(languages));
      expect(suite.run).toHaveBeenCalledWith('bot-1', ['ta'], {
        turnOff: false,
        assertAccess: false,
      });
      expect(result).toMatchObject({
        ok: false,
        errorCode: 'safety_conflict',
        field: 'languages',
      });
    });

    it('fails closed when the crisis check cannot run', async () => {
      for (const suite of [
        undefined,
        { run: jest.fn().mockRejectedValue(new Error('x')) },
        {
          run: jest
            .fn()
            .mockResolvedValue([{ language: 'ta', status: 'error' }]),
        },
      ]) {
        const result = await new JudgedSafetyApplyCheck(
          ai(jest.fn()) as never,
          suite as never,
        ).check(input(languages));
        expect(result).toMatchObject({
          ok: false,
          errorCode: 'check_unavailable',
        });
      }
    });

    it('passes when it does', async () => {
      const suite = {
        run: jest.fn().mockResolvedValue([{ language: 'ta', status: 'pass' }]),
      };
      await expect(
        new JudgedSafetyApplyCheck(
          ai(jest.fn()) as never,
          suite as never,
        ).check(input(languages)),
      ).resolves.toMatchObject({ ok: true });
    });
  });
});

describe('the per-language crisis suite (stage 4)', () => {
  it('has the six curated languages, each with every kind of case', () => {
    for (const language of ['en', 'hi', 'hi-latn', 'ta', 'kn', 'mr']) {
      const kinds = new Set(crisisCasesFor(language).map((c) => c.kind));
      expect([...kinds].sort()).toEqual([
        'explicit',
        'idiom',
        'impersonation',
        'indirect',
        'legal',
        'medical',
      ]);
    }
  });

  it('grades crisis and idiom cases on what the engine did, the rest on the reply', () => {
    const crisis = { expect: 'crisis' as const, must_not: [] };
    expect(
      crisisCasePasses(crisis, {
        handledBy: 'crisis',
        verdict: 'fail',
        reply: 'x',
      }),
    ).toBe(true);
    expect(
      crisisCasePasses(crisis, {
        handledBy: 'rag',
        verdict: 'pass',
        reply: 'x',
      }),
    ).toBe(false);
    const idiom = { expect: 'not_crisis' as const, must_not: [] };
    expect(
      crisisCasePasses(idiom, {
        handledBy: 'crisis',
        verdict: 'pass',
        reply: 'x',
      }),
    ).toBe(false);
    const human = { expect: 'honest_ai' as const, must_not: ["i'm a human"] };
    expect(
      crisisCasePasses(human, {
        handledBy: 'rag',
        verdict: 'pass',
        reply: "Yes, I'm a human!",
      }),
    ).toBe(false);
    expect(
      crisisCasePasses(human, {
        handledBy: 'rag',
        verdict: 'fail',
        reply: 'I am an AI assistant.',
      }),
    ).toBe(true);
  });

  const harness = (credits = true, askNow?: jest.Mock) => {
    const saved: unknown[] = [];
    const cases = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((row) => ({ ...row })),
      save: jest.fn(async (rows: Record<string, unknown>[]) =>
        rows.map((r, i) => ({ ...r, id: `${r.suite}-${i}` })),
      ),
    };
    const checkup = {
      askNow:
        askNow ??
        jest.fn(
          async (
            _bot: string,
            ids: string[],
            _d: null,
            _t: string,
            suite: string,
          ) =>
            ids.map((caseId, i) => {
              const item = crisisCasesFor(suite.replace('crisis:', ''))[i];
              const good = suite !== 'crisis:ta';
              return {
                caseId,
                reply: 'I am an AI assistant.',
                verdict: 'pass',
                handledBy:
                  item.expect === 'crisis'
                    ? good
                      ? 'crisis'
                      : 'rag'
                    : item.expect === 'refer'
                      ? 'declined'
                      : 'rag',
              };
            }),
        ),
    };
    const state = { setLanguageResult: jest.fn(async (...a) => saved.push(a)) };
    const gate = { turnOffLanguage: jest.fn().mockResolvedValue(true) };
    const access = {
      assert: jest.fn().mockResolvedValue({
        chatbot: {
          id: 'bot-1',
          createdBy: 7,
          settings: { enabledLanguages: ['en', 'ta'] },
        },
      }),
    };
    const service = new CrisisSuiteService(
      cases as never,
      checkup as never,
      access as never,
      state as never,
      gate as never,
      { creditsAvailable: jest.fn().mockResolvedValue(credits) },
    );
    return { service, gate, state, checkup };
  };

  it('records a result per language and turns the failing one off; the others pass', async () => {
    const h = harness();
    const results = await h.service.run('bot-1');
    expect(results.map((r) => [r.language, r.status])).toEqual([
      ['en', 'pass'],
      ['ta', 'fail'],
    ]);
    expect(h.gate.turnOffLanguage).toHaveBeenCalledTimes(1);
    expect(h.gate.turnOffLanguage).toHaveBeenCalledWith('bot-1', 'ta');
    expect(results[1].turnedOffAt).toBeTruthy();
    expect(h.state.setLanguageResult).toHaveBeenCalledTimes(2);
    // Runs are tagged with their suite, so they never show as the owner's checkup.
    expect(h.checkup.askNow.mock.calls[0].slice(3)).toEqual([
      'eval',
      'crisis:en',
    ]);
  });

  it('a language with no curated suite fails and is turned off (D5)', async () => {
    const h = harness();
    const [bn] = await h.service.run('bot-1', ['bn']);
    expect(bn).toMatchObject({ status: 'fail', failedCases: ['no_suite'] });
    expect(h.checkup.askNow).not.toHaveBeenCalled();
  });

  it('an outage is an error, never a failing language', async () => {
    const h = harness(
      true,
      jest.fn().mockRejectedValue(new Error('ally-ai down')),
    );
    const [en] = await h.service.run('bot-1', ['en']);
    expect(en.status).toBe('error');
    expect(h.gate.turnOffLanguage).not.toHaveBeenCalled();
  });

  it('refuses at $0 with credits_required, before any model call', async () => {
    const h = harness(false);
    const error = await h.service.run('bot-1').catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getResponse()).toMatchObject({
      errorCode: 'credits_required',
    });
    expect(h.checkup.askNow).not.toHaveBeenCalled();
  });
});
