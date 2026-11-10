import { QueryRunner } from 'typeorm';
import { AddAgentLessonCollections1981000400000 } from './1981000400000-AddAgentLessonCollections';
import { CopyAgentMemoriesIntoContextLibrary1981000500000 } from './1981000500000-CopyAgentMemoriesIntoContextLibrary';
import { DropAgentMemoriesAndBuilderLessons1981000600000 } from './1981000600000-DropAgentMemoriesAndBuilderLessons';

const at = new Date('2026-10-01T00:00:00Z');

const memories = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    agent: 'bug_hunter',
    body: 'ally-be: scheduler specs need a live Redis.',
    repos: ['ally-be'],
    tags: ['Flaky-Test'],
    status: 'active',
    pinned: true,
    source_count: 3,
    times_applied: 2,
    times_contradicted: 1,
    merged_into_id: null,
    run_id: 'run-1',
    finding_id: 'finding-1',
    created_by: null,
    last_applied_at: at,
    retired_at: null,
    retired_by: null,
    retired_reason: null,
    createdAt: at,
    updatedAt: at,
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    agent: 'bug_hunter',
    body: 'Old note about a fixed suite.',
    repos: null,
    tags: null,
    status: 'retired',
    pinned: false,
    source_count: 1,
    times_applied: 0,
    times_contradicted: 0,
    merged_into_id: null,
    run_id: null,
    finding_id: null,
    created_by: 7,
    last_applied_at: null,
    retired_at: at,
    retired_by: null,
    retired_reason: 'No run applied it.',
    createdAt: at,
    updatedAt: at,
  },
];

const lessons = [
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    sessionId: 'session-1',
    repo: 'ally-web',
    repos: null,
    category: 'gotcha',
    lesson: 'NX_DAEMON=false or the admin suite hangs on CI.',
    status: 'merged',
    pinned: false,
    sourceCount: 1,
    sourceSessionIds: ['session-0'],
    timesApplied: 0,
    timesContradicted: 0,
    mergedIntoId: 'aaaaaaaa-0000-4000-8000-000000000001',
    tags: ['ci'],
    lastAppliedAt: null,
    createdBy: null,
    createdAt: at,
    updatedAt: at,
  },
];

function fakeRunner(existing: string[] = []) {
  const queries: Array<{ sql: string; params?: any[] }> = [];
  const next: Record<string, number> = {
    bug_hunter_notes: 1,
    builder_lessons: 1,
  };
  const runner = {
    hasTable: jest.fn(async () => true),
    query: jest.fn(async (sql: string, params?: any[]) => {
      queries.push({ sql, params });
      if (sql.includes('FROM "agent_memories" ORDER BY')) return memories;
      if (sql.includes('FROM "builder_lessons" ORDER BY')) return lessons;
      if (sql.includes('SELECT "sync_key" FROM "cl_chunks"'))
        return existing.map((sync_key) => ({ sync_key }));
      if (sql.includes('UPDATE "cl_collections"')) {
        const id = params![0] as string;
        const n = next[id]++;
        return [
          [{ code_prefix: id === 'bug_hunter_notes' ? 'BN' : 'BL', n }],
          1,
        ];
      }
      if (sql.includes('INSERT INTO "cl_chunks"')) return [{ id: params![0] }];
      return [];
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

describe('CopyAgentMemoriesIntoContextLibrary', () => {
  it('copies every row as an agent chunk, keeping its id, status, pin, labels and counts', async () => {
    const { runner, queries } = fakeRunner();
    await new CopyAgentMemoriesIntoContextLibrary1981000500000().up(runner);

    const inserts = queries.filter((q) =>
      q.sql.includes('INSERT INTO "cl_chunks"'),
    );
    expect(inserts).toHaveLength(3);
    const [note, retired, lesson] = inserts.map((q) => q.params!);

    // id, collection, code, statement, body, facets, attributes, pinned, status, quality,
    // source_count, sync_key, agent, embedding_status, times_applied, times_contradicted
    expect(note.slice(0, 4)).toEqual([
      memories[0].id,
      'bug_hunter_notes',
      'BN-0001',
      'ally-be: scheduler specs need a live Redis.',
    ]);
    expect(JSON.parse(note[5])).toEqual({
      repos: ['ally-be'],
      tags: ['flaky-test'],
    });
    expect(JSON.parse(note[6])).toEqual({
      runIds: ['run-1'],
      findingIds: ['finding-1'],
    });
    expect(note.slice(7, 9)).toEqual([true, 'active']);
    expect(note.slice(10, 16)).toEqual([
      3,
      `agent_memories:${memories[0].id}`,
      'bug_hunter',
      'pending',
      2,
      1,
    ]);

    expect(retired[8]).toBe('archived');
    expect(retired[13]).toBe('skipped');
    expect(JSON.parse(retired[9])).toMatchObject({
      retiredReason: 'No run applied it.',
    });

    expect(lesson.slice(0, 3)).toEqual([
      lessons[0].id,
      'builder_lessons',
      'BL-0001',
    ]);
    expect(JSON.parse(lesson[5])).toEqual({
      repos: ['ally-web'],
      category: 'gotcha',
      tags: ['ci'],
    });
    expect(JSON.parse(lesson[6])).toEqual({
      sessionIds: ['session-0', 'session-1'],
    });
    expect(lesson[8]).toBe('superseded');
  });

  it('turns the counters into usage history and points merged rows at their survivor', async () => {
    const { runner, queries } = fakeRunner();
    await new CopyAgentMemoriesIntoContextLibrary1981000500000().up(runner);

    const events = queries.filter((q) =>
      q.sql.includes('INSERT INTO "cl_usage_events"'),
    );
    expect(events.map((q) => [q.params![3], q.params![6]])).toEqual([
      ['agent_applied', 2],
      ['agent_contradicted', 1],
    ]);
    expect(events[0].params![2]).toBe('bug_hunter');
    expect(
      queries.filter((q) => q.sql.includes('"superseded_by_id" =')),
    ).toHaveLength(2);
  });

  it('is idempotent: rows already copied are skipped, and it never deletes or drops', async () => {
    const { runner, queries } = fakeRunner([
      `agent_memories:${memories[0].id}`,
      `agent_memories:${memories[1].id}`,
      `builder_lessons:${lessons[0].id}`,
    ]);
    await new CopyAgentMemoriesIntoContextLibrary1981000500000().up(runner);

    expect(
      queries.filter((q) => q.sql.includes('INSERT INTO "cl_chunks"')),
    ).toEqual([]);
    expect(queries.some((q) => /\b(DROP|DELETE)\b/.test(q.sql))).toBe(false);
  });
});

describe('DropAgentMemoriesAndBuilderLessons', () => {
  const runner = (missing: number) => {
    const queries: string[] = [];
    return {
      queries,
      runner: {
        hasTable: jest.fn(async () => true),
        query: jest.fn(async (sql: string) => {
          queries.push(sql);
          return sql.includes('count(*)') ? [{ n: missing }] : [];
        }),
      } as unknown as QueryRunner,
    };
  };

  it('refuses to drop while any row has no Context Library copy', async () => {
    const { runner: r, queries } = runner(2);
    await expect(
      new DropAgentMemoriesAndBuilderLessons1981000600000().up(r),
    ).rejects.toThrow(/no Context Library copy/);
    expect(queries.some((q) => q.includes('DROP TABLE'))).toBe(false);
  });

  it('drops both tables once every row is copied', async () => {
    const { runner: r, queries } = runner(0);
    await new DropAgentMemoriesAndBuilderLessons1981000600000().up(r);
    expect(queries).toEqual(
      expect.arrayContaining([
        'DROP TABLE IF EXISTS "agent_memories"',
        'DROP TABLE IF EXISTS "builder_lessons"',
      ]),
    );
  });
});

describe('AddAgentLessonCollections', () => {
  it('adds both collections and the grants the plan names', async () => {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    const r = {
      query: jest.fn(async (sql: string, params?: any[]) => {
        calls.push({ sql, params });
        return [];
      }),
    } as unknown as QueryRunner;
    await new AddAgentLessonCollections1981000400000().up(r);

    expect(
      calls
        .filter((c) => c.sql.includes('INSERT INTO "cl_collections"'))
        .map((c) => c.params),
    ).toEqual([
      ['builder_lessons', 'Builder Lessons', 'BL'],
      ['bug_hunter_notes', 'Bug Hunter Notes', 'BN'],
    ]);
    expect(
      calls
        .filter((c) => c.sql.includes('INSERT INTO "cl_use_case_access"'))
        .map((c) => c.params!.join(' → ')),
    ).toEqual([
      'builder_interview → builder_lessons',
      'builder_research → builder_lessons',
      'builder_prd_review → builder_lessons',
      'builder_brief → builder_lessons',
      'builder_build → builder_lessons',
      'mcp_dev → builder_lessons',
      'bug_hunter → bug_hunter_notes',
      'mcp_dev → bug_hunter_notes',
    ]);
  });
});
