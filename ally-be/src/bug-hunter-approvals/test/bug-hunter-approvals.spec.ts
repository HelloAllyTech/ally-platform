import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleGuard } from 'src/auth/guards/feature-toggle.guard';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { BugHunterApprovalsController } from '../controller/bug-hunter-approvals.controller';
import { CreateVerdictDto } from '../dto/verdict.dto';
import { BugHunterApprovalsService } from '../service/bug-hunter-approvals.service';
import { DataSource } from 'typeorm';
import { BughunterDbService } from '../service/bughunter-db.service';

/**
 * An in-memory stand-in for the two bughunter tables, answering the service's SQL
 * by shape. Enough to exercise every branch without a database.
 */
class FakeBughunterDb {
  reports = new Map<number, any>();
  verdicts: any[] = [];
  closedBugs: any[][] = [];
  failInsertWith: any = null;

  query = async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (
      s.startsWith('SELECT id, run_id, app, patch_diff FROM bughunter.reports')
    ) {
      const r = this.reports.get(params[0]);
      return r && params[1].includes(r.status) ? [r] : [];
    }
    if (s.startsWith('SELECT * FROM bughunter.reports')) {
      const r = this.reports.get(params[0]);
      return r && params[1].includes(r.status) ? [r] : [];
    }
    if (s.startsWith('SELECT id FROM bughunter.verdicts WHERE report_id')) {
      return this.verdicts.filter(
        (v) => v.report_id === params[0] && v.superseded_by === null,
      );
    }
    if (s.startsWith('UPDATE bughunter.verdicts SET superseded_by = -1')) {
      this.verdicts
        .filter((v) => params[0].includes(v.id))
        .forEach((v) => (v.superseded_by = -1));
      return [];
    }
    if (s.startsWith('INSERT INTO bughunter.verdicts')) {
      if (this.failInsertWith) throw this.failInsertWith;
      const row = {
        id: this.verdicts.length + 1,
        run_id: params[0],
        app: params[1],
        diagnosis: params[2],
        fix: params[3],
        reason: params[4],
        decided_by: params[5],
        source: 'dashboard',
        report_id: params[6],
        superseded_by: null,
        superseded_at: null,
        created_at: new Date('2026-11-16T10:00:00Z'),
      };
      this.verdicts.push(row);
      return [row];
    }
    if (s.startsWith('UPDATE bughunter.verdicts SET superseded_by = $1')) {
      this.verdicts
        .filter((v) => params[1].includes(v.id))
        .forEach((v) => {
          v.superseded_by = params[0];
          v.superseded_at = new Date('2026-11-16T10:00:00Z');
        });
      return [];
    }
    if (s.startsWith("UPDATE bughunter.bugs SET status = 'done'")) {
      this.closedBugs.push(params);
      return [];
    }
    if (s.startsWith('SELECT id, diagnosis, fix, reason')) {
      return this.verdicts
        .filter((v) => v.report_id === params[0])
        .sort((a, b) => b.id - a.id);
    }
    if (s.startsWith('SELECT r.id, r.created_at')) {
      return [...this.reports.values()]
        .filter((r) => params[0].includes(r.status))
        .map((r) => {
          const v = this.verdicts.find(
            (x) => x.report_id === r.id && x.superseded_by === null,
          );
          return {
            ...r,
            diagnosis: v?.diagnosis,
            fix: v?.fix,
            decided_at: v?.created_at,
          };
        })
        .filter((r) =>
          s.includes('v.id IS NULL')
            ? !r.diagnosis
            : s.includes('v.id IS NOT NULL')
              ? !!r.diagnosis
              : true,
        );
    }
    throw new Error(`unexpected SQL: ${s.slice(0, 80)}`);
  };

  transaction = async (fn: (m: any) => Promise<void>) => fn(this);
}

const report = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  run_id: `run-${id}`,
  app: 'ally-be',
  source: 'issue',
  status: 'suggested_fix',
  title: `report ${id}`,
  created_at: new Date('2026-11-16T09:00:00Z'),
  patch_diff: 'diff --git a/x b/x',
  finding: { title: 'x returns 0' },
  repro: { test_name: 'x returns 3' },
  review: { verdict: 'approve' },
  ...extra,
});

describe('BugHunterApprovalsService', () => {
  let fake: FakeBughunterDb;
  let audit: { log: jest.Mock };
  let service: BugHunterApprovalsService;

  beforeEach(() => {
    fake = new FakeBughunterDb();
    fake.reports.set(1, report(1));
    fake.reports.set(2, report(2, { status: 'escalated', patch_diff: null }));
    fake.reports.set(3, report(3, { status: 'closed_not_bug' }));
    audit = { log: jest.fn() };
    const db = { get: async () => fake } as unknown as BughunterDbService;
    service = new BugHunterApprovalsService(db, audit as any);
  });

  it('lists only suggested fixes and escalations, open ones by default', async () => {
    const open = await service.list({});
    expect(open.map((r) => r.id).sort()).toEqual([1, 2]);
    await service.recordVerdict(
      1,
      { diagnosis: 'correct', fix: 'worked', reason: 'ok' },
      42,
    );
    expect((await service.list({})).map((r) => r.id)).toEqual([2]);
    const judged = await service.list({ status: 'judged' });
    expect(judged[0]).toMatchObject({
      id: 1,
      verdict: { diagnosis: 'correct' },
    });
  });

  it('records a verdict, with the user id and an audit entry', async () => {
    const out = await service.recordVerdict(
      1,
      { diagnosis: 'not_a_bug', fix: 'none', reason: 'intended' },
      42,
    );
    expect(out).toMatchObject({ amended: false, diagnosis: 'not_a_bug' });
    expect(fake.verdicts[0]).toMatchObject({
      decided_by: '42',
      source: 'dashboard',
      report_id: 1,
      run_id: 'run-1',
      superseded_by: null,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'BUG_HUNTER_V2_VERDICT_RECORDED',
        userId: 42,
        details: expect.objectContaining({ reportId: 1, verdictId: 1 }),
      }),
    );
    // chunk 10: the verdict closes the bug on the board
    expect(fake.closedBugs).toEqual([[1, 'verdict: not_a_bug / none']]);
  });

  it('an amendment becomes active and keeps the old row, linked, with an audit entry', async () => {
    await service.recordVerdict(
      1,
      { diagnosis: 'not_a_bug', fix: 'none', reason: 'a' },
      42,
    );
    const second = await service.recordVerdict(
      1,
      { diagnosis: 'correct', fix: 'worked', reason: 'it was real' },
      7,
    );
    expect(second).toMatchObject({ amended: true, supersededVerdictIds: [1] });
    expect(fake.verdicts[0]).toMatchObject({ superseded_by: 2 });
    expect(fake.verdicts[1]).toMatchObject({
      superseded_by: null,
      decided_by: '7',
    });
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'BUG_HUNTER_V2_VERDICT_AMENDED' }),
    );
    const detail = await service.detail(1);
    expect(
      detail.verdicts.map((v: { id: number; active: boolean }) => [
        v.id,
        v.active,
      ]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
  });

  it('refuses a fix verdict when there was no patch, and contradictions', async () => {
    await expect(
      service.recordVerdict(
        2,
        { diagnosis: 'correct', fix: 'worked', reason: 'r' },
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.recordVerdict(
        1,
        { diagnosis: 'not_a_bug', fix: 'worked', reason: 'r' },
        1,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.recordVerdict(
        2,
        { diagnosis: 'wrong', fix: 'none', reason: 'r' },
        1,
      ),
    ).resolves.toMatchObject({ amended: false });
  });

  it('only reports a human judges exist here', async () => {
    await expect(service.detail(3)).rejects.toThrow(
      'No such Bug Hunter report.',
    );
    await expect(
      service.recordVerdict(
        99,
        { diagnosis: 'wrong', fix: 'none', reason: 'r' },
        1,
      ),
    ).rejects.toThrow('No such Bug Hunter report.');
  });

  it('two admins at the same moment: the second gets 409', async () => {
    fake.failInsertWith = Object.assign(new Error('duplicate'), {
      code: '23505',
    });
    await expect(
      service.recordVerdict(
        1,
        { diagnosis: 'correct', fix: 'worked', reason: 'r' },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('BughunterDbService', () => {
  const dataSource = (present: boolean) => {
    const query = jest.fn().mockResolvedValue([{ present }]);
    return { ds: { query } as unknown as DataSource, query };
  };

  it('answers 503 while the bughunter schema is not set up', async () => {
    const { ds } = dataSource(false);
    await expect(new BughunterDbService(ds).get()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("returns ally-be's own connection once the schema exists, checking only once", async () => {
    const { ds, query } = dataSource(true);
    const service = new BughunterDbService(ds);
    await expect(service.get()).resolves.toBe(ds);
    await expect(service.get()).resolves.toBe(ds);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain(
      "to_regclass('bughunter.reports')",
    );
  });
});

describe('verdict body validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: CreateVerdictDto });

  it('requires a reason and known values (400)', async () => {
    await expect(
      validate({ diagnosis: 'correct', fix: 'worked', reason: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ diagnosis: 'maybe', fix: 'worked', reason: 'r' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ diagnosis: 'correct', fix: 'sort of', reason: 'r' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ diagnosis: 'correct', fix: 'worked', reason: ' fine ' }),
    ).resolves.toMatchObject({ reason: 'fine' });
  });
});

describe('BugHunterApprovalsController access', () => {
  const handlers = [
    'list',
    'detail',
    'verdict',
    'approve',
    'reject',
    'settings',
    'setMode',
    'bugs',
    'start',
  ] as const;
  const proto = BugHunterApprovalsController.prototype as any;

  it.each(handlers)('%s needs the BUG_HUNTER_V2_VERDICTS toggle', (name) => {
    const meta = Reflect.getMetadata(FEATURE_TOGGLE_KEY, proto[name]);
    expect(meta?.featureKey).toBe(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS);
    const guards = Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? [];
    expect(guards).toContain(FeatureToggleGuard);
  });

  it.each(handlers)(
    '%s: a caller without the toggle gets 403',
    async (name) => {
      const guard = new FeatureToggleGuard(
        new Reflector(),
        {
          hasToggle: jest.fn().mockResolvedValue(false),
          isWithheld: jest.fn().mockResolvedValue(false),
          isLimitedToOrgScopedRoutes: jest.fn().mockResolvedValue(false),
        } as any,
        { isEnabledForTenant: jest.fn().mockResolvedValue(false) } as any,
        { assertTenantInScope: jest.fn() } as any,
        { getUserPermissions: jest.fn().mockResolvedValue([]) } as any,
      );
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 5, tenantId: undefined },
            query: {},
          }),
        }),
        getHandler: () => proto[name],
        getClass: () => BugHunterApprovalsController,
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('approve and reject stay switched off until pr mode', () => {
    const controller = new BugHunterApprovalsController({} as any, {} as any);
    expect(() => controller.approve()).toThrow(ForbiddenException);
    expect(() => controller.reject()).toThrow(ForbiddenException);
  });
});
