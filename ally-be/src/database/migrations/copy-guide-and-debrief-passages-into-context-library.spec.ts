import { QueryRunner } from 'typeorm';
import { AddAllyGuideAndDebriefCollections1981000700000 } from './1981000700000-AddAllyGuideAndDebriefCollections';
import { CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000 } from './1981000800000-CopyGuideAndDebriefPassagesIntoContextLibrary';
import { headingFor, withoutByline } from '../migration-helpers/context-library-passages.helpers';
import { DropKbDocumentClinicalSignOff1981000900000 } from './1981000900000-DropKbDocumentClinicalSignOff';

const at = new Date('2026-10-01T00:00:00Z');
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const guideDocs = [
  {
    id: 'g-platform',
    title: 'Self-care for helpers by Jane Q. Doe',
    tags: ['Self Care'],
    is_global: true,
    owner_tenant_id: null,
    chunk_version: 2,
    clinical: false,
    signed_current: false,
    created_by: 3,
  },
  {
    id: 'g-org',
    title: 'Our escalation protocol',
    tags: [],
    is_global: false,
    owner_tenant_id: ORG,
    chunk_version: 1,
    clinical: false,
    signed_current: false,
    created_by: 4,
  },
];

const debriefDocs = [
  {
    id: 'd-targeted',
    title: 'Level guide',
    tags: ['level guide', 'Lay'],
    is_global: false,
    owner_tenant_id: null,
    chunk_version: 1,
    clinical: true,
    signed_current: true,
    created_by: null,
  },
  {
    id: 'd-unsigned',
    title: 'Risk protocol',
    tags: [],
    is_global: true,
    owner_tenant_id: null,
    chunk_version: 1,
    clinical: true,
    signed_current: false,
    created_by: null,
  },
];

const passage = (
  id: string,
  text: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  text,
  page_from: 0,
  page_to: 0,
  section_path: null,
  createdAt: at,
  updatedAt: at,
  ...over,
});

const passages: Record<string, unknown[]> = {
  'g-platform': [
    passage('p1', '  Rest is part of the work.\n\nNot a reward for it.  ', {
      page_from: 12,
      page_to: 13,
      section_path: 'Part 2 > Rest',
    }),
  ],
  'g-org': [passage('p2', 'Call the duty supervisor first.')],
  'd-targeted': [passage('p3', 'Lay helpers: name the feeling.')],
  'd-unsigned': [passage('p4', 'Ask about safety directly.')],
};

function fakeRunner(opts: { existing?: string[]; signOff?: boolean } = {}) {
  const queries: Array<{ sql: string; params?: any[] }> = [];
  const next: Record<string, number> = {
    ally_guide_library: 1,
    debrief_guidance: 1,
  };
  const inserts: Array<any[]> = [];
  const runner = {
    hasTable: jest.fn(async () => true),
    hasColumn: jest.fn(async () => opts.signOff ?? true),
    query: jest.fn(async (sql: string, params?: any[]) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT "sync_key" FROM "cl_chunks"'))
        return (opts.existing ?? []).map((sync_key) => ({ sync_key }));
      if (sql.includes('FROM "kb_documents" d'))
        return params![0] === 'ally_guide_library' ? guideDocs : debriefDocs;
      if (sql.includes('FROM "kb_document_tenants"'))
        return [
          { document_id: 'g-org', tenant_id: ORG },
          { document_id: 'd-targeted', tenant_id: ORG },
          { document_id: 'd-targeted', tenant_id: OTHER },
        ];
      if (sql.includes('FROM "kb_document_chunks"'))
        return passages[params![0] as string] ?? [];
      if (sql.includes('UPDATE "cl_collections"')) {
        const id = params![0] as string;
        const n = next[id]++;
        return [
          [{ code_prefix: id === 'ally_guide_library' ? 'AG' : 'DG', n }],
          1,
        ];
      }
      if (sql.includes('INSERT INTO "cl_chunks"')) {
        inserts.push(params!);
        return [{ id: params![0] }];
      }
      return [];
    }),
  } as unknown as QueryRunner;
  return { runner, queries, inserts };
}

/** The INSERT's parameters, by name. */
const row = (params: any[]) => ({
  id: params[0],
  collectionId: params[1],
  code: params[2],
  statement: params[3],
  body: params[4],
  topics: params[5],
  facets: JSON.parse(params[6]),
  attributes: JSON.parse(params[7]),
  citation: JSON.parse(params[8]),
  isGlobal: params[9],
  tenantIds: params[10],
  ownerTenantId: params[11],
  status: params[12],
  quality: JSON.parse(params[13]),
  syncKey: params[14],
  embeddingStatus: params[15],
});

describe('AddAllyGuideAndDebriefCollections', () => {
  it('adds both collections and grants each to its use case only', async () => {
    const { runner, queries } = fakeRunner();
    await new AddAllyGuideAndDebriefCollections1981000700000().up(runner);
    const params = queries.map((q) => q.params);
    expect(params).toContainEqual([
      'ally_guide_library',
      'Ally Guide Library',
      'AG',
    ]);
    expect(params).toContainEqual([
      'debrief_guidance',
      'Debrief Guidance',
      'DG',
    ]);
    expect(params).toContainEqual(['ally_guide', 'ally_guide_library']);
    expect(params).toContainEqual(['debrief', 'debrief_guidance']);
    expect(JSON.stringify(params)).not.toContain('mcp_dev');
  });
});

describe('CopyGuideAndDebriefPassagesIntoContextLibrary', () => {
  it('copies every passage word for word, with its citation, audience and owner', async () => {
    const { runner, inserts } = fakeRunner();
    await new CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000().up(
      runner,
    );
    const rows = inserts.map(row);
    expect(rows).toHaveLength(4);

    const platform = rows.find((r) => r.id === 'p1')!;
    // The passage exactly as stored: not trimmed, not reflowed.
    expect(platform.body).toBe(
      '  Rest is part of the work.\n\nNot a reward for it.  ',
    );
    expect(platform).toMatchObject({
      collectionId: 'ally_guide_library',
      code: 'AG-0001',
      syncKey: 'kb_document_chunks:p1',
      isGlobal: true,
      tenantIds: [],
      ownerTenantId: null,
      status: 'active',
      embeddingStatus: 'pending',
      facets: { kind: 'material', topic: ['self-care'] },
      attributes: { clinical: false },
    });
    // No author names anywhere: the byline is stripped from the cited title.
    expect(platform.citation).toEqual({
      title: 'Self-care for helpers',
      sectionPath: 'Part 2 > Rest',
      pageFrom: 12,
      pageTo: 13,
    });
    expect(JSON.stringify(platform)).not.toContain('Doe');
    expect(platform.statement).toBe('Self-care for helpers — Rest');
    expect(platform.quality).toMatchObject({
      statementFrom: 'citation',
      enrichment: 'pending',
    });

    const own = rows.find((r) => r.id === 'p2')!;
    expect(own).toMatchObject({
      isGlobal: false,
      tenantIds: [ORG],
      ownerTenantId: ORG,
      facets: { kind: 'protocol' },
    });
  });

  it('copies Debrief targeting as tenantIds and the clinical flag as information', async () => {
    const { runner, inserts } = fakeRunner();
    await new CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000().up(
      runner,
    );
    const rows = inserts.map(row);
    const targeted = rows.find((r) => r.id === 'p3')!;
    expect(targeted).toMatchObject({
      collectionId: 'debrief_guidance',
      code: 'DG-0001',
      isGlobal: false,
      tenantIds: [ORG, OTHER],
      ownerTenantId: null,
      status: 'active',
      attributes: { clinical: true },
      facets: { kind: 'level_guide', level: ['lay'] },
    });
    // A clinical document never signed off was not being served: copied, but held back.
    const unsigned = rows.find((r) => r.id === 'p4')!;
    expect(unsigned).toMatchObject({
      status: 'archived',
      embeddingStatus: 'skipped',
      attributes: { clinical: true },
      quality: { importedAs: 'clinical_sign_off_pending' },
    });
  });

  it('is idempotent: a passage that already has its copy is skipped', async () => {
    const { runner, inserts } = fakeRunner({
      existing: ['kb_document_chunks:p1', 'kb_document_chunks:p3'],
    });
    await new CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000().up(
      runner,
    );
    expect(inserts.map((p) => p[0]).sort()).toEqual(['p2', 'p4']);
  });

  it('only reads documents that were being served, and changes no old row', async () => {
    const { runner, queries } = fakeRunner();
    await new CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000().up(
      runner,
    );
    const docQuery = queries.find((q) =>
      q.sql.includes('FROM "kb_documents" d'),
    )!;
    expect(docQuery.sql).toContain(`"archived_at" IS NULL`);
    expect(docQuery.sql).toContain(`"status" = 'indexed'`);
    for (const { sql } of queries) {
      expect(sql).not.toMatch(/(UPDATE|DELETE FROM) "kb_/);
    }
  });

  it('still runs once the sign-off columns are gone, treating nothing as clinical', async () => {
    const { runner, queries } = fakeRunner({ signOff: false });
    await new CopyGuideAndDebriefPassagesIntoContextLibrary1981000800000().up(
      runner,
    );
    const docQuery = queries.find((q) =>
      q.sql.includes('FROM "kb_documents" d'),
    )!;
    expect(docQuery.sql).not.toContain('needs_clinical_sign_off');
  });

  it('writes a heading from the citation, clipped, until enrichment writes a statement', () => {
    expect(headingFor('Guide', 'A > B > Breathing', 'x')).toBe(
      'Guide — Breathing',
    );
    expect(headingFor('', null, 'Body only.')).toBe('Body only.');
    expect(headingFor('T', 'S'.repeat(400), '').length).toBeLessThanOrEqual(
      200,
    );
    expect(withoutByline('Stand by Me')).toBe('Stand by Me');
  });
});

describe('DropKbDocumentClinicalSignOff', () => {
  it('refuses while any served passage has no copy', async () => {
    const runner = {
      hasTable: jest.fn(async () => true),
      query: jest.fn(async (sql: string) =>
        sql.includes('count(*)') ? [{ n: 2 }] : [],
      ),
    } as unknown as QueryRunner;
    await expect(
      new DropKbDocumentClinicalSignOff1981000900000().up(runner),
    ).rejects.toThrow(/no Context Library copy/);
    expect(
      (runner.query as jest.Mock).mock.calls.some(([sql]: [string]) =>
        sql.includes('DROP COLUMN'),
      ),
    ).toBe(false);
  });

  it('drops the four sign-off columns once every passage is copied', async () => {
    const runner = {
      hasTable: jest.fn(async () => true),
      query: jest.fn(async (sql: string) =>
        sql.includes('count(*)') ? [{ n: 0 }] : [],
      ),
    } as unknown as QueryRunner;
    await new DropKbDocumentClinicalSignOff1981000900000().up(runner);
    const drop = (runner.query as jest.Mock).mock.calls
      .map(([sql]: [string]) => sql)
      .find((sql: string) => sql.includes('DROP COLUMN'));
    for (const column of [
      'needs_clinical_sign_off',
      'clinical_signed_off_by',
      'clinical_signed_off_at',
      'clinical_signed_off_hash',
    ]) {
      expect(drop).toContain(column);
    }
  });
});
