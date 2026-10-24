/**
 * A small in-memory stand-in for TypeORM repositories and a DataSource, for
 * the pipeline's end-to-end spec. Understands plain equality and `In()` in
 * `where`, `order` on one column, `update` by id or by criteria, and
 * transactions (run inline). Raw SQL goes to `onQuery`.
 */
type Row = Record<string, any>;

const matchValue = (actual: unknown, expected: any) => {
  if (expected && typeof expected === 'object' && expected._type === 'in') {
    return (expected._value as unknown[]).includes(actual);
  }
  return actual === expected;
};
const matches = (row: Row, where: Row | undefined) =>
  Object.entries(where ?? {}).every(([k, v]) => matchValue(row[k], v));

export class FakeRepo {
  rows: Row[] = [];
  private seq = 0;
  constructor(
    private readonly name: string,
    private readonly clock: () => Date,
  ) {}

  private sort(found: Row[], order?: Row) {
    if (!order) return found;
    const [key, dir] = Object.entries(order)[0];
    return [...found].sort((a, b) => {
      const av = a[key] instanceof Date ? a[key].getTime() : a[key];
      const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
      return (av > bv ? 1 : av < bv ? -1 : 0) * (dir === 'DESC' ? -1 : 1);
    });
  }

  // Copies, as TypeORM returns: an update never changes a row already read.
  findOne = async ({ where, order }: Row = {}) => {
    const row = this.sort(
      this.rows.filter((r) => matches(r, where)),
      order,
    )[0];
    return row ? { ...row } : null;
  };
  find = async ({ where, order, take }: Row = {}) => {
    const found = this.sort(
      this.rows.filter((r) => matches(r, where)),
      order,
    ).map((r) => ({ ...r }));
    return take ? found.slice(0, take) : found;
  };
  count = async ({ where }: Row = {}) =>
    this.rows.filter((r) => matches(r, where)).length;
  create = (row: Row) => ({ ...row });
  save = async (row: Row) => {
    const existing = row.id ? this.rows.find((r) => r.id === row.id) : null;
    if (existing) return { ...Object.assign(existing, row) };
    const keyed =
      this.name === 'AgentDelegation'
        ? this.rows.find((r) => r.agentKey === row.agentKey)
        : null;
    if (keyed) return { ...Object.assign(keyed, row) };
    // Distinct, increasing timestamps so ordering by createdAt is stable.
    const at = new Date(this.clock().getTime() + ++this.seq);
    const saved = {
      id: `${this.name}-${this.seq}`,
      createdAt: at,
      updatedAt: at,
      ...row,
    };
    this.rows.push(saved);
    return { ...saved };
  };
  update = async (criteria: string | Row, patch: Row) => {
    const targets =
      typeof criteria === 'string'
        ? this.rows.filter((r) => r.id === criteria)
        : this.rows.filter((r) => matches(r, criteria));
    for (const row of targets) Object.assign(row, patch);
  };
}

export function fakeDb(onQuery: (sql: string, params: unknown[]) => unknown[]) {
  let now = new Date('2026-10-24T00:00:00Z');
  const clock = () => now;
  const repos = new Map<unknown, FakeRepo>();
  const getRepository = (entity: any) => {
    if (!repos.has(entity)) repos.set(entity, new FakeRepo(entity.name, clock));
    return repos.get(entity)!;
  };
  const query = jest.fn(async (sql: string, params: unknown[] = []) =>
    onQuery(sql, params),
  );
  const dataSource = {
    getRepository,
    query,
    transaction: async (fn: any) => fn({ getRepository, query }),
  };
  return {
    dataSource,
    repo: getRepository,
    advanceClock: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
