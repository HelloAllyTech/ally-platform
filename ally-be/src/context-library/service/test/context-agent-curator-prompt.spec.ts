import { CONTEXT_LIBRARY_AGENT_CURATOR_SYSTEM } from 'src/prompt/contracts';
import { expectWorkingBase } from 'src/prompt/contracts/test/shipped-prompt-base';

/**
 * The agent curator's system prompt lives in the Skills Store; its default is a minimal base. It
 * must still carry the operation grammar the curator parses (AGREE / EDIT / ADD / REMOVE with
 * id, candidateId, text, category, tags), the PINNED marker the entries are rendered with, and
 * the JSON object the call's JSON mode needs.
 */
describe('context_library_agent_curator_system', () => {
  it('ships a working base', async () => {
    await expectWorkingBase(CONTEXT_LIBRARY_AGENT_CURATOR_SYSTEM, [
      ...['AGREE', 'EDIT', 'ADD', 'REMOVE'].map((op) => `{"op":"${op}"`),
      ...['id', 'candidateId', 'text', 'category', 'tags'].map(
        (key) => `"${key}"`,
      ),
      'PINNED',
      '{"operations"',
    ]);
  });
});
