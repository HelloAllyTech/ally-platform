import { PlanStage } from '../../enum/product-planning.enum';
import { PlanSpendService } from '../plan-spend.service';

describe('PlanSpendService', () => {
  const usage = {
    sessionId: 's1',
    stage: PlanStage.PRD,
    actorUserId: 7,
    taskId: 'builder-interview',
    tokensIn: 1_000_000,
    tokensOut: 1_000_000,
  };

  describe('price', () => {
    it('prices an Anthropic call with its cache reads and writes', () => {
      const { costUsd, priced } = PlanSpendService.price({
        ...usage,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        cachedTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      });
      // 2 in + 10 out + 0.2 read (0.1x) + 2.5 write (1.25x)
      expect(priced).toBe(true);
      expect(costUsd).toBeCloseTo(14.7);
    });

    it('prices an OpenAI cached share at the cached rate', () => {
      const { costUsd } = PlanSpendService.price({
        ...usage,
        provider: 'openai',
        model: 'gpt-5',
        cachedTokens: 1_000_000,
      });
      // all 1M prompt tokens cached at 0.125, plus 10 out
      expect(costUsd).toBeCloseTo(10.125);
    });

    it('marks an unknown model unpriced rather than free', () => {
      expect(
        PlanSpendService.price({
          ...usage,
          provider: 'openai',
          model: 'mystery-1',
        }),
      ).toEqual({ costUsd: 0, priced: false });
    });

    it("takes a runner's known cost as-is", () => {
      expect(
        PlanSpendService.price({
          ...usage,
          provider: 'anthropic',
          model: 'whatever',
          knownCostUsd: 0.42,
        }),
      ).toEqual({ costUsd: 0.42, priced: true });
    });
  });

  describe('record', () => {
    it('writes a priced row and awaits the save', async () => {
      const save = jest.fn(async (row: object) => row);
      const service = new PlanSpendService(
        { create: (row: object) => row, save } as never,
        {} as never,
      );
      const row = await service.record({
        ...usage,
        provider: 'openai',
        model: 'gpt-5-mini',
        tokensIn: 1000.4,
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(row).toMatchObject({
        sessionId: 's1',
        stage: PlanStage.PRD,
        tokensIn: 1000,
        priced: true,
        specialist: null,
      });
      expect(row.costUsd).toMatch(/^\d+\.\d{6}$/);
    });
  });

  describe('summarizeRows', () => {
    it('totals by stage, person and specialist, and flags unpriced rows', () => {
      const summary = PlanSpendService.summarizeRows([
        {
          stage: PlanStage.IDEA,
          actorUserId: 1,
          specialist: null,
          costUsd: '0.5',
          priced: true,
        },
        {
          stage: PlanStage.PRD,
          actorUserId: 2,
          specialist: 'grounder',
          costUsd: '1.25',
          priced: true,
        },
        {
          stage: PlanStage.PRD,
          actorUserId: 2,
          specialist: null,
          costUsd: '0',
          priced: false,
        },
      ]);
      expect(summary.totalUsd).toBeCloseTo(1.75);
      expect(summary.approximate).toBe(true);
      expect(summary.byStage).toEqual([
        { key: PlanStage.PRD, costUsd: 1.25 },
        { key: PlanStage.IDEA, costUsd: 0.5 },
      ]);
      expect(summary.byActor[0]).toEqual({ actorUserId: 2, costUsd: 1.25 });
      expect(summary.bySpecialist).toContainEqual({
        key: 'grounder',
        costUsd: 1.25,
      });
    });

    it('is zero and exact for no rows', () => {
      expect(PlanSpendService.summarizeRows([])).toMatchObject({
        totalUsd: 0,
        approximate: false,
      });
    });
  });

  describe('checkCeiling', () => {
    const service = (rows: object[], settings: object | null) =>
      new PlanSpendService(
        { find: jest.fn(async () => rows) } as never,
        { findOne: jest.fn(async () => settings) } as never,
      );

    it('defaults to one $100 ceiling per plan, builds included', async () => {
      const check = await service(
        [{ stage: PlanStage.BUILDING, costUsd: '79', priced: true }],
        null,
      ).checkCeiling('s1', PlanStage.BUILDING);
      expect(check).toMatchObject({ ceilingUsd: 100, state: 'ok' });
    });

    it('reads a retuned ceiling from Builder settings', async () => {
      const check = await service(
        [{ stage: PlanStage.PRD, costUsd: '40', priced: true }],
        { planCeilingUsd: '50.0000', planIdeaCeilingUsd: '1.0000' },
      ).checkCeiling('s1', PlanStage.PRD);
      expect(check).toMatchObject({ ceilingUsd: 50, state: 'warn' });
    });
  });

  describe('ceilingState', () => {
    const at = (totalUsd: number, stage: PlanStage) =>
      PlanSpendService.ceilingState(
        { totalUsd, approximate: false },
        stage,
        5,
        1,
      ).state;

    it('warns at 80% and stops at the plan ceiling', () => {
      expect(at(3.99, PlanStage.PRD)).toBe('ok');
      expect(at(4, PlanStage.PRD)).toBe('warn');
      expect(at(5, PlanStage.PRD)).toBe('stop');
    });

    it('never hard-stops the private Idea stage: it wraps up at 80% of its share', () => {
      expect(at(0.79, PlanStage.IDEA)).toBe('ok');
      expect(at(0.8, PlanStage.IDEA)).toBe('wrap_up');
      expect(at(50, PlanStage.IDEA)).toBe('wrap_up');
    });
  });
});
