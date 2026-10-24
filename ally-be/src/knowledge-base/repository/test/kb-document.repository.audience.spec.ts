import { IsNull } from 'typeorm';
import { KbCorpus } from '../../enum/knowledge-base.enum';
import { KbDocumentRepository } from '../kb-document.repository';

/**
 * The Postgres half of the library's tenant isolation: which documents an audience may read,
 * and which an owner may manage. These clauses are the allow-list every library search is
 * scoped by, so they are asserted as written rather than trusted.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';

const fakeQueryBuilder = () => {
  const qb: any = {
    clauses: [] as { sql: string; params?: Record<string, unknown> }[],
  };
  const chain = (sql: string, params?: Record<string, unknown>) => {
    qb.clauses.push({ sql, params });
    return qb;
  };
  qb.select = jest.fn(() => qb);
  qb.where = jest.fn(chain);
  qb.andWhere = jest.fn(chain);
  qb.getMany = jest.fn().mockResolvedValue([
    { id: 'g', isGlobal: true },
    { id: 'a', isGlobal: false },
  ]);
  return qb;
};

describe('KbDocumentRepository — audience and ownership', () => {
  let repository: KbDocumentRepository;
  let qb: ReturnType<typeof fakeQueryBuilder>;

  beforeEach(() => {
    repository = new KbDocumentRepository({
      createEntityManager: () => ({}),
    } as any);
    qb = fakeQueryBuilder();
    jest.spyOn(repository, 'createQueryBuilder').mockReturnValue(qb);
  });

  const sql = () => qb.clauses.map((c: any) => c.sql).join('\n');

  it('gives no organisation the global documents only', async () => {
    await repository.retrievableForAudience({
      corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
      tenantId: null,
    });

    expect(sql()).toContain('doc.isGlobal = true');
    expect(sql()).not.toContain('kb_document_tenants');
    expect(sql()).toContain('doc.archivedAt IS NULL');
  });

  it('gives an organisation the global documents plus those targeted at it, and nothing else', async () => {
    const allowed = await repository.retrievableForAudience({
      corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
      tenantId: TENANT_A,
    });

    const audience = qb.clauses.find((c: any) =>
      c.sql.includes('kb_document_tenants'),
    );
    expect(audience.sql).toMatch(/is_global" = true OR EXISTS/);
    expect(audience.sql).toContain('dt.tenant_id = :tenantId');
    expect(audience.sql).toContain('dt."deletedAt" IS NULL');
    expect(audience.params).toEqual({ tenantId: TENANT_A });
    expect(qb.clauses[0].params).toEqual({
      corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
    });
    expect([...allowed.entries()]).toEqual([
      ['g', { isGlobal: true }],
      ['a', { isGlobal: false }],
    ]);
  });

  it('finds a document only for the owner that owns it', async () => {
    const findOne = jest.spyOn(repository, 'findOne').mockResolvedValue(null);

    await repository.findOwned('doc', {
      corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
      tenantId: TENANT_A,
    });
    await repository.findOwned('doc', {
      corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
      tenantId: null,
    });

    expect(findOne.mock.calls[0][0]).toEqual({
      where: {
        id: 'doc',
        corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
        ownerTenantId: TENANT_A,
      },
    });
    // The platform's documents are owner IS NULL — never "no owner condition".
    expect(findOne.mock.calls[1][0]).toEqual({
      where: {
        id: 'doc',
        corpus: KbCorpus.ALLY_GUIDE_LIBRARY,
        ownerTenantId: IsNull(),
      },
    });
  });
});
