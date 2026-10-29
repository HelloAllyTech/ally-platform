import { BadRequestException } from '@nestjs/common';
import {
  BUILDER_PROPOSAL_STREAK,
  BuilderRulesService,
  normaliseScope,
  ruleMatchesDecision,
} from '../builder-rules.service';

/**
 * Rules bind future work, so what a rule may do is the part worth pinning:
 * which decisions a "decide for me" rule may answer, that the autonomy slider
 * always wins, and that a proposal is earned, never assumed.
 */
describe('BuilderRulesService', () => {
  const decision = (over: Record<string, any> = {}): any => ({
    id: 'budget:sess-1',
    kind: 'budget',
    questionType: null,
    sessionId: 'sess-1',
    options: [
      { id: 'raise_10', label: 'Raise by $10', recommended: true },
      { id: 'uncap', label: 'Remove', oneWay: true, confirm: true },
    ],
    ...over,
  });

  const build = (over: Record<string, any> = {}) => {
    const rules: any[] = over.rules ?? [];
    const repository = {
      find: jest.fn(async ({ where }: any = {}) =>
        rules.filter(
          (rule) =>
            (where?.active === undefined || rule.active === where.active) &&
            (where?.effect === undefined || rule.effect === where.effect),
        ),
      ),
      findOne: jest.fn(
        async ({ where }: any) =>
          rules.find((rule) => rule.id === where.id) ?? null,
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: 'r-new',
        createdAt: new Date(),
        ...value,
      })),
      update: jest.fn().mockResolvedValue({}),
    };
    const historyRepository = {
      find: jest.fn().mockResolvedValue(over.history ?? []),
      findOne: jest.fn(),
    };
    const store = new Map<string, string>();
    const redisService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    };
    const settingsService = {
      get: jest.fn().mockResolvedValue(
        over.settings ?? {
          autoFixEnabled: true,
          autoReviewEnabled: true,
          autoApproveEnabled: true,
          autoMergeEnabled: true,
          autoReleaseEnabled: true,
        },
      ),
      update: jest.fn().mockResolvedValue({}),
    };
    const decisionService = {
      listPending: jest.fn().mockResolvedValue(over.pending ?? []),
      answer: jest.fn().mockResolvedValue({ ok: true }),
    };
    const service = new BuilderRulesService(
      repository as never,
      historyRepository as never,
      {} as never,
      {} as never,
      redisService as never,
      settingsService as never,
      decisionService as never,
    );
    return { service, repository, settingsService, decisionService, store };
  };

  describe('ruleMatchesDecision', () => {
    const rule = (match: any, scope = 'everywhere') => ({ match, scope });

    it('matches its kind and option, and only a reversible option', () => {
      expect(
        ruleMatchesDecision(
          rule({ kind: 'budget', optionId: 'raise_10' }),
          decision(),
        ),
      ).toBe(true);
      expect(
        ruleMatchesDecision(
          rule({ kind: 'budget', optionId: 'uncap' }),
          decision(),
        ),
      ).toBe(false);
      expect(
        ruleMatchesDecision(
          rule({ kind: 'budget', optionId: 'gone' }),
          decision(),
        ),
      ).toBe(false);
    });

    it('respects question type and a session scope', () => {
      expect(
        ruleMatchesDecision(
          rule({ kind: 'budget', optionId: 'raise_10', questionType: 'taste' }),
          decision(),
        ),
      ).toBe(false);
      expect(
        ruleMatchesDecision(
          rule({ kind: 'budget', optionId: 'raise_10' }, 'session:other'),
          decision(),
        ),
      ).toBe(false);
    });
  });

  it('normalises a scope to one it knows', () => {
    expect(normaliseScope('area:admin ui')).toBe('area:Admin UI');
    expect(normaliseScope('area:nonsense')).toBe('everywhere');
    expect(normaliseScope('session:123e4567-e89b-12d3-a456-426614174000')).toBe(
      'session:123e4567-e89b-12d3-a456-426614174000',
    );
    expect(normaliseScope('whatever')).toBe('everywhere');
  });

  describe('create', () => {
    it('refuses to let a rule decide what to build', async () => {
      const { service } = build();
      await expect(
        service.create(
          {
            statement: 'Always choose Monday for digests',
            scope: 'everywhere',
            effect: 'decide',
            match: { kind: 'question', optionId: 'mon' },
          },
          7,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('turns a merge rule into the existing auto-merge switch', async () => {
      const { service, settingsService } = build();
      await service.create(
        {
          statement: 'Merge green, reviewed pull requests',
          scope: 'everywhere',
          effect: 'decide',
          match: { kind: 'pr_merge', optionId: 'merge' },
        },
        7,
      );
      expect(settingsService.update).toHaveBeenCalledWith(
        { autoMergeEnabled: true },
        7,
      );
    });

    it('switches off the rules it supersedes', async () => {
      const { service, repository } = build();
      await service.create(
        {
          statement: 'Store one row per event',
          scope: 'area:Data model',
          supersedes: ['r-old'],
        },
        7,
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        { active: false, updatedBy: 7 },
      );
    });
  });

  describe('applyDecideRules', () => {
    const decideRule = {
      id: 'r-1',
      active: true,
      effect: 'decide',
      scope: 'everywhere',
      match: { kind: 'budget', optionId: 'raise_10' },
      createdBy: 7,
    };

    it('answers a matching decision as the rule', async () => {
      const { service, decisionService } = build({
        rules: [decideRule],
        pending: [decision()],
      });
      await expect(service.applyDecideRules()).resolves.toBe(1);
      expect(decisionService.answer).toHaveBeenCalledWith(
        'budget:sess-1',
        { selectedOptionIds: ['raise_10'] },
        7,
        { surface: 'rule', ruleId: 'r-1' },
      );
    });

    it('does nothing while autonomy is assist or off', async () => {
      const { service, decisionService } = build({
        rules: [decideRule],
        pending: [decision()],
        settings: {
          autoFixEnabled: false,
          autoReviewEnabled: false,
          autoApproveEnabled: false,
          autoMergeEnabled: false,
          autoReleaseEnabled: false,
        },
      });
      await expect(service.applyDecideRules()).resolves.toBe(0);
      expect(decisionService.answer).not.toHaveBeenCalled();
    });
  });

  describe('proposals', () => {
    const answers = (n: number, over: Record<string, any> = {}) =>
      Array.from({ length: n }, (_, i) => ({
        id: `h-${i}`,
        entryType: 'decision',
        kind: 'budget',
        questionType: null,
        chosenOptionIds: ['raise_10'],
        chosenLabel: 'Raise by $10',
        matchedRecommendation: true,
        prompt: 'Raise the budget?',
        ...over,
      }));

    it(`proposes after ${BUILDER_PROPOSAL_STREAK} agreements in a row`, async () => {
      const { service } = build({ history: answers(BUILDER_PROPOSAL_STREAK) });
      const proposals = await service.proposals();
      expect(proposals).toEqual([
        expect.objectContaining({ kind: 'budget', optionId: 'raise_10' }),
      ]);
    });

    it('does not propose on a shorter streak, a disagreement, or a dismissed key', async () => {
      expect(
        await build({
          history: answers(BUILDER_PROPOSAL_STREAK - 1),
        }).service.proposals(),
      ).toEqual([]);
      const mixed = answers(BUILDER_PROPOSAL_STREAK);
      mixed[3].matchedRecommendation = false;
      expect(await build({ history: mixed }).service.proposals()).toEqual([]);

      const dismissed = build({ history: answers(BUILDER_PROPOSAL_STREAK) });
      await dismissed.service.dismissProposal('budget:');
      expect(await dismissed.service.proposals()).toEqual([]);
    });

    it('never proposes deciding what to build', async () => {
      const { service } = build({
        history: answers(BUILDER_PROPOSAL_STREAK, { kind: 'question' }),
      });
      expect(await service.proposals()).toEqual([]);
    });
  });
});
