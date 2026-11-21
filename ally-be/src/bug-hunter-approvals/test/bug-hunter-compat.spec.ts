import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BugFindingStatus } from 'src/bug-hunter/enum/bug-finding.enum';
import {
  BugHunterCompatService,
  compatStatus,
  fromCompatId,
  toCompatId,
} from '../service/bug-hunter-compat.service';
import { BughunterDbService } from '../service/bughunter-db.service';
import { BugHunterCompatController } from '../controller/bug-hunter-compat.controller';
import { FEATURE_TOGGLE_KEY } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';

const row = (extra: Record<string, unknown> = {}) => ({
  id: 10,
  source: 'reported',
  signal_key: 'reported:976eb704-4a94-43a6-a593-f1d4e09ecc98',
  app: 'ally-be',
  title: 'Plan and usage shows 79% at exactly 80%',
  description: 'the warning is missing',
  status: 'needs_you',
  reason: null,
  report_id: 10,
  report_status: 'suggested_fix',
  root_cause: 'Math.floor on dollar floats',
  finding: { evidence: ['plan-view.service.ts:53'] },
  repro: {
    test_path: 'src/billing/plan-view.repro.spec.ts',
    test_name: 'warns at 80%',
    failure_excerpt: 'expected [] to equal [...]',
  },
  patch_diff: '+++ w/ally-be/src/billing/service/plan-view.service.ts\n',
  review: { notes: ['integer micros fix it'] },
  confidence: 'medium',
  severity: 'medium',
  stop_reason: null,
  pr_url: null,
  pr_number: null,
  created_at: '2026-11-20T15:00:00Z',
  updated_at: '2026-11-20T15:40:00Z',
  started_at: '2026-11-20T17:05:06Z',
  finished_at: '2026-11-20T17:42:47Z',
  ...extra,
});

describe('BugHunterCompatService (v2 in the old page shape)', () => {
  let rows: any[];
  let board: Record<string, jest.Mock>;
  let service: BugHunterCompatService;

  beforeEach(() => {
    rows = [row()];
    const fake = {
      query: jest.fn(async (_sql: string, params: unknown[] = []) =>
        params.length ? rows.filter((r) => r.id === params[0]) : rows,
      ),
    };
    board = {
      openPr: jest.fn(async () => ({})),
      start: jest.fn(async () => ({})),
      dismiss: jest.fn(async () => ({})),
      merge: jest.fn(async () => ({})),
      release: jest.fn(async () => ({})),
      settings: jest.fn(async () => ({
        mode: 'autonomous',
        updatedBy: 7,
        updatedAt: '2026-11-21T00:00:00Z',
      })),
      setMode: jest.fn(async () => ({})),
    };
    service = new BugHunterCompatService(
      { get: async () => fake } as unknown as BughunterDbService,
      board as any,
    );
  });

  it('ids: v2 bugs never look like a v1 uuid, and a bad id is a 404', () => {
    expect(toCompatId(10)).toBe('v2-10');
    expect(fromCompatId('v2-10')).toBe(10);
    expect(() => fromCompatId('976eb704-4a94-43a6-a593-f1d4e09ecc98')).toThrow(
      NotFoundException,
    );
    expect(() => fromCompatId('v2-x')).toThrow(NotFoundException);
  });

  it.each([
    ['backlog', null, BugFindingStatus.NEW],
    ['queued', null, BugFindingStatus.QUEUED],
    ['running', null, BugFindingStatus.FIXING],
    ['needs_you', 'suggested_fix', BugFindingStatus.PENDING_APPROVAL],
    ['needs_you', 'escalated', BugFindingStatus.NEEDS_INPUT],
    ['pr_open', 'suggested_fix', BugFindingStatus.PR_OPENED],
    ['merged', null, BugFindingStatus.MERGED],
    ['released', null, BugFindingStatus.RELEASED],
    ['failed', null, BugFindingStatus.FAILED],
    ['done', null, BugFindingStatus.DISMISSED],
  ])('%s (%s) shows as %s', (status, report, expected) => {
    expect(compatStatus(status, report)).toBe(expected);
  });

  it('a v2 bug becomes a full old-page finding with its report as evidence', async () => {
    const { items, count } = await service.list();
    expect(count).toBe(1);
    expect(items[0]).toMatchObject({
      id: 'v2-10',
      repo: 'ally-be',
      source: 'reported_bug',
      status: BugFindingStatus.PENDING_APPROVAL,
      reportedBugId: '976eb704-4a94-43a6-a593-f1d4e09ecc98',
      file: 'ally-be/src/billing/service/plan-view.service.ts',
      proven: true,
      confidence: 0.6,
      engine: 'bug-hunter-v2',
    });
    expect(items[0].evidence).toContain(
      'Root cause\nMath.floor on dollar floats',
    );
    expect(items[0].evidence).toContain(
      'Failing test\nsrc/billing/plan-view.repro.spec.ts',
    );
    expect(items[0].evidence).toContain('Suggested fix');
    // the old serializer filled every nested field
    expect(items[0]).toHaveProperty('chain');
    expect(items[0]).toHaveProperty('budget');
  });

  it("the drawer gets a work log from the bug's own timestamps", async () => {
    const detail: any = await service.detail('v2-10');
    expect(detail.events.map((e: any) => e.stage)).toEqual([
      'finder_result',
      'session_dispatched',
      'test_written',
    ]);
    expect(detail.releasable).toBe(false);
  });

  it('Approve opens a PR for a suggested fix, and starts a bug not run yet', async () => {
    await service.approve('v2-10', 7);
    expect(board.openPr).toHaveBeenCalledWith(10, 7);
    rows = [row({ status: 'backlog', report_status: null })];
    await service.approve('v2-10', 7);
    expect(board.start).toHaveBeenCalledWith(10, {}, 7);
  });

  it("Decline maps the old page's reasons onto v2's dismissals", async () => {
    await service.reject('v2-10', 'too_risky', 'not now', 7);
    expect(board.dismiss).toHaveBeenCalledWith(
      10,
      { reason: 'wont_fix', note: 'not now' },
      7,
    );
    await service.reject('v2-10', 'not_a_bug', undefined, 7);
    expect(board.dismiss).toHaveBeenLastCalledWith(
      10,
      { reason: 'not_a_bug', note: undefined },
      7,
    );
    await expect(
      service.reject('v2-10', 'nope', undefined, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("the old page's AI mode is v2's autonomous, both ways", async () => {
    expect((await service.settings()).mode).toBe('ai');
    await service.setMode('ai', 7);
    expect(board.setMode).toHaveBeenCalledWith('autonomous', 7);
  });

  it('every compat route needs the v2 toggle', () => {
    const proto = BugHunterCompatController.prototype as any;
    for (const name of [
      'settings',
      'setMode',
      'findings',
      'finding',
      'decisions',
      'approve',
      'reject',
      'start',
      'merge',
      'release',
    ]) {
      expect(
        Reflect.getMetadata(FEATURE_TOGGLE_KEY, proto[name])?.featureKey,
      ).toBe(FeatureToggleKey.BUG_HUNTER_V2_VERDICTS);
    }
  });
});
