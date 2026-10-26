import {
  DEBRIEF_CHAT_SUMMARY_SYSTEM,
  renderPrompt,
} from 'src/prompt/contracts';
import {
  loadPromptTemplate,
  shippedPromptDefault,
} from 'src/common/util/prompt-template.util';

/**
 * The debrief chat's history-summary system prompt (AiChatService.summarizeMessages) moved out of code into the Skills Store. On first deploy sync
 * creates each prompt with its shipped default as live v1, so for identical
 * inputs the system prompt sent must be exactly what the code sent before.
 *
 * LEGACY holds the removed constants verbatim — frozen copies of the source
 * expressions as they stood in git before the move — and each test renders
 * the shipped default the way the call site now does (the text trimmed as
 * sync stores it, then renderPrompt) and compares byte for byte.
 */
const LEGACY = [
  'You are a conversation summarizer.',
  'Given the existing summary (if any) and new messages, produce a concise updated summary.',
  'Capture all key topics, questions asked, decisions made, advice given, and important details.',
  'Preserve anything from the existing summary that remains relevant.',
  'Write in third person (e.g. "The user asked about…", "The assistant suggested…").',
  'Keep the summary under 300 words.',
].join(' ');

describe('debrief_chat_summary_system', () => {
  it('renders its shipped default to the removed constant, byte for byte', async () => {
    const shipped = shippedPromptDefault(DEBRIEF_CHAT_SUMMARY_SYSTEM.code);
    expect(shipped).not.toBeNull();
    expect(renderPrompt(DEBRIEF_CHAT_SUMMARY_SYSTEM, shipped!, {})).toBe(
      LEGACY,
    );
    const loaded = await loadPromptTemplate(
      null,
      DEBRIEF_CHAT_SUMMARY_SYSTEM.code,
    );
    expect(renderPrompt(DEBRIEF_CHAT_SUMMARY_SYSTEM, loaded, {})).toBe(LEGACY);
  });
});
