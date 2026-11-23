import { DebriefContextRepository } from '../service/debrief-context.repository';

/**
 * PRD §6.1: no learner message, no debrief. A blank line (an empty
 * transcription) is not a learner turn, so it must not lift a silent session
 * into a "short" debrief written about nothing.
 */
describe('DebriefContextRepository learner turns', () => {
  it('counts only learner messages with words in them', async () => {
    const query = jest.fn(async () => []);
    await new DebriefContextRepository({ query } as any).loadSession('s-1');
    const sql = String((query.mock.calls[0] as unknown[])[0]).replace(
      /\s+/g,
      ' ',
    );
    expect(sql).toMatch(
      /m\."senderId" <> -1 AND btrim\(m\.content\) <> ''\) AS learner_turns/,
    );
  });
});
