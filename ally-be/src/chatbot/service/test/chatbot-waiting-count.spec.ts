import { ExecutionManager } from '../../../common/execution/execution-manager';
import { ChatbotService } from '../chatbot.service';

/** The home's waiting count: only for members who can respond, edit or own. */
function waiting(rows: unknown[], { roles = false }: { roles?: boolean } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('information_schema'))
      return roles ? [{ '?column?': 1 }] : [];
    return rows;
  });
  const call = (ids: string[]) =>
    (
      ChatbotService.prototype as unknown as {
        waitingCounts: (ids: string[]) => Promise<Map<string, number>>;
      }
    ).waitingCounts.call({ chatbotRepository: { manager: { query } } }, ids);
  return { query, call };
}

describe('ChatbotService waiting count', () => {
  beforeEach(() => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(7 as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('counts waiting chats per bot for the caller', async () => {
    const w = waiting([{ chatbot_id: 'a', count: '3' }]);
    const counts = await w.call(['a', 'b']);
    expect(counts.get('a')).toBe(3);
    expect(counts.get('b')).toBeUndefined();
  });

  it('restricts the count to editors and owners, plus responders once roles exist', async () => {
    const before = waiting([]);
    await before.call(['a']);
    const sqlBefore = before.query.mock.calls.find((c) =>
      c[0].includes('FROM chatbot_conversations'),
    )![0];
    expect(sqlBefore).toContain("m.role IN ('editor', 'owner')");
    expect(sqlBefore).not.toContain('responder');
    expect(sqlBefore).toContain(
      'needs_person_since IS NOT NULL AND c.handled_by_user_id IS NULL',
    );

    const after = waiting([], { roles: true });
    await after.call(['a']);
    const sqlAfter = after.query.mock.calls.find((c) =>
      c[0].includes('FROM chatbot_conversations'),
    )![0];
    expect(sqlAfter).toContain('to_jsonb(m."roles") ? \'responder\'');
  });

  it('is empty with no user or no bots', async () => {
    jest
      .spyOn(ExecutionManager, 'getUserId')
      .mockReturnValue(undefined as never);
    expect((await waiting([]).call(['a'])).size).toBe(0);
  });
});
