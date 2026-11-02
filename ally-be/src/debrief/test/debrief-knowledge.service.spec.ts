import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DebriefKnowledgeService } from '../service/debrief-knowledge.service';

const ROW = {
  id: 'd1',
  title: 'Asking about suicide',
  status: 'indexed',
  is_global: true,
  chunk_count: 4,
  archived_at: null,
  updatedAt: new Date('2026-11-02T00:00:00Z'),
  needs_clinical_sign_off: true,
  clinical_signed_off_at: new Date('2026-11-02T01:00:00Z'),
  signed_current: true,
  signed_by: 'Tanuja',
  tenant_count: 0,
};

function build(opts: { advisors?: number[]; updated?: boolean; row?: object }) {
  const queries: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.trim().startsWith('UPDATE')) {
        return opts.updated === false ? [[], 0] : [[{ id: 'd1' }], 1];
      }
      return [{ ...ROW, ...(opts.row ?? {}) }];
    }),
  };
  const svc = new DebriefKnowledgeService(
    dataSource as any,
    {
      hasToggle: jest.fn(
        async (userId: number, key: string) =>
          key === 'debrief_clinical_sign_off' &&
          (opts.advisors ?? []).includes(userId),
      ),
    } as any,
  );
  return { svc, queries };
}

describe('DebriefKnowledgeService (clinical sign-off)', () => {
  it('lets only a named clinical advisor sign off', async () => {
    await expect(
      build({ advisors: [122] }).svc.signOff('d1', 7),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const { svc, queries } = build({ advisors: [122] });
    const doc = await svc.signOff('d1', 122);
    expect(queries[0]).toContain('clinical_signed_off_hash = content_hash');
    expect(doc.clinical).toBe('signed_off');
    expect(doc.signedOffBy).toBe('Tanuja');
  });

  it('nobody can sign off until someone is named', async () => {
    await expect(build({}).svc.signOff('d1', 122)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses to sign off a document that is not marked clinical', async () => {
    await expect(
      build({ advisors: [122], updated: false }).svc.signOff('d1', 122),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marking a document clinical clears any earlier sign-off', async () => {
    const { svc, queries } = build({
      row: { signed_current: false, signed_by: null },
    });
    const doc = await svc.setClinical('d1', true);
    expect(queries[0]).toContain('clinical_signed_off_hash = NULL');
    expect(doc.clinical).toBe('awaiting');
  });

  it('shows an edited clinical document as awaiting sign-off again', async () => {
    const { svc } = build({ row: { signed_current: false } });
    const { documents, canSignOff } = await svc.listFor(7);
    expect(documents[0].clinical).toBe('awaiting');
    expect(documents[0].signedOffBy).toBeNull();
    expect(canSignOff).toBe(false);
  });
});
