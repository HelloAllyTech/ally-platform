import { DEBRIEF_CHAT_SUMMARY_SYSTEM } from 'src/prompt/contracts';
import { expectWorkingBase } from 'src/prompt/contracts/test/shipped-prompt-base';

/**
 * The debrief chat's history-summary system prompt lives in the Skills Store;
 * its default is a minimal base that still asks for a bounded summary.
 */
describe('debrief_chat_summary_system', () => {
  it('ships a working base', async () => {
    await expectWorkingBase(DEBRIEF_CHAT_SUMMARY_SYSTEM, ['300 words']);
  });
});
