import { PmSignalStatus } from '../enum/pm-agent.enum';
import type { SecuritySignalFindingDto } from '../dto/pm-security-signal.dto';
import {
  PmSecuritySignalService,
  securitySignalKey,
} from '../service/pm-security-signal.service';

const finding = (
  over: Partial<SecuritySignalFindingDto> = {},
): SecuritySignalFindingDto => ({
  severity: 'high',
  title: 'Tenant check missing on export endpoint',
  service: 'ally-be',
  file: 'src/export/export.controller.ts',
  line: 42,
  what: 'The export route reads by id without a tenant filter.',
  impact: 'One tenant can read another tenant export.',
  fix: 'Filter by the caller tenant.',
  ...over,
});

function fakeRepo(rows: any[] = []) {
  return {
    rows,
    findOne: jest.fn(
      async ({ where }: any) =>
        rows.find((r) => r.source === where.source && r.key === where.key) ??
        null,
    ),
    create: jest.fn((v: any) => ({ ...v })),
    save: jest.fn(async (v: any) => {
      if (!rows.includes(v)) rows.push(v);
      return v;
    }),
  };
}

describe('PmSecuritySignalService', () => {
  it('key ignores line number and title casing/punctuation', () => {
    expect(securitySignalKey(finding({ line: 1 }))).toBe(
      securitySignalKey(
        finding({
          line: 99,
          title: 'tenant check MISSING on export endpoint!',
        }),
      ),
    );
    expect(securitySignalKey(finding())).not.toBe(
      securitySignalKey(finding({ file: 'src/other.ts' })),
    );
  });

  it('files medium and above, skips low', async () => {
    const repo = fakeRepo();
    const svc = new PmSecuritySignalService(repo as any);
    const res = await svc.ingest([
      finding(),
      finding({ severity: 'medium', file: 'a.ts' }),
      finding({ severity: 'low', file: 'b.ts' }),
    ]);
    expect(res).toMatchObject({ created: 2, skippedLowSeverity: 1 });
    expect(repo.rows[0]).toMatchObject({
      source: 'security_audit',
      status: PmSignalStatus.NEW,
      severity: 'high',
    });
    expect(repo.rows[0].metrics).toMatchObject({
      file: finding().file,
      line: 42,
    });
  });

  it('refreshes an existing row instead of duplicating it', async () => {
    const repo = fakeRepo();
    const svc = new PmSecuritySignalService(repo as any);
    await svc.ingest([finding()]);
    const res = await svc.ingest([finding({ line: 50, severity: 'critical' })]);
    expect(res).toMatchObject({ created: 0, refreshed: 1 });
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ severity: 'critical' });
  });

  it('never reopens a dismissed signal', async () => {
    const repo = fakeRepo();
    const svc = new PmSecuritySignalService(repo as any);
    await svc.ingest([finding()]);
    repo.rows[0].status = PmSignalStatus.DISMISSED;
    const res = await svc.ingest([finding()]);
    expect(res.skippedDismissed).toBe(1);
    expect(repo.rows[0].status).toBe(PmSignalStatus.DISMISSED);
  });
});
