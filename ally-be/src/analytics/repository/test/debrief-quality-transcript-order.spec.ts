import { DebriefQualityRepository } from '../debrief-quality.repository';

/**
 * Turns reach the database through a queue that does not keep order, so the time a row was saved can
 * put a later turn first. The debrief reads the transcript in the order it was spoken, the order the
 * transcript panel shows.
 */
describe('DebriefQualityRepository.buildTranscript order', () => {
  const build = (rows: unknown[]) => {
    const query = jest.fn(async () => rows);
    const repository = new DebriefQualityRepository({ query } as any);
    return { repository, query };
  };

  it('asks for speech order first, with the save time and id only as tie-breakers', async () => {
    const { repository, query } = build([]);
    await repository.buildTranscript('s1');
    const sql = String((query.mock.calls as any[][])[0][0]);
    expect(sql).toContain(
      'ORDER BY "startSeconds" ASC, "createdAt" ASC, id ASC',
    );
  });

  it('numbers turns in the order the rows come back, skipping empty ones', async () => {
    const { repository } = build([
      { id: 5, sender_id: -1, content: 'first spoken' },
      { id: 4, sender_id: 7, content: '  ' },
      { id: 9, sender_id: 7, content: 'second spoken' },
    ]);
    const { turns, turnByMessageId } = await repository.buildTranscript('s1');
    expect(turns.map((t) => [t.turn_index, t.role, t.text])).toEqual([
      [1, 'client', 'first spoken'],
      [2, 'counselor', 'second spoken'],
    ]);
    expect(turnByMessageId.get(9)).toBe(2);
  });
});
