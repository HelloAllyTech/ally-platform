import { PlanEventKind } from '../../enum/product-planning.enum';
import {
  PlanCeilingReachedException,
  PlanCeilingService,
} from '../plan-ceiling.service';

interface Setup {
  enabled?: boolean;
  session?: {
    kind: string;
    leadUserId: number | null;
    ceilingUsd: string | null;
    totalCostUsd: string | null;
  } | null;
  ledgerUsd?: number;
  role?: string;
  settingsThrow?: boolean;
}

function build(setup: Setup = {}) {
  const session =
    setup.session === undefined
      ? { kind: 'plan', leadUserId: 7, ceilingUsd: null, totalCostUsd: '0' }
      : setup.session;
  const settings = {
    getRoadmapV2: jest.fn(async () => {
      if (setup.settingsThrow) throw new Error('db down');
      return {
        enabled: setup.enabled ?? true,
        ceilingUsd: 100,
        maxLeadCeilingUsd: 200,
      };
    }),
    assertRoadmapV2: jest.fn(async () => {
      if (!(setup.enabled ?? true)) throw new Error('404');
      return { enabled: true, ceilingUsd: 100, maxLeadCeilingUsd: 200 };
    }),
  };
  const spend = {
    summarize: jest.fn(async () => ({
      totalUsd: setup.ledgerUsd ?? 0,
      approximate: false,
    })),
  };
  const events = { record: jest.fn(async () => undefined) };
  const roles = { roleOf: jest.fn(async () => setup.role ?? 'builder') };
  const query = jest.fn(
    async (sql: string, params?: unknown[]): Promise<unknown[]> =>
      sql.trim().startsWith('SELECT') && params
        ? session
          ? [session]
          : []
        : [],
  );
  const service = new PlanCeilingService(
    settings as never,
    spend as never,
    events as never,
    roles as never,
    { query } as never,
  );
  return { service, query, events, spend, session };
}

describe('PlanCeilingService', () => {
  describe('effectiveCeiling', () => {
    it('uses a raised ceiling when the plan has one, the setting otherwise', () => {
      expect(PlanCeilingService.effectiveCeiling('150', 100)).toEqual({
        ceilingUsd: 150,
        raised: true,
      });
      expect(PlanCeilingService.effectiveCeiling(null, 100)).toEqual({
        ceilingUsd: 100,
        raised: false,
      });
      expect(PlanCeilingService.effectiveCeiling('0', 100).raised).toBe(false);
      expect(PlanCeilingService.effectiveCeiling('junk', 100).raised).toBe(
        false,
      );
    });
  });

  describe('assertWithinCeiling', () => {
    it('does nothing at all while roadmap_v2 is off', async () => {
      const { service, query } = build({ enabled: false, ledgerUsd: 999 });
      await expect(
        service.assertWithinCeiling('s1', 'interviewer_turn'),
      ).resolves.toBeUndefined();
      expect(query).not.toHaveBeenCalled();
    });

    it('treats an unreadable flag as off', async () => {
      const { service, query } = build({ settingsThrow: true });
      await expect(
        service.assertWithinCeiling('s1', 'copilot_turn'),
      ).resolves.toBeUndefined();
      expect(query).not.toHaveBeenCalled();
    });

    it('ignores a session that is not a plan (Builder keeps budgetUsd)', async () => {
      const { service } = build({
        session: {
          kind: 'build',
          leadUserId: null,
          ceilingUsd: null,
          totalCostUsd: '500',
        },
      });
      await expect(
        service.assertWithinCeiling('s1', 'build_dispatch'),
      ).resolves.toBeUndefined();
    });

    it('ignores a call with no session', async () => {
      const { service, query } = build();
      await service.assertWithinCeiling(null, 'specialist');
      expect(query).not.toHaveBeenCalled();
    });

    it('passes under the ceiling', async () => {
      const { service } = build({ ledgerUsd: 40 });
      await expect(
        service.assertWithinCeiling('s1', 'specialist'),
      ).resolves.toBeUndefined();
    });

    it('counts the ledger and the runner together, and refuses at the ceiling', async () => {
      const { service } = build({
        ledgerUsd: 60,
        session: {
          kind: 'plan',
          leadUserId: 7,
          ceilingUsd: null,
          totalCostUsd: '40',
        },
      });
      const refusal = await service
        .assertWithinCeiling('s1', 'design_run')
        .catch((e) => e);
      expect(refusal).toBeInstanceOf(PlanCeilingReachedException);
      expect(refusal.getStatus()).toBe(409);
      expect(refusal.getResponse()).toMatchObject({
        code: 'plan_ceiling_reached',
        point: 'design_run',
        spentUsd: 100,
        ceilingUsd: 100,
      });
    });

    it('honours a raised ceiling', async () => {
      const { service } = build({
        ledgerUsd: 120,
        session: {
          kind: 'plan',
          leadUserId: 7,
          ceilingUsd: '150',
          totalCostUsd: '0',
        },
      });
      await expect(
        service.assertWithinCeiling('s1', 'build_dispatch'),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkAt', () => {
    it('answers the state instead of throwing, and null while off', async () => {
      expect(
        await build({ ledgerUsd: 150 }).service.checkAt('s1', 'phase_boundary'),
      ).toMatchObject({ exceeded: true, spentUsd: 150, ceilingUsd: 100 });
      expect(
        await build({ enabled: false }).service.checkAt('s1', 'pr_automation'),
      ).toBeNull();
    });

    it('never throws', async () => {
      const { service, spend } = build();
      spend.summarize.mockRejectedValueOnce(new Error('boom'));
      await expect(service.checkAt('s1', 'phase_boundary')).resolves.toBeNull();
    });
  });

  describe('setCeiling', () => {
    it('lets the lead raise up to the Owner-set maximum and records it', async () => {
      const { service, query, events } = build({ ledgerUsd: 90 });
      await service.setCeiling('s1', 7, 180);
      const update = query.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE'),
      );
      expect(update?.[1]).toEqual(['s1', 180]);
      expect(events.record).toHaveBeenCalledWith({
        sessionId: 's1',
        kind: PlanEventKind.BUDGET_CHANGED,
        actorUserId: 7,
        detail: { fromUsd: 100, toUsd: 180, by: 'lead' },
      });
    });

    it('refuses a lead past the maximum', async () => {
      const { service, events } = build();
      await expect(service.setCeiling('s1', 7, 250)).rejects.toMatchObject({
        status: 403,
      });
      expect(events.record).not.toHaveBeenCalled();
    });

    it('lets an Owner set any amount, lead or not', async () => {
      const { service, events } = build({ role: 'owner' });
      await service.setCeiling('s1', 99, 1000);
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { fromUsd: 100, toUsd: 1000, by: 'owner' },
        }),
      );
    });

    it('refuses a Builder who does not lead it, and an Idea author', async () => {
      await expect(
        build({ role: 'builder' }).service.setCeiling('s1', 8, 150),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        build({ role: 'idea' }).service.setCeiling('s1', 7, 150),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('refuses a figure at or below what is already spent', async () => {
      await expect(
        build({ role: 'owner', ledgerUsd: 120 }).service.setCeiling(
          's1',
          1,
          120,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('refuses a session with no plan', async () => {
      await expect(
        build({ session: null }).service.setCeiling('s1', 7, 150),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('is closed while the flag is off', async () => {
      await expect(
        build({ enabled: false }).service.setCeiling('s1', 7, 150),
      ).rejects.toThrow('404');
    });
  });
});
