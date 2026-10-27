import { AGENT_MEMORY_CURATOR_SYSTEM } from 'src/prompt/contracts';
import { expectWorkingBase } from 'src/prompt/contracts/test/shipped-prompt-base';

/**
 * The notebook curator's system prompt lives in the Skills Store; its default
 * is a minimal base. It must still carry the operation grammar the curator
 * parses (AGREE / EDIT / ADD / REMOVE with id, candidateId, body, tags) and
 * the PINNED marker the entries are rendered with.
 */
describe('agent_memory_curator_system', () => {
  it('ships a working base', async () => {
    await expectWorkingBase(AGENT_MEMORY_CURATOR_SYSTEM, [
      ...['AGREE', 'EDIT', 'ADD', 'REMOVE'].map((op) => `{"op":"${op}"`),
      ...['id', 'candidateId', 'body', 'tags'].map((key) => `"${key}"`),
      'PINNED',
      'JSON array',
    ]);
  });
});
