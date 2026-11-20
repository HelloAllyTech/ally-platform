import { RoadmapOpportunityRepository } from './roadmap-opportunity.repository';

/**
 * Filter-clause tests for the triage Inbox. applyFilters is private and only appends clauses to a
 * query builder, so a recording fake is enough — the SQL itself is exercised by the e2e path.
 */
describe('RoadmapOpportunityRepository owner filter', () => {
  const run = (owner: string[]) => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const qb = {
      andWhere: (sql: string, params?: Record<string, unknown>) => {
        calls.push([sql, params]);
        return qb;
      },
    };
    const repo = Object.create(
      RoadmapOpportunityRepository.prototype,
    ) as unknown as {
      applyFilters: (q: unknown, o: unknown) => void;
    };
    repo.applyFilters(qb, { owner, userId: 1, periodKey: '2026-11' });
    return calls;
  };

  it('treats "unassigned" as no linked user and no legacy owner text', () => {
    const [[sql, params]] = run(['unassigned']);
    expect(sql).toContain('"ownerUserId" IS NULL');
    expect(sql).not.toContain('IN (:...owner)');
    expect(params).toEqual({});
  });

  it('keeps matching names on both columns', () => {
    const [[sql, params]] = run(['Priya']);
    expect(sql).toContain('owner_user.name IN (:...owner)');
    expect(params).toEqual({ owner: ['Priya'] });
  });

  it('ORs unassigned with names rather than ANDing them', () => {
    const [[sql, params]] = run(['Priya', 'unassigned']);
    expect(sql).toMatch(/^\(.* OR .*\)$/s);
    expect(params).toEqual({ owner: ['Priya'] });
  });

  it('adds the needs-triage clause: unowned or unsized', () => {
    const calls: string[] = [];
    const qb = {
      andWhere: (sql: string) => {
        calls.push(sql);
        return qb;
      },
    };
    const repo = Object.create(
      RoadmapOpportunityRepository.prototype,
    ) as unknown as { applyFilters: (q: unknown, o: unknown) => void };
    repo.applyFilters(qb, { needsTriage: true, userId: 1, periodKey: 'x' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"effort" IS NULL');
    expect(calls[0]).toContain('"ownerUserId" IS NULL');
  });
});
